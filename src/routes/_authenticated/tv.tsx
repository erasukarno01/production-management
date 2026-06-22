import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Maximize2 } from "lucide-react";
import { db } from "@/integrations/local-db/client";
import { oeeStatus, pct, statusBg } from "@/lib/oee";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/tv")({
  ssr: false,
  head: () => ({ meta: [{ title: "OEE TV Display" }] }),
  component: TvDisplay,
});

type Snap = { station_id: string; ts: string; availability: number; performance: number; quality: number; oee: number };

function TvDisplay() {
  const [lines, setLines] = useState<any[]>([]);
  const [stations, setStations] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [latest, setLatest] = useState<Record<string, Snap>>({});
  const [alerts, setAlerts] = useState(0);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => {
      const [c, l, s] = await Promise.all([
        db.from("categories").select("*").order("sort_order"),
        db.from("lines").select("*").order("sort_order"),
        db.from("stations").select("*").order("sort_order"),
      ]);
      setCategories(c.data ?? []); setLines(l.data ?? []); setStations(s.data ?? []);
      const { data: snaps } = await db.from("oee_snapshots")
        .select("station_id, ts, availability, performance, quality, oee")
        .order("ts", { ascending: false }).limit(2000);
      const map: Record<string, Snap> = {};
      (snaps ?? []).forEach((sn: any) => { if (!map[sn.station_id]) map[sn.station_id] = sn; });
      setLatest(map);
      const { count } = await db.from("alerts").select("id", { count: "exact", head: true }).is("acknowledged_at", null);
      setAlerts(count ?? 0);
    })();
    const ch = db.channel("tv-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "oee_snapshots" }, (p: any) => {
        const row = p.new as Snap;
        setLatest((prev) => ({ ...prev, [row.station_id]: row }));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, async () => {
        const { count } = await db.from("alerts").select("id", { count: "exact", head: true }).is("acknowledged_at", null);
        setAlerts(count ?? 0);
      })
      .subscribe();
    return () => { db.removeChannel(ch); };
  }, []);

  const plant = useMemo(() => {
    const arr = Object.values(latest);
    if (!arr.length) return { a: 0, p: 0, q: 0, oee: 0 };
    const avg = (k: keyof Snap) => arr.reduce((s, x) => s + Number(x[k] ?? 0), 0) / arr.length;
    return { a: avg("availability"), p: avg("performance"), q: avg("quality"), oee: avg("oee") };
  }, [latest]);

  const lineAgg = (lineId: string) => {
    const ss = stations.filter((s) => s.line_id === lineId).map((s) => latest[s.id]?.oee).filter((v): v is number => v != null);
    if (!ss.length) return 0;
    return ss.reduce((a, b) => a + Number(b), 0) / ss.length;
  };

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  };

  return (
    <div className="min-h-screen w-full bg-background text-foreground p-4 md:p-8">
      <header className="flex items-center justify-between mb-6">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Live Plant OEE</div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight">PRODUCTION FLOOR</h1>
        </div>
        <div className="text-right">
          <div className="text-3xl md:text-4xl font-bold tabular-nums">{now.toLocaleTimeString()}</div>
          <div className="text-sm text-muted-foreground">{now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</div>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <BigKpi label="OEE" value={plant.oee} primary />
        <BigKpi label="Availability" value={plant.a} />
        <BigKpi label="Performance" value={plant.p} />
        <BigKpi label="Quality" value={plant.q} />
        <div className={cn("rounded-xl border p-4 flex flex-col justify-center",
          alerts > 0 ? "bg-danger/15 border-danger/40" : "bg-success/15 border-success/40")}>
          <div className="text-xs uppercase tracking-wider opacity-70">Active Alerts</div>
          <div className={cn("text-5xl font-black tabular-nums", alerts > 0 ? "text-danger" : "text-success")}>{alerts}</div>
        </div>
      </div>

      <div className="space-y-6">
        {categories.map((cat) => {
          const catLines = lines.filter((l) => l.category_id === cat.id);
          return (
            <section key={cat.id}>
              <h2 className="text-sm uppercase tracking-[0.25em] text-muted-foreground mb-2">{cat.name}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {catLines.map((line) => {
                  const agg = lineAgg(line.id);
                  const st = oeeStatus(agg, Number(line.target_oee));
                  const lineStations = stations.filter((s) => s.line_id === line.id);
                  return (
                    <div key={line.id} className={cn("rounded-xl border p-4", statusBg(st))}>
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-foreground">{line.name}</div>
                        <div className="text-xs opacity-70">target {pct(Number(line.target_oee), 0)}</div>
                      </div>
                      <div className="text-5xl font-black tabular-nums my-2">{pct(agg)}</div>
                      <div className="grid grid-cols-2 gap-1 text-[11px] uppercase tracking-wider opacity-80">
                        {lineStations.slice(0, 6).map((s) => {
                          const snap = latest[s.id];
                          return (
                            <div key={s.id} className="flex justify-between gap-2 truncate">
                              <span className="truncate">{s.name}</span>
                              <span className="tabular-nums font-semibold">{snap ? pct(Number(snap.oee), 0) : "—"}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="fixed bottom-4 right-4 flex gap-2">
        <Link to="/dashboard" className="rounded-md bg-card border border-border px-3 py-2 text-xs hover:bg-accent">← Dashboard</Link>
        <button onClick={fullscreen} className="rounded-md bg-primary text-primary-foreground px-3 py-2 text-xs flex items-center gap-1">
          <Maximize2 className="h-3.5 w-3.5" /> Fullscreen
        </button>
      </div>
    </div>
  );
}

function BigKpi({ label, value, primary }: { label: string; value: number; primary?: boolean }) {
  const st = oeeStatus(value);
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("text-5xl md:text-6xl font-black tabular-nums",
        primary ? (st === "good" ? "text-success" : st === "warning" ? "text-warning" : "text-danger") : "text-foreground")}>
        {pct(value)}
      </div>
    </div>
  );
}
