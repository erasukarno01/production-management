import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, Area, AreaChart, Line } from "recharts";
import { db } from "@/integrations/local-db/client";
import { AppShell } from "@/components/AppShell";
import { OeeGauge } from "@/components/OeeGauge";
import { OeeBadge } from "@/components/OeeBadge";
import { TrendChart } from "@/components/TrendChart";
import { DateRangeFilter, getDateRange, type DateRange, type DatePreset } from "@/components/DateRangeFilter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { bucketize, type Bucket } from "@/lib/shift";
import { downloadCsv } from "@/lib/csv";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { oeeStatus, pct } from "@/lib/oee";

export const Route = createFileRoute("/_authenticated/line/$lineId")({
  ssr: false,
  component: LineDetail,
});

function LineDetail() {
  const { lineId } = Route.useParams();
  const [line, setLine] = useState<any>(null);
  const [stations, setStations] = useState<any[]>([]);
  const [latest, setLatest] = useState<Record<string, any>>({});
  const [rawSnaps, setRawSnaps] = useState<any[]>([]);
  const [downtimes, setDowntimes] = useState<any[]>([]);
  const [activeWos, setActiveWos] = useState<any[]>([]);
  const [woStations, setWoStations] = useState<any[]>([]);
  const [ngDefects, setNgDefects] = useState<any[]>([]);
  const [bucket, setBucket] = useState<Bucket>("hourly");
  const [dateRange, setDateRange] = useState<DateRange>(() => getDateRange("24h"));
  const [shift, setShift] = useState<"all" | "day" | "mid" | "night">("all");

  useEffect(() => {
    (async () => {
      const { data: l } = await db.from("lines").select("*, production_sections(name)").eq("id", lineId).single();
      setLine(l);
      const { data: st } = await db.from("stations").select("*").eq("line_id", lineId).order("sort_order");
      setStations(st ?? []);
      const ids = (st ?? []).map((s: any) => s.id);
      if (ids.length) {
        const { data: snaps } = await db.from("oee_snapshots").select("*").in("station_id", ids).order("ts", { ascending: false }).limit(3000);
        const map: Record<string, any> = {};
        (snaps ?? []).forEach((sn: any) => { if (!map[sn.station_id]) map[sn.station_id] = sn; });
        setLatest(map);
        setRawSnaps((snaps ?? []).slice().reverse());

        const { data: dt } = await db.from("downtime_events").select("*").in("station_id", ids).order("started_at", { ascending: false }).limit(500);
        setDowntimes(dt ?? []);
        const { data: nd } = await db.from("ng_defects").select("*").in("station_id", ids).order("ts", { ascending: false }).limit(500);
        setNgDefects(nd ?? []);
      }
      const { data: wos } = await db.from("work_orders").select("*, products(code, name)").eq("line_id", lineId).in("status", ["open", "in_progress"]).order("created_at", { ascending: false });
      setActiveWos(wos ?? []);
      if ((wos ?? []).length > 0) {
        const woIds = (wos ?? []).map((wo: any) => wo.id);
        const { data: wss } = await db.from("wo_stations").select("*, stations(name)").in("work_order_id", woIds);
        setWoStations(wss ?? []);
      }
    })();

    const ch = db.channel(`line-${lineId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "oee_snapshots" }, (payload: any) => {
        const row = payload.new as any;
        setLatest((prev) => (stations.find((s) => s.id === row.station_id) ? { ...prev, [row.station_id]: row } : prev));
        setRawSnaps((prev) => stations.find((s) => s.id === row.station_id) ? [...prev, row].slice(-3000) : prev);
      })
      .subscribe();
    return () => { db.removeChannel(ch); };
  }, [lineId]);

  const filteredSnaps = useMemo(() => rawSnaps.filter(s => { const t = new Date(s.ts).getTime(); return t >= dateRange.start.getTime() && t <= dateRange.end.getTime(); }), [rawSnaps, dateRange]);
  const filteredDowntimes = useMemo(() => downtimes.filter(d => { const t = new Date(d.started_at).getTime(); return t >= dateRange.start.getTime() && t <= dateRange.end.getTime(); }), [downtimes, dateRange]);

  const shiftFilter = (ts: string) => {
    if (shift === "all") return true;
    const h = new Date(ts).getHours();
    if (shift === "day") return h >= 6 && h < 14;
    if (shift === "mid") return h >= 14 && h < 22;
    return h >= 22 || h < 6;
  };
  const shiftSnaps = useMemo(() => filteredSnaps.filter(s => shiftFilter(s.ts)), [filteredSnaps, shift]);

  const trend = useMemo(() => bucketize(shiftSnaps.map((s) => ({ ts: s.ts, oee: Number(s.oee) })), bucket), [shiftSnaps, bucket]);

  const stationOees = stations.map((s) => Number(latest[s.id]?.oee ?? 0)).filter((v) => v > 0);
  const avg = stationOees.length ? stationOees.reduce((a, b) => a + b, 0) / stationOees.length : 0;
  const avgA = stations.map((s) => Number(latest[s.id]?.availability ?? 0)).filter(v => v > 0).reduce((a, b, _, arr) => a + b / arr.length, 0);
  const avgP = stations.map((s) => Number(latest[s.id]?.performance ?? 0)).filter(v => v > 0).reduce((a, b, _, arr) => a + b / arr.length, 0);
  const avgQ = stations.map((s) => Number(latest[s.id]?.quality ?? 0)).filter(v => v > 0).reduce((a, b, _, arr) => a + b / arr.length, 0);

  // Station comparison data (sorted by OEE ascending)
  const stationComp = useMemo(() => stations
    .map(s => ({ id: s.id, name: s.name, target: s.target_oee, oee: Number(latest[s.id]?.oee ?? 0), availability: Number(latest[s.id]?.availability ?? 0), performance: Number(latest[s.id]?.performance ?? 0), quality: Number(latest[s.id]?.quality ?? 0) }))
    .sort((a, b) => a.oee - b.oee), [stations, latest]);

  // Per-station production data
  const stationProd = useMemo(() => {
    const perStation: Record<string, { plan: number; actual: number; ng: number }> = {};
    shiftSnaps.forEach((s) => {
      const sid = s.station_id;
      const st = stations.find(x => x.id === sid);
      if (!st) return;
      const key = st.name;
      const b = perStation[key] ?? (perStation[key] = { plan: 0, actual: 0, ng: 0 });
      b.plan += Number(s.plan_count ?? 0);
      b.actual += Number(s.total_count ?? 0);
      b.ng += Number(s.ng_count ?? Math.max(0, Number(s.total_count ?? 0) - Number(s.good_count ?? 0)));
    });
    return Object.entries(perStation).map(([name, v]) => ({ name, ...v }));
  }, [shiftSnaps, stations]);

  const totalPlan = stationProd.reduce((a, s) => a + s.plan, 0);
  const totalActual = stationProd.reduce((a, s) => a + s.actual, 0);
  const totalNg = stationProd.reduce((a, s) => a + s.ng, 0);
  const lineAch = totalPlan > 0 ? totalActual / totalPlan : 0;

  // Downtime by station
  const filteredDefects = useMemo(() => ngDefects.filter(d => { const t = new Date(d.ts).getTime(); return t >= dateRange.start.getTime() && t <= dateRange.end.getTime(); }), [ngDefects, dateRange]);

  const ngByStationLine = useMemo(() => {
    const agg: Record<string, number> = {};
    filteredDefects.forEach((d) => {
      const st = stations.find(s => s.id === d.station_id);
      if (!st) return;
      agg[st.name] = (agg[st.name] ?? 0) + Number(d.quantity ?? 1);
    });
    return Object.entries(agg).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty);
  }, [filteredDefects, stations]);

  const dtByStation = useMemo(() => {
    const agg: Record<string, Record<string, number>> = {};
    filteredDowntimes.forEach((d) => {
      const st = stations.find(s => s.id === d.station_id);
      if (!st) return;
      const name = st.name;
      agg[name] ??= {};
      agg[name][d.category] = (agg[name][d.category] ?? 0) + Number(d.duration_sec ?? 0) / 60;
    });
    const cats = ["breakdown", "changeover", "material", "quality", "idle", "other"];
    return Object.entries(agg).map(([name, c]) => ({ name, ...Object.fromEntries(cats.map(cat => [cat, c[cat] ?? 0])) }));
  }, [filteredDowntimes, stations]);

  // Shift comparison
  const shiftData = useMemo(() => {
    const shifts: Record<string, { oee: number; a: number; p: number; q: number; count: number }> = { day: { oee: 0, a: 0, p: 0, q: 0, count: 0 }, mid: { oee: 0, a: 0, p: 0, q: 0, count: 0 }, night: { oee: 0, a: 0, p: 0, q: 0, count: 0 } };
    filteredSnaps.forEach((s) => {
      const h = new Date(s.ts).getHours();
      const key = h >= 6 && h < 14 ? "day" : h >= 14 && h < 22 ? "mid" : "night";
      const b = shifts[key];
      b.oee += Number(s.oee ?? 0);
      b.a += Number(s.availability ?? 0);
      b.p += Number(s.performance ?? 0);
      b.q += Number(s.quality ?? 0);
      b.count++;
    });
    return Object.entries(shifts).map(([name, v]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      OEE: v.count > 0 ? v.oee / v.count : 0,
      "Operating Time Ratio": v.count > 0 ? v.a / v.count : 0,
      "Performance Ratio": v.count > 0 ? v.p / v.count : 0,
      "Quality Ratio": v.count > 0 ? v.q / v.count : 0,
    }));
  }, [filteredSnaps]);

  const trendA = useMemo(() => bucketize(shiftSnaps.map((s) => ({ ts: s.ts, oee: Number(s.availability) })), bucket), [shiftSnaps, bucket]);
  const trendP = useMemo(() => bucketize(shiftSnaps.map((s) => ({ ts: s.ts, oee: Number(s.performance) })), bucket), [shiftSnaps, bucket]);
  const trendQ = useMemo(() => bucketize(shiftSnaps.map((s) => ({ ts: s.ts, oee: Number(s.quality) })), bucket), [shiftSnaps, bucket]);

  return (
    <AppShell title={line?.name ?? "Line"}>
      <div className="space-y-6">
        {/* Breadcrumb */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
            <span>/</span>
            <span className="text-foreground font-medium">{line?.name ?? "Line"}</span>
          </div>
          <div className="text-xs text-muted-foreground">{line?.production_sections?.name}</div>
        </div>

        {/* OEE Gauges */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="p-4 flex justify-center"><OeeGauge label="OEE" value={avg} target={Number(line?.target_oee ?? 0.85)} /></CardContent></Card>
          <Card><CardContent className="p-4 flex justify-center"><OeeGauge label="Operating Time Ratio" value={avgA} /></CardContent></Card>
          <Card><CardContent className="p-4 flex justify-center"><OeeGauge label="Performance Ratio" value={avgP} /></CardContent></Card>
          <Card><CardContent className="p-4 flex justify-center"><OeeGauge label="Quality Ratio" value={avgQ} /></CardContent></Card>
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

        {/* Active Work Orders */}
        {activeWos.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Active Work Orders</CardTitle></CardHeader>
            <CardContent>
              <div className="divide-y divide-border">
                {activeWos.map((wo) => {
                  const planQty = Number(wo.planned_qty ?? 0);
                  const actualQty = Number(wo.actual_qty ?? 0);
                  const achPct = planQty > 0 ? Math.min(actualQty / planQty, 1) : 0;
                  const stationJobs = woStations.filter((ws: any) => ws.work_order_id === wo.id);
                  return (
                    <div key={wo.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div>
                          <div className="font-semibold text-sm">{wo.wo_number}</div>
                          <div className="text-xs text-muted-foreground">{wo.products?.code} — {wo.products?.name}</div>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span>Plan <strong>{planQty}</strong></span>
                          <span>Act <strong>{actualQty}</strong></span>
                          <OeeBadge value={achPct} target={1} />
                        </div>
                      </div>
                      {planQty > 0 && (
                        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden mb-2">
                          <div className={cn("h-full rounded-full transition-all", achPct >= 1 ? "bg-success" : achPct >= 0.8 ? "bg-warning" : "bg-danger")} style={{ width: `${achPct * 100}%` }} />
                        </div>
                      )}
                      {stationJobs.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {stationJobs.map((ws: any) => (
                            <span key={ws.id} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{ws.stations?.name}: {ws.job_card_number}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Production Summary */}
        <Card>
          <CardHeader><CardTitle className="text-base">Line Production Summary</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-xs text-muted-foreground">Total Plan</div>
                <div className="text-2xl font-bold tabular-nums">{totalPlan.toLocaleString()}</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-muted-foreground">Total Actual</div>
                <div className={cn("text-2xl font-bold tabular-nums", lineAch >= 1 ? "text-success" : lineAch >= 0.8 ? "text-warning" : "text-danger")}>{totalActual.toLocaleString()}</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-muted-foreground">Achievement</div>
                <div className={cn("text-2xl font-bold tabular-nums", lineAch >= 1 ? "text-success" : lineAch >= 0.8 ? "text-warning" : "text-danger")}>{(lineAch * 100).toFixed(1)}%</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-muted-foreground">Total NG</div>
                <div className="text-2xl font-bold tabular-nums text-danger">{totalNg.toLocaleString()}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Station OEE Comparison */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Station OEE Comparison</CardTitle>
            <Button variant="outline" size="sm" onClick={() => downloadCsv(`line-${line?.name ?? lineId}-station-oee.csv`, stationComp)}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
          </CardHeader>
          <CardContent>
            {stationComp.length ? (
              <ResponsiveContainer width="100%" height={Math.max(160, stationComp.length * 50)}>
                <BarChart data={stationComp} layout="vertical" margin={{ top: 5, right: 40, left: 80, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" domain={[0, 1]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "var(--foreground)", fontSize: 12 }} width={75} />
                  <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }}
                    formatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                  <Bar dataKey="oee" radius={[0, 4, 4, 0]}>
                    {stationComp.map((s, i) => {
                      const status = oeeStatus(s.oee, s.target);
                      return <Cell key={i} fill={status === "good" ? "var(--success)" : status === "warning" ? "var(--warning)" : "var(--danger)"} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="py-8 text-center text-sm text-muted-foreground">No station data.</div>}
          </CardContent>
        </Card>

        {/* APQ Matrix */}
        <Card>
          <CardHeader><CardTitle className="text-base">APQ Matrix</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  <th className="text-left py-2 pr-4">Station</th>
                  <th className="text-center px-2">OEE</th>
                  <th className="text-center px-2">A</th>
                  <th className="text-center px-2">P</th>
                  <th className="text-center px-2">Q</th>
                  <th className="text-center pl-2">Target</th>
                </tr>
              </thead>
              <tbody>
                {stationComp.map((s) => {
                  const st = oeeStatus(s.oee, s.target);
                  return (
                    <tr key={s.id} className="border-b border-border/50 hover:bg-accent/30">
                      <td className="py-2 pr-4 font-medium">{s.name}</td>
                      <td className={cn("text-center px-2 tabular-nums font-semibold", st === "good" ? "text-success" : st === "warning" ? "text-warning" : "text-danger")}>{(s.oee * 100).toFixed(1)}%</td>
                      <td className="text-center px-2 tabular-nums">{pct(s.availability, 1)}</td>
                      <td className="text-center px-2 tabular-nums">{pct(s.performance, 1)}</td>
                      <td className="text-center px-2 tabular-nums">{pct(s.quality, 1)}</td>
                      <td className="text-center pl-2 tabular-nums text-muted-foreground">{(s.target * 100).toFixed(0)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* OEE Trend with APQ overlay */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">OEE Trend — Multi-line</CardTitle>
            <Button variant="outline" size="sm" onClick={() => downloadCsv(`line-${line?.name ?? lineId}-trend.csv`, trend.map((t, i) => ({ bucket: t.ts, oee: t.oee, a: trendA[i]?.oee, p: trendP[i]?.oee, q: trendQ[i]?.oee })))}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
          </CardHeader>
          <CardContent>
            {trend.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={trend.map((t, i) => ({ ...t, availability: trendA[i]?.oee, performance: trendP[i]?.oee, quality: trendQ[i]?.oee }))} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="lg-oee" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="ts" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                  <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }}
                    formatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="availability" stroke="var(--success)" strokeWidth={1.5} dot={false} name="Operating Time Ratio" />
                  <Line type="monotone" dataKey="performance" stroke="var(--chart-2)" strokeWidth={1.5} dot={false} name="Performance Ratio" />
                  <Line type="monotone" dataKey="quality" stroke="var(--chart-3)" strokeWidth={1.5} dot={false} name="Quality Ratio" />
                  <Area type="monotone" dataKey="oee" stroke="var(--chart-1)" strokeWidth={2} fill="url(#lg-oee)" name="OEE" />
                </AreaChart>
              </ResponsiveContainer>
            ) : <div className="text-sm text-muted-foreground py-12 text-center">No data yet</div>}
          </CardContent>
        </Card>

        {/* NG by Station */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">NG Distribution by Station</CardTitle>
            <Button variant="outline" size="sm" onClick={() => downloadCsv(`line-${line?.name ?? lineId}-ng.csv`, ngByStationLine)}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
          </CardHeader>
          <CardContent>
            {ngByStationLine.length ? (
              <ResponsiveContainer width="100%" height={Math.max(160, ngByStationLine.length * 50)}>
                <BarChart data={ngByStationLine} layout="vertical" margin={{ top: 5, right: 20, left: 80, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "var(--foreground)", fontSize: 12 }} width={75} />
                  <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }} />
                  <Bar dataKey="qty" name="NG Qty" radius={[0, 4, 4, 0]}>
                    {ngByStationLine.map((d, i) => <Cell key={i} fill={i === 0 ? "var(--danger)" : i === ngByStationLine.length - 1 ? "var(--success)" : "var(--warning)"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="py-8 text-center text-sm text-muted-foreground">No NG data</div>}
          </CardContent>
        </Card>

        {/* Shift Performance Comparison */}
        <Card>
          <CardHeader><CardTitle className="text-base">Shift Performance Comparison</CardTitle></CardHeader>
          <CardContent>
            {shiftData.some(s => s.OEE > 0) ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={shiftData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                  <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }}
                    formatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="OEE" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Operating Time Ratio" fill="var(--success)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Performance Ratio" fill="var(--chart-2)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Quality Ratio" fill="var(--chart-3)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="py-8 text-center text-sm text-muted-foreground">No data yet</div>}
          </CardContent>
        </Card>

        {/* Downtime by Station */}
        {dtByStation.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Downtime by Station (minutes)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={Math.max(160, dtByStation.length * 50)}>
                <BarChart data={dtByStation} layout="vertical" margin={{ top: 5, right: 20, left: 80, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "var(--foreground)", fontSize: 12 }} width={75} />
                  <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }}
                    formatter={(v: number) => `${v.toFixed(1)} min`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {["breakdown", "changeover", "material", "quality", "idle", "other"].map(cat => (
                    <Bar key={cat} dataKey={cat} name={cat.charAt(0).toUpperCase() + cat.slice(1)} stackId="a"
                      fill={cat === "breakdown" ? "var(--danger)" : cat === "changeover" ? "#f59e0b" : cat === "material" ? "#8b5cf6" : cat === "quality" ? "var(--warning)" : cat === "idle" ? "var(--muted-foreground)" : "#64748b"} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Station cards */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Stations</CardTitle>
            <span className="text-xs text-muted-foreground">{stations.length} stations</span>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {stations.map((s) => {
              const snap = latest[s.id];
              const comp = stationComp.find(c => c.id === s.id);
              return (
                <Link key={s.id} to="/station/$stationId" params={{ stationId: s.id }}
                  className="rounded-md border border-border bg-card p-3 hover:bg-accent/50 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-medium text-sm">{s.name}</div>
                    {snap ? <OeeBadge value={Number(snap.oee)} target={Number(s.target_oee)} /> : <span className="text-xs text-muted-foreground">—</span>}
                  </div>
                  {comp && (
                    <div className="grid grid-cols-3 gap-1 text-[10px] text-muted-foreground">
                      <span>A {pct(comp.availability, 0)}</span>
                      <span>P {pct(comp.performance, 0)}</span>
                      <span>Q {pct(comp.quality, 0)}</span>
                    </div>
                  )}
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
