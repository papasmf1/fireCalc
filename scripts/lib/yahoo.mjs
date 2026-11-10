// Yahoo Finance chart API 공용 헬퍼 (외부 의존성 없음, Node 내장 fetch 사용)

export const USER_AGENT = 'Mozilla/5.0';
const CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function round(value, digits = 4) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

// Yahoo 봉 타임스탬프는 거래소/환율마다 시차가 있다 (예: KRW=X 월봉이 '전월 마지막 날 23:00Z' 로 찍힘).
// 한국 시간(KST) 기준으로 날짜 키를 만들면 1일 00:00 KST 근처의 봉이 올바른 달에 들어간다.
const kstFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' });

/** 초 단위 타임스탬프 → 'YYYY-MM-DD' (KST 기준) */
export function dayKey(sec) {
  return kstFormatter.format(new Date(sec * 1000));
}

/** 초 단위 타임스탬프 → 'YYYY-MM' (KST 기준) */
export function monthKey(sec) {
  return dayKey(sec).slice(0, 7);
}

/** 오늘 날짜(한국 시간 기준) 'YYYY-MM-DD' */
export function todayKST(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(date);
}

/** 현재 달(한국 시간 기준) 'YYYY-MM' — 아직 끝나지 않은 달은 월말 데이터에서 제외하기 위해 사용 */
export function currentMonthKST(date = new Date()) {
  return todayKST(date).slice(0, 7);
}

/** GET + 429/5xx 재시도. 4xx 는 본문을 그대로 돌려줘서 호출부가 chart.error 를 해석하게 한다. */
export async function fetchJson(url, { retries = 3 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}`);
      } else {
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          throw new Error(`HTTP ${res.status}, JSON 아님: ${text.slice(0, 120)}`);
        }
      }
    } catch (err) {
      lastError = err;
    }
    if (attempt < retries) await sleep(1500 * attempt);
  }
  throw lastError ?? new Error('알 수 없는 fetch 오류');
}

/**
 * chart API 결과(result 객체) 를 가져온다.
 * @param {string} symbol  예: 'VOO', 'KRW=X'
 * @param {{range?: string, interval?: string, events?: string}} opts
 */
export async function fetchChart(symbol, { range = 'max', interval = '1mo', events = '', period1, period2 } = {}) {
  const params = new URLSearchParams({ interval });
  if (period1 != null && period2 != null) {
    params.set('period1', String(period1));
    params.set('period2', String(period2));
  } else {
    params.set('range', range);
  }
  if (events) params.set('events', events);
  const url = `${CHART_BASE}/${encodeURIComponent(symbol)}?${params.toString()}`;

  const json = await fetchJson(url);
  if (json?.chart?.error) {
    const { code, description } = json.chart.error;
    throw new Error(`${symbol}: Yahoo 오류 ${code ?? ''} ${description ?? ''}`.trim());
  }
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`${symbol}: 응답에 result 없음`);
  return result;
}

/**
 * chart result → 봉 배열 [{ date, close, adjClose, dividend }] (오래된 순).
 * keyFn 으로 날짜 키를 정한다 (monthKey 또는 dayKey).
 * close 가 null 인 봉은 제외. adjClose 가 없는 시리즈(환율 등)는 null.
 */
export function parseBars(result, keyFn) {
  const ts = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const adjArr = result.indicators?.adjclose?.[0]?.adjclose ?? null;

  const byKey = new Map();
  ts.forEach((t, i) => {
    const close = quote.close?.[i];
    if (close == null) return;
    const adj = adjArr ? adjArr[i] : null;
    const key = keyFn(t);
    byKey.set(key, {
      date: key,
      close: round(close, 4),
      adjClose: adj == null ? null : round(adj, 4),
      dividend: 0,
    });
  });

  for (const d of Object.values(result.events?.dividends ?? {})) {
    const row = byKey.get(keyFn(d.date));
    if (row) row.dividend = round(row.dividend + d.amount, 6);
  }

  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date));
}
