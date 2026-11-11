import type { EtfData } from "../schema";

const makeSeries = (start: number, months = 241) =>
  Array.from({ length: months }, (_, i) => {
    const date = new Date(Date.UTC(2006, 10 + i, 1)).toISOString().slice(0, 7);
    const value = start * Math.pow(1.008, i) * (1 + Math.sin(i * 0.31) * 0.045);
    return {
      date,
      close: value,
      adjClose: value,
      dividend: 0.002,
      source: "fixture",
    };
  });
const definitions = [
  ["VOO", "Vanguard S&P 500 ETF", 100, 241],
  ["SCHD", "Schwab US Dividend Equity ETF", 80, 241],
  ["QQQM", "Invesco NASDAQ 100 ETF", 75, 241],
  ["QLD", "ProShares Ultra QQQ", 60, 241],
  ["SPYQ", "Tradr 2X Long SPY Quarterly ETF", 90, 25],
  ["JEPQ", "JPMorgan Nasdaq Equity Premium Income ETF", 95, 53],
  ["GLD", "SPDR Gold Shares", 110, 241],
  ["IBIT", "iShares Bitcoin Trust ETF", 120, 34],
] as const;
export const fixtureEtfs: EtfData[] = definitions.map(
  ([ticker, name, start, months]) => ({
    ticker,
    name,
    inception: "2006-11-01",
    currency: "USD",
    updatedAt: "2026-11-11",
    monthly: makeSeries(start, months),
  }),
);
