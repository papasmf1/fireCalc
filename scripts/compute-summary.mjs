// 요약 지표 계산: data/etf/*.json + data/fx/usdkrw-monthly.json → data/summary.json
// 실행: node scripts/compute-summary.mjs
//
// 기간: 5y / 10y / 20y 각각 USD 기준과 KRW 기준.
//  - 기간 N년 = 마지막 달 기준 과거 12N개월 수익률 (시작 가격 포인트 = 12N개월 전 달).
//  - 데이터가 모자라면 가능한 만큼만 쓰고 coverage: "partial" 로 표시.
//  - KRW 기준: 매월 월말 조정종가 × 월말 USDKRW 환율 로 원화 평가액을 만들어 계산.
//  - bestYear / worstYear: 완전한 달력연도(전년 12월 → 당해 12월) 기준.
//  - volatility: 월수익률 표본표준편차 × √12.
//
// 배당 지표 (티커 단위, 기간과 무관):
//  - trailing12mDividendUsd: 마지막 완료 월 기준 최근 12개월(ex-date 기준) 주당 배당 합 (USD)
//  - dividendYieldTtm: trailing12mDividendUsd ÷ 마지막 달 종가 (USD)
//  - dividendYieldTtmKrw: 배당을 ex-date 월 환율로 원화 환산한 합 ÷ (마지막 종가 × 마지막 환율)
//  - dividendFrequency: 최근 12개월 ex-date 횟수로 판정 (11회 이상 monthly, 3~5회 quarterly, 그 외 other)
//  - dividendCagr5y: 완전한 연도 기준 연간 배당 합의 5년 CAGR (마지막 완전 연도 vs 5년 전). 불가하면 null
//  - dividendCagrPeriod: 5년이 안 될 때 가능한 가장 긴 구간의 CAGR (예: JEPQ 2023→2025)
//  배당은 월 버킷이 아니라 dividendEvents(ex-date 원본) 를 쓴다. 월 버킷은 12월 두 번·1월 없음처럼 어긋날 수 있음.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { todayKST } from './lib/yahoo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ETF_DIR = path.join(ROOT, 'data', 'etf');
const FX_FILE = path.join(ROOT, 'data', 'fx', 'usdkrw-monthly.json');
const OUT_FILE = path.join(ROOT, 'data', 'summary.json');
const TICKERS = ['VOO', 'SCHD', 'QQQM', 'QLD', 'SPYQ', 'JEPQ'];
const PERIODS = [5, 10, 20];

const round = (v, d = 6) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

function stdev(xs) {
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/** 'YYYY-MM' 에 달 수를 더해 그 달의 말일 'YYYY-MM-DD' 를 돌려준다 */
function monthEnd(ym, addMonths = 0) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + addMonths + 1, 0)).toISOString().slice(0, 10);
}

/** 기간 수익률/변동성/MDD 계산. rows 는 환율이 붙은 월 행, valueOf 는 평가 가격 */
function computeWindow(rows, valueOf, ticker, months, dividendYieldTtm) {
  const win = rows.slice(-(months + 1));
  const m = win.length - 1;
  if (m < 12) return { error: `데이터 부족 (${m}개월)` };

  const V = win.map(valueOf);
  if (V.some((v) => v == null || !Number.isFinite(v))) return { error: '환율 누락' };

  const rets = [];
  for (let i = 1; i <= m; i++) rets.push(V[i] / V[i - 1] - 1);

  let peak = V[0];
  let mdd = 0;
  for (const v of V) {
    peak = Math.max(peak, v);
    mdd = Math.min(mdd, v / peak - 1);
  }

  // 완전한 달력연도 수익률 (전년 12월 → 당해 12월 모두 window 안에 있어야 함)
  const decValue = new Map();
  win.forEach((r, i) => {
    if (r.date.endsWith('-12')) decValue.set(r.date.slice(0, 4), V[i]);
  });
  const years = [];
  for (const [y, v] of decValue) {
    const prev = decValue.get(String(Number(y) - 1));
    if (prev != null) years.push({ year: Number(y), return: round(v / prev - 1, 6) });
  }
  const best = years.reduce((a, b) => (a == null || b.return > a.return ? b : a), null);
  const worst = years.reduce((a, b) => (a == null || b.return < a.return ? b : a), null);

  const cagr = Math.pow(V[m] / V[0], 12 / m) - 1;
  const vol = stdev(rets);

  return {
    start: win[0].date,
    end: win[m].date,
    months: m,
    coverage: m === months ? 'full' : 'partial',
    cagr: round(cagr, 6),
    totalReturn: round(V[m] / V[0] - 1, 6),
    volatility: round(vol * Math.sqrt(12), 6),
    maxDrawdown: round(mdd, 6),
    bestYear: best,
    worstYear: worst,
    dividendYield: dividendYieldTtm,
    usesProxy: win.some((r) => r.source !== ticker),
  };
}

/** 배당 지표 (티커 단위) */
function dividendMetrics(etf, rows, rateByMonth) {
  const events = etf.dividendEvents ?? [];
  const lastRow = rows.at(-1);
  const lastMonth = lastRow.date;
  const lastClose = lastRow.close;
  const lastRate = rateByMonth.get(lastMonth);

  // 최근 12개월: (말일 - 12개월, 말일]
  const endDay = monthEnd(lastMonth);
  const startExcl = monthEnd(lastMonth, -12);
  const ttmEvents = events.filter((e) => e.exDate > startExcl && e.exDate <= endDay);
  const ttmUsd = ttmEvents.reduce((a, e) => a + e.amount, 0);
  const ttmKrwNum = ttmEvents.reduce((a, e) => a + e.amount * (rateByMonth.get(e.exDate.slice(0, 7)) ?? NaN), 0);

  const n = ttmEvents.length;
  const frequency = n >= 11 ? 'monthly' : n >= 3 && n <= 5 ? 'quarterly' : 'other';

  // 연간 배당 합 (완전한 연도만)
  const annual = new Map();
  for (const e of events) {
    const y = Number(e.exDate.slice(0, 4));
    annual.set(y, (annual.get(y) ?? 0) + e.amount);
  }
  const firstMonth = rows[0].date;
  const lastFullYear = lastMonth.endsWith('-12') ? Number(lastMonth.slice(0, 4)) : Number(lastMonth.slice(0, 4)) - 1;
  const firstFullYear = firstMonth.endsWith('-01') ? Number(firstMonth.slice(0, 4)) : Number(firstMonth.slice(0, 4)) + 1;

  const cagrBetween = (from, to) => {
    const a = annual.get(from);
    const b = annual.get(to);
    if (!a || !b || a <= 0 || b <= 0) return null;
    return Math.pow(b / a, 1 / (to - from)) - 1;
  };

  const cagr5 = lastFullYear - 5 >= firstFullYear ? cagrBetween(lastFullYear - 5, lastFullYear) : null;
  let period = null;
  const shortFrom = Math.max(firstFullYear, lastFullYear - 5);
  if (lastFullYear - shortFrom >= 1) {
    const v = cagrBetween(shortFrom, lastFullYear);
    period = v == null ? null : { from: shortFrom, to: lastFullYear, years: lastFullYear - shortFrom, value: round(v, 6) };
  }

  return {
    trailing12mDividendUsd: round(ttmUsd, 6),
    dividendYieldTtm: round(ttmUsd / lastClose, 6),
    dividendYieldTtmKrw: lastRate ? round(ttmKrwNum / (lastClose * lastRate), 6) : null,
    trailing12mDividendEvents: n,
    dividendFrequency: frequency,
    dividendCagr5y: round(cagr5, 6),
    dividendCagrPeriod: period,
    dividendAnnualUsd: Object.fromEntries(
      [...annual].filter(([y]) => y >= firstFullYear && y <= lastFullYear).map(([y, v]) => [y, round(v, 6)]),
    ),
    dividendNote:
      cagr5 == null && period == null
        ? `데이터가 짧아 연간 배당 성장률을 계산할 수 없음 (완전한 연도 ${firstFullYear}~${lastFullYear})`
        : null,
  };
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const fx = loadJson(FX_FILE).monthly;
  const rateByMonth = new Map(fx.map((r) => [r.date, r.rate]));

  const out = {
    generatedAt: todayKST(),
    notes: [
      'USD: 조정종가(배당·분할 반영) 기준 총수익',
      'KRW: 월말 조정종가 × 월말 USDKRW 환율 (매월 환전 후 원화 평가)',
      'coverage "partial": 요청 기간보다 데이터가 짧아 가능한 기간만 사용',
      '배당 지표는 Yahoo 배당 이벤트(ex-date) 기준, 주당 금액(USD)',
    ],
    tickers: {},
  };

  for (const ticker of TICKERS) {
    const file = path.join(ETF_DIR, `${ticker}.json`);
    if (!fs.existsSync(file)) {
      out.tickers[ticker] = { error: 'data/etf 파일 없음' };
      console.warn(`[summary] ${ticker}: 파일 없음, 건너뜀`);
      continue;
    }
    const etf = loadJson(file);
    // 환율이 있는 달만 사용 (KRW 계산 가능 구간)
    const rows = etf.monthly.filter((r) => rateByMonth.has(r.date));
    const rateOf = (r) => rateByMonth.get(r.date);
    const div = dividendMetrics(etf, rows, rateByMonth);

    const periods = {};
    for (const years of PERIODS) {
      const months = years * 12;
      periods[`${years}y`] = {
        USD: computeWindow(rows, (r) => r.adjClose, ticker, months, div.dividendYieldTtm),
        KRW: computeWindow(rows, (r) => r.adjClose * rateOf(r), ticker, months, div.dividendYieldTtmKrw),
      };
    }
    out.tickers[ticker] = {
      name: etf.name,
      inception: etf.inception,
      proxy: etf.proxy ?? null,
      firstMonth: etf.monthly[0].date,
      lastMonth: etf.monthly.at(-1).date,
      ...div,
      periods,
    };
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');

  // 콘솔 요약
  const pct = (v) => (v == null ? '    -  ' : (v * 100).toFixed(2).padStart(6) + '%');
  console.log('ticker  period  cur  months  cover    CAGR      total     vol      MDD      divYld');
  for (const [t, info] of Object.entries(out.tickers)) {
    if (!info.periods) continue;
    for (const [p, cur] of Object.entries(info.periods)) {
      for (const c of ['USD', 'KRW']) {
        const s = cur[c];
        if (s.error) {
          console.log(`${t.padEnd(7)} ${p.padEnd(6)}  ${c}  ${s.error}`);
          continue;
        }
        console.log(
          `${t.padEnd(7)} ${p.padEnd(6)}  ${c}  ${String(s.months).padStart(5)}  ${s.coverage.padEnd(7)}  ${pct(s.cagr)}  ${pct(s.totalReturn)}  ${pct(s.volatility)}  ${pct(s.maxDrawdown)}  ${pct(s.dividendYield)}`,
        );
      }
    }
  }

  console.log('\n[배당 지표]');
  console.log('ticker  TTM($)    yieldUSD  yieldKRW  events freq       divCAGR5y  period');
  for (const [t, info] of Object.entries(out.tickers)) {
    if (!info.periods) continue;
    const cp = info.dividendCagrPeriod;
    console.log(
      `${t.padEnd(7)} ${String(info.trailing12mDividendUsd).padStart(8)}  ${pct(info.dividendYieldTtm)}  ${pct(info.dividendYieldTtmKrw)}  ${String(info.trailing12mDividendEvents).padStart(6)}  ${info.dividendFrequency.padEnd(10)} ${pct(info.dividendCagr5y)}  ${cp ? `${cp.from}→${cp.to} ${pct(cp.value)}` : '-'}`,
    );
  }
  console.log(`\n→ ${OUT_FILE}`);
}

main();
