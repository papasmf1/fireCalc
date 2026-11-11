# fireCalc — 구현 플랜 (Opus 작성)

은퇴·노후 준비(FIRE)를 위한 미국 ETF 투자 시뮬레이터. 한국 투자자가 **원화(KRW)를 달러(USD)로 환전**해 5개 미국 ETF에 투자하는 상황을 과거 데이터로 시뮬레이션한다.

- 스택: Next.js (App Router, `src/`), TypeScript(strict), Tailwind, shadcn/ui, Recharts(shadcn chart)
- 프로젝트 경로: `C:\Users\student\Desktop\firecalc` (사이트 이름은 **fireCalc**)
- UI 언어: 한국어. 금액 표기는 원화 기본, 달러 병기.

## 역할 분담 (herdr)

| 창 | 모델 | 역할 | 작업 범위 |
|---|---|---|---|
| 왼쪽 위 | Claude Opus | 총괄, 플랜, 최종 보고 | `docs/PLAN.md` |
| 오른쪽 위 | Codex gpt-reserve | 구현 | `src/**`, `components.json`, `package.json` 등 앱 코드 |
| 왼쪽 아래 | Claude Haiku | 데이터 수집 | `scripts/collect-*.mjs`, `data/**` 만 |
| 오른쪽 아래 | Claude Sonnet | 코드·데이터 리뷰 | `docs/REVIEW.md` 만 (코드 수정 금지) |

Haiku와 Codex는 동시에 작업한다. 둘 사이의 계약은 아래 **데이터 계약**이다. Codex는 `data/` 파일이 아직 없으면 같은 스키마의 작은 fixture로 개발하고, 실제 파일이 생기면 그것을 사용한다.

## 대상 ETF

| 티커 | 설명 | 상장 | 20년 데이터 대체(proxy) |
|---|---|---|---|
| VOO | Vanguard S&P 500 | 2010-09 | 상장 전은 SPY |
| SCHD | Schwab US Dividend Equity | 2011-10 | 상장 전은 없음 → 가능한 기간만 (Haiku가 대안 조사·보고, 예: DVY는 지수가 달라 참고용) |
| QQQM | Invesco NASDAQ 100 | 2020-10 | 상장 전은 QQQ |
| QLD | ProShares Ultra QQQ (2x) | 2006-06 | 2006-06 이전은 없음 |
| SPYQ | 사용자 지정 티커 | Haiku가 **실존 여부·정식 명칭·상장일 확인** | 확인 결과에 따름. 없으면 원본 데이터 없이 보고 |

proxy로 이어 붙인 구간은 데이터에 반드시 표시한다(`source` 필드). UI에서도 "상장 전 구간은 SPY/QQQ 데이터로 대체"라고 안내한다.

## 데이터 계약 (Haiku → Codex)

수집 원천: Yahoo Finance chart API (`https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?range=max&interval=1mo&events=div,split`), 환율은 `KRW=X`.
수집 스크립트는 Node(.mjs, 외부 의존성 없이 `fetch`)로 작성하고 재실행 가능해야 한다.

### `data/etf/{TICKER}.json`
```json
{
  "ticker": "VOO",
  "name": "Vanguard S&P 500 ETF",
  "inception": "2010-09-09",
  "currency": "USD",
  "updatedAt": "2026-11-11",
  "monthly": [
    { "date": "2006-11", "close": 140.1, "adjClose": 98.2, "dividend": 0.0, "source": "SPY" }
  ]
}
```
- `monthly`: 월말 기준, 오래된 순. `adjClose`는 배당·분할 반영 총수익 지수. proxy 구간은 proxy의 수익률로 역산해 실제 상장 첫 달과 이어지도록 스케일을 맞춘다.
- 최소 20년(2006-11~) 시도, 불가능하면 가능한 기간만.

### `data/fx/usdkrw-monthly.json`
```json
{ "pair": "USDKRW", "updatedAt": "2026-11-11", "monthly": [ { "date": "2006-11", "rate": 930.5 } ] }
```

### `data/fx/usdkrw-daily.json` (매일 환율 수집)
```json
{ "pair": "USDKRW", "source": "...", "daily": [ { "date": "2026-11-11", "rate": 1380.2 } ] }
```
- `scripts/collect-fx-daily.mjs`: 오늘 환율을 받아 append(같은 날짜면 덮어씀). 원천: Yahoo `KRW=X` 일봉, 실패 시 `https://open.er-api.com/v6/latest/USD`.
- 처음 실행 시 최근 1년치 일별 환율로 채운다.

### `data/summary.json` (Haiku가 계산)
티커별, 기간별(5y/10y/20y) — 원화 기준과 달러 기준 모두:
`cagr`, `totalReturn`, `volatility`(연환산), `maxDrawdown`, `bestYear`, `worstYear`, `dividendYield`(최근 12개월), `months`, `usesProxy`.

## 앱 기능 (Codex)

1. **메인 대시보드 `/`**
   - 오늘 환율 카드(USD/KRW, 전일 대비), 마지막 수집일 표시
   - 5개 ETF 카드: 5/10/20년 CAGR, 변동성, MDD (summary.json)
2. **시뮬레이터 `/simulate`** (핵심)
   - 입력: 현재 나이, 은퇴 나이, 초기 투자금(원), 월 적립금(원), 적립금 연 증가율, 은퇴 후 월 생활비(원, 현재가치), 물가상승률(기본 2.5%), 인출률(기본 4%)
   - 포트폴리오 비중: 5개 ETF 슬라이더(합계 100% 검증), 프리셋(안정형 SCHD 중심 / 성장형 QQQM·VOO / 공격형 QLD 포함), 리밸런싱(없음/연 1회)
   - 백테스트 기간 선택: 5년 / 10년 / 20년
   - 환율 옵션: 과거 실제 환율 적용(월별 환전) / 현재 환율 고정
   - 세금(선택): 배당소득세 15% 원천징수, 해외주식 양도소득세 22%(연 250만원 공제) — 단순화 모델임을 명시
   - 결과: 원화·달러 자산 추이 차트, 원금 대비 수익, 최종 자산, CAGR, MDD, FIRE 목표액(연 생활비 / 인출률), 목표 달성 예상 시점
   - **몬테카를로**: 선택 기간 월수익률 부트스트랩 1,000회 → 은퇴 시점 자산 분포(10/50/90 백분위), 은퇴 후 자산 고갈 확률
3. **ETF 비교 `/etfs`**: 정규화 성과 차트(원화/달러 토글), 기간 탭, 연도별 수익률 표
4. **API `/api/fx`**: `data/fx/usdkrw-daily.json` 최신값 반환, 하루 1회 재검증(`revalidate = 86400`), 실패 시 마지막 저장값 + 경고
5. `npm run collect:fx` / `npm run collect:etf` 스크립트 등록, README에 매일 실행 방법(Windows 작업 스케줄러 예시) 기록

### 구조 가이드
- `src/lib/sim/` : 순수 함수(백테스트, 몬테카를로, 세금, FIRE 계산) — UI와 분리, 유닛 테스트(Vitest)
- `src/lib/data/` : JSON 로딩·타입(`zod` 검증)
- 계산은 월 단위. 환전: 매월 적립 원화 ÷ 그 달 환율 = 달러 매수액. 평가: 달러 자산 × 그 달 환율.
- 몬테카를로는 클라이언트에서 Web Worker 또는 seed 고정 RNG로 결정적 결과.
- 투자 권유 아님 면책 문구 푸터에 표시.

## 완료 기준
- `npm run build`, `npm run lint`, `npm test` 통과
- 실제 `data/` 데이터로 세 페이지가 렌더링됨
- Sonnet 리뷰의 치명/중요 항목 수정 완료

---

# 2단계 요구사항 (2026-11-11, Opus)

## A. JEPQ 추가 (Haiku: 데이터 / Codex: 앱)
- JEPQ = JPMorgan Nasdaq Equity Premium Income ETF, 2022-05 상장, **월배당** 커버드콜 ETF. proxy 없음(상장 이후만).
- `data/etf/JEPQ.json`, `data/summary.json` 에 동일 스키마로 추가. 앱의 티커 목록은 하드코딩 대신 `data/etf/*.json` 기준 6개(VOO, SCHD, QQQM, QLD, SPYQ, JEPQ).
- 배당 데이터 계약 보강: `summary.json` 각 티커에 `trailing12mDividendUsd`(최근 12개월 주당 배당 합), `dividendYieldTtm`(= 그 합 / 최신 close), `dividendFrequency`("monthly"|"quarterly"|"other"), `dividendCagr5y`(가능하면, 연간 배당 합 기준 5년 성장률). JEPQ·QLD·SPYQ 처럼 짧거나 배당이 미미한 경우도 값 기록.

## B. 금액 입력 단위: 1만원
- 모든 원화 입력(종목별 투자금, 월 적립금, 월 생활비)은 **만원 단위** 숫자 입력, 입력 중에도 **세 자리마다 쉼표**(예: `1,000` 만원). 붙여넣기·삭제·커서 위치가 자연스러워야 함. 내부 계산은 원 단위.
- 결과 표시도 쉼표 포맷, 큰 금액은 `12억 3,456만원` 형식 병기.

## C. 기본값: 종목별 1천만원 즉시 시뮬레이션
- 포트폴리오 입력을 비중(%) 대신 **종목별 초기 투자금(만원)** 으로 변경, 6개 종목 모두 기본 `1,000`만원(총 6,000만원). 비중은 금액에서 자동 계산·표시.
- 월 적립금은 총액 입력(기본 100만원), 초기 금액 비율대로 배분.
- 페이지 진입 즉시 결과가 계산·표시되어야 함(버튼 불필요).
- 기본 구성에 SPYQ(25개월)·JEPQ(약 4.5년)가 포함되므로 **과거 공통기간 백테스트는 짧아짐** → 미래 시나리오(D)는 공통기간이 아닌 **각 ETF의 자체 최장 이력**으로 추정한다. 백테스트 영역에는 "공통 데이터 N개월" 안내 유지.

## D. 3개 시나리오 (비관적으로 보는 낙관론자 뷰)
- "관점" 선택: **비관적 낙관론자(기본)** / 역사적 그대로.
  - 역사적: 각 ETF 월수익률의 평균·변동성(자체 최장 이력, proxy 포함), 상관계수는 쌍별 겹치는 기간으로 추정(양의 준정부호 보정).
  - 비관적 낙관론자: 장기 우상향은 믿되 과거(특히 2010년대 미국 강세장)는 반복되지 않는다고 본다 → 연 기대수익률에서 **헤어컷 2%p**(입력 가능), 변동성 ×1.15, 물가 기본 3.0%, 배당 성장 0%. 레버리지 ETF(QLD, SPYQ)는 변동성 끌림이 자연히 반영되도록 월 단위 시뮬레이션.
- seed 고정 몬테카를로 1,000회(상관 정규 또는 다변량 로그정규, 월 단위), 적립기 = (은퇴나이−현재나이)×12, 이후 은퇴기 인출.
- 출력: **3개의 별도 그래프** — 부정적 미래(P10), 중간 미래(P50), 낙관적 미래(P90). 각 그래프는 현재→은퇴→은퇴 후 기간의 자산(원화, 실질/명목 토글 가능) 경로, 은퇴 시점 표시, FIRE 목표선.
  - 경로는 각 시점 백분위가 아니라, 은퇴 시점 자산 순위가 P10/P50/P90에 해당하는 **대표 경로**(또는 시점별 백분위 — 둘 중 택1, 화면에 명시).
- 각 시나리오 카드: 은퇴 시 자산, 은퇴 후 고갈 확률(전체 기준), 월 배당(아래 E), 생활비 충당률.

## E. 은퇴 후 월 배당 현금흐름
- 은퇴 시점 각 ETF 평가액 × 해당 ETF 배당수익률(TTM, 비관적 낙관론자 뷰에서는 배당 성장 0%·보수적) ÷ 12 = 월 배당(세전), 미국 원천징수 15% 후 세후 금액(원화).
- 표: 종목별 월 배당 기여, 합계, 월 생활비(은퇴 시점 명목) 대비 충당률, "배당만으로 생활 가능 여부".
- 월배당 ETF(JEPQ)와 분기배당 ETF 차이 안내: 분기배당은 월 평균 환산임을 명시.
- 시나리오별(P10/P50/P90)로 월 배당 표시.

## 완료 기준
- lint/test/build 통과, 핵심 계산 손계산 테스트(만원 파싱·포맷, 금액→비중, 시나리오 결정성, 배당 계산, 헤어컷 적용).

---

# 3단계 요구사항 (2026-11-12, Opus): 금·비트코인 ETF 추가

## 대상
| 티커 | 이름 | 상장 | 데이터 |
|---|---|---|---|
| GLD | SPDR Gold Shares | 2004-11 | 상장 이후 전체(20년 충분), proxy 없음, 무배당 |
| IBIT | iShares Bitcoin Trust ETF | 2024-01 | 상장 이후만(약 34개월), **proxy 없음**, 무배당 |

- 비트코인 현물(BTC-USD)로 상장 전을 이어 붙이지 않는다. 2015~2017년의 연 수백% 수익률이 미래 시나리오를 비현실적으로 부풀리기 때문. DATA_REPORT 와 UI 에 이유를 명시.

## 데이터 (Haiku)
- `data/etf/GLD.json`, `data/etf/IBIT.json` 동일 스키마, `summary.json` 에 추가(배당 필드는 0/`none`).
- 각 ETF 에 `assetClass` 필드(`"equity" | "gold" | "bitcoin"`)를 summary 에 추가(기존 6개는 equity, JEPQ 는 equity).

## 앱 (Codex)
- 티커 8개(VOO, SCHD, QQQM, QLD, SPYQ, JEPQ, GLD, IBIT). 기본 투자금은 기존 규칙대로 **종목별 1,000만원**(총 8,000만원).
- 자산군 배지(주식/금/비트코인)와 색상 구분, `/etfs`·홈·시뮬레이터 모두 반영.
- GLD·IBIT 는 무배당 → 월 배당 기여 0 으로 표에 표시, "배당 없음(가격 수익만)" 안내.
- IBIT 짧은 표본 경고(34개월), 비트코인 고변동성 안내.
- **비관적 낙관론자 뷰: 단일 자산 연 기대수익률 상한 12%**(헤어컷 적용 후, 입력으로 조정 가능). 역사적 뷰는 상한 없음. 상한 적용된 종목은 화면에 표시.
- 상관 추정·PSD 보정에 GLD(주식과 낮은/음의 상관), IBIT 포함 확인.
- 테스트: 8종목 로딩, 무배당 처리, 수익률 상한 적용.
