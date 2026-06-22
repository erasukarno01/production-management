import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type DowntimeBucket = { category: string; minutes: number };

const COLORS: Record<string, string> = {
  breakdown: "var(--danger)",
  changeover: "#f59e0b",
  material: "#8b5cf6",
  quality: "var(--warning)",
  idle: "var(--muted-foreground)",
  other: "#64748b",
  speedloss: "#ec4899",
};

export function DowntimeBarChart({ data, height = 260 }: { data: DowntimeBucket[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 20, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="category" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
        <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} label={{ value: "min", angle: -90, position: "insideLeft", style: { fill: "var(--muted-foreground)", fontSize: 11 } }} />
        <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }}
          formatter={(v: number) => `${v.toFixed(1)} min`} />
        <Bar dataKey="minutes" radius={[4, 4, 0, 0]}>
          <LabelList dataKey="minutes" position="top" formatter={(v: number) => v > 0 ? v.toFixed(0) : ""} style={{ fill: "var(--foreground)", fontSize: 10 }} />
          {data.map((d, i) => <Cell key={i} fill={COLORS[d.category] ?? "#64748b"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
