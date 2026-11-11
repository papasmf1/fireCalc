import Link from "next/link";
import { ArrowRight, CircleDollarSign, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadEtfs, loadFxDaily, loadSummary } from "@/lib/data/loader";
import { assetClassFor, assetClassLabel } from "@/lib/asset-class";
const won = (n: number) => new Intl.NumberFormat("ko-KR").format(Math.round(n));
export default function Home() {
  const fxResult = loadFxDaily();
  const fx = fxResult.data;
  const latest = fx?.daily.at(-1);
  const previous = fx?.daily.at(-2);
  const summaryResult = loadSummary();
  const summary = summaryResult.data;
  const etfs =
    loadEtfs().data?.map((etf) => etf.ticker) ??
    Object.keys(summary?.tickers ?? {});
  if (!fx || !summary)
    return (
      <main className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-2xl font-bold">
          대시보드 데이터를 불러오지 못했습니다.
        </h1>
        <p className="mt-2 text-muted-foreground">
          {fxResult.error ?? summaryResult.error}
        </p>
      </main>
    );
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <section className="mb-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <Badge variant="secondary">FIRE 플래닝 도구</Badge>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
            내 은퇴 자산,
            <br />
            <span className="text-primary">오늘부터 설계하세요.</span>
          </h1>
          <p className="mt-4 max-w-xl text-muted-foreground">
            원화로 적립하고 미국 ETF에 투자하는 상황을 과거 데이터와 결정적
            시뮬레이션으로 살펴봅니다.
          </p>
        </div>
        <Link
          href="/simulate"
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-3 font-medium text-primary-foreground"
        >
          시뮬레이션 시작 <ArrowRight className="size-4" />
        </Link>
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="bg-primary text-primary-foreground">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CircleDollarSign className="size-5" /> 오늘의 환율
            </CardTitle>
          </CardHeader>
          <CardContent>
            {latest ? (
              <>
                <div className="text-3xl font-bold">
                  ₩{won(latest.rate)}{" "}
                  <span className="text-base font-normal opacity-75">/ $1</span>
                </div>
                <p className="mt-2 text-sm opacity-80">
                  전일 대비{" "}
                  {previous
                    ? `${latest.rate - previous.rate >= 0 ? "+" : ""}${(latest.rate - previous.rate).toFixed(1)}원`
                    : "-"}{" "}
                  · {latest.date} 수집
                </p>
                {(latest.date < "2026-11-11" ||
                  fxResult.source !== "actual") && (
                  <p className="mt-2 text-xs text-amber-100">
                    {fxResult.source !== "actual"
                      ? "개발용 환율 데이터입니다."
                      : `환율 기준일 ${latest.date} · 최신 수집일보다 오래된 값일 수 있습니다.`}
                  </p>
                )}
              </>
            ) : (
              <p>환율 정보를 불러오지 못했습니다.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-5 text-primary" /> 지금 알아두세요
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              상장 전 구간은 SPY·QQQ 데이터로 대체될 수 있습니다. 요약 카드의
              기간별 성과는 참고용입니다.
            </p>
            <Link
              href="/etfs"
              className="mt-4 inline-block text-sm font-medium text-primary"
            >
              ETF 비교 보기 →
            </Link>
          </CardContent>
        </Card>
      </div>
      <section className="mt-10">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-semibold">ETF 성과 한눈에 보기</h2>
            <p className="text-sm text-muted-foreground">
              실제 summary.json · 최근 5년 · 달러 기준
            </p>
          </div>
          <Link href="/etfs" className="text-sm text-primary">
            상세 비교
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {etfs.map((ticker) => {
            const m = summary?.tickers[ticker]?.periods["5y"]?.USD;
            return (
              <Card key={ticker}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    {ticker}
                    <Badge variant="secondary">
                      {
                        assetClassLabel[
                          assetClassFor(
                            ticker,
                            summary?.tickers[ticker]?.assetClass,
                          )
                        ]
                      }
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold text-primary">
                    {m
                      ? ticker === "SPYQ"
                        ? `데이터 ${m.months}개월`
                        : `${(m.cagr * 100).toFixed(1)}%`
                      : "-"}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">CAGR</p>
                  {m && ["SPYQ", "JEPQ"].includes(ticker) && m.months < 60 ? (
                    <Badge variant="outline" className="mt-2">
                      짧은 표본 · {m.months}개월
                    </Badge>
                  ) : null}
                  {m && ticker === "IBIT" && m.volatility > 0.5 ? (
                    <Badge variant="destructive" className="mt-2">
                      짧은 표본·고변동성
                    </Badge>
                  ) : null}
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                    <span>
                      변동성
                      <br />
                      <b>{m ? `${(m.volatility * 100).toFixed(1)}%` : "-"}</b>
                    </span>
                    <span>
                      MDD
                      <br />
                      <b>{m ? `${(m.maxDrawdown * 100).toFixed(1)}%` : "-"}</b>
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </main>
  );
}
