export type MonthlyReturn = { date: string; return: number; fxRate: number };
export type MonthlySeries = {
  ticker: string;
  monthly: Array<{
    date: string;
    adjClose: number;
    close?: number;
    dividend?: number;
  }>;
};
export type PortfolioWeight = Record<string, number>;
export type BacktestInput = {
  initialKrw: number;
  monthlyContributionKrw: number;
  contributionGrowth: number;
  weights: PortfolioWeight;
  returns: Record<string, MonthlyReturn[]>;
  fxMode: "historical" | "fixed";
  fixedFx: number;
  rebalance: "none" | "annual";
};
export type BacktestPoint = {
  date: string;
  valueKrw: number;
  valueUsd: number;
  contributedKrw: number;
  return: number;
  marketReturn: number;
  holdings: Record<string, number>;
};

export function validateWeights(weights: PortfolioWeight) {
  const values = Object.values(weights);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (
    values.some((value) => value < 0 || value > 1) ||
    Math.abs(total - 1) > 0.0001
  ) {
    throw new Error("ETF 비중은 0~100% 범위에서 합계 100%여야 합니다.");
  }
}

export function commonDates(
  etfs: MonthlySeries[],
  fx: Array<{ date: string; rate: number }>,
) {
  const sets = etfs
    .map((etf) => new Set(etf.monthly.slice(1).map((point) => point.date)))
    .concat([new Set(fx.map((point) => point.date))]);
  return [
    ...sets.reduce(
      (common, set) => new Set([...common].filter((date) => set.has(date))),
      sets[0] ?? new Set<string>(),
    ),
  ].sort();
}

export function buildMonthlyReturns(
  etfs: MonthlySeries[],
  fx: Array<{ date: string; rate: number }>,
): Record<string, MonthlyReturn[]> {
  const fxMap = new Map(fx.map((point) => [point.date, point.rate]));
  const dates = commonDates(etfs, fx);
  return Object.fromEntries(
    etfs.map((etf) => {
      const points = new Map(
        etf.monthly.map((point) => [point.date, point.adjClose]),
      );
      return [
        etf.ticker,
        dates.map((date) => {
          const index = etf.monthly.findIndex((point) => point.date === date);
          const previous =
            index > 0 ? etf.monthly[index - 1].adjClose : undefined;
          const current = points.get(date);
          if (!previous || !current || !fxMap.has(date)) {
            throw new Error(`수익률 또는 환율 누락: ${etf.ticker} ${date}`);
          }
          return {
            date,
            return: current / previous - 1,
            fxRate: fxMap.get(date)!,
          };
        }),
      ];
    }),
  );
}

export function runBacktest(input: BacktestInput): BacktestPoint[] {
  validateWeights(input.weights);
  const tickers = Object.keys(input.weights).filter(
    (ticker) => input.weights[ticker] > 0,
  );
  if (!tickers.length) throw new Error("비중이 0%보다 큰 ETF가 없습니다.");
  const dates = input.returns[tickers[0]]?.map((point) => point.date) ?? [];
  if (
    tickers.some(
      (ticker) =>
        input.returns[ticker]?.map((point) => point.date).join() !==
        dates.join(),
    )
  ) {
    throw new Error("ETF 수익률 날짜가 정렬되지 않았습니다.");
  }
  const firstFx =
    input.fxMode === "historical"
      ? input.returns[tickers[0]][0].fxRate
      : input.fixedFx;
  let holdings = Object.fromEntries(
    tickers.map((ticker) => [
      ticker,
      (input.initialKrw / firstFx) * input.weights[ticker],
    ]),
  );
  let contributed = input.initialKrw;
  const result: BacktestPoint[] = [];

  dates.forEach((date, month) => {
    const fx =
      input.fxMode === "historical"
        ? input.returns[tickers[0]][month].fxRate
        : input.fixedFx;
    const contribution =
      input.monthlyContributionKrw *
      Math.pow(1 + input.contributionGrowth, Math.floor(month / 12));
    const marketReturn =
      month === 0
        ? 0
        : tickers.reduce(
            (sum, ticker) =>
              sum + input.weights[ticker] * input.returns[ticker][month].return,
            0,
          );

    // 월초 매수 기준: 첫 달 원금·적립금은 매수만 하고, 다음 달부터 시장수익률을 반영한다.
    if (month > 0) {
      tickers.forEach((ticker) => {
        holdings[ticker] *= 1 + input.returns[ticker][month].return;
      });
    }
    tickers.forEach((ticker) => {
      holdings[ticker] += (contribution * input.weights[ticker]) / fx;
    });
    contributed += contribution;

    const totalUsd = Object.values(holdings).reduce(
      (sum, value) => sum + value,
      0,
    );
    if (input.rebalance === "annual" && month > 0 && month % 12 === 0) {
      holdings = Object.fromEntries(
        tickers.map((ticker) => [ticker, totalUsd * input.weights[ticker]]),
      );
    }
    const newTotal = Object.values(holdings).reduce(
      (sum, value) => sum + value,
      0,
    );
    const previous = result.at(-1)?.valueUsd ?? input.initialKrw / firstFx;
    result.push({
      date,
      valueKrw: newTotal * fx,
      valueUsd: newTotal,
      contributedKrw: contributed,
      return: previous ? newTotal / previous - 1 : 0,
      marketReturn,
      holdings: { ...holdings },
    });
  });
  return result;
}

export function fireTarget(
  monthlyLivingKrw: number,
  withdrawalRate = 0.04,
  inflation = 0,
  yearsToRetire = 0,
) {
  return (
    (monthlyLivingKrw * 12 * Math.pow(1 + inflation, yearsToRetire)) /
    withdrawalRate
  );
}
export function firstTargetMonth(points: BacktestPoint[], target: number) {
  return points.find((point) => point.valueKrw >= target)?.date ?? null;
}
export function marketCagr(monthlyReturns: number[]) {
  if (!monthlyReturns.length) return 0;
  const growth = monthlyReturns.reduce(
    (product, value) => product * (1 + value),
    1,
  );
  return Math.pow(growth, 12 / monthlyReturns.length) - 1;
}
export function annualReturns(points: Array<{ date: string; value: number }>) {
  const lastByYear = new Map<string, (typeof points)[number]>();
  points.forEach((point) => lastByYear.set(point.date.slice(0, 4), point));
  return [...lastByYear.entries()].map(([year, last]) => {
    const priorDecember = points.find(
      (point) => point.date === `${Number(year) - 1}-12`,
    );
    const first =
      priorDecember ?? points.find((point) => point.date.startsWith(year))!;
    return {
      year,
      partial: !priorDecember || !last.date.endsWith("-12"),
      return: last.value / first.value - 1,
    };
  });
}
export function afterTaxGain(
  gainKrw: number,
  dividendKrw: number,
  dividendRate = 0.15,
  capitalRate = 0.22,
  deduction = 2_500_000,
) {
  return (
    gainKrw -
    dividendKrw * dividendRate -
    Math.max(0, gainKrw - deduction) * capitalRate
  );
}
export function taxByYear(
  realizedByYear: Record<number, number>,
  dividendByYear: Record<number, number>,
  dividendRate = 0.15,
  capitalRate = 0.22,
  deduction = 2_500_000,
) {
  return Object.keys(realizedByYear).reduce(
    (sum, year) =>
      sum +
      Math.max(0, realizedByYear[Number(year)] - deduction) * capitalRate +
      (dividendByYear[Number(year)] ?? 0) * dividendRate,
    0,
  );
}
export function maxDrawdown(values: number[]) {
  let peak = -Infinity;
  let mdd = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    mdd = Math.min(mdd, value / peak - 1);
  }
  return mdd;
}
export function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ??
    0
  );
}
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
export function monteCarlo(
  returns: number[],
  start: number,
  monthlySpend: number,
  months: number,
  runs = 1000,
  seed = 42,
  accumulationMonths = 0,
  monthlyContribution = 0,
  contributionGrowth = 0,
  inflation = 0,
) {
  if (!returns.length) throw new Error("몬테카를로 수익률이 없습니다.");
  const random = seededRandom(seed);
  const endings: number[] = [];
  let depleted = 0;
  for (let run = 0; run < runs; run++) {
    let value = start;
    for (let month = 0; month < accumulationMonths; month++)
      value =
        value * (1 + returns[Math.floor(random() * returns.length)]) +
        monthlyContribution *
          Math.pow(1 + contributionGrowth, Math.floor(month / 12));
    for (let month = 0; month < months; month++) {
      value = Math.max(
        0,
        value * (1 + returns[Math.floor(random() * returns.length)]) -
          monthlySpend * Math.pow(1 + inflation, Math.floor(month / 12)),
      );
      if (value === 0) {
        depleted++;
        break;
      }
    }
    endings.push(value);
  }
  return {
    p10: percentile(endings, 0.1),
    p50: percentile(endings, 0.5),
    p90: percentile(endings, 0.9),
    depletionProbability: depleted / runs,
    endings,
  };
}
