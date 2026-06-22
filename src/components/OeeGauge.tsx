import { oeeStatus, pct } from "@/lib/oee";
import { cn } from "@/lib/utils";

export function OeeGauge({
  label, value, target = 0.85, size = 140,
}: { label: string; value: number; target?: number; size?: number }) {
  const s = oeeStatus(value, target);
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(1, value)));
  const colorVar = s === "good" ? "var(--success)" : s === "warning" ? "var(--warning)" : "var(--danger)";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--muted)" strokeWidth={stroke} fill="none" />
          <circle
            cx={size / 2} cy={size / 2} r={r}
            stroke={colorVar} strokeWidth={stroke} fill="none"
            strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 600ms ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("text-2xl font-bold tabular-nums", s === "good" ? "text-success" : s === "warning" ? "text-warning" : "text-danger")}>
            {pct(value, 1)}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">target {pct(target, 0)}</span>
        </div>
      </div>
      <span className="text-sm font-medium text-foreground/80">{label}</span>
    </div>
  );
}
