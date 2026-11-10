// ETF 월봉 + 배당 이벤트 수집: Yahoo Finance chart API → data/etf/{TICKER}.json
// 실행: node scripts/collect-etf.mjs
//
// - 기간: 2006-11 ~ 직전 완료 월 (최대 20년)
// - 상장 전 구간은 proxy(VOO←SPY, QQQM←QQQ)의 가격을 상장 첫 달에 맞춰 스케일하여 이어 붙이고 source 로 표시
// - 현재 진행 중인 달은 월말 기준이 아니므로 제외
// - dividendEvents: Yahoo 배당 이벤트 원본(ex-date 단위). TTM·배당 빈도 계산은 이 값을 쓴다
//   (월봉 버킷은 ex-date 가 월 경계에 걸리면 한 달이 비거나 두 번 찍힐 수 있기 때문).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchChart, parseBars, monthKey, dayKey, round, todayKST, currentMonthKST } from './lib/yahoo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'data', 'etf');
const START_MONTH = '2006-11';
const START_DATE = '2006-11-01';
const CURRENT_MONTH = currentMonthKST();
const UPDATED_AT = todayKST();

const TARGETS = [
  { ticker: 'VOO', proxy: 'SPY' },
  { ticker: 'SCHD' },
  { ticker: 'QQQM', proxy: 'QQQ' },
  { ticker: 'QLD' },
  { ticker: 'SPYQ', optional: true }, // 실존 확인됨(Tradr 2X Long SPY Quarterly). 데이터가 짧아도 저장
  { ticker: 'JEPQ' },                  // JPMorgan Nasdaq Equity Premium Income ETF, 2022-05 상장, 월배당, proxy 없음
];
const PROXY_TICKERS = ['SPY', 'QQQ'];

async function loadSeries(symbol) {
  const result = await fetchChart(symbol, { range: 'max', interval: '1mo', events: 'div,split' });
  const rows = parseBars(result, monthKey)
    .filter((r) => r.date !== CURRENT_MONTH && r.date >= START_MONTH && r.adjClose != null);
  const firstTradeSec = result.meta?.firstTradeDate;
  const raw = Object.values(result.events?.dividends ?? {})
    .map((d) => ({ exDate: dayKey(d.date), amount: round(d.amount, 6) }))
    .filter((e) => e.exDate >= START_DATE && e.exDate < CURRENT_MONTH + '-01')
    .sort((a, b) => a.exDate.localeCompare(b.exDate));
  const events = dedupeEvents(raw, symbol);

  // 월 버킷 배당은 중복 제거된 이벤트로 다시 계산 (월봉 dividend 와 이벤트 목록을 일치시킴)
  const byMonth = new Map();
  for (const e of events) byMonth.set(e.exDate.slice(0, 7), round((byMonth.get(e.exDate.slice(0, 7)) ?? 0) + e.amount, 6));
  for (const r of rows) r.dividend = byMonth.get(r.date) ?? 0;

  return {
    symbol,
    name: result.meta?.longName ?? result.meta?.shortName ?? null,
    currency: result.meta?.currency ?? 'USD',
    firstTradeDate: firstTradeSec ? dayKey(firstTradeSec) : null,
    rows,
    events,
  };
}

/**
 * Yahoo 이벤트 중복 제거: 금액이 완전히 같고 31일 이내에 찍힌 연속 이벤트는 같은 배당의 중복으로 본다.
 * (예: QQQ 2010-06 두 건 모두 0.036627 — 실제 두 번 지급이 아니라 데이터 중복으로 판단)
 */
function dedupeEvents(events, symbol) {
  const out = [];
  for (const e of events) {
    const prev = out.at(-1);
    const gapDays = prev ? (Date.parse(e.exDate) - Date.parse(prev.exDate)) / 86400000 : Infinity;
    if (prev && prev.amount === e.amount && gapDays <= 31) {
      console.warn(`  [배당 중복 제거] ${symbol}: ${e.exDate} ${e.amount} (앞 이벤트 ${prev.exDate})`);
      continue;
    }
    out.push(e);
  }
  return out;
}

/** 상장 전 구간을 proxy 로 채운다. 상장 첫 달 값으로 비율을 맞춰 연속되게 만든다. */
function stitch(target, series, proxySeries) {
  const real = series.rows.map((r) => ({ ...r, source: target.ticker }));
  const realEvents = series.events.map((e) => ({ ...e, source: target.ticker }));
  if (!target.proxy || real.length === 0 || real[0].date <= START_MONTH) {
    return { monthly: real, dividendEvents: realEvents, usesProxy: false };
  }
  const first = real[0];
  const anchor = proxySeries.rows.find((r) => r.date === first.date);
  if (!anchor) throw new Error(`${target.ticker}: proxy ${target.proxy} 에 ${first.date} 데이터 없음`);

  const kClose = first.close / anchor.close;
  const kAdj = first.adjClose / anchor.adjClose;
  const pre = proxySeries.rows
    .filter((r) => r.date < first.date)
    .map((r) => ({
      date: r.date,
      close: round(r.close * kClose, 4),
      adjClose: round(r.adjClose * kAdj, 4),
      dividend: round(r.dividend * kClose, 6),
      source: target.proxy,
    }));

  // 배당 이벤트: 실제 상장일 이전의 proxy 이벤트만 쓴다 (상장 이후는 실데이터 이벤트와 중복되지 않게)
  const realStart = series.firstTradeDate ?? first.date + '-01';
  const preEvents = proxySeries.events
    .filter((e) => e.exDate < realStart)
    .map((e) => ({ exDate: e.exDate, amount: round(e.amount * kClose, 6), source: target.proxy }));

  return {
    monthly: [...pre, ...real],
    dividendEvents: [...preEvents, ...realEvents],
    usesProxy: pre.length > 0,
  };
}

/** 같은 ex-date 가 두 번 들어갔는지, 같은 달에 여러 번 찍혔는지 점검용 로그 */
function checkDividends(ticker, dividendEvents) {
  const dupDates = dividendEvents.filter((e, i, arr) => i > 0 && arr[i - 1].exDate === e.exDate);
  if (dupDates.length) console.warn(`  [배당 점검] ${ticker}: 같은 ex-date 중복 ${dupDates.length}건`);
  const perMonth = new Map();
  for (const e of dividendEvents) perMonth.set(e.exDate.slice(0, 7), (perMonth.get(e.exDate.slice(0, 7)) ?? 0) + 1);
  const multi = [...perMonth].filter(([, n]) => n > 1).map(([m]) => m);
  if (multi.length) console.log(`  [배당 점검] ${ticker}: 한 달에 2회 이상 ex-date ${multi.length}개월 (${multi.slice(-3).join(', ')} ...)`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const proxies = {};
  const failures = [];
  for (const p of PROXY_TICKERS) {
    try {
      proxies[p] = await loadSeries(p);
      console.log(`[proxy] ${p}: ${proxies[p].rows.length}개월, 배당 ${proxies[p].events.length}건`);
    } catch (err) {
      failures.push({ ticker: p, required: true, message: err.message });
      console.error(`[proxy] ${p} 실패: ${err.message}`);
    }
  }

  for (const target of TARGETS) {
    const { ticker } = target;
    try {
      const series = await loadSeries(ticker);
      if (series.rows.length === 0) throw new Error('수집된 월봉이 없음');

      const proxySeries = target.proxy ? proxies[target.proxy] : null;
      if (target.proxy && !proxySeries) throw new Error(`proxy ${target.proxy} 미확보`);

      const { monthly, dividendEvents, usesProxy } = stitch(target, series, proxySeries);
      const out = {
        ticker,
        name: series.name ?? ticker,
        inception: series.firstTradeDate ?? monthly[0].date,
        currency: 'USD',
        updatedAt: UPDATED_AT,
        proxy: usesProxy ? target.proxy : null,
        monthly,
        dividendEvents,
      };
      fs.writeFileSync(path.join(OUT_DIR, `${ticker}.json`), JSON.stringify(out, null, 2) + '\n', 'utf8');

      const short = monthly.length < 13 ? ' [경고: 13개월 미만]' : '';
      console.log(
        `[etf] ${ticker}: ${monthly[0].date} ~ ${monthly.at(-1).date}, ${monthly.length}개월, ` +
          `배당 이벤트 ${dividendEvents.length}건, proxy=${usesProxy ? target.proxy : '없음'}, 상장일=${out.inception}${short}`,
      );
      checkDividends(ticker, dividendEvents);
    } catch (err) {
      failures.push({ ticker, required: !target.optional, message: err.message });
      console.error(`[etf] ${ticker} 실패: ${err.message}`);
    }
  }

  const requiredFailures = failures.filter((f) => f.required);
  console.log(
    `\n완료. 실패 ${failures.length}건 (필수 ${requiredFailures.length}건)` +
      (failures.length ? ': ' + failures.map((f) => `${f.ticker}(${f.message})`).join(', ') : ''),
  );
  process.exitCode = requiredFailures.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
