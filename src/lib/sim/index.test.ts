import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { etfSchema, summarySchema } from "../data/schema";
import {
  afterTaxGain,
  annualReturns,
  buildMonthlyReturns,
  fireTarget,
  marketCagr,
  monteCarlo,
  runBacktest,
  taxByYear,
  validateWeights,
} from "./index";
describe("fireCalc calculations", () => {
  it("parses the real data contracts", () => {
    const summary = JSON.parse(fs.readFileSync("data/summary.json", "utf8"));
    const etf = JSON.parse(fs.readFileSync("data/etf/VOO.json", "utf8"));
    expect(
      summarySchema.parse(summary).tickers.VOO.periods["5y"].USD.cagr,
    ).toBeCloseTo(0.120395);
    expect(etfSchema.parse(etf).monthly.length).toBeGreaterThan(200);
  });
  it("uses the first historical FX for initial KRW", () => {
    const returns = {
      VOO: [
        { date: "2026-01", return: 0, fxRate: 2000 },
        { date: "2026-02", return: 0, fxRate: 1000 },
      ],
    };
    const points = runBacktest({
      initialKrw: 10_000_000,
      monthlyContributionKrw: 0,
      contributionGrowth: 0,
      weights: { VOO: 1 },
      returns,
      fxMode: "historical",
      fixedFx: 1000,
      rebalance: "none",
    });
    expect(points[0].valueKrw).toBe(10_000_000);
  });
  it("uses monthly market return without contribution contamination", () => {
    const returns = {
      VOO: [
        { date: "2026-01", return: 0, fxRate: 1000 },
        { date: "2026-02", return: 0, fxRate: 1000 },
      ],
    };
    const points = runBacktest({
      initialKrw: 10_000_000,
      monthlyContributionKrw: 1_000_000,
      contributionGrowth: 0,
      weights: { VOO: 1 },
      returns,
      fxMode: "historical",
      fixedFx: 1000,
      rebalance: "none",
    });
    expect(points.map((point) => point.marketReturn)).toEqual([0, 0]);
    expect(points[1].return).toBeCloseTo(1 / 11);
  });
  it("calculates contribution-free CAGR safely", () => {
    expect(marketCagr([0, 0, 0])).toBe(0);
    expect(marketCagr([])).toBe(0);
  });
  it("calculates year returns from prior December", () => {
    const rows = annualReturns([
      { date: "2022-12", value: 100 },
      { date: "2023-01", value: 110 },
      { date: "2023-12", value: 126.3 },
      { date: "2024-01", value: 130 },
    ]);
    expect(rows.find((row) => row.year === "2023")?.return).toBeCloseTo(0.263);
    expect(rows.find((row) => row.year === "2024")?.partial).toBe(true);
  });
  it("applies monthly returns from the next month after a month-start purchase", () => {
    const returns = {
      VOO: [
        { date: "2026-01", return: 0.1, fxRate: 1000 },
        { date: "2026-02", return: 0.1, fxRate: 1000 },
      ],
    };
    const points = runBacktest({
      initialKrw: 1_000_000,
      monthlyContributionKrw: 0,
      contributionGrowth: 0,
      weights: { VOO: 1 },
      returns,
      fxMode: "historical",
      fixedFx: 1000,
      rebalance: "none",
    });
    expect(points[0].valueKrw).toBe(1_000_000);
    expect(points[1].valueKrw).toBe(1_100_000);
  });
  it("tracks holdings and makes annual rebalance materially different", () => {
    const returns = {
      A: Array.from({ length: 14 }, (_, i) => ({
        date: `2026-${String(i + 1).padStart(2, "0")}`,
        return: i === 1 ? 1 : i === 13 ? 1 : 0,
        fxRate: 1000,
      })),
      B: Array.from({ length: 14 }, (_, i) => ({
        date: `2026-${String(i + 1).padStart(2, "0")}`,
        return: 0,
        fxRate: 1000,
      })),
    };
    const base = {
      initialKrw: 1_000_000,
      monthlyContributionKrw: 0,
      contributionGrowth: 0,
      weights: { A: 0.5, B: 0.5 },
      returns,
      fxMode: "fixed" as const,
      fixedFx: 1000,
    };
    const none = runBacktest({ ...base, rebalance: "none" });
    const annual = runBacktest({ ...base, rebalance: "annual" });
    expect(none.at(-1)!.valueUsd).not.toBe(annual.at(-1)!.valueUsd);
  });
  it("rejects invalid weights and aligns dates by common intersection", () => {
    expect(() => validateWeights({ A: 0.5 })).toThrow();
    const aligned = buildMonthlyReturns(
      [
        {
          ticker: "A",
          monthly: [
            { date: "2026-01", adjClose: 100 },
            { date: "2026-02", adjClose: 110 },
          ],
        },
        {
          ticker: "B",
          monthly: [
            { date: "2026-01", adjClose: 100 },
            { date: "2026-02", adjClose: 105 },
          ],
        },
      ],
      [{ date: "2026-02", rate: 1000 }],
    );
    expect(aligned.A[0].date).toBe("2026-02");
  });
  it("changes the usable period when a short ETF is excluded", () => {
    const fx = [
      { date: "2026-02", rate: 1000 },
      { date: "2026-03", rate: 1000 },
    ];
    const long = [
      {
        ticker: "A",
        monthly: [
          { date: "2026-01", adjClose: 100 },
          { date: "2026-02", adjClose: 110 },
          { date: "2026-03", adjClose: 121 },
        ],
      },
    ];
    const short = [
      {
        ticker: "SPYQ",
        monthly: [
          { date: "2026-02", adjClose: 100 },
          { date: "2026-03", adjClose: 110 },
        ],
      },
    ];
    expect(Object.values(buildMonthlyReturns(long, fx))[0]).toHaveLength(2);
    expect(
      Object.values(buildMonthlyReturns([...long, ...short], fx))[0],
    ).toHaveLength(1);
  });
  it("applies annual tax deduction and inflation-adjusted FIRE target", () => {
    expect(afterTaxGain(10_000_000, 1_000_000)).toBe(8_200_000);
    expect(
      taxByYear(
        { 2025: 10_000_000, 2026: 2_000_000 },
        { 2025: 1_000_000, 2026: 0 },
      ),
    ).toBeCloseTo(1_800_000);
    expect(fireTarget(2_500_000, 0.04, 0.025, 20)).toBeCloseTo(
      1_228_962_330,
      -3,
    );
  });
  it("uses decimal monthly returns and simulates accumulation plus retirement", () => {
    const zeroReturn = monteCarlo([0], 0, 10, 1, 10, 1, 2, 100, 0, 0);
    expect(zeroReturn.p50).toBe(190);
    const depleted = monteCarlo([0], 10, 11, 2, 10, 1);
    expect(depleted.depletionProbability).toBe(1);
  });
});
