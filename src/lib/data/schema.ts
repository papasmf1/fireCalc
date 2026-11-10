import { z } from "zod";
export const monthlyPointSchema = z.object({
  date: z.string(),
  close: z.number(),
  adjClose: z.number(),
  dividend: z.number().default(0),
  source: z.string().optional(),
});
export const etfSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  inception: z.string(),
  currency: z.literal("USD"),
  updatedAt: z.string(),
  proxy: z.string().nullable().optional(),
  monthly: z.array(monthlyPointSchema).min(2),
});
export const fxPointSchema = z.object({
  date: z.string(),
  rate: z.number(),
  asOf: z.string().optional(),
});
export const fxMonthlySchema = z.object({
  pair: z.literal("USDKRW"),
  source: z.string().optional(),
  updatedAt: z.string(),
  monthly: z.array(fxPointSchema).min(1),
});
export const fxDailySchema = z.object({
  pair: z.literal("USDKRW"),
  source: z.string().optional(),
  updatedAt: z.string().optional(),
  daily: z.array(fxPointSchema).min(1),
});
export const metricSchema = z.object({
  start: z.string(),
  end: z.string(),
  months: z.number(),
  coverage: z.enum(["full", "partial"]),
  cagr: z.number(),
  totalReturn: z.number(),
  volatility: z.number(),
  maxDrawdown: z.number(),
  bestYear: z.object({ year: z.number(), return: z.number() }),
  worstYear: z.object({ year: z.number(), return: z.number() }),
  dividendYield: z.number(),
  usesProxy: z.boolean(),
});
export const summarySchema = z.object({
  generatedAt: z.string(),
  notes: z.array(z.string()),
  tickers: z.record(
    z.string(),
    z.object({
      name: z.string(),
      inception: z.string(),
      proxy: z.string().nullable(),
      firstMonth: z.string(),
      lastMonth: z.string(),
      periods: z.record(
        z.enum(["5y", "10y", "20y"]),
        z.object({ USD: metricSchema, KRW: metricSchema }),
      ),
    }),
  ),
});
export type EtfData = z.infer<typeof etfSchema>;
export type FxPoint = z.infer<typeof fxPointSchema>;
export type FxMonthly = z.infer<typeof fxMonthlySchema>;
export type FxDaily = z.infer<typeof fxDailySchema>;
export type Summary = z.infer<typeof summarySchema>;
export type SummaryMetric = z.infer<typeof metricSchema>;
