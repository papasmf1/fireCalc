"use client";

import { useMemo, useState } from "react";
import {
  Line,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/money-input";
import { formatWon } from "@/lib/money";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  buildMonthlyReturns,
  fireTarget,
  firstTargetMonth,
  maxDrawdown,
  marketCagr,
  runBacktest,
  taxByYear,
  type MonthlySeries,
} from "@/lib/sim";
import type { Summary } from "@/lib/data/schema";
import { monthlyDividendKrw, runScenarioMonteCarlo } from "@/lib/sim/scenario";
import { assetClassFor, assetClassLabel } from "@/lib/asset-class";

type Fx = { date: string; rate: number };
type Preset = "stable" | "growth" | "aggressive" | "direct";
const money = (value: number) =>
  `₩${new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(Math.max(0, value))}`;
const chartConfig: ChartConfig = {
  krw: { label: "원화", color: "var(--color-primary)" },
  usd: { label: "달러", color: "#d97706" },
};

export default function Simulator({
  etfs,
  fx,
  latestFx,
  summary,
}: {
  etfs: MonthlySeries[];
  fx: Fx[];
  latestFx: number;
  summary: Summary | null;
}) {
  const [currentAge, setCurrentAge] = useState(35);
  const [retireAge, setRetireAge] = useState(55);
  const [monthly, setMonthly] = useState(100);
  const [living, setLiving] = useState(250);
  const [growth, setGrowth] = useState(0.03);
  const [inflation, setInflation] = useState(0.025);
  const [withdrawal, setWithdrawal] = useState(0.04);
  const [years, setYears] = useState("20");
  const [retireMonths, setRetireMonths] = useState(240);
  const [rebalance, setRebalance] = useState(false);
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [view, setView] = useState<"pessimistic" | "historical">("pessimistic");
  const [haircut, setHaircut] = useState(0.02);
  const [annualReturnCap, setAnnualReturnCap] = useState(0.12);
  const [realTerms, setRealTerms] = useState(false);
  const [fxMode, setFxMode] = useState<"historical" | "fixed">("historical");
  const [fixedFx, setFixedFx] = useState(latestFx);
  const [preset, setPreset] = useState<Preset>("stable");
  const [amounts, setAmounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(etfs.map((etf) => [etf.ticker, 1000])),
  );
  const totalAmount = Object.values(amounts).reduce(
    (sum, value) => sum + value,
    0,
  );
  const weights = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(amounts).map(([ticker, value]) => [
          ticker,
          totalAmount ? value / totalAmount : 0,
        ]),
      ),
    [amounts, totalAmount],
  );
  const initial = totalAmount * 10_000;
  const activeEtfs = useMemo(
    () => etfs.filter((etf) => (weights[etf.ticker] ?? 0) > 0),
    [etfs, weights],
  );
  const activeReturnsState = useMemo(() => {
    try {
      return {
        data: activeEtfs.length ? buildMonthlyReturns(activeEtfs, fx) : {},
        error: null,
      };
    } catch (error) {
      return {
        data: {},
        error:
          error instanceof Error
            ? error.message
            : "활성 ETF 데이터를 계산할 수 없습니다.",
      };
    }
  }, [activeEtfs, fx]);
  const activeReturns = activeReturnsState.data;
  const futureReturnsState = useMemo(() => {
    try {
      return {
        data: Object.fromEntries(
          activeEtfs.map((etf) => [
            etf.ticker,
            buildMonthlyReturns([etf], fx)[etf.ticker],
          ]),
        ),
        error: null,
      };
    } catch (error) {
      return {
        data: {},
        error:
          error instanceof Error
            ? error.message
            : "미래 시나리오 데이터를 계산할 수 없습니다.",
      };
    }
  }, [activeEtfs, fx]);
  const futureReturns = futureReturnsState.data;
  const availableMonths = Object.values(activeReturns)[0]?.length ?? 0;
  const requestedMonths = Number(years) * 12;
  const usableMonths = Math.min(requestedMonths, availableMonths);
  const selectedReturns = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(activeReturns).map(([ticker, points]) => [
          ticker,
          points.slice(-usableMonths),
        ]),
      ),
    [activeReturns, usableMonths],
  );
  const totalWeight = Object.values(weights).reduce(
    (sum, value) => sum + value,
    0,
  );
  const validWeights =
    Math.abs(totalWeight - 1) < 0.0001 &&
    Object.values(weights).every((value) => value >= 0 && value <= 1) &&
    fixedFx > 0 &&
    withdrawal > 0;
  const yearsToRetire = Math.max(0, retireAge - currentAge);
  const effectiveInflation =
    view === "pessimistic" ? Math.max(inflation, 0.03) : inflation;
  const result = useMemo(() => {
    try {
      if (activeReturnsState.error) return { error: activeReturnsState.error };
      if (!validWeights || !Object.keys(selectedReturns).length)
        return {
          error: "ETF 비중 합계가 100%이고 하나 이상의 ETF를 선택해야 합니다.",
        };
      const backtest = runBacktest({
        initialKrw: initial,
        monthlyContributionKrw: monthly * 10_000,
        contributionGrowth: growth,
        weights,
        returns: selectedReturns,
        fxMode,
        fixedFx,
        rebalance: rebalance ? "annual" : "none",
      });
      const target = fireTarget(
        living * 10_000,
        withdrawal,
        effectiveInflation,
        yearsToRetire,
      );
      const scenario = runScenarioMonteCarlo(
        {
          returns: futureReturns,
          weights,
          initialKrw: initial,
          monthlyContributionKrw: monthly * 10_000,
          contributionGrowth: growth,
          accumulationMonths: yearsToRetire * 12,
          retirementMonths: retireMonths,
          monthlyLivingKrw:
            living * 10_000 * Math.pow(1 + effectiveInflation, yearsToRetire),
          fxRate: fixedFx,
          inflation: effectiveInflation,
          haircut,
          pessimistic: view === "pessimistic",
          annualReturnCap,
        },
        1000,
        42,
      );
      const final = backtest.at(-1);
      const gain = (final?.valueKrw ?? 0) - (final?.contributedKrw ?? 0);
      const tax = taxEnabled
        ? taxByYear(
            { [new Date().getFullYear()]: Math.max(0, gain) },
            { [new Date().getFullYear()]: 0 },
          )
        : 0;
      const chart = backtest.map((point) => ({
        date: point.date,
        krw: Math.round(point.valueKrw),
        usd: Math.round(point.valueUsd),
      }));
      return {
        backtest,
        target,
        tax,
        chart,
        mdd: maxDrawdown(backtest.map((point) => point.valueKrw)),
        targetDate: firstTargetMonth(backtest, target),
        scenario,
        cagr:
          final && final.valueUsd > 0
            ? marketCagr(backtest.map((point) => point.marketReturn))
            : 0,
      };
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "시뮬레이션 중 오류가 발생했습니다.",
      };
    }
  }, [
    validWeights,
    activeReturnsState.error,
    selectedReturns,
    initial,
    monthly,
    growth,
    weights,
    fxMode,
    fixedFx,
    rebalance,
    living,
    withdrawal,
    effectiveInflation,
    yearsToRetire,
    retireMonths,
    taxEnabled,
    futureReturns,
    view,
    haircut,
    annualReturnCap,
  ]);
  const setPresetWeights = (next: Preset) => {
    setPreset(next);
    setAmounts(
      next === "stable"
        ? {
            VOO: 1400,
            SCHD: 1800,
            QQQM: 800,
            QLD: 0,
            SPYQ: 0,
            JEPQ: 0,
            GLD: 1000,
            IBIT: 0,
          }
        : next === "growth"
          ? {
              VOO: 1800,
              SCHD: 400,
              QQQM: 1800,
              QLD: 0,
              SPYQ: 0,
              JEPQ: 0,
              GLD: 0,
              IBIT: 0,
            }
          : next === "aggressive"
            ? {
                VOO: 400,
                SCHD: 0,
                QQQM: 2000,
                QLD: 1600,
                SPYQ: 0,
                JEPQ: 0,
                GLD: 0,
                IBIT: 0,
              }
            : amounts,
    );
  };
  const dividendYields = Object.fromEntries(
    etfs.map((etf) => {
      const recent = etf.monthly.slice(-12);
      const dividend = recent.reduce(
        (sum, point) => sum + (point.dividend ?? 0),
        0,
      );
      const close = etf.monthly.at(-1)?.close ?? 0;
      const fromSummary = summary?.tickers[etf.ticker]?.dividendYieldTtm;
      return [etf.ticker, fromSummary ?? (close > 0 ? dividend / close : 0)];
    }),
  );
  const monthlyCap = Math.pow(1 + Math.max(0, annualReturnCap), 1 / 12) - 1;
  const cappedTickers =
    view === "pessimistic"
      ? activeEtfs
          .filter((etf) => {
            const points =
              (futureReturns as Record<string, { return: number }[]>)[
                etf.ticker
              ] ?? [];
            const mean =
              points.reduce((sum, point) => sum + point.return, 0) /
              Math.max(1, points.length);
            return mean - haircut / 12 > monthlyCap;
          })
          .map((etf) => etf.ticker)
      : [];
  const cappedTicker = cappedTickers.join(", ");
  const scenarioCards =
    "error" in result
      ? []
      : result.scenario.paths.map((path) => {
          const monthlyDividend = monthlyDividendKrw(
            path.retirementHoldings,
            dividendYields,
            fixedFx,
          );
          return {
            ...path,
            displayValues: path.values.map((value, index) =>
              realTerms
                ? value / Math.pow(1 + effectiveInflation, index / 12)
                : value,
            ),
            monthlyDividend,
            coverage:
              living *
                10_000 *
                Math.pow(1 + effectiveInflation, yearsToRetire) >
              0
                ? monthlyDividend /
                  (living *
                    10_000 *
                    Math.pow(1 + effectiveInflation, yearsToRetire))
                : 0,
          };
        });
  const displayTarget =
    "error" in result
      ? 0
      : realTerms
        ? fireTarget(living * 10_000, withdrawal, 0, 0)
        : result.target;
  const displayChart =
    "error" in result
      ? []
      : result.chart.map((point, index) => ({
          ...point,
          krw: realTerms
            ? point.krw / Math.pow(1 + effectiveInflation, index / 12)
            : point.krw,
          usd: realTerms
            ? point.usd / Math.pow(1 + effectiveInflation, index / 12)
            : point.usd,
        }));
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <p className="text-sm font-medium text-primary">
          SIMULATOR · 실제 데이터
        </p>
        <h1 className="mt-2 text-3xl font-bold">나의 FIRE 시뮬레이션</h1>
        <p className="mt-2 text-muted-foreground">
          월초 매수 기준: 첫 달 원금·적립금은 매수만 하고, 다음 달부터 수익률을
          반영합니다.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[370px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>가정과 포트폴리오</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Field
                id="currentAge"
                label="현재 나이"
                value={currentAge}
                setValue={setCurrentAge}
              />
              <Field
                id="retireAge"
                label="은퇴 나이"
                value={retireAge}
                setValue={setRetireAge}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              초기 투자금 합계: <b>{totalAmount.toLocaleString()}만원</b> (
              {money(initial)})
            </p>
            <MoneyInput
              id="monthly"
              label="월 적립금"
              value={monthly}
              onChange={setMonthly}
            />
            <Field
              id="growth"
              label="적립금 연 증가율 (%)"
              value={growth * 100}
              setValue={(value) => setGrowth(value / 100)}
              step="0.1"
            />
            <MoneyInput
              id="living"
              label="은퇴 후 월 생활비 (현재가치)"
              value={living}
              onChange={setLiving}
            />
            <div className="grid grid-cols-2 gap-2">
              <Field
                id="inflation"
                label="물가상승률 (%)"
                value={inflation * 100}
                setValue={(value) => setInflation(value / 100)}
                step="0.1"
              />
              <Field
                id="withdrawal"
                label="인출률 (%)"
                value={withdrawal * 100}
                setValue={(value) => setWithdrawal(value / 100)}
                step="0.1"
                min={0.1}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field
                id="fixedFx"
                label="고정 환율 (원/$)"
                value={fixedFx}
                setValue={setFixedFx}
                min={1}
              />
              <Field
                id="retireMonths"
                label="은퇴 후 기간 (개월)"
                value={retireMonths}
                setValue={setRetireMonths}
              />
            </div>
            <div>
              <Label>관점</Label>
              <Tabs
                value={view}
                onValueChange={(value) =>
                  setView(value as "pessimistic" | "historical")
                }
                className="mt-2"
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="pessimistic">비관적 낙관론자</TabsTrigger>
                  <TabsTrigger value="historical">역사적 그대로</TabsTrigger>
                </TabsList>
              </Tabs>
              {view === "pessimistic" && (
                <>
                  <p className="mb-2 text-xs leading-5 text-muted-foreground">
                    산술 기대수익률에서 연 2%p를 차감하고 변동성을 1.15배로
                    높입니다. QLD/SPYQ 같은 레버리지 ETF는 복리 변동성 끌림으로
                    역사적 경로와의 격차가 더 커질 수 있습니다. 실제 적용 물가:{" "}
                    {(effectiveInflation * 100).toFixed(1)}%
                  </p>
                  <Field
                    id="haircut"
                    label="기대수익률 헤어컷 (%p)"
                    value={haircut * 100}
                    setValue={(value) => setHaircut(value / 100)}
                    step="0.1"
                  />
                  <Field
                    id="annualReturnCap"
                    label="단일 자산 연 기대수익률 상한 (%)"
                    value={annualReturnCap * 100}
                    setValue={(value) => setAnnualReturnCap(value / 100)}
                    step="0.1"
                    min={0}
                  />
                  {cappedTickers.length ? (
                    <p className="text-xs text-amber-700">
                      상한 적용 종목: {cappedTicker} (연{" "}
                      {(annualReturnCap * 100).toFixed(1)}%)
                    </p>
                  ) : null}
                </>
              )}
            </div>
            <div>
              <Label>백테스트 기간</Label>
              <Tabs value={years} onValueChange={setYears} className="mt-2">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="5">5년</TabsTrigger>
                  <TabsTrigger value="10">10년</TabsTrigger>
                  <TabsTrigger value="20">20년</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div>
              <Label>프리셋</Label>
              <Tabs
                value={preset}
                onValueChange={(value) => setPresetWeights(value as Preset)}
                className="mt-2"
              >
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="stable">안정형</TabsTrigger>
                  <TabsTrigger value="growth">성장형</TabsTrigger>
                  <TabsTrigger value="aggressive">공격형</TabsTrigger>
                  <TabsTrigger value="direct">직접 설정</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div>
              <Label>종목별 초기 투자금 (만원) · 비중 자동 계산</Label>
              {etfs.map((etf) => {
                const ticker = etf.ticker;
                return (
                  <div key={ticker} className="mt-2 flex items-center gap-2">
                    <span className="flex w-24 items-center gap-1 text-xs">
                      {ticker}{" "}
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
                      {["SPYQ", "JEPQ"].includes(ticker) &&
                      etf.monthly.length < 60 ? (
                        <Badge variant="outline" className="px-1 text-[10px]">
                          표본 {etf.monthly.length}개월
                        </Badge>
                      ) : null}
                    </span>
                    <MoneyInput
                      id={`amount-${ticker}`}
                      label=""
                      value={amounts[ticker] ?? 0}
                      onChange={(value) => {
                        setPreset("direct");
                        setAmounts({ ...amounts, [ticker]: value });
                      }}
                    />
                    <span className="text-xs">
                      {((weights[ticker] ?? 0) * 100).toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
            {!validWeights && (
              <p className="text-sm text-destructive">
                투자금은 0 이상이어야 하고 총 투자금이 0일 수 없습니다.
              </p>
            )}
            <div className="flex items-center justify-between">
              <Label htmlFor="rebalance">연 1회 리밸런싱</Label>
              <Switch
                id="rebalance"
                checked={rebalance}
                onCheckedChange={setRebalance}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="fxmode">과거 실제 환율 사용</Label>
              <Switch
                id="fxmode"
                checked={fxMode === "historical"}
                onCheckedChange={(value) =>
                  setFxMode(value ? "historical" : "fixed")
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="tax">세금 모델 적용</Label>
              <Switch
                id="tax"
                checked={taxEnabled}
                onCheckedChange={setTaxEnabled}
              />
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              세금 적용 시 기간 말 일시 매도, 배당 0원, 연도별 양도차익 공제만
              반영하는 단순 모델입니다. 실제 세금 신고와 다릅니다.
            </p>
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">
                공통 사용 기간: <b>{usableMonths}개월</b> / 요청{" "}
                {requestedMonths}개월
                {usableMonths < requestedMonths &&
                activeEtfs.some((etf) => etf.ticker === "SPYQ") ? (
                  <span className="ml-2 text-amber-700">
                    SPYQ 때문에 {usableMonths}개월로 단축
                  </span>
                ) : null}
              </p>
            </CardContent>
          </Card>
          {"error" in result ? (
            <Card>
              <CardContent className="p-6 text-destructive">
                시뮬레이션을 계산할 수 없습니다: {result.error}
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  title="최종 자산"
                  value={money(result.backtest.at(-1)?.valueKrw ?? 0)}
                />
                <Metric title="FIRE 목표액" value={formatWon(result.target)} />
                <Metric
                  title="연환산 수익률(적립 효과 제외)"
                  value={`${(result.cagr * 100).toFixed(1)}%`}
                />
                <Metric
                  title="원금 대비 수익률"
                  value={`${(((result.backtest.at(-1)?.valueKrw ?? 0) / Math.max(1, result.backtest.at(-1)?.contributedKrw ?? 1) - 1) * 100).toFixed(1)}%`}
                />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>과거 백테스트 자산 추이 (원화·달러)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={chartConfig} className="h-72 w-full">
                    <LineChart accessibilityLayer data={displayChart}>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        minTickGap={32}
                      />
                      <YAxis
                        yAxisId="krw"
                        tickFormatter={(value) =>
                          `${Math.round(value / 1000000)}M`
                        }
                      />
                      <YAxis
                        yAxisId="usd"
                        orientation="right"
                        tickFormatter={(value) =>
                          `$${Math.round(value / 1000)}k`
                        }
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line
                        dataKey="krw"
                        yAxisId="krw"
                        type="monotone"
                        stroke="var(--color-krw)"
                        dot={false}
                      />
                      <Line
                        dataKey="usd"
                        yAxisId="usd"
                        type="monotone"
                        stroke="var(--color-usd)"
                        dot={false}
                      />
                    </LineChart>
                  </ChartContainer>
                  <p className="mt-2 text-xs text-muted-foreground">
                    연환산 수익률 {(result.cagr * 100).toFixed(1)}% · MDD{" "}
                    {(result.mdd * 100).toFixed(1)}% · 목표 달성 예상{" "}
                    {result.targetDate ?? "기간 내 미달성"} (과거 백테스트 구간
                    기준)
                  </p>
                </CardContent>
              </Card>
              <div className="flex items-center justify-between rounded-md border p-3">
                <span className="text-sm">
                  경로 정의: 은퇴 시점 자산 순위로 고른 대표 경로 ·{" "}
                  <b>{realTerms ? "실질" : "명목"}</b> 가치
                </span>
                <div className="flex items-center gap-2">
                  <Label htmlFor="realTerms">실질가치</Label>
                  <Switch
                    id="realTerms"
                    checked={realTerms}
                    onCheckedChange={setRealTerms}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {realTerms
                  ? "오늘 가치 기준: 전 구간을 물가로 할인했습니다."
                  : "명목 가치 기준"}
              </p>
              <div className="grid gap-4 lg:grid-cols-3">
                {scenarioCards.map((scenario) => (
                  <Card key={scenario.label}>
                    <CardHeader>
                      <CardTitle>
                        {scenario.label === "P10"
                          ? "부정적 미래"
                          : scenario.label === "P50"
                            ? "중간 미래"
                            : "낙관적 미래"}{" "}
                        · 대표 경로
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer
                        config={{
                          value: {
                            label: "자산",
                            color: "var(--color-primary)",
                          },
                          target: { label: "FIRE 목표", color: "#ef4444" },
                        }}
                        className="h-40 w-full"
                      >
                        <LineChart
                          data={scenario.displayValues.map((value, index) => ({
                            month: index,
                            value,
                            target: displayTarget,
                          }))}
                        >
                          <XAxis
                            dataKey="month"
                            tickFormatter={(value) =>
                              String(Math.round(value / 12)) + "년"
                            }
                          />
                          <YAxis
                            tickFormatter={(value) =>
                              String(Math.round(value / 100000000)) + "억"
                            }
                          />
                          <ReferenceLine
                            x={yearsToRetire * 12}
                            stroke="#2563eb"
                            label="은퇴"
                          />
                          <Line
                            dataKey="value"
                            type="monotone"
                            stroke="var(--color-value)"
                            dot={false}
                          />
                          <Line
                            dataKey="target"
                            stroke="var(--color-target)"
                            strokeDasharray="4 4"
                            dot={false}
                          />
                          <ChartTooltip content={<ChartTooltipContent />} />
                        </LineChart>
                      </ChartContainer>
                      <p className="mt-2 text-sm">
                        은퇴 시 자산{" "}
                        <b>{formatWon(scenario.retirementValue)}</b>
                      </p>
                      <p className="text-sm">
                        월 배당 <b>{formatWon(scenario.monthlyDividend)}</b> ·
                        생활비 충당률 {(scenario.coverage * 100).toFixed(1)}%
                      </p>
                      <table className="mt-3 w-full text-xs">
                        <tbody>
                          {Object.entries(scenario.retirementHoldings).map(
                            ([ticker, value]) => (
                              <tr key={ticker} className="border-b">
                                <td className="py-1">
                                  {ticker} (
                                  {summary?.tickers[ticker]
                                    ?.dividendFrequency ?? "other"}
                                  )
                                </td>
                                <td className="py-1 text-right">
                                  {dividendYields[ticker] > 0
                                    ? formatWon(
                                        monthlyDividendKrw(
                                          { [ticker]: value },
                                          { [ticker]: dividendYields[ticker] },
                                          fixedFx,
                                        ),
                                      )
                                    : "배당 없음(가격 수익만)"}
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                      <p className="mt-2 text-xs font-medium">
                        배당만으로 생활 가능:{" "}
                        {scenario.coverage >= 1 ? "가능" : "불가"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        전체 경로 고갈 확률:{" "}
                        {(result.scenario.depletionProbability * 100).toFixed(
                          1,
                        )}
                        %
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        월 배당은 은퇴 시점 보유액의 TTM 기준, 원천징수 15%
                        후입니다. 분기배당은 월 평균 환산입니다.
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
function Field({
  id,
  label,
  value,
  setValue,
  step,
  min = 0,
}: {
  id: string;
  label: string;
  value: number;
  setValue: (value: number) => void;
  step?: string;
  min?: number;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(event) =>
          setValue(Math.max(min, Number(event.target.value) || 0))
        }
      />
    </div>
  );
}
function Metric({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{title}</p>
        <p className="mt-1 text-xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
