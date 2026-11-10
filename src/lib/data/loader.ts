import fs from "node:fs";
import path from "node:path";
import {
  etfSchema,
  fxDailySchema,
  fxMonthlySchema,
  summarySchema,
  type EtfData,
  type FxDaily,
  type FxMonthly,
  type Summary,
} from "./schema";
import { fixtureEtfs } from "./fixtures/etfs";
import { fixtureFx } from "./fixtures/fx";
const root = path.join(process.cwd(), "data");
export type DataResult<T> = {
  data: T | null;
  source: "actual" | "fixture" | "error";
  error?: string;
};
function readFile(file: string) {
  return fs.readFileSync(path.join(root, file), "utf8");
}
function load<T>(
  file: string,
  parse: (value: unknown) => T,
  fallback: T,
): DataResult<T> {
  try {
    return { data: parse(JSON.parse(readFile(file))), source: "actual" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      !fs.existsSync(path.join(root, file)) &&
      process.env.NODE_ENV !== "production"
    )
      return { data: fallback, source: "fixture", error: message };
    console.error(`[fireCalc] ${file} 파싱 실패`, error);
    return { data: null, source: "error", error: message };
  }
}
export function loadEtfs(): DataResult<EtfData[]> {
  const files = fs.existsSync(path.join(root, "etf"))
    ? fs
        .readdirSync(path.join(root, "etf"))
        .filter((file) => file.endsWith(".json"))
    : [];
  const tickers = files.length
    ? files.map((file) => file.replace(/\.json$/, ""))
    : fixtureEtfs.map((etf) => etf.ticker);
  const results = [
    ...new Set([
      ...tickers,
      ...(process.env.NODE_ENV !== "production"
        ? fixtureEtfs
            .map((etf) => etf.ticker)
            .filter((ticker) => !tickers.includes(ticker))
        : []),
    ]),
  ]
    .map((ticker) => {
      const fallback = fixtureEtfs.find((etf) => etf.ticker === ticker);
      return load(`etf/${ticker}.json`, (v) => etfSchema.parse(v), fallback);
    })
    .filter((result): result is DataResult<EtfData> => Boolean(result.data));
  const errors = results.filter((r) => r.source === "error");
  if (errors.length)
    return {
      data: null,
      source: "error",
      error: errors.map((e) => e.error).join("; "),
    };
  return {
    data: results.map((r) => r.data!).filter(Boolean),
    source: results.some((r) => r.source === "fixture") ? "fixture" : "actual",
  };
}
export function loadFxMonthly(): DataResult<FxMonthly> {
  return load("fx/usdkrw-monthly.json", (v) => fxMonthlySchema.parse(v), {
    pair: "USDKRW",
    updatedAt: "fixture",
    monthly: [{ date: "2026-11", rate: 1380 }],
  });
}
export function loadFxDaily(): DataResult<FxDaily> {
  return load("fx/usdkrw-daily.json", (v) => fxDailySchema.parse(v), fixtureFx);
}
export function loadSummary(): DataResult<Summary> {
  return load("summary.json", (v) => summarySchema.parse(v), {
    generatedAt: "fixture",
    notes: [],
    tickers: {},
  });
}
