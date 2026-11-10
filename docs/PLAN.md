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
