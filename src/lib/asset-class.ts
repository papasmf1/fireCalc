export type AssetClass = "equity" | "gold" | "bitcoin";

export function assetClassFor(
  ticker: string,
  value?: AssetClass | null,
): AssetClass {
  if (value) return value;
  if (ticker === "GLD") return "gold";
  if (ticker === "IBIT") return "bitcoin";
  return "equity";
}

export const assetClassLabel: Record<AssetClass, string> = {
  equity: "주식",
  gold: "금",
  bitcoin: "비트코인",
};
