import { loadEtfs, loadFxDaily, loadFxMonthly } from "@/lib/data/loader";
import Simulator from "./simulator";
export default function SimulatePage() {
  const etfs = loadEtfs().data;
  const fx = loadFxMonthly().data;
  const latestFx = loadFxDaily().data?.daily.at(-1)?.rate ?? 1380;
  if (!etfs || !fx)
    return (
      <main className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-2xl font-bold">
          시뮬레이션 데이터를 불러오지 못했습니다.
        </h1>
        <p className="mt-2 text-muted-foreground">
          ETF 또는 환율 데이터의 형식을 확인해 주세요.
        </p>
      </main>
    );
  return <Simulator etfs={etfs} fx={fx.monthly} latestFx={latestFx} />;
}
