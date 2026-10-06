// Money + date formatters for the RentPro UI.

export function money(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return `৳${v.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export function moneyDetailed(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return `৳${v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
