// USD/KRW 월말 환율 수집: Yahoo KRW=X 일봉 → 월말 종가 → data/fx/usdkrw-monthly.json
// 실행: node scripts/collect-fx.mjs
//
// 월봉(interval=1mo)에는 잘못된 봉(예: 2015-02 = 0.1103)이 섞여 있어서 쓰지 않는다.
// 일봉을 전체 기간(period1~period2)으로 받아 달별 마지막 거래일 종가를 월말 환율로 쓴다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchChart, parseBars, dayKey, todayKST, currentMonthKST } from './lib/yahoo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(ROOT, 'data', 'fx', 'usdkrw-monthly.json');
const START_MONTH = '2006-11';
const PLAUSIBLE = { min: 500, max: 3000 }; // USD/KRW 역사적 범위 밖이면 잘못된 봉으로 보고 제외

const period1 = Math.floor(Date.UTC(2006, 10, 1) / 1000); // 2006-11-01
const period2 = Math.floor(Date.now() / 1000);

const result = await fetchChart('KRW=X', { interval: '1d', period1, period2 });
const currentMonth = currentMonthKST();

const daily = parseBars(result, dayKey).filter((r) => r.close >= PLAUSIBLE.min && r.close <= PLAUSIBLE.max);
const byMonth = new Map();
for (const r of daily) byMonth.set(r.date.slice(0, 7), { date: r.date.slice(0, 7), rate: r.close, lastDay: r.date });

const monthly = [...byMonth.values()]
  .filter((r) => r.date !== currentMonth && r.date >= START_MONTH)
  .map(({ date, rate, lastDay }) => ({ date, rate, asOf: lastDay }));

if (monthly.length === 0) {
  console.error('월말 환율이 비어 있음 — 파일을 갱신하지 않음');
  process.exitCode = 1;
} else {
  const out = {
    pair: 'USDKRW',
    source: 'Yahoo Finance KRW=X 일봉의 달별 마지막 거래일 종가',
    updatedAt: todayKST(),
    monthly,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`[fx-monthly] ${monthly[0].date} ~ ${monthly.at(-1).date}, ${monthly.length}개월 → ${OUT_FILE}`);
}
