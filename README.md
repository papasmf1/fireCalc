# fireCalc

원화로 적립해 미국 ETF에 투자하는 FIRE 시뮬레이터입니다. 과거 월별 데이터, 환율, 고정 seed 몬테카를로를 사용해 은퇴 목표를 탐색합니다.

## 실행

```bash
npm install
npm run dev
```

## 검증

```bash
npm run lint
npm test
npm run build
```

## 데이터 수집

`npm run collect:etf`는 ETF 데이터를 수집하고 요약을 계산하며, `npm run collect:fx`는 일별 USD/KRW 환율을 저장합니다. 수집 스크립트와 `data/`는 별도 데이터 작업 영역입니다.

Windows 작업 스케줄러에서는 **기본 작업 만들기** → 매일 트리거 → 프로그램 `npm.cmd`, 인수 `run collect:fx`, 시작 위치 `C:\Users\student\Desktop\firecalc`로 등록하세요. Node 설치 경로를 직접 지정해야 한다면 프로그램에 `C:\Program Files\nodejs\npm.cmd`를 사용합니다.

> 본 서비스는 교육·정보 제공 목적이며 투자 권유가 아닙니다. 세금, 환율, 수수료를 단순화한 예시입니다.
