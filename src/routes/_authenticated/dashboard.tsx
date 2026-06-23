import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Search } from "lucide-react";
import { db } from "@/integrations/local-db/client";
import { AppShell } from "@/components/AppShell";
import { OeeBadge } from "@/components/OeeBadge";
import { oeeStatus, type OeeStatus, pct, statusBg } from "@/lib/oee";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — OEE Monitor" }] }),
  component: Dashboard,
});

type ProductionSection = { id: string; name: string; sort_order: number };
type Line = { id: string; name: string; production_section_id: string; target_oee: number; sort_order: number };
type Station = { id: string; name: string; line_id: string; target_oee: number; sort_order: number };
type Snap = { station_id: string; ts: string; availability: number; performance: number; quality: number; oee: number };
type WoCard = { id: string; wo_number: string; product_id: string; line_id: string; planned_qty: number; actual_qty: number; ng_qty: number; planned_start: string; status: string; products: { code: string; name: string } };
type WoStationCard = { work_order_id: string; station_id: string; job_card_number: string; actual_qty: number; ng_qty: number };

const COL_OPTIONS = [1, 2, 3] as const;
const REFRESH_OPTIONS = [
  { value: 0, label: "Off" },
  { value: 2, label: "2s" },
  { value: 3, label: "3s" },
  { value: 5, label: "5s" },
  { value: 10, label: "10s" },
] as const;

const colGrid: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
};

function Dashboard() {
  const [sections, setSections] = useState<ProductionSection[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [latest, setLatest] = useState<Record<string, Snap>>({});
  const [woMap, setWoMap] = useState<Record<string, { wo: WoCard; ws: WoStationCard | null }>>({});
  const [openLines, setOpenLines] = useState<Record<string, boolean>>({});
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});
  const [activeAlerts, setActiveAlerts] = useState(0);
  const [downtimeMap, setDowntimeMap] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [columns, setColumns] = useState(2);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [refreshInterval, setRefreshInterval] = useState(0);

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const isTodayRef = useRef(true);
  isTodayRef.current = selectedDate === todayStr;

  async function loadOeeData() {
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

    const { data: dtData } = await db.from("downtime_events").select("station_id, duration_sec");
    const dtMap: Record<string, number> = {};
    (dtData ?? []).forEach((d: any) => {
      dtMap[d.station_id] = (dtMap[d.station_id] ?? 0) + Math.round(Number(d.duration_sec ?? 0) / 60);
    });
    setDowntimeMap(dtMap);
  }

  async function loadWoData(dateStr: string) {
    const { data: wos } = await db.from("work_orders").select("*, products(code, name)").in("status", ["open", "in_progress"]);
    const activeWos = (wos ?? []) as WoCard[];
    const woIds = activeWos.map(wo => wo.id);
    let wsList: WoStationCard[] = [];
    if (woIds.length > 0) {
      const { data: wss } = await db.from("wo_stations").select("work_order_id, station_id, actual_qty, ng_qty");
      wsList = (wss ?? []) as WoStationCard[];
    }
    const dateWos = activeWos.filter(wo => wo.planned_start && wo.planned_start.startsWith(dateStr));
    const effectiveWos = dateWos;
    const lineWo: Record<string, WoCard> = {};
    for (const wo of effectiveWos) {
      if (!lineWo[wo.line_id] || wo.planned_start > lineWo[wo.line_id].planned_start) {
        lineWo[wo.line_id] = wo;
      }
    }
    const byStation: Record<string, { wo: WoCard; ws: WoStationCard | null }> = {};
    for (const st of stations) {
      const wo = lineWo[st.line_id];
      if (wo) {
        const ws = wsList.find(w => w.work_order_id === wo.id && w.station_id === st.id) ?? null;
        byStation[st.id] = { wo, ws };
      }
    }
    setWoMap(byStation);
  }

  // Initial load + loadOeeData on interval
  useEffect(() => {
    loadOeeData();

    const timer = refreshInterval > 0 ? setInterval(loadOeeData, refreshInterval * 1000) : undefined;
    return () => { if (timer) clearInterval(timer); };
  }, [refreshInterval]);

  // Reload WO data on date change
  useEffect(() => {
    loadWoData(selectedDate);
  }, [selectedDate]);

  // Initial load of static data (sections, lines, stations)
  useEffect(() => {
    (async () => {
      const [ps, l, s] = await Promise.all([
        db.from("production_sections").select("*").order("sort_order"),
        db.from("lines").select("*").order("sort_order"),
        db.from("stations").select("*").order("sort_order"),
      ]);
      setSections((ps.data ?? []) as ProductionSection[]);
      setLines((l.data ?? []) as Line[]);
      setStations((s.data ?? []) as Station[]);
      const openL: Record<string, boolean> = {};
      const openC: Record<string, boolean> = {};
      (l.data ?? []).forEach((x: any) => (openL[x.id] = true));
      (ps.data ?? []).forEach((x: any) => (openC[x.id] = true));
      setOpenLines(openL); setOpenCats(openC);

      const stationList = (s.data ?? []) as Station[];
      // Build woMap after stations load
      const { data: wos } = await db.from("work_orders").select("*, products(code, name)").in("status", ["open", "in_progress"]);
      const activeWos = (wos ?? []) as WoCard[];
      const woIds = activeWos.map(wo => wo.id);
      let wsList: WoStationCard[] = [];
      if (woIds.length > 0) {
        const { data: wss } = await db.from("wo_stations").select("work_order_id, station_id, job_card_number, actual_qty, ng_qty");
        wsList = (wss ?? []) as WoStationCard[];
      }
      const dateWos = activeWos.filter(wo => wo.planned_start && wo.planned_start.startsWith(selectedDate));
      const effectiveWos = dateWos;
      const lineWo: Record<string, WoCard> = {};
      for (const wo of effectiveWos) {
        if (!lineWo[wo.line_id] || wo.planned_start > lineWo[wo.line_id].planned_start) {
          lineWo[wo.line_id] = wo;
        }
      }
      const byStation: Record<string, { wo: WoCard; ws: WoStationCard | null }> = {};
      for (const st of stationList) {
        const wo = lineWo[st.line_id];
        if (wo) {
          const ws = wsList.find(w => w.work_order_id === wo.id && w.station_id === st.id) ?? null;
          byStation[st.id] = { wo, ws };
        }
      }
      setWoMap(byStation);
    })();
  }, []);

  // Realtime subscription
  useEffect(() => {
    const ch = db.channel("dashboard-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "oee_snapshots" }, (payload: any) => {
        if (isTodayRef.current) {
          const row = payload.new as Snap;
          setLatest((prev) => ({ ...prev, [row.station_id]: row }));
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, async () => {
        if (isTodayRef.current) {
          const { count } = await db.from("alerts").select("id", { count: "exact", head: true }).is("acknowledged_at", null);
          setActiveAlerts(count ?? 0);
        }
      })
      .subscribe();
    return () => { db.removeChannel(ch); };
  }, []);

  const kpi = useMemo(() => {
    const arr = Object.values(latest);
    if (!arr.length) return { a: 0, p: 0, q: 0, oee: 0 };
    const avg = (k: keyof Snap) => arr.reduce((s, x) => s + Number(x[k] ?? 0), 0) / arr.length;
    return { a: avg("availability"), p: avg("performance"), q: avg("quality"), oee: avg("oee") };
  }, [latest]);

  const lineAgg = (lineId: string) => {
    const matched = stations.filter((s) => s.line_id === lineId);
    const snaps = matched.map((s) => latest[s.id]).filter((v): v is Snap => v != null);
    if (!snaps.length) return null;
    const avg = (k: keyof Snap) => snaps.reduce((s, x) => s + Number(x[k] ?? 0), 0) / snaps.length;
    return { oee: avg("oee"), a: avg("availability"), p: avg("performance"), q: avg("quality") };
  };

  const filteredStation = (s: Station) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase());

  return (
    <AppShell title="OEE Monitoring Dashboard">
      <div className="space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard label="Plant OEE" value={kpi.oee} primary />
          <KpiCard label="Operating Time Ratio" value={kpi.a} />
          <KpiCard label="Performance Ratio" value={kpi.p} />
          <KpiCard label="Quality Ratio" value={kpi.q} />
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

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1 min-w-[160px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search stations…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
          <input type="date" value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs tabular-nums" />
          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
            {COL_OPTIONS.map(n => (
              <button key={n} onClick={() => setColumns(n)}
                className={cn("h-7 w-7 rounded flex items-center justify-center text-xs font-medium transition-colors",
                  columns === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}>
                {n}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
            {REFRESH_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => setRefreshInterval(opt.value)}
                className={cn("h-7 px-1.5 rounded flex items-center justify-center text-[11px] font-medium transition-colors",
                  refreshInterval === opt.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Sections/Lines/Stations tree */}
        <div className="space-y-4">
          {sections.map((sec) => {
            const secLines = lines.filter((l) => l.production_section_id === sec.id);
            const opened = openCats[sec.id];
            return (
              <Card key={sec.id}>
                <button onClick={() => setOpenCats((p) => ({ ...p, [sec.id]: !opened }))}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/40 transition-colors">
                  <div className="flex items-center gap-2">
                    {opened ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="text-base font-semibold">{sec.name}</span>
                    <span className="text-xs text-muted-foreground">({secLines.length} lines)</span>
                  </div>
                </button>
                {opened && (
                  <div className="border-t border-border p-3 space-y-3">
                    {secLines.map((line) => {
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
                              <span className="text-xs text-muted-foreground hidden sm:inline">Line</span>
                              {agg != null ? (
                                <div className="flex items-center gap-1 flex-wrap">
                                  <OeeBadge value={agg.oee} target={Number(line.target_oee)} />
                                  <span className="text-[11px] text-muted-foreground font-mono">OTR</span>
                                  <OeeBadge value={agg.a} target={0.90} />
                                  <span className="text-[11px] text-muted-foreground font-mono">PER</span>
                                  <OeeBadge value={agg.p} target={0.95} />
                                  <span className="text-[11px] text-muted-foreground font-mono">QR</span>
                                  <OeeBadge value={agg.q} target={0.999} />
                                </div>
                              ) : <span className="text-xs text-muted-foreground">no data</span>}
                            </div>
                          </div>
                          {opLine && (
                            <div className={cn("grid gap-2 p-3 pt-0", colGrid[columns])}>
                              {lineStations.map((s) => (
                                <StationCard key={s.id} station={s} snap={latest[s.id]} woData={woMap[s.id] ?? null} downtimeTotal={downtimeMap[s.id] ?? 0} />
                              ))}
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

function StationCard({ station, snap, woData, downtimeTotal }: { station: Station; snap?: Snap; woData: { wo: WoCard; ws: WoStationCard | null } | null; downtimeTotal: number }) {
  const status = snap ? oeeStatus(Number(snap.oee), Number(station.target_oee)) : "warning";
  const planQty = woData?.wo?.planned_qty ?? 0;
  const actualQty = woData?.ws?.actual_qty ?? woData?.wo?.actual_qty ?? 0;
  const ngQty = woData?.ws?.ng_qty ?? woData?.wo?.ng_qty ?? 0;
  const achPct = planQty > 0 ? Math.min(actualQty / planQty, 1) : 0;
  const achColor = achPct >= 1 ? "text-success" : achPct >= 0.8 ? "text-warning" : "text-danger";
  const achBarColor = achPct >= 1 ? "bg-success" : achPct >= 0.8 ? "bg-warning" : "bg-danger";

  function barColor(metric: string, value: number): string {
    const t: Record<string, { g: number; y: number }> = {
      availability: { g: 0.90, y: 0.70 },
      performance: { g: 0.95, y: 0.80 },
      quality: { g: 0.999, y: 0.95 },
    };
    const th = t[metric] ?? { g: 0.85, y: 0.60 };
    return value >= th.g ? "var(--success)" : value >= th.y ? "var(--warning)" : "var(--danger)";
  }

  return (
    <Link to="/station/$stationId" params={{ stationId: station.id }}
      className={cn("rounded-xl border p-3.5 transition-all hover:scale-[1.01] hover:shadow-md block", statusBg(status))}>
      {/* Header */}
      <div className="mb-2.5">
        <div className="text-sm font-medium text-foreground mb-0.5">{station.name}</div>
        {woData ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{woData.wo.products?.code ?? "—"}</span>
            <span className="opacity-50">·</span>
            <span>{woData.ws?.job_card_number ?? "—"}</span>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">No active WO</div>
        )}
      </div>

      {/* Main row: Act/Plan | OEE ring | APQ */}
      {snap ? (
        <div className="flex items-center gap-0 mb-3.5">
          {/* Act / Plan */}
          <div className="flex flex-col items-center gap-0.5 shrink-0 pr-4">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-medium text-foreground leading-none tracking-tight">{actualQty}</span>
              <span className="text-sm text-muted-foreground whitespace-nowrap">/{planQty} pcs</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>Act</span>
              <span className="opacity-30">|</span>
              <span>Plan</span>
            </div>
          </div>

          <div className="w-px self-stretch bg-border/20" />

          {/* OEE ring */}
          <div className="flex flex-col items-center gap-0.5 shrink-0 px-4">
            <span className="text-[10px] text-muted-foreground font-medium">OEE</span>
            <OeeRing64 value={Number(snap.oee)} status={status} />
          </div>

          <div className="w-px self-stretch bg-border/20" />

          {/* APQ bars */}
          <div className="flex-1 flex flex-col gap-1.5 min-w-0 pl-4">
            {(["availability","performance","quality"] as const).map((k, i) => {
              const label = ["OTR","PER","QR"][i];
              const v = Number(snap[k]);
              return (
                <div key={k} className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground w-5 shrink-0">{label}</span>
                  <div className="flex-1 h-[6px] bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(v, 1) * 100}%`, backgroundColor: barColor(k, v) }} />
                  </div>
                  <span className="text-xs text-muted-foreground w-9 text-right tabular-nums shrink-0">{pct(v, 0)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground py-4 text-center mb-2">No OEE data</div>
      )}

      {/* Achievement bar */}
      {woData && planQty > 0 ? (
        <div className="mb-2">
          <div className="relative h-2.5 bg-muted rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full transition-all", achBarColor)} style={{ width: `${achPct * 100}%` }} />
          </div>
          <div className="flex justify-end mt-0.5">
            <span className={cn("text-xs font-medium", achColor)}>{(achPct * 100).toFixed(0)}% of plan</span>
          </div>
        </div>
      ) : null}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-border/60 text-xs font-medium text-foreground">
        <span>Qty NG: <span className="text-danger">{ngQty}</span></span>
        <span>Total downtime: <span className="tabular-nums">{downtimeTotal}</span> min</span>
      </div>
    </Link>
  );
}

function OeeRing64({ value, status }: { value: number; status: OeeStatus }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(Math.max(value, 0), 1);
  const strokeColor = status === "good" ? "var(--success)" : status === "warning" ? "var(--warning)" : "var(--danger)";
  return (
    <div className="relative shrink-0" style={{ width: 64, height: 64 }}>
      <svg width={64} height={64} viewBox="0 0 64 64">
        <circle cx={32} cy={32} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={7} />
        <circle cx={32} cy={32} r={r} fill="none" stroke={strokeColor} strokeWidth={7} strokeLinecap="round"
          strokeDasharray={c.toFixed(1)} strokeDashoffset={(c * (1 - clamped)).toFixed(1)} transform="rotate(-90 32 32)" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="text-sm font-semibold tabular-nums leading-none">{pct(value, 0)}</span>
      </div>
    </div>
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
