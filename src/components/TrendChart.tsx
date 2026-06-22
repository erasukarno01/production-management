import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type TrendPoint = { ts: string; oee: number; availability?: number; performance?: number; quality?: number };

export function TrendChart({ data, height = 240 }: { data: TrendPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="g-oee" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.5} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="ts" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
        <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
        <Tooltip
          contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }}
          formatter={(v: number) => `${(v * 100).toFixed(1)}%`}
        />
        <Area type="monotone" dataKey="oee" stroke="var(--chart-1)" strokeWidth={2} fill="url(#g-oee)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
