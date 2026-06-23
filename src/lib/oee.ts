export type OeeStatus = "good" | "warning" | "critical";

export function oeeStatus(value: number, target = 0.85): OeeStatus {
  if (value >= target) return "good";
  if (value >= 0.60) return "warning";
  return "critical";
}

export function statusClass(s: OeeStatus): string {
  switch (s) {
    case "good": return "text-success";
    case "warning": return "text-warning";
    case "critical": return "text-danger";
  }
}

export function statusBg(s: OeeStatus): string {
  switch (s) {
    case "good": return "bg-success/15 text-success border-success/30";
    case "warning": return "bg-warning/15 text-warning border-warning/30";
    case "critical": return "bg-danger/15 text-danger border-danger/30";
  }
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || isNaN(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

/** Random walk centered around base, clamped 0..1 */
export function rwalk(prev: number, base = 0.9, vol = 0.04): number {
  const drift = (base - prev) * 0.2;
  const noise = (Math.random() - 0.5) * vol * 2;
  return Math.min(1, Math.max(0.3, prev + drift + noise));
}
