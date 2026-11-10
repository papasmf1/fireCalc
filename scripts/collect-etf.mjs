// ETF 월봉 수집: Yahoo Finance chart API → data/etf/{TICKER}.json
// 실행: node scripts/collect-etf.mjs
//
// - 기간: 2006-11 ~ 직전 완료 월 (최대 20년)
// - 상장 전 구간은 proxy(VOO←SPY, QQQM←QQQ)의 가격을 상장 첫 달에 맞춰 스케일하여 이어 붙이고 source 로 표시
// - 현재 진행 중인 달은 월말 기준이 아니므로 제외

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchChart, parseBars, monthKey, round, todayKST, currentMonthKST } from './lib/yahoo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'data', 'etf');
const START_MONTH = '2006-11';
const CURRENT_MONTH = currentMonthKST();
const UPDATED_AT = todayKST();

const TARGETS = [
  { ticker: 'VOO', proxy: 'SPY' },
  { ticker: 'SCHD' },
  { ticker: 'QQQM', proxy: 'QQQ' },
  { ticker: 'QLD' },
  { ticker: 'SPYQ', optional: true }, // 실존 여부 미확인 — 없으면 보고만 하고 넘어간다
];
const PROXY_TICKERS = ['SPY', 'QQQ'];

async function loadSeries(symbol) {
  const result = await fetchChart(symbol, { range: 'max', interval: '1mo', events: 'div,split' });
  const rows = parseBars(result, monthKey)
    .filter((r) => r.date !== CURRENT_MONTH && r.date >= START_MONTH && r.adjClose != null);
  const firstTradeSec = result.meta?.firstTradeDate;
  return {
    symbol,
    name: result.meta?.longName ?? result.meta?.shortName ?? null,
    currency: result.meta?.currency ?? 'USD',
    firstTradeDate: firstTradeSec ? new Date(firstTradeSec * 1000).toISOString().slice(0, 10) : null,
    rows,
  };
}

/** 상장 전 구간을 proxy 로 채운다. 상장 첫 달 값으로 비율을 맞춰 연속되게 만든다. */
function stitch(target, series, proxySeries) {
  const real = series.rows.map((r) => ({ ...r, source: target.ticker }));
  if (!target.proxy || real.length === 0 || real[0].date <= START_MONTH) {
    return { monthly: real, usesProxy: false };
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
  return { monthly: [...pre, ...real], usesProxy: pre.length > 0 };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const proxies = {};
  const failures = [];
  for (const p of PROXY_TICKERS) {
    try {
      proxies[p] = await loadSeries(p);
      console.log(`[proxy] ${p}: ${proxies[p].rows.length}개월`);
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

      const { monthly, usesProxy } = stitch(target, series, proxySeries);
      const out = {
        ticker,
        name: series.name ?? ticker,
        inception: series.firstTradeDate ?? monthly[0].date,
        currency: 'USD',
        updatedAt: UPDATED_AT,
        proxy: usesProxy ? target.proxy : null,
        monthly,
      };
      fs.writeFileSync(path.join(OUT_DIR, `${ticker}.json`), JSON.stringify(out, null, 2) + '\n', 'utf8');

      const short = monthly.length < 13 ? ' [경고: 13개월 미만]' : '';
      console.log(
        `[etf] ${ticker}: ${monthly[0].date} ~ ${monthly[monthly.length - 1].date}, ` +
          `${monthly.length}개월, proxy=${usesProxy ? target.proxy : '없음'}, 상장일=${out.inception}${short}`,
      );
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
