export function parseManwon(value: string) {
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
export function formatManwonInput(value: string) {
  const clean = value.replace(/[^0-9.]/g, "");
  const [integer = "", ...fractionParts] = clean.split(".");
  const fraction = fractionParts.join("").slice(0, 2);
  const normalizedInteger = integer.replace(/^0+(?=\d)/, "");
  const grouped = normalizedInteger.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fractionParts.length ? `${grouped || "0"}.${fraction}` : grouped;
}
export function formatManwon(value: number) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(
    Math.max(0, value),
  );
}
export function wonFromManwon(value: number) {
  return value * 10_000;
}
export function formatWon(value: number) {
  const rounded = Math.max(0, Math.round(value / 10_000) * 10_000);
  const eok = Math.floor(rounded / 100_000_000);
  const man = Math.floor((rounded % 100_000_000) / 10_000);
  return `${eok ? `${eok}억 ` : ""}${man.toLocaleString("ko-KR")}만원`.trim();
}
