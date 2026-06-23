import { cn } from "@/lib/utils";

export type DatePreset = "24h" | "7d" | "30d" | "custom";

export interface DateRange {
  preset: DatePreset;
  start: Date;
  end: Date;
}

export function getDateRange(preset: DatePreset, prev?: DateRange): DateRange {
  const end = prev?.end ?? new Date();
  let start: Date;
  switch (preset) {
    case "24h": start = new Date(end.getTime() - 24 * 3600_000); break;
    case "7d": start = new Date(end.getTime() - 7 * 24 * 3600_000); break;
    case "30d": start = new Date(end.getTime() - 30 * 24 * 3600_000); break;
    case "custom": return { preset, start: prev?.start ?? end, end: prev?.end ?? end };
  }
  return { preset, start, end };
}

export function DateRangeFilter({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const presets: { key: DatePreset; label: string }[] = [
    { key: "24h", label: "24H" },
    { key: "7d", label: "7D" },
    { key: "30d", label: "30D" },
    { key: "custom", label: "Custom" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
        {presets.map(p => (
          <button key={p.key} onClick={() => onChange(getDateRange(p.key, value))}
            className={cn("h-7 px-2 rounded text-xs font-medium transition-colors",
              value.preset === p.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}>
            {p.label}
          </button>
        ))}
      </div>
      {value.preset === "custom" && (
        <div className="flex items-center gap-1">
          <input type="date" value={value.start.toISOString().slice(0, 10)}
            onChange={e => onChange({ ...value, start: new Date(e.target.value + "T00:00:00") })}
            className="h-7 rounded border border-input bg-background px-1.5 text-xs tabular-nums" />
          <span className="text-xs text-muted-foreground">—</span>
          <input type="date" value={value.end.toISOString().slice(0, 10)}
            onChange={e => onChange({ ...value, end: new Date(e.target.value + "T23:59:59") })}
            className="h-7 rounded border border-input bg-background px-1.5 text-xs tabular-nums" />
        </div>
      )}
    </div>
  );
}
