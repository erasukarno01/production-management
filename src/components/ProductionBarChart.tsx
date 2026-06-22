import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type ProductionPoint = { label: string; plan: number; actual: number };

export function ProductionBarChart({ data, height = 240 }: { data: ProductionPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="label" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
        <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
        <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="plan" name="Plan" fill="var(--muted-foreground)" opacity={0.5} radius={[3, 3, 0, 0]} />
        <Bar dataKey="actual" name="Actual" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
