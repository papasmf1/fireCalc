"use client";

import { useMemo, useState } from "react";
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  monteCarlo,
  runBacktest,
  taxByYear,
  type MonthlySeries,
} from "@/lib/sim";

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
}: {
  etfs: MonthlySeries[];
  fx: Fx[];
  latestFx: number;
}) {
  const [currentAge, setCurrentAge] = useState(35);
  const [retireAge, setRetireAge] = useState(55);
  const [monthly, setMonthly] = useState(2_000_000);
  const [initial, setInitial] = useState(50_000_000);
  const [living, setLiving] = useState(2_500_000);
  const [growth, setGrowth] = useState(0.03);
  const [inflation, setInflation] = useState(0.025);
  const [withdrawal, setWithdrawal] = useState(0.04);
  const [years, setYears] = useState("20");
  const [retireMonths, setRetireMonths] = useState(240);
  const [rebalance, setRebalance] = useState(false);
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [fxMode, setFxMode] = useState<"historical" | "fixed">("historical");
  const [fixedFx, setFixedFx] = useState(latestFx);
  const [preset, setPreset] = useState<Preset>("stable");
  const [weights, setWeights] = useState<Record<string, number>>({
    VOO: 0.35,
    SCHD: 0.45,
    QQQM: 0.2,
    QLD: 0,
    SPYQ: 0,
  });
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
    Object.values(weights).every((value) => value >= 0 && value <= 1);
  const yearsToRetire = Math.max(0, retireAge - currentAge);
  const result = useMemo(() => {
    try {
      if (activeReturnsState.error) return { error: activeReturnsState.error };
      if (!validWeights || !Object.keys(selectedReturns).length)
        return {
          error: "ETF 비중 합계가 100%이고 하나 이상의 ETF를 선택해야 합니다.",
        };
      const backtest = runBacktest({
        initialKrw: initial,
        monthlyContributionKrw: monthly,
        contributionGrowth: growth,
        weights,
        returns: selectedReturns,
        fxMode,
        fixedFx,
        rebalance: rebalance ? "annual" : "none",
      });
      const target = fireTarget(living, withdrawal, inflation, yearsToRetire);
      const mc = monteCarlo(
        backtest.slice(1).map((point) => point.marketReturn),
        initial,
        living * Math.pow(1 + inflation, yearsToRetire),
        retireMonths,
        1000,
        42,
        yearsToRetire * 12,
        monthly,
        growth,
        inflation,
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
        mc,
        tax,
        chart,
        mdd: maxDrawdown(backtest.map((point) => point.valueKrw)),
        targetDate: firstTargetMonth(backtest, target),
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
    inflation,
    yearsToRetire,
    retireMonths,
    taxEnabled,
  ]);
  const setPresetWeights = (next: Preset) => {
    setPreset(next);
    setWeights(
      next === "stable"
        ? { VOO: 0.35, SCHD: 0.45, QQQM: 0.2, QLD: 0, SPYQ: 0 }
        : next === "growth"
          ? { VOO: 0.45, SCHD: 0.1, QQQM: 0.45, QLD: 0, SPYQ: 0 }
          : next === "aggressive"
            ? { VOO: 0.1, SCHD: 0, QQQM: 0.5, QLD: 0.4, SPYQ: 0 }
            : weights,
    );
  };
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
            <Field
              id="initial"
              label="초기 투자금 (원)"
              value={initial}
              setValue={setInitial}
            />
            <Field
              id="monthly"
              label="월 적립금 (원)"
              value={monthly}
              setValue={setMonthly}
            />
            <Field
              id="growth"
              label="적립금 연 증가율 (%)"
              value={growth * 100}
              setValue={(value) => setGrowth(value / 100)}
              step="0.1"
            />
            <Field
              id="living"
              label="은퇴 후 월 생활비 (현재가치)"
              value={living}
              setValue={setLiving}
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
              <Label>ETF 비중 합계: {(totalWeight * 100).toFixed(0)}%</Label>
              {Object.keys(weights).map((ticker) => (
                <div key={ticker} className="mt-2 flex items-center gap-2">
                  <span className="w-12 text-xs">{ticker}</span>
                  <Input
                    aria-label={`${ticker} 비중`}
                    type="number"
                    min="0"
                    max="100"
                    value={weights[ticker] * 100}
                    onChange={(event) => {
                      const value = Math.max(
                        0,
                        Math.min(100, Number(event.target.value) || 0),
                      );
                      setPreset("direct");
                      setWeights({ ...weights, [ticker]: value / 100 });
                    }}
                  />
                  <span className="text-xs">%</span>
                </div>
              ))}
            </div>
            {!validWeights && (
              <p className="text-sm text-destructive">
                각 비중은 0~100%이며 합계가 100%여야 합니다.
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
                <Metric title="FIRE 목표액" value={money(result.target)} />
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
                    <LineChart accessibilityLayer data={result.chart}>
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
              <Card>
                <CardHeader>
                  <CardTitle>
                    미래 시뮬레이션 1,000회 · 은퇴 후 {retireMonths}개월
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric title="10 백분위" value={money(result.mc.p10)} />
                  <Metric title="중앙값" value={money(result.mc.p50)} />
                  <Metric title="90 백분위" value={money(result.mc.p90)} />
                  <Metric
                    title="고갈 확률"
                    value={`${(result.mc.depletionProbability * 100).toFixed(1)}%`}
                  />
                  {taxEnabled && (
                    <Metric title="단순 예상 세금" value={money(result.tax)} />
                  )}
                </CardContent>
              </Card>
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
