import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, ChevronDown, ChevronRight, Search } from "lucide-react";
import { db } from "@/integrations/local-db/client";
import { AppShell } from "@/components/AppShell";
import { OeeBadge } from "@/components/OeeBadge";
import { oeeStatus, pct, statusBg } from "@/lib/oee";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — OEE Monitor" }] }),
  component: Dashboard,
});

type Category = { id: string; name: string; sort_order: number };
type Line = { id: string; name: string; category_id: string; target_oee: number; sort_order: number };
type Station = { id: string; name: string; line_id: string; target_oee: number; sort_order: number };
type Snap = { station_id: string; ts: string; availability: number; performance: number; quality: number; oee: number };

function Dashboard() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [latest, setLatest] = useState<Record<string, Snap>>({});
  const [openLines, setOpenLines] = useState<Record<string, boolean>>({});
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});
  const [activeAlerts, setActiveAlerts] = useState(0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const [c, l, s] = await Promise.all([
        db.from("categories").select("*").order("sort_order"),
        db.from("lines").select("*").order("sort_order"),
        db.from("stations").select("*").order("sort_order"),
      ]);
      setCategories((c.data ?? []) as Category[]);
      setLines((l.data ?? []) as Line[]);
      setStations((s.data ?? []) as Station[]);
      const openL: Record<string, boolean> = {};
      const openC: Record<string, boolean> = {};
      (l.data ?? []).forEach((x: any) => (openL[x.id] = true));
      (c.data ?? []).forEach((x: any) => (openC[x.id] = true));
      setOpenLines(openL); setOpenCats(openC);

      // latest snapshot per station
      const { data: snaps } = await db
        .from("oee_snapshots")
        .select("station_id, ts, availability, performance, quality, oee")
        .order("ts", { ascending: false })
        .limit(2000);
      const map: Record<string, Snap> = {};
      (snaps ?? []).forEach((sn: any) => { if (!map[sn.station_id]) map[sn.station_id] = sn; });
      setLatest(map);

      const { count } = await db.from("alerts").select("id", { count: "exact", head: true }).is("acknowledged_at", null);
      setActiveAlerts(count ?? 0);
    })();

    const ch = db.channel("dashboard-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "oee_snapshots" }, (payload: any) => {
        const row = payload.new as Snap;
        setLatest((prev) => ({ ...prev, [row.station_id]: row }));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, async () => {
        const { count } = await db.from("alerts").select("id", { count: "exact", head: true }).is("acknowledged_at", null);
        setActiveAlerts(count ?? 0);
      })
      .subscribe();
    return () => { db.removeChannel(ch); };
  }, []);

  // Aggregate KPIs
  const kpi = useMemo(() => {
    const arr = Object.values(latest);
    if (!arr.length) return { a: 0, p: 0, q: 0, oee: 0 };
    const avg = (k: keyof Snap) => arr.reduce((s, x) => s + Number(x[k] ?? 0), 0) / arr.length;
    return { a: avg("availability"), p: avg("performance"), q: avg("quality"), oee: avg("oee") };
  }, [latest]);

  // Per line aggregate
  const lineAgg = (lineId: string) => {
    const ss = stations.filter((s) => s.line_id === lineId).map((s) => latest[s.id]?.oee).filter((v): v is number => v != null);
    if (!ss.length) return null;
    return ss.reduce((a, b) => a + Number(b), 0) / ss.length;
  };

  const filteredStation = (s: Station) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase());

  return (
    <AppShell title="OEE Monitoring Dashboard">
      <div className="space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard label="Plant OEE" value={kpi.oee} primary />
          <KpiCard label="Availability" value={kpi.a} />
          <KpiCard label="Performance" value={kpi.p} />
          <KpiCard label="Quality" value={kpi.q} />
          <Card className="col-span-2 md:col-span-1">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Active Alerts</div>
                  <div className={cn("text-2xl font-bold tabular-nums", activeAlerts > 0 ? "text-danger" : "text-success")}>
                    {activeAlerts}
                  </div>
                </div>
                <AlertTriangle className={cn("h-8 w-8", activeAlerts > 0 ? "text-danger" : "text-muted-foreground")} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search stations…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>

        {/* Tree */}
        <div className="space-y-4">
          {categories.map((cat) => {
            const catLines = lines.filter((l) => l.category_id === cat.id);
            const opened = openCats[cat.id];
            return (
              <Card key={cat.id}>
                <button onClick={() => setOpenCats((p) => ({ ...p, [cat.id]: !opened }))}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/40 transition-colors">
                  <div className="flex items-center gap-2">
                    {opened ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="text-base font-semibold">{cat.name}</span>
                    <span className="text-xs text-muted-foreground">({catLines.length} lines)</span>
                  </div>
                </button>
                {opened && (
                  <div className="border-t border-border p-3 space-y-3">
                    {catLines.map((line) => {
                      const lineStations = stations.filter((s) => s.line_id === line.id).filter(filteredStation);
                      const agg = lineAgg(line.id);
                      const opLine = openLines[line.id];
                      return (
                        <div key={line.id} className="rounded-md border border-border bg-card/50">
                          <div className="flex items-center justify-between gap-2 px-3 py-2">
                            <button onClick={() => setOpenLines((p) => ({ ...p, [line.id]: !opLine }))}
                              className="flex items-center gap-2 text-sm font-medium">
                              {opLine ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              <Link to="/line/$lineId" params={{ lineId: line.id }} className="hover:underline">
                                {line.name}
                              </Link>
                            </button>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground hidden sm:inline">Line OEE</span>
                              {agg != null ? <OeeBadge value={agg} target={line.target_oee} /> : <span className="text-xs text-muted-foreground">no data</span>}
                            </div>
                          </div>
                          {opLine && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 p-3 pt-0">
                              {lineStations.map((s) => {
                                const snap = latest[s.id];
                                const status = snap ? oeeStatus(Number(snap.oee), Number(s.target_oee)) : "warning";
                                return (
                                  <Link key={s.id} to="/station/$stationId" params={{ stationId: s.id }}
                                    className={cn("rounded-md border p-3 transition-all hover:scale-[1.01] hover:shadow-md", statusBg(status))}>
                                    <div className="flex items-center justify-between mb-2">
                                      <div className="text-sm font-medium text-foreground truncate">{s.name}</div>
                                      <Activity className="h-3.5 w-3.5 opacity-50" />
                                    </div>
                                    {snap ? (
                                      <>
                                        <div className="text-2xl font-bold tabular-nums">{pct(Number(snap.oee))}</div>
                                        <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                                          <span>A {pct(Number(snap.availability), 0)}</span>
                                          <span>P {pct(Number(snap.performance), 0)}</span>
                                          <span>Q {pct(Number(snap.quality), 0)}</span>
                                        </div>
                                      </>
                                    ) : (
                                      <div className="text-sm text-muted-foreground">No data</div>
                                    )}
                                  </Link>
                                );
                              })}
                              {lineStations.length === 0 && <div className="col-span-full text-xs text-muted-foreground py-2">No stations match.</div>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}

function KpiCard({ label, value, primary }: { label: string; value: number; primary?: boolean }) {
  const status = oeeStatus(value);
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={cn("mt-1 text-2xl md:text-3xl font-bold tabular-nums",
          primary ? (status === "good" ? "text-success" : status === "warning" ? "text-warning" : "text-danger") : "text-foreground")}>
          {pct(value)}
        </div>
      </CardContent>
    </Card>
  );
}
