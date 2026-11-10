// 요약 지표 계산: data/etf/*.json + data/fx/usdkrw-monthly.json → data/summary.json
// 실행: node scripts/compute-summary.mjs
//
// 기간: 5y / 10y / 20y 각각 USD 기준과 KRW 기준.
//  - 기간 N년 = 마지막 달 기준 과거 12N개월 수익률 (시작 가격 포인트 = 12N개월 전 달).
//  - 데이터가 모자라면 가능한 만큼만 쓰고 coverage: "partial" 로 표시 (예: 2006-11 시작 → 20y 는 239개월).
//  - KRW 기준: 매월 월말 조정종가 × 월말 USDKRW 환율 로 원화 평가액을 만들어 계산.
//  - bestYear / worstYear: 완전한 달력연도(전년 12월 → 당해 12월) 기준.
//  - dividendYield: 최근 12개월 배당 합 ÷ 마지막 달 종가 (KRW 는 각 달 환율 반영).
//  - volatility: 월수익률 표본표준편차 × √12.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { todayKST } from './lib/yahoo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ETF_DIR = path.join(ROOT, 'data', 'etf');
const FX_FILE = path.join(ROOT, 'data', 'fx', 'usdkrw-monthly.json');
const OUT_FILE = path.join(ROOT, 'data', 'summary.json');
const TICKERS = ['VOO', 'SCHD', 'QQQM', 'QLD', 'SPYQ'];
const PERIODS = [5, 10, 20];

const round = (v, d = 6) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

function stdev(xs) {
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/**
 * rows: [{date, close, adjClose, dividend, source}] — 같은 달 기준으로 정렬되어 있고 환율이 붙은 상태
 * values: 평가 기준 가격 배열 (USD: adjClose, KRW: adjClose*rate)
 */
function computeWindow(rows, valueOf, rateOf, ticker, months) {
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

  // 최근 12개월 배당수익률 (마지막 달 기준)
  const last = win[m];
  const ttm = rows.slice(-12);
  const divSum = ttm.reduce((acc, r) => acc + r.dividend * rateOf(r), 0);
  const dividendYield = round(divSum / (last.close * rateOf(last)), 6);

  const total = V[m] / V[0] - 1;
  const cagr = Math.pow(V[m] / V[0], 12 / m) - 1;
  const vol = stdev(rets);

  return {
    start: win[0].date,
    end: last.date,
    months: m,
    coverage: m === 12 * (months / 12) ? 'full' : 'partial',
    cagr: round(cagr, 6),
    totalReturn: round(total, 6),
    volatility: round(vol * Math.sqrt(12), 6),
    maxDrawdown: round(mdd, 6),
    bestYear: best,
    worstYear: worst,
    dividendYield,
    usesProxy: win.some((r) => r.source !== ticker),
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

    const periods = {};
    for (const years of PERIODS) {
      const months = years * 12;
      periods[`${years}y`] = {
        USD: computeWindow(rows, (r) => r.adjClose, rateOf, ticker, months),
        KRW: computeWindow(rows, (r) => r.adjClose * rateOf(r), rateOf, ticker, months),
      };
    }
    out.tickers[ticker] = {
      name: etf.name,
      inception: etf.inception,
      proxy: etf.proxy ?? null,
      firstMonth: etf.monthly[0].date,
      lastMonth: etf.monthly.at(-1).date,
      periods,
    };
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');

  // 콘솔 요약
  console.log('ticker  period  cur  months  cover    CAGR      total     vol      MDD      divYld  proxy');
  for (const [t, info] of Object.entries(out.tickers)) {
    if (!info.periods) continue;
    for (const [p, cur] of Object.entries(info.periods)) {
      for (const c of ['USD', 'KRW']) {
        const s = cur[c];
        if (s.error) {
          console.log(`${t.padEnd(7)} ${p.padEnd(6)}  ${c}  ${s.error}`);
          continue;
        }
        const pct = (v) => (v == null ? '   -  ' : (v * 100).toFixed(2).padStart(6) + '%');
        console.log(
          `${t.padEnd(7)} ${p.padEnd(6)}  ${c}  ${String(s.months).padStart(5)}  ${s.coverage.padEnd(7)}  ${pct(s.cagr)}  ${pct(s.totalReturn)}  ${pct(s.volatility)}  ${pct(s.maxDrawdown)}  ${pct(s.dividendYield)}  ${s.usesProxy ? 'Y' : '-'}`,
        );
      }
    }
  }
  console.log(`\n→ ${OUT_FILE}`);
}

main();
