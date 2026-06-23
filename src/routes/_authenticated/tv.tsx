import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Maximize2 } from "lucide-react";
import { db } from "@/integrations/local-db/client";
import { oeeStatus, type OeeStatus, pct, statusBg } from "@/lib/oee";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/tv")({
  ssr: false,
  head: () => ({ meta: [{ title: "OEE TV Display" }] }),
  component: TvDisplay,
});

type Snap = { station_id: string; ts: string; availability: number; performance: number; quality: number; oee: number };
type WoCard = { id: string; wo_number: string; product_id: string; line_id: string; planned_qty: number; actual_qty: number; ng_qty: number; status: string; products: { code: string; name: string } };
type WoStationCard = { work_order_id: string; station_id: string; job_card_number: string; actual_qty: number; ng_qty: number };

const ITEMS_PER_PAGE = 6;

function TvDisplay() {
  const [lines, setLines] = useState<any[]>([]);
  const [stations, setStations] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);
  const [latest, setLatest] = useState<Record<string, Snap>>({});
  const [alerts, setAlerts] = useState(0);
  const [now, setNow] = useState(new Date());
  const [woMap, setWoMap] = useState<Record<string, { wo: WoCard; ws: WoStationCard | null } | null>>({});
  const [downtimeMap, setDowntimeMap] = useState<Record<string, number>>({});
  const [currentPage, setCurrentPage] = useState(0);
  const [liveDot, setLiveDot] = useState(true);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setLiveDot(v => !v), 2000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => {
      const [ps, l, s] = await Promise.all([
        db.from("production_sections").select("*").order("sort_order"),
        db.from("lines").select("*").order("sort_order"),
        db.from("stations").select("*").order("sort_order"),
      ]);
      setSections(ps.data ?? []);
      setLines(l.data ?? []);
      const stData = s.data ?? [];
      setStations(stData);

      const { data: snaps } = await db.from("oee_snapshots")
        .select("station_id, ts, availability, performance, quality, oee")
        .order("ts", { ascending: false }).limit(2000);
      const snapMap: Record<string, Snap> = {};
      (snaps ?? []).forEach((sn: any) => { if (!snapMap[sn.station_id]) snapMap[sn.station_id] = sn; });
      setLatest(snapMap);

      const { count } = await db.from("alerts").select("id", { count: "exact", head: true }).is("acknowledged_at", null);
      setAlerts(count ?? 0);

      const { data: wos } = await db.from("work_orders").select("*, products(code, name)").in("status", ["open", "in_progress"]);
      const woList = (wos ?? []) as WoCard[];
      let wsList: WoStationCard[] = [];
      if (woList.length > 0) {
        const { data: wss } = await db.from("wo_stations").select("work_order_id, station_id, job_card_number, actual_qty, ng_qty");
        wsList = (wss ?? []) as WoStationCard[];
      }
      const byStation: Record<string, { wo: WoCard; ws: WoStationCard | null } | null> = {};
      stData.forEach((st: any) => {
        const wo = woList.find((w: WoCard) => w.line_id === st.line_id);
        if (wo) {
          const ws = wsList.find((wss2: WoStationCard) => wss2.work_order_id === wo.id && wss2.station_id === st.id) ?? null;
          byStation[st.id] = { wo, ws };
        } else {
          byStation[st.id] = null;
        }
      });
      setWoMap(byStation);

      const { data: dtEvents } = await db.from("downtime_events").select("station_id, duration_sec");
      const dtByStation: Record<string, number> = {};
      (dtEvents ?? []).forEach((e: any) => {
        dtByStation[e.station_id] = (dtByStation[e.station_id] ?? 0) + Math.round(Number(e.duration_sec ?? 0) / 60);
      });
      setDowntimeMap(dtByStation);
    })();

    const ch = db.channel("tv-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "oee_snapshots" }, (p: any) => {
        const row = p.new as Snap;
        setLatest(prev => ({ ...prev, [row.station_id]: row }));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, async () => {
        const { count } = await db.from("alerts").select("id", { count: "exact", head: true }).is("acknowledged_at", null);
        setAlerts(count ?? 0);
      })
      .subscribe();
    return () => { db.removeChannel(ch); };
  }, []);

  const sortedStations = useMemo(() => {
    const secMap = new Map(sections.map(s => [s.id, s]));
    const lineMap = new Map(lines.map(l => [l.id, l]));
    return [...stations].sort((a, b) => {
      const la = lineMap.get(a.line_id);
      const lb = lineMap.get(b.line_id);
      const sa = la ? secMap.get(la.production_section_id) : null;
      const sb = lb ? secMap.get(lb.production_section_id) : null;
      const secDiff = (sa?.sort_order ?? 0) - (sb?.sort_order ?? 0);
      if (secDiff !== 0) return secDiff;
      const lineDiff = (la?.sort_order ?? 0) - (lb?.sort_order ?? 0);
      if (lineDiff !== 0) return lineDiff;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
  }, [stations, sections, lines]);

  const totalPages = useMemo(() => Math.ceil(sortedStations.length / ITEMS_PER_PAGE), [sortedStations.length]);

  useEffect(() => {
    if (totalPages <= 1) return;
    const t = setInterval(() => setCurrentPage(prev => (prev + 1) % totalPages), 12000);
    return () => clearInterval(t);
  }, [totalPages]);

  const pagedStations = useMemo(() => {
    const start = currentPage * ITEMS_PER_PAGE;
    return sortedStations.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedStations, currentPage]);

  const plant = useMemo(() => {
    const arr = Object.values(latest);
    if (!arr.length) return { a: 0, p: 0, q: 0, oee: 0 };
    const avg = (k: keyof Snap) => arr.reduce((s, x) => s + Number(x[k] ?? 0), 0) / arr.length;
    return { a: avg("availability"), p: avg("performance"), q: avg("quality"), oee: avg("oee") };
  }, [latest]);

  const attentionList = useMemo(() => {
    const list: { stationName: string; lineName: string; oee: number; target: number }[] = [];
    stations.forEach(s => {
      const snap = latest[s.id];
      const target = Number(s.target_oee) || 85;
      if (snap && snap.oee < target) {
        const line = lines.find(l => l.id === s.line_id);
        list.push({ stationName: s.name, lineName: line?.name ?? "", oee: snap.oee, target });
      }
    });
    return list.sort((a, b) => a.oee - b.oee).slice(0, 5);
  }, [latest, stations, lines]);

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  };

  return (
    <div className="min-h-screen w-full bg-background text-foreground p-4 md:p-6 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className={cn(
              "h-3 w-3 rounded-full transition-opacity duration-500",
              liveDot ? "opacity-100" : "opacity-30",
              alerts > 0 ? "bg-danger" : "bg-success"
            )} />
            <span className={cn(
              "text-xs uppercase tracking-[0.15em] font-semibold",
              alerts > 0 ? "text-danger" : "text-success"
            )}>LIVE</span>
          </div>
          <div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight leading-none">PRODUCTION FLOOR</h1>
            <div className="text-xs text-muted-foreground mt-0.5">Plant OEE {pct(plant.oee)}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl md:text-4xl font-bold tabular-nums leading-none">{now.toLocaleTimeString()}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
          </div>
        </div>
      </header>

      {/* KPI Row */}
      <div className="grid grid-cols-5 gap-3 mb-5">
        <BigKpi label="OEE" value={plant.oee} primary />
        <BigKpi label="Operating Time Ratio" value={plant.a} />
          <BigKpi label="Performance Ratio" value={plant.p} />
          <BigKpi label="Quality Ratio" value={plant.q} />
        <AlertKpi count={alerts} />
      </div>

      {/* Main Content — Station Cards */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 auto-rows-max">
        {pagedStations.length === 0 && (
          <div className="col-span-full flex items-center justify-center py-16 text-muted-foreground">
            <div className="text-center">
              <div className="text-2xl font-bold mb-1">No stations configured</div>
              <div className="text-xs">Configure stations to display on this TV.</div>
            </div>
          </div>
        )}
        {pagedStations.map(station => {
          const snap = latest[station.id];
          const woData = woMap[station.id];
          const line = lines.find(l => l.id === station.line_id);
          const sectionName = line ? sections.find(s => s.id === line.production_section_id)?.name ?? "" : "";
          const status = snap ? oeeStatus(Number(snap.oee), Number(station.target_oee)) : "warning";
          const planQty = woData?.wo?.planned_qty ?? 0;
          const actualQty = woData?.ws?.actual_qty ?? woData?.wo?.actual_qty ?? 0;
          const ngQty = woData?.ws?.ng_qty ?? woData?.wo?.ng_qty ?? 0;
          const achPct = planQty > 0 ? Math.min(actualQty / planQty, 1) : 0;
          const achColor = achPct >= 1 ? "text-success" : achPct >= 0.8 ? "text-warning" : "text-danger";
          const achBarColor = achPct >= 1 ? "bg-success" : achPct >= 0.8 ? "bg-warning" : "bg-danger";
          const downtimeMin = downtimeMap[station.id] ?? 0;

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
            <div key={station.id} className={cn("rounded-xl border p-4 md:p-5 flex flex-col", statusBg(status))}>
              {/* Header */}
              <div className="mb-2.5">
                <div className="text-base font-bold text-foreground mb-0.5">{station.name}</div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{line?.name ?? "—"}</span>
                  {sectionName && <><span className="opacity-50">·</span><span>{sectionName}</span></>}
                </div>
                {woData && (
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                    <span>{woData.wo.products?.code ?? "—"}</span>
                    <span className="opacity-50">·</span>
                    <span>{woData.ws?.job_card_number ?? woData.wo.wo_number}</span>
                  </div>
                )}
              </div>

              {/* Main row: Act/Plan | OEE ring | APQ bars */}
              {snap ? (
                <div className="flex items-center gap-0 mb-3">
                  {/* Act / Plan */}
                  <div className="flex flex-col items-center gap-0.5 shrink-0 pr-4">
                    <div className="flex items-baseline gap-1">
                      <span className="text-5xl md:text-6xl font-black text-foreground leading-none tracking-tight">{actualQty}</span>
                      <span className="text-base md:text-lg text-muted-foreground whitespace-nowrap">/{planQty} pcs</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span>Act</span>
                      <span className="opacity-30">|</span>
                      <span>Plan</span>
                    </div>
                  </div>

                  <div className="w-px self-stretch bg-border/20" />

                  {/* OEE ring */}
                  <div className="flex flex-col items-center gap-0.5 shrink-0 px-4">
                    <span className="text-xs text-muted-foreground font-medium">OEE</span>
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
                          <div className="flex-1 h-[8px] bg-muted rounded-full overflow-hidden">
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
              {woData && planQty > 0 && (
                <div className="mb-2">
                  <div className="relative h-3 bg-muted rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", achBarColor)} style={{ width: `${achPct * 100}%` }} />
                  </div>
                  <div className="flex justify-end mt-0.5">
                    <span className={cn("text-xs font-medium", achColor)}>{(achPct * 100).toFixed(0)}% of plan</span>
                  </div>
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between pt-2 border-t border-border/60 text-xs font-medium text-foreground">
                <span>Qty NG: <span className="text-danger">{ngQty}</span></span>
                <span>Total downtime: <span className="tabular-nums">{downtimeMin}</span> min</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Page Indicators */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              onClick={() => setCurrentPage(i)}
              className={cn(
                "h-2 rounded-full transition-all cursor-pointer",
                i === currentPage ? "w-6 bg-primary" : "w-2 bg-muted hover:bg-muted-foreground/30"
              )}
            />
          ))}
        </div>
      )}

      {/* Bottom Attention Bar */}
      {attentionList.length > 0 && (
        <div className="mt-4 rounded-xl border border-danger/30 bg-danger/10 p-3 flex items-center gap-2 flex-wrap animate-in fade-in">
          <AlertTriangle className="h-4 w-4 text-danger shrink-0" />
          {attentionList.slice(0, 4).map((item, i) => (
            <span key={i} className="text-xs text-danger">
              <strong>{item.stationName}</strong> {pct(item.oee, 0)}
              <span className="opacity-60"> (target {pct(item.target, 0)})</span>
              {i < Math.min(attentionList.length, 4) - 1 && <span className="mx-1.5 opacity-30">|</span>}
            </span>
          ))}
          {attentionList.length > 4 && (
            <span className="text-xs text-muted-foreground">+{attentionList.length - 4} more</span>
          )}
        </div>
      )}

      {/* Footer Buttons */}
      <div className="fixed bottom-4 right-4 flex gap-2 z-50">
        <Link to="/dashboard" className="rounded-md bg-card border border-border px-3 py-1.5 text-xs hover:bg-accent transition-colors">
          ← Dashboard
        </Link>
        <button
          onClick={fullscreen}
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs flex items-center gap-1 hover:opacity-90 transition-opacity"
        >
          <Maximize2 className="h-3 w-3" /> Fullscreen
        </button>
      </div>
    </div>
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

function BigKpi({ label, value, primary }: { label: string; value: number; primary?: boolean }) {
  const st = oeeStatus(value);
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col justify-center">
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className={cn(
        "text-5xl md:text-6xl font-black tabular-nums leading-none",
        primary ? (
          st === "good" ? "text-success" : st === "warning" ? "text-warning" : "text-danger"
        ) : "text-foreground"
      )}>{pct(value)}</div>
    </div>
  );
}

function AlertKpi({ count }: { count: number }) {
  return (
    <div className={cn(
      "rounded-xl border p-4 flex flex-col justify-center",
      count > 0 ? "bg-danger/15 border-danger/40" : "bg-success/15 border-success/40"
    )}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Active Alerts</div>
      <div className={cn(
        "text-5xl md:text-6xl font-black tabular-nums leading-none",
        count > 0 ? "text-danger" : "text-success"
      )}>
        {count}
      </div>
    </div>
  );
}
