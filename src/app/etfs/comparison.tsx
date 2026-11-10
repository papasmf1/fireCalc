"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
type Series = {
  ticker: string;
  points: Array<{ date: string; usd: number; krw: number }>;
  annual: Array<{ year: string; partial: boolean; usd: number; krw: number }>;
};
export default function Comparison({ series }: { series: Series[] }) {
  const [currency, setCurrency] = useState<"usd" | "krw">("usd");
  const years = [
    ...new Set(series.flatMap((item) => item.annual.map((row) => row.year))),
  ].sort();
  return (
    <>
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>정규화 성과 (시작값 = 100)</CardTitle>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={currency === "usd" ? "default" : "outline"}
                onClick={() => setCurrency("usd")}
              >
                달러
              </Button>
              <Button
                size="sm"
                variant={currency === "krw" ? "default" : "outline"}
                onClick={() => setCurrency("krw")}
              >
                원화
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {series.map((item) => {
              const values = item.points.map((point) => point[currency]);
              const max = Math.max(...values);
              return (
                <div key={item.ticker}>
                  <p className="mb-2 font-medium">{item.ticker}</p>
                  <div
                    role="img"
                    aria-label={`${item.ticker} ${currency === "usd" ? "달러" : "원화"} 정규화 성과`}
                    className="flex h-24 items-end gap-1"
                  >
                    {item.points
                      .filter(
                        (_, i) =>
                          i %
                            Math.max(1, Math.floor(item.points.length / 32)) ===
                          0,
                      )
                      .map((point) => (
                        <div
                          key={point.date}
                          className="flex-1 rounded-t bg-primary/60"
                          style={{
                            height: `${Math.max(4, (point[currency] / max) * 100)}%`,
                          }}
                          title={`${point.date}: ${point[currency].toFixed(1)}`}
                        />
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>연도별 수익률</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2">ETF</th>
                  {years.map((year) => (
                    <th key={year} className="p-2">
                      {year}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {series.map((item) => (
                  <tr key={item.ticker} className="border-b">
                    <td className="p-2 font-medium">{item.ticker}</td>
                    {years.map((year) => {
                      const row = item.annual.find(
                        (annual) => annual.year === year,
                      );
                      return (
                        <td key={year} className="p-2">
                          {row
                            ? `${(row[currency] * 100).toFixed(1)}%${row.partial ? "*" : ""}`
                            : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
