import type { MonthlyReturn, PortfolioWeight } from "./index";
export type ScenarioInput = {
  returns: Record<string, MonthlyReturn[]>;
  weights: PortfolioWeight;
  initialKrw: number;
  monthlyContributionKrw: number;
  contributionGrowth: number;
  accumulationMonths: number;
  retirementMonths: number;
  monthlyLivingKrw: number;
  fxRate: number;
  inflation: number;
  haircut: number;
  pessimistic: boolean;
};
export type ScenarioPath = {
  label: "P10" | "P50" | "P90";
  values: number[];
  retirementValue: number;
  depleted: boolean;
  retirementHoldings: Record<string, number>;
  holdings: Record<string, number>;
};
export function monthlyDividendKrw(
  holdingsUsd: Record<string, number>,
  yields: Record<string, number>,
  fxRate: number,
  withholding = 0.15,
) {
  return Object.entries(holdingsUsd).reduce(
    (sum, [ticker, value]) =>
      sum + ((value * (yields[ticker] ?? 0) * fxRate) / 12) * (1 - withholding),
    0,
  );
}
const normal = (random: () => number) => {
  const u = Math.max(random(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
};
const rng = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
};
export function estimateCorrelation(
  returns: Record<string, MonthlyReturn[]>,
  tickers = Object.keys(returns),
) {
  return tickers.map((a, i) =>
    tickers.map((b, j) => {
      if (i === j) return 1;
      const bMap = new Map(
        returns[b].map((point) => [point.date, point.return]),
      );
      const pairs = returns[a]
        .map((point) => [point.return, bMap.get(point.date)] as const)
        .filter((pair): pair is [number, number] => pair[1] !== undefined);
      if (!pairs.length) return 0;
      const ma = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
      const mb = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
      const numerator = pairs.reduce(
        (s, p) => s + (p[0] - ma) * (p[1] - mb),
        0,
      );
      const sa = Math.sqrt(pairs.reduce((s, p) => s + (p[0] - ma) ** 2, 0));
      const sb = Math.sqrt(pairs.reduce((s, p) => s + (p[1] - mb) ** 2, 0));
      return sa && sb ? numerator / sa / sb : 0;
    }),
  );
}
export function psdCorrelation(matrix: number[][]) {
  const result = matrix.map((row) => [...row]);
  for (let i = 0; i < result.length; i++)
    for (let j = i + 1; j < result.length; j++)
      result[i][j] = result[j][i] = Math.max(
        -0.999,
        Math.min(0.999, (result[i][j] + result[j][i]) / 2),
      );
  for (let ridge = 0; ridge < 20; ridge++) {
    const candidate = result.map((row, i) =>
      row.map((value, j) => (i === j ? 1 : value)),
    );
    if (cholesky(candidate)) return candidate;
    for (let i = 0; i < result.length; i++)
      for (let j = 0; j < result.length; j++) if (i !== j) result[i][j] *= 0.95;
  }
  return result;
}
export function cholesky(matrix: number[][]) {
  const lower = matrix.map(() => matrix.map(() => 0));
  for (let i = 0; i < matrix.length; i++)
    for (let j = 0; j <= i; j++) {
      const sum = lower[i]
        .slice(0, j)
        .reduce((s, _, k) => s + lower[i][k] * lower[j][k], 0);
      if (i === j) {
        const diagonal = matrix[i][i] - sum;
        if (diagonal <= 0) return null;
        lower[i][j] = Math.sqrt(diagonal);
      } else lower[i][j] = (matrix[i][j] - sum) / lower[j][j];
    }
  return lower;
}
export function portfolioVolatility(
  vols: number[],
  correlation: number[][],
  weights: number[],
) {
  return Math.sqrt(
    weights.reduce(
      (sum, wi, i) =>
        sum +
        weights.reduce(
          (inner, wj, j) =>
            inner + wi * wj * vols[i] * vols[j] * correlation[i][j],
          0,
        ),
      0,
    ),
  );
}
export function runScenarioMonteCarlo(
  input: ScenarioInput,
  runs = 1000,
  seed = 42,
) {
  const tickers = Object.keys(input.weights).filter(
    (ticker) => input.weights[ticker] > 0,
  );
  const means = tickers.map(
    (ticker) =>
      input.returns[ticker].reduce((sum, point) => sum + point.return, 0) /
      Math.max(1, input.returns[ticker].length),
  );
  const vols = tickers.map((ticker, i) =>
    Math.sqrt(
      input.returns[ticker].reduce(
        (sum, point) => sum + (point.return - means[i]) ** 2,
        0,
      ) / Math.max(1, input.returns[ticker].length - 1),
    ),
  );
  const correlation = psdCorrelation(
    estimateCorrelation(input.returns, tickers),
  );
  const lower =
    cholesky(correlation) ??
    correlation.map((row, i) => row.map((_, j) => (i === j ? 1 : 0)));
  const random = rng(seed);
  const paths: ScenarioPath[] = [];
  for (let run = 0; run < runs; run++) {
    const holdings = Object.fromEntries(
      tickers.map((ticker) => [
        ticker,
        (input.initialKrw * input.weights[ticker]) / input.fxRate,
      ]),
    );
    const values = [input.initialKrw];
    let retirementHoldings: Record<string, number> | null = null;
    let retirementValue = input.initialKrw;
    let depleted = false;
    for (
      let month = 0;
      month < input.accumulationMonths + input.retirementMonths;
      month++
    ) {
      if (month === input.accumulationMonths) {
        retirementHoldings = { ...holdings };
        retirementValue =
          Object.values(holdings).reduce((sum, value) => sum + value, 0) *
          input.fxRate;
      }
      if (month > 0) {
        const z = tickers.map(() => normal(random));
        const correlated = lower.map((row) =>
          row.reduce((sum, value, j) => sum + value * z[j], 0),
        );
        tickers.forEach((ticker, i) => {
          const drift = means[i] - (input.pessimistic ? input.haircut / 12 : 0);
          const sigma = vols[i] * (input.pessimistic ? 1.15 : 1);
          const growth =
            Math.exp(drift - (sigma * sigma) / 2 + sigma * correlated[i]) - 1;
          holdings[ticker] *= Math.max(0, 1 + growth);
        });
      }
      if (month < input.accumulationMonths)
        tickers.forEach((ticker) => {
          holdings[ticker] +=
            (input.monthlyContributionKrw *
              Math.pow(1 + input.contributionGrowth, Math.floor(month / 12)) *
              input.weights[ticker]) /
            input.fxRate;
        });
      else {
        const spend =
          (input.monthlyLivingKrw *
            Math.pow(
              1 + input.inflation,
              Math.floor((month - input.accumulationMonths) / 12),
            )) /
          input.fxRate;
        const total = Object.values(holdings).reduce(
          (sum, value) => sum + value,
          0,
        );
        const factor = total > 0 ? Math.max(0, (total - spend) / total) : 0;
        tickers.forEach((ticker) => {
          holdings[ticker] *= factor;
        });
        if (factor === 0) depleted = true;
      }
      values.push(
        Object.values(holdings).reduce((sum, value) => sum + value, 0) *
          input.fxRate,
      );
    }
    paths.push({
      values,
      retirementValue,
      depleted,
      retirementHoldings: retirementHoldings ?? { ...holdings },
      holdings: { ...holdings },
      label: "P50",
    });
  }
  const sorted = [...paths].sort(
    (a, b) => a.retirementValue - b.retirementValue,
  );
  const pick = (fraction: number, label: "P10" | "P50" | "P90") => ({
    ...sorted[Math.floor((sorted.length - 1) * fraction)],
    label,
  });
  return {
    paths: [pick(0.1, "P10"), pick(0.5, "P50"), pick(0.9, "P90")],
    depletionProbability: paths.filter((path) => path.depleted).length / runs,
    means,
    vols,
    correlation,
  };
}
