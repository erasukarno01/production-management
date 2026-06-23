import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Plus } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Area, AreaChart, Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis, Legend, ComposedChart, Line } from "recharts";
import { toast } from "sonner";
import { db } from "@/integrations/local-db/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { OeeGauge } from "@/components/OeeGauge";
import { TrendChart } from "@/components/TrendChart";
import { DateRangeFilter, getDateRange, type DateRange } from "@/components/DateRangeFilter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProductionBarChart } from "@/components/ProductionBarChart";
import { NgDonutChart } from "@/components/NgDonutChart";
import { bucketize, type Bucket } from "@/lib/shift";
import { downloadCsv } from "@/lib/csv";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { pct } from "@/lib/oee";

export const Route = createFileRoute("/_authenticated/station/$stationId")({
  ssr: false,
  component: StationDetail,
});

function MiniSparkline({ data, color, width = 100, height = 24 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const mn = Math.min(...data);
  const mx = Math.max(...data);
  const rng = mx - mn || 1;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * width).toFixed(1)},${((1 - (v - mn) / rng) * height).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible opacity-60">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ActiveWoCard({ wo, ws }: { wo: any; ws: any }) {
  const planQty = Number(wo?.planned_qty ?? 0);
  const actualQty = Number(ws?.actual_qty ?? wo?.actual_qty ?? 0);
  const ngQty = Number(ws?.ng_qty ?? wo?.ng_qty ?? 0);
  const achPct = planQty > 0 ? Math.min(actualQty / planQty, 1) : 0;
  const achColor = achPct >= 1 ? "bg-success" : achPct >= 0.8 ? "bg-warning" : "bg-danger";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Active Work Order</div>
            <div className="text-sm font-semibold">{wo.wo_number}</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Product: <span className="font-medium text-foreground">{wo.products?.code ?? "—"}</span></span>
              <span>JC: <span className="font-medium text-foreground">{ws?.job_card_number ?? "—"}</span></span>
              <span>Model: <span className="font-medium text-foreground">{wo.products?.name ?? "—"}</span></span>
              {ws?.operator_name && <span>Operator: <span className="font-medium text-foreground">{ws.operator_name}</span></span>}
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="text-center">
              <div className="text-xs text-muted-foreground">Plan</div>
              <div className="text-xl font-bold tabular-nums">{planQty}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground">Actual</div>
              <div className="text-xl font-bold tabular-nums text-success">{actualQty}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground">NG</div>
              <div className="text-xl font-bold tabular-nums text-danger">{ngQty}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground">Ach.</div>
              <div className={cn("text-xl font-bold tabular-nums", achPct >= 1 ? "text-success" : achPct >= 0.8 ? "text-warning" : "text-danger")}>
                {(achPct * 100).toFixed(0)}%
              </div>
            </div>
          </div>
        </div>
        {planQty > 0 && (
          <div className="mt-2 h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full transition-all", achColor)} style={{ width: `${achPct * 100}%` }} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GaugeWithSparkline({ label, value, target, data }: { label: string; value: number; target?: number; data: number[] }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-col items-center">
          <OeeGauge label={label} value={value} target={target} size={110} />
          <MiniSparkline data={data} color="var(--chart-1)" />
        </div>
      </CardContent>
    </Card>
  );
}

function ProductionTable({ data }: { data: { ts: string; plan: number; actual: number; ng: number; oee: number }[] }) {
  return (
    <div className="max-h-64 overflow-y-auto text-xs">
      <table className="w-full">
        <thead>
          <tr className="text-muted-foreground border-b border-border">
            <th className="text-left py-1 pr-2">Time</th>
            <th className="text-right px-2">Plan</th>
            <th className="text-right px-2">Actual</th>
            <th className="text-right px-2">NG</th>
            <th className="text-right pl-2">OEE</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-accent/30">
              <td className="py-1 pr-2 text-muted-foreground">{r.ts}</td>
              <td className="text-right px-2 tabular-nums">{r.plan}</td>
              <td className="text-right px-2 tabular-nums">{r.actual}</td>
              <td className="text-right px-2 tabular-nums text-danger">{r.ng}</td>
              <td className="text-right pl-2 tabular-nums">{(r.oee * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StationDetail() {
  const { stationId } = Route.useParams();
  const { isOperator } = useAuth();
  const [station, setStation] = useState<any>(null);
  const [latest, setLatest] = useState<any>(null);
  const [rawSnaps, setRawSnaps] = useState<any[]>([]);
  const [downtimes, setDowntimes] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [ngDefects, setNgDefects] = useState<any[]>([]);
  const [activeWo, setActiveWo] = useState<any>(null);
  const [woStation, setWoStation] = useState<any>(null);
  const [dtOpen, setDtOpen] = useState(false);
  const [bucket, setBucket] = useState<Bucket>("hourly");
  const [dateRange, setDateRange] = useState<DateRange>(() => getDateRange("24h"));
  const [shift, setShift] = useState<"all" | "day" | "mid" | "night">("all");

  const load = async () => {
    const { data: st } = await db.from("stations").select("*, lines(name, target_oee, production_sections(name))").eq("id", stationId).single();
    setStation(st);
    const { data: snaps } = await db.from("oee_snapshots").select("*").eq("station_id", stationId).order("ts", { ascending: false }).limit(2000);
    setLatest(snaps?.[0]);
    setRawSnaps((snaps ?? []).slice().reverse());
    const { data: dt } = await db.from("downtime_events").select("*").eq("station_id", stationId).order("started_at", { ascending: false }).limit(500);
    setDowntimes(dt ?? []);
    const { data: a } = await db.from("alerts").select("*").eq("station_id", stationId).order("created_at", { ascending: false }).limit(50);
    setAlerts(a ?? []);
    const { data: nd } = await db.from("ng_defects").select("*").eq("station_id", stationId).order("ts", { ascending: false }).limit(500);
    setNgDefects(nd ?? []);
    if (st) {
      const { data: wos } = await db.from("work_orders").select("*, products(code, name)").eq("line_id", st.line_id).in("status", ["open", "in_progress"]).order("created_at", { ascending: false }).limit(1);
      const wo = wos?.[0] ?? null;
      setActiveWo(wo);
      if (wo) {
        const { data: wss } = await db.from("wo_stations").select("*").eq("work_order_id", wo.id).eq("station_id", stationId).maybeSingle();
        setWoStation(wss ?? null);
      }
    }
  };

  useEffect(() => {
    load();
    const ch = db.channel(`station-${stationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "oee_snapshots", filter: `station_id=eq.${stationId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "downtime_events", filter: `station_id=eq.${stationId}` }, load)
      .subscribe();
    return () => { db.removeChannel(ch); };
  }, [stationId]);

  const filteredSnaps = useMemo(() => rawSnaps.filter(s => { const t = new Date(s.ts).getTime(); return t >= dateRange.start.getTime() && t <= dateRange.end.getTime(); }), [rawSnaps, dateRange]);
  const filteredDowntimes = useMemo(() => downtimes.filter(d => { const t = new Date(d.started_at).getTime(); return t >= dateRange.start.getTime() && t <= dateRange.end.getTime(); }), [downtimes, dateRange]);
  const filteredAlerts = useMemo(() => alerts.filter(a => { const t = new Date(a.created_at).getTime(); return t >= dateRange.start.getTime() && t <= dateRange.end.getTime(); }), [alerts, dateRange]);
  const filteredDefects = useMemo(() => ngDefects.filter(d => { const t = new Date(d.ts).getTime(); return t >= dateRange.start.getTime() && t <= dateRange.end.getTime(); }), [ngDefects, dateRange]);

  const shiftFilter = (ts: string) => {
    if (shift === "all") return true;
    const h = new Date(ts).getHours();
    if (shift === "day") return h >= 6 && h < 14;
    if (shift === "mid") return h >= 14 && h < 22;
    return h >= 22 || h < 6;
  };
  const shiftSnaps = useMemo(() => filteredSnaps.filter(s => shiftFilter(s.ts)), [filteredSnaps, shift]);

  const trend = useMemo(() => bucketize(shiftSnaps.map(s => ({ ts: s.ts, oee: Number(s.oee) })), bucket), [shiftSnaps, bucket]);

  const prodData = useMemo(() => {
    const hourly: Record<string, { plan: number; actual: number; ng: number; oee: number; count: number }> = {};
    shiftSnaps.forEach((s) => {
      const key = format(new Date(s.ts), "HH:00");
      const b = hourly[key] ?? (hourly[key] = { plan: 0, actual: 0, ng: 0, oee: 0, count: 0 });
      b.plan += Number(s.plan_count ?? 0);
      b.actual += Number(s.total_count ?? 0);
      b.ng += Number(s.ng_count ?? Math.max(0, Number(s.total_count ?? 0) - Number(s.good_count ?? 0)));
      b.oee += Number(s.oee ?? 0);
      b.count++;
    });
    return Object.entries(hourly).sort(([a], [b]) => a.localeCompare(b)).map(([label, v]) => ({ label, ...v, oee: v.count > 0 ? v.oee / v.count : 0 }));
  }, [shiftSnaps]);

  const prodTableData = useMemo(() => prodData.map(d => ({ ts: d.label, plan: d.plan, actual: d.actual, ng: d.ng, oee: d.oee })), [prodData]);

  const ngTotals = useMemo(() => {
    const totalGood = shiftSnaps.reduce((a, s) => a + Number(s.good_count ?? 0), 0);
    const totalAll = shiftSnaps.reduce((a, s) => a + Number(s.total_count ?? 0), 0);
    const totalNg = shiftSnaps.reduce((a, s) => a + Number(s.ng_count ?? Math.max(0, Number(s.total_count ?? 0) - Number(s.good_count ?? 0))), 0);
    return { totalGood, totalAll, totalNg };
  }, [shiftSnaps]);

  const planTotal = prodData.reduce((a, d) => a + d.plan, 0);
  const actualTotal = prodData.reduce((a, d) => a + d.actual, 0);
  const achTotal = planTotal > 0 ? actualTotal / planTotal : 0;

  const dtPareto = useMemo(() => {
    const agg: Record<string, number> = { breakdown: 0, changeover: 0, material: 0, quality: 0, idle: 0, other: 0 };
    filteredDowntimes.forEach((d) => { agg[d.category] = (agg[d.category] ?? 0) + Number(d.duration_sec ?? 0) / 60; });
    const entries = Object.entries(agg).map(([cat, min]) => ({ category: cat, minutes: min })).sort((a, b) => b.minutes - a.minutes);
    const total = entries.reduce((s, e) => s + e.minutes, 0);
    let cum = 0;
    return entries.map(e => { cum += e.minutes; return { ...e, cumPct: total > 0 ? cum / total : 0 }; }).filter(e => e.minutes > 0);
  }, [filteredDowntimes]);

  const mtbfMttr = useMemo(() => {
    const breakdowns = filteredDowntimes.filter(d => d.category === "breakdown");
    const totalMin = (dateRange.end.getTime() - dateRange.start.getTime()) / 60000;
    const count = breakdowns.length;
    const totalDtMin = breakdowns.reduce((a, d) => a + Number(d.duration_sec ?? 0) / 60, 0);
    return { mtbf: count > 0 ? totalMin / count : 0, mttr: count > 0 ? totalDtMin / count : 0, count };
  }, [filteredDowntimes, dateRange]);

  const speedlossMin = useMemo(() => shiftSnaps.reduce((a, s) => a + Number(s.speedloss_sec ?? 0), 0) / 60, [shiftSnaps]);

  // NG Pareto by defect category
  const ngPareto = useMemo(() => {
    const agg: Record<string, number> = {};
    filteredDefects.forEach((d) => { agg[d.category] = (agg[d.category] ?? 0) + Number(d.quantity ?? 1); });
    const entries = Object.entries(agg).map(([cat, qty]) => ({ category: cat, quantity: qty })).sort((a, b) => b.quantity - a.quantity);
    const total = entries.reduce((s, e) => s + e.quantity, 0);
    let cum = 0;
    return entries.map(e => { cum += e.quantity; return { ...e, cumPct: total > 0 ? cum / total : 0 }; });
  }, [filteredDefects]);

  // NG by shift
  const ngByShift = useMemo(() => {
    const shifts: Record<string, number> = { day: 0, mid: 0, night: 0 };
    filteredDefects.forEach((d) => {
      const h = new Date(d.ts).getHours();
      const key = h >= 6 && h < 14 ? "day" : h >= 14 && h < 22 ? "mid" : "night";
      shifts[key] += Number(d.quantity ?? 1);
    });
    return Object.entries(shifts).map(([name, qty]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), qty }));
  }, [filteredDefects]);

  // NG rate trend per hour
  const ngRateTrend = useMemo(() => {
    const hourly: Record<string, { ng: number; total: number }> = {};
    shiftSnaps.forEach((s) => {
      const key = format(new Date(s.ts), "HH:00");
      const b = hourly[key] ?? (hourly[key] = { ng: 0, total: 0 });
      b.ng += Number(s.ng_count ?? Math.max(0, Number(s.total_count ?? 0) - Number(s.good_count ?? 0)));
      b.total += Number(s.total_count ?? 0);
    });
    filteredDefects.forEach((d) => {
      const key = format(new Date(d.ts), "HH:00");
      if (hourly[key]) hourly[key].ng += Number(d.quantity ?? 1);
    });
    return Object.entries(hourly).sort(([a], [b]) => a.localeCompare(b)).map(([label, v]) => ({ label, rate: v.total > 0 ? v.ng / v.total : 0 }));
  }, [shiftSnaps, filteredDefects]);

  // Cumulative Plan vs Actual
  const cumulativeProd = useMemo(() => {
    let cumPlan = 0, cumActual = 0;
    return prodData.map(d => { cumPlan += d.plan; cumActual += d.actual; return { label: d.label, cumPlan, cumActual }; });
  }, [prodData]);

  const dtData = useMemo(() => [
    ...dtPareto.map(e => ({ category: e.category, minutes: e.minutes })),
    ...(speedlossMin > 0 ? [{ category: "speedloss" as const, minutes: speedlossMin }] : []),
  ], [dtPareto, speedlossMin]);

  const lastSnaps = rawSnaps.slice(-30);
  const oeeVals = lastSnaps.map(s => Number(s.oee ?? 0));
  const avVals = lastSnaps.map(s => Number(s.availability ?? 0));
  const perfVals = lastSnaps.map(s => Number(s.performance ?? 0));
  const qualVals = lastSnaps.map(s => Number(s.quality ?? 0));

  const exportCsv = () => {
    const rows = rawSnaps.map((s) => ({
      ts: s.ts, availability: s.availability, performance: s.performance, quality: s.quality, oee: s.oee,
      plan_count: s.plan_count, total_count: s.total_count, good_count: s.good_count, ng_count: s.ng_count,
    }));
    downloadCsv(`station-${station?.name ?? stationId}-all.csv`, rows);
  };

  return (
    <AppShell title={station?.name ?? "Station"}>
      <div className="space-y-6">
        {/* Breadcrumb */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
            <span>/</span>
            {station ? (
              <Link to="/line/$lineId" params={{ lineId: station.line_id }} className="hover:text-foreground transition-colors">{station.lines?.name}</Link>
            ) : <span className="animate-pulse">Loading…</span>}
            <span>/</span>
            <span className="text-foreground font-medium">{station?.name ?? "Station"}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4 mr-1" /> CSV</Button>
            {isOperator && (
              <Dialog open={dtOpen} onOpenChange={setDtOpen}>
                <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> Log Downtime</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Log Downtime — {station?.name}</DialogTitle></DialogHeader>
                  <DowntimeForm stationId={stationId} onDone={() => { setDtOpen(false); load(); }} />
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        {/* Active WO card */}
        {activeWo && <ActiveWoCard wo={activeWo} ws={woStation} />}

        {/* Gauges with sparklines */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {latest ? (
            <>
              <GaugeWithSparkline label="OEE" value={Number(latest.oee)} target={Number(station?.target_oee ?? 0.85)} data={oeeVals} />
              <GaugeWithSparkline label="Operating Time Ratio" value={Number(latest.availability)} data={avVals} />
              <GaugeWithSparkline label="Performance Ratio" value={Number(latest.performance)} data={perfVals} />
              <GaugeWithSparkline label="Quality Ratio" value={Number(latest.quality)} data={qualVals} />
            </>
          ) : (
            <div className="col-span-4 py-12 text-center text-sm text-muted-foreground">No snapshots yet.</div>
          )}
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3">
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
          <Tabs value={bucket} onValueChange={(v) => setBucket(v as Bucket)}>
            <TabsList>
              <TabsTrigger value="hourly">Hourly</TabsTrigger>
              <TabsTrigger value="shift">Shift</TabsTrigger>
              <TabsTrigger value="daily">Daily</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={shift} onValueChange={(v) => setShift(v as any)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="day">Day</TabsTrigger>
              <TabsTrigger value="mid">Mid</TabsTrigger>
              <TabsTrigger value="night">Night</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* OEE Trend */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">OEE Trend</CardTitle>
            <Button variant="outline" size="sm" onClick={() => downloadCsv(`station-${station?.name ?? stationId}-trend.csv`, trend.map(t => ({ bucket: t.ts, oee: t.oee })))}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
          </CardHeader>
          <CardContent>
            {trend.length ? <TrendChart data={trend} /> : <div className="py-12 text-center text-sm text-muted-foreground">Awaiting data…</div>}
          </CardContent>
        </Card>

        {/* Production — Enhanced Plan vs Actual per Jam */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Chart with achievement line */}
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Plan vs Actual per Jam (dengan %Achievement)</CardTitle>
              <Button variant="outline" size="sm" onClick={() => downloadCsv(`station-${station?.name ?? stationId}-production.csv`, prodData)}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
            </CardHeader>
            <CardContent>
              {prodData.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={prodData.map(d => ({ ...d, ach: d.plan > 0 ? d.actual / d.plan : 0 }))} margin={{ top: 10, right: 50, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" domain={[0, 1]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }}
                      formatter={(v: number, name: string) => name === "ach" ? `${(v * 100).toFixed(1)}%` : v} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="left" dataKey="plan" name="Plan" fill="var(--muted-foreground)" opacity={0.4} radius={[3, 3, 0, 0]} />
                    <Bar yAxisId="left" dataKey="actual" name="Actual" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="ach" name="%Ach" stroke="var(--success)" strokeWidth={2} dot={false} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="py-12 text-center text-sm text-muted-foreground">Awaiting data…</div>}
            </CardContent>
          </Card>

          {/* Cumulative chart */}
          <Card>
            <CardHeader><CardTitle className="text-base">Cumulative Plan vs Actual</CardTitle></CardHeader>
            <CardContent>
              {cumulativeProd.length ? (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={cumulativeProd} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
                    <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Area type="monotone" dataKey="cumPlan" name="Cum Plan" stroke="var(--muted-foreground)" fill="var(--muted-foreground)" fillOpacity={0.1} strokeWidth={1.5} dot={false} />
                    <Area type="monotone" dataKey="cumActual" name="Cum Actual" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.15} strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <div className="py-8 text-center text-sm text-muted-foreground">No data</div>}
            </CardContent>
          </Card>

          {/* Summary */}
          <Card>
            <CardHeader><CardTitle className="text-base">Production Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Total Plan</div>
                  <div className="text-2xl font-bold tabular-nums">{planTotal.toLocaleString()}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Total Actual</div>
                  <div className={cn("text-2xl font-bold tabular-nums", achTotal >= 1 ? "text-success" : achTotal >= 0.8 ? "text-warning" : "text-danger")}>{actualTotal.toLocaleString()}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Achievement</div>
                  <div className={cn("text-2xl font-bold tabular-nums", achTotal >= 1 ? "text-success" : achTotal >= 0.8 ? "text-warning" : "text-danger")}>{(achTotal * 100).toFixed(1)}%</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">NG Rate</div>
                  <div className="text-2xl font-bold tabular-nums text-danger">{ngTotals.totalAll > 0 ? (ngTotals.totalNg / ngTotals.totalAll * 100).toFixed(1) : "—"}%</div>
                </div>
              </div>
              {ngTotals.totalAll > 0 && (
                <div className="mt-3 text-xs text-center text-muted-foreground">
                  Good: <span className="font-medium text-foreground">{ngTotals.totalGood.toLocaleString()}</span>
                  &nbsp;·&nbsp; NG: <span className="font-medium text-foreground">{ngTotals.totalNg.toLocaleString()}</span>
                  &nbsp;·&nbsp; Total: <span className="font-medium text-foreground">{ngTotals.totalAll.toLocaleString()}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Production Table — enhanced with Gap & %Ach */}
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">Production Log</CardTitle></CardHeader>
            <CardContent>
              {prodTableData.length ? (
                <div className="max-h-64 overflow-y-auto text-xs">
                  <table className="w-full">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border">
                        <th className="text-left py-1 pr-2">Time</th>
                        <th className="text-right px-2">Plan</th>
                        <th className="text-right px-2">Actual</th>
                        <th className="text-right px-2">Gap</th>
                        <th className="text-right px-2">%Ach</th>
                        <th className="text-right px-2">NG</th>
                        <th className="text-right pl-2">OEE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prodTableData.map((r, i) => (
                        <tr key={i} className="border-b border-border/50 hover:bg-accent/30">
                          <td className="py-1 pr-2 text-muted-foreground">{r.ts}</td>
                          <td className="text-right px-2 tabular-nums">{r.plan}</td>
                          <td className="text-right px-2 tabular-nums">{r.actual}</td>
                          <td className={cn("text-right px-2 tabular-nums", r.plan - r.actual > 0 ? "text-danger" : "text-success")}>{r.plan - r.actual}</td>
                          <td className={cn("text-right px-2 tabular-nums", r.plan > 0 ? (r.actual / r.plan >= 1 ? "text-success" : r.actual / r.plan >= 0.8 ? "text-warning" : "text-danger") : "")}>{r.plan > 0 ? (r.actual / r.plan * 100).toFixed(0) : "—"}%</td>
                          <td className="text-right px-2 tabular-nums text-danger">{r.ng}</td>
                          <td className="text-right pl-2 tabular-nums">{(r.oee * 100).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="py-8 text-center text-sm text-muted-foreground">No data</div>}
            </CardContent>
          </Card>
        </div>

        {/* NG Analysis — Pareto + Shift + Rate Trend */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Pareto NG by Category */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Pareto NG by Defect Category</CardTitle>
              <Button variant="outline" size="sm" onClick={() => downloadCsv(`station-${station?.name ?? stationId}-ng-pareto.csv`, ngPareto)}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
            </CardHeader>
            <CardContent>
              {ngPareto.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={ngPareto} margin={{ top: 20, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="category" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} label={{ value: "qty", angle: -90, position: "insideLeft", style: { fill: "var(--muted-foreground)", fontSize: 11 } }} />
                    <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} domain={[0, 1]} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }} />
                    <Bar yAxisId="left" dataKey="quantity" name="Qty" radius={[4, 4, 0, 0]}>
                      {ngPareto.map((d, i) => <Cell key={i} fill={i === 0 ? "var(--danger)" : i === 1 ? "var(--warning)" : "var(--chart-1)"} />)}
                    </Bar>
                    <Line yAxisId="right" type="monotone" dataKey="cumPct" stroke="var(--danger)" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : <div className="py-12 text-center text-sm text-muted-foreground">No defect data. Log defects first.</div>}
            </CardContent>
          </Card>

          {/* NG by Shift */}
          <Card>
            <CardHeader><CardTitle className="text-base">NG by Shift</CardTitle></CardHeader>
            <CardContent>
              {ngByShift.some(s => s.qty > 0) ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={ngByShift} margin={{ top: 20, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                    <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }} />
                    <Bar dataKey="qty" name="NG Qty" radius={[4, 4, 0, 0]}>
                      {ngByShift.map((d, i) => {
                        const colors = ["var(--chart-2)", "#f59e0b", "var(--chart-3)"];
                        return <Cell key={i} fill={colors[i]} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="py-12 text-center text-sm text-muted-foreground">No NG data.</div>}
            </CardContent>
          </Card>

          {/* NG Rate Trend */}
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">NG Rate Trend (%)</CardTitle></CardHeader>
            <CardContent>
              {ngRateTrend.length ? (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={ngRateTrend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                    <YAxis domain={[0, 'auto']} tickFormatter={(v) => `${(v * 100).toFixed(1)}%`} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }}
                      formatter={(v: number) => `${(v * 100).toFixed(2)}%`} />
                    <Area type="monotone" dataKey="rate" stroke="var(--danger)" strokeWidth={2} fill="var(--danger)" fillOpacity={0.1} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <div className="py-8 text-center text-sm text-muted-foreground">No production data</div>}
            </CardContent>
          </Card>
        </div>

        {/* Downtime section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Pareto */}
          <Card>
            <CardHeader><CardTitle className="text-base">Downtime Pareto (minutes)</CardTitle></CardHeader>
            <CardContent>
              {dtPareto.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={dtPareto} margin={{ top: 20, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="category" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} label={{ value: "min", angle: -90, position: "insideLeft", style: { fill: "var(--muted-foreground)", fontSize: 11 } }} />
                    <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} domain={[0, 1]} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }}
                      formatter={(v: number, name: string) => name === "cumPct" ? `${(v * 100).toFixed(0)}%` : `${v.toFixed(1)} min`} />
                    <Bar yAxisId="left" dataKey="minutes" name="Minutes" radius={[4, 4, 0, 0]} fill="var(--chart-1)">
                      {dtPareto.map((d, i) => <Cell key={i} fill={i === 0 ? "var(--danger)" : i === 1 ? "var(--warning)" : "var(--chart-1)"} />)}
                    </Bar>
                    <Line yAxisId="right" type="monotone" dataKey="cumPct" stroke="var(--danger)" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : <div className="py-12 text-center text-sm text-muted-foreground">No downtime.</div>}
            </CardContent>
          </Card>

          {/* MTBF/MTTR */}
          <Card>
            <CardHeader><CardTitle className="text-base">Reliability Metrics</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">MTBF</div>
                  <div className="text-xl font-bold tabular-nums">{mtbfMttr.mtbf > 0 ? `${mtbfMttr.mtbf.toFixed(1)}m` : "—"}</div>
                  <div className="text-[10px] text-muted-foreground">Mean Time Between Failures</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">MTTR</div>
                  <div className="text-xl font-bold tabular-nums">{mtbfMttr.mttr > 0 ? `${mtbfMttr.mttr.toFixed(1)}m` : "—"}</div>
                  <div className="text-[10px] text-muted-foreground">Mean Time To Repair</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Events</div>
                  <div className="text-xl font-bold tabular-nums">{mtbfMttr.count}</div>
                  <div className="text-[10px] text-muted-foreground">Breakdown count</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Downtime + speedloss chart */}
          <Card>
            <CardHeader><CardTitle className="text-base">Downtime + Speedloss (min)</CardTitle></CardHeader>
            <CardContent>
              {dtData.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={dtData} margin={{ top: 20, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="category" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                    <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} label={{ value: "min", angle: -90, position: "insideLeft", style: { fill: "var(--muted-foreground)", fontSize: 11 } }} />
                    <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }}
                      formatter={(v: number) => `${v.toFixed(1)} min`} />
                    <Bar dataKey="minutes" radius={[4, 4, 0, 0]}>
                      {dtData.map((d, i) => {
                        const COLORS: Record<string, string> = { breakdown: "var(--danger)", changeover: "#f59e0b", material: "#8b5cf6", quality: "var(--warning)", idle: "var(--muted-foreground)", other: "#64748b", speedloss: "#ec4899" };
                        return <Cell key={i} fill={COLORS[d.category] ?? "#64748b"} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="py-12 text-center text-sm text-muted-foreground">No data.</div>}
            </CardContent>
          </Card>
        </div>

        {/* Recent Downtime */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Downtime Events</CardTitle>
            <Button variant="outline" size="sm" onClick={() => downloadCsv(`station-${station?.name ?? stationId}-downtime.csv`, filteredDowntimes)}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
          </CardHeader>
          <CardContent>
            {filteredDowntimes.length === 0 ? <div className="text-sm text-muted-foreground">No downtime events.</div> : (
              <div className="divide-y divide-border max-h-72 overflow-y-auto">
                {filteredDowntimes.map((d) => (
                  <div key={d.id} className="py-2 flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium capitalize">{d.category} — {d.reason ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{format(new Date(d.started_at), "MMM d, HH:mm")}{d.duration_sec ? ` · ${Math.round(d.duration_sec / 60)}m` : ""}</div>
                    </div>
                    {d.note && <div className="text-xs text-muted-foreground max-w-xs truncate">{d.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Alerts section */}
        <Card>
          <CardHeader><CardTitle className="text-base">Alerts</CardTitle></CardHeader>
          <CardContent>
            {filteredAlerts.length === 0 ? <div className="text-sm text-muted-foreground">No alerts.</div> : (
              <div className="divide-y divide-border max-h-72 overflow-y-auto">
                {filteredAlerts.map((a) => (
                  <div key={a.id} className="py-2 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full shrink-0", a.acknowledged_at ? "bg-muted-foreground" : "bg-danger")} />
                      <div>
                        <div className="font-medium">{a.message}</div>
                        <div className="text-xs text-muted-foreground">{format(new Date(a.created_at), "MMM d, HH:mm")}{a.level ? ` · ${a.level}` : ""}</div>
                      </div>
                    </div>
                    {a.acknowledged_at && <div className="text-[10px] text-muted-foreground">Ack {format(new Date(a.acknowledged_at), "HH:mm")}</div>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function DowntimeForm({ stationId, onDone }: { stationId: string; onDone: () => void }) {
  const [category, setCategory] = useState("breakdown");
  const [reason, setReason] = useState("");
  const [durationMin, setDurationMin] = useState(5);
  const [note, setNote] = useState("");
  const submit = async () => {
    const now = new Date();
    const started = new Date(now.getTime() - durationMin * 60_000);
    const { error } = await db.from("downtime_events").insert({
      station_id: stationId,
      started_at: started.toISOString(),
      ended_at: now.toISOString(),
      duration_sec: durationMin * 60,
      category: category as any,
      reason, note: note || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Downtime logged");
    onDone();
  };
  return (
    <div className="space-y-3">
      <div>
        <Label>Category</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {["breakdown", "changeover", "material", "quality", "idle", "other"].map((c) =>
              <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div><Label>Reason</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. nozzle clog" /></div>
      <div><Label>Duration (minutes)</Label><Input type="number" value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} /></div>
      <div><Label>Note</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <Button onClick={submit} className="w-full">Submit</Button>
    </div>
  );
}
