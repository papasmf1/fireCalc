// USD/KRW 일별 환율 수집 (매일 실행용): data/fx/usdkrw-daily.json 에 오늘 환율을 append(같은 날짜면 덮어씀)
// 실행: node scripts/collect-fx-daily.mjs
//
// - 파일이 없거나 비어 있으면 Yahoo KRW=X 최근 1년 일봉으로 먼저 채운다.
// - 오늘 환율: Yahoo KRW=X 최신 시세 → 실패 시 open.er-api.com 폴백.
// - 두 원천 모두 실패하면 기존 파일을 건드리지 않고 종료 코드 1.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchChart, fetchJson, parseBars, dayKey, todayKST } from './lib/yahoo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(ROOT, 'data', 'fx', 'usdkrw-daily.json');
const FALLBACK_URL = 'https://open.er-api.com/v6/latest/USD';
const SRC_YAHOO = 'Yahoo Finance KRW=X';
const SRC_FALLBACK = 'open.er-api.com';

function readExisting() {
  if (!fs.existsSync(OUT_FILE)) return { pair: 'USDKRW', source: '', daily: [] };
  try {
    const json = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    return { pair: 'USDKRW', source: json.source ?? '', daily: Array.isArray(json.daily) ? json.daily : [] };
  } catch (err) {
    throw new Error(`기존 ${OUT_FILE} 파싱 실패: ${err.message} (파일을 직접 확인하세요)`);
  }
}

/** 오늘 환율 한 건을 구한다. */
async function fetchToday(today) {
  try {
    const result = await fetchChart('KRW=X', { range: '5d', interval: '1d' });
    const bars = parseBars(result, dayKey);
    const last = bars.at(-1);
    // 장중이면 meta.regularMarketPrice 가 가장 최신 값
    const price = result.meta?.regularMarketPrice ?? last?.close;
    if (!price || price < 500 || price > 3000) throw new Error(`가격 이상: ${price}`);
    return { date: today, rate: round2(price), source: SRC_YAHOO };
  } catch (err) {
    console.warn(`[fx-daily] Yahoo 실패 (${err.message}) → open.er-api.com 폴백`);
    const json = await fetchJson(FALLBACK_URL);
    const krw = json?.rates?.KRW;
    if (json?.result !== 'success' || typeof krw !== 'number') {
      throw new Error(`폴백도 실패: result=${json?.result}, KRW=${krw}`);
    }
    return { date: today, rate: round2(krw), source: SRC_FALLBACK };
  }
}

/** 최근 1년 일봉으로 초기 채움 */
async function backfillOneYear() {
  const result = await fetchChart('KRW=X', { range: '1y', interval: '1d' });
  return parseBars(result, dayKey)
    .filter((r) => r.close >= 500 && r.close <= 3000) // 잘못된 봉(예: 0.11) 제외
    .map((r) => ({ date: r.date, rate: round2(r.close), source: SRC_YAHOO }));
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

async function main() {
  const existing = readExisting();
  const today = todayKST();
  const daily = [...existing.daily];

  if (daily.length === 0) {
    console.log('[fx-daily] 최초 실행: 최근 1년 일봉으로 채움');
    try {
      daily.push(...(await backfillOneYear()));
    } catch (err) {
      console.warn(`[fx-daily] 1년 일봉 실패 (${err.message}) — 오늘 값만 저장`);
    }
  }

  const todayRow = await fetchToday(today);
  const idx = daily.findIndex((r) => r.date === todayRow.date);
  if (idx >= 0) daily[idx] = todayRow;
  else daily.push(todayRow);
  daily.sort((a, b) => a.date.localeCompare(b.date));

  const sources = [...new Set(daily.map((r) => r.source))].join(' + ');
  const out = { pair: 'USDKRW', source: sources, updatedAt: today, daily };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`[fx-daily] 오늘(${today}) ${todayRow.rate}원 (${todayRow.source}), 총 ${daily.length}일 저장`);
}

main().catch((err) => {
  console.error(`[fx-daily] 실패: ${err.message}`);
  process.exitCode = 1;
});
