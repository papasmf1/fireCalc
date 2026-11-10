import { loadFxDaily } from "@/lib/data/loader";
export const revalidate = 86400;
export async function GET() {
  const result = loadFxDaily();
  if (!result.data)
    return Response.json(
      { error: "환율 데이터를 불러오지 못했습니다.", detail: result.error },
      { status: 503 },
    );
  const latest = result.data.daily.at(-1);
  const ageDays = latest
    ? Math.floor(
        (Date.now() - new Date(`${latest.date}T00:00:00Z`).getTime()) /
          86400000,
      )
    : 0;
  return Response.json({
    ...result.data,
    latest,
    warning:
      result.source === "fixture"
        ? "개발용 fixture를 사용 중입니다."
        : ageDays > 3
          ? `환율이 ${ageDays}일 전 값입니다.`
          : undefined,
    sourceStatus: result.source,
  });
}
