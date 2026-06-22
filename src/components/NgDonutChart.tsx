import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

export function NgDonutChart({ good, ng, target = 0.02, height = 240 }: { good: number; ng: number; target?: number; height?: number }) {
  const total = good + ng;
  const ratio = total > 0 ? ng / total : 0;
  const ngColor = ratio <= target ? "var(--success)" : ratio <= target * 2 ? "var(--warning)" : "var(--danger)";
  const data = [
    { name: "Good", value: good, color: "var(--chart-1)" },
    { name: "NG", value: ng, color: ngColor },
  ];
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }} />
          <Pie data={data} dataKey="value" innerRadius="62%" outerRadius="88%" paddingAngle={2} stroke="none">
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-bold" style={{ color: ngColor }}>{(ratio * 100).toFixed(2)}%</div>
        <div className="text-xs text-muted-foreground">NG {ng.toLocaleString()} / {total.toLocaleString()} pcs</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">Target ≤ {(target * 100).toFixed(1)}%</div>
      </div>
    </div>
  );
}
