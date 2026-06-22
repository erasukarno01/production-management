import { oeeStatus, statusBg, pct } from "@/lib/oee";
import { cn } from "@/lib/utils";

export function OeeBadge({ value, target = 0.85, className }: { value: number; target?: number; className?: string }) {
  const s = oeeStatus(value, target);
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-mono font-semibold tabular-nums", statusBg(s), className)}>
      {pct(value)}
    </span>
  );
}
