import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { loadEtfs, loadSummary } from "@/lib/data/loader";
import { loadFxMonthly } from "@/lib/data/loader";
import { annualReturns } from "@/lib/sim";
import { assetClassFor, assetClassLabel } from "@/lib/asset-class";
import Comparison from "./comparison";
const pct = (n?: number) => (n == null ? "-" : `${(n * 100).toFixed(1)}%`);
export default function EtfsPage() {
  const summary = loadSummary().data;
  const etfs = loadEtfs().data ?? [];
  const fx = loadFxMonthly().data?.monthly ?? [];
  const fxMap = new Map(fx.map((point) => [point.date, point.rate]));
  const series = etfs.map((etf) => {
    const first = etf.monthly[0];
    const firstFx = fxMap.get(first.date) ?? 1;
    const points = etf.monthly
      .filter((point) => fxMap.has(point.date))
      .map((point) => ({
        date: point.date,
        usd: (point.adjClose / first.adjClose) * 100,
        krw:
          ((point.adjClose * (fxMap.get(point.date) ?? firstFx)) /
            (first.adjClose * firstFx)) *
          100,
      }));
    const usdAnnual = annualReturns(
      points.map((point) => ({ date: point.date, value: point.usd })),
    );
    const krwAnnual = annualReturns(
      points.map((point) => ({ date: point.date, value: point.krw })),
    );
    return {
      ticker: etf.ticker,
      points,
      annual: usdAnnual.map((row) => ({
        year: row.year,
        partial: row.partial,
        usd: row.return,
        krw: krwAnnual.find((item) => item.year === row.year)?.return ?? 0,
      })),
    };
  });
  const tickers = etfs.map((etf) => etf.ticker);
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-bold">ETF 비교</h1>
      <p className="mt-2 text-muted-foreground">
        실제 월별 데이터와 summary.json을 사용합니다. 원화 성과는 환율에 따라
        달라집니다.
      </p>
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>기간별 핵심 지표</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ETF</TableHead>
                <TableHead>5년 CAGR</TableHead>
                <TableHead>10년 CAGR</TableHead>
                <TableHead>20년 CAGR</TableHead>
                <TableHead>변동성</TableHead>
                <TableHead>MDD</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickers.map((ticker) => {
                const item = summary?.tickers[ticker];
                const five = item?.periods["5y"]?.USD;
                const ten = item?.periods["10y"]?.USD;
                const twenty = item?.periods["20y"]?.USD;
                const short = twenty && twenty.months < 240;
                return (
                  <TableRow key={ticker}>
                    <TableCell className="font-semibold">
                      <div className="flex items-center gap-2">
                        {ticker}
                        <Badge variant="secondary">
                          {
                            assetClassLabel[
                              assetClassFor(ticker, item?.assetClass)
                            ]
                          }
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {short && (
                          <Badge variant="outline">
                            실제 {twenty.months}개월
                          </Badge>
                        )}
                        {["SPYQ", "JEPQ"].includes(ticker) && (
                          <Badge variant="destructive">
                            짧은 표본 · {five?.months ?? 0}개월
                          </Badge>
                        )}
                        {ticker === "IBIT" && five && five.volatility > 0.5 && (
                          <Badge variant="destructive">怨좊??숈꽦</Badge>
                        )}
                        {ticker === "SPYQ" && (
                          <Badge variant="destructive">2배·분기 리셋</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {ticker === "SPYQ" && five
                        ? `데이터 ${five.months}개월 · ${pct(five.cagr)}`
                        : pct(five?.cagr)}
                    </TableCell>
                    <TableCell>
                      {ticker === "SPYQ" ? "—" : pct(ten?.cagr)}
                    </TableCell>
                    <TableCell>
                      {ticker === "SPYQ" ? "—" : pct(twenty?.cagr)}
                    </TableCell>
                    <TableCell>{pct(five?.volatility)}</TableCell>
                    <TableCell>{pct(five?.maxDrawdown)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Comparison series={series} />
    </main>
  );
}
