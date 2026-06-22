import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Download } from "lucide-react";
import { db } from "@/integrations/local-db/client";
import { AppShell } from "@/components/AppShell";
import { OeeGauge } from "@/components/OeeGauge";
import { OeeBadge } from "@/components/OeeBadge";
import { TrendChart } from "@/components/TrendChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { bucketize, type Bucket } from "@/lib/shift";
import { downloadCsv } from "@/lib/csv";
import { format } from "date-fns";

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
  const [bucket, setBucket] = useState<Bucket>("hourly");

  useEffect(() => {
    (async () => {
      const { data: l } = await db.from("lines").select("*, categories(name)").eq("id", lineId).single();
      setLine(l);
      const { data: st } = await db.from("stations").select("*").eq("line_id", lineId).order("sort_order");
      setStations(st ?? []);
      const ids = (st ?? []).map((s: any) => s.id);
      if (ids.length) {
        const { data: snaps } = await db.from("oee_snapshots")
          .select("*").in("station_id", ids).order("ts", { ascending: false }).limit(2000);
        const map: Record<string, any> = {};
        (snaps ?? []).forEach((sn: any) => { if (!map[sn.station_id]) map[sn.station_id] = sn; });
        setLatest(map);
        setRawSnaps((snaps ?? []).slice().reverse());
      }
    })();

    const ch = db.channel(`line-${lineId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "oee_snapshots" }, (payload: any) => {
        const row = payload.new as any;
        setLatest((prev) => (stations.find((s) => s.id === row.station_id) ? { ...prev, [row.station_id]: row } : prev));
        setRawSnaps((prev) => stations.find((s) => s.id === row.station_id) ? [...prev, row].slice(-2000) : prev);
      })
      .subscribe();
    return () => { db.removeChannel(ch); };
  }, [lineId, stations.length]);

  const trend = bucketize(rawSnaps.map((s) => ({ ts: s.ts, oee: Number(s.oee) })), bucket);

  const stationOees = stations.map((s) => Number(latest[s.id]?.oee ?? 0)).filter((v) => v > 0);
  const avg = stationOees.length ? stationOees.reduce((a, b) => a + b, 0) / stationOees.length : 0;
  const avgA = stations.map((s) => Number(latest[s.id]?.availability ?? 0)).filter(v=>v>0).reduce((a,b,_,arr)=>a+b/arr.length,0);
  const avgP = stations.map((s) => Number(latest[s.id]?.performance ?? 0)).filter(v=>v>0).reduce((a,b,_,arr)=>a+b/arr.length,0);
  const avgQ = stations.map((s) => Number(latest[s.id]?.quality ?? 0)).filter(v=>v>0).reduce((a,b,_,arr)=>a+b/arr.length,0);

  return (
    <AppShell title={line?.name ?? "Line"}>
      <div className="space-y-6">
        <Button variant="ghost" size="sm" asChild><Link to="/dashboard"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Link></Button>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="p-4 flex justify-center"><OeeGauge label="OEE" value={avg} target={Number(line?.target_oee ?? 0.85)} /></CardContent></Card>
          <Card><CardContent className="p-4 flex justify-center"><OeeGauge label="Availability" value={avgA} /></CardContent></Card>
          <Card><CardContent className="p-4 flex justify-center"><OeeGauge label="Performance" value={avgP} /></CardContent></Card>
          <Card><CardContent className="p-4 flex justify-center"><OeeGauge label="Quality" value={avgQ} /></CardContent></Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">OEE Trend</CardTitle>
            <div className="flex items-center gap-2">
              <Tabs value={bucket} onValueChange={(v) => setBucket(v as Bucket)}>
                <TabsList>
                  <TabsTrigger value="hourly">Hourly</TabsTrigger>
                  <TabsTrigger value="shift">Shift</TabsTrigger>
                  <TabsTrigger value="daily">Daily</TabsTrigger>
                </TabsList>
              </Tabs>
              <Button variant="outline" size="sm" onClick={() => downloadCsv(
                `line-${line?.name ?? lineId}-${bucket}-${format(new Date(), "yyyyMMdd-HHmm")}.csv`,
                trend.map((t) => ({ bucket: t.ts, oee: (t.oee * 100).toFixed(2) + "%" })))}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>{trend.length ? <TrendChart data={trend} /> : <div className="text-sm text-muted-foreground py-12 text-center">No data yet</div>}</CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Stations</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {stations.map((s) => {
              const snap = latest[s.id];
              return (
                <Link key={s.id} to="/station/$stationId" params={{ stationId: s.id }}
                  className="rounded-md border border-border bg-card p-3 hover:bg-accent/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{s.name}</div>
                    {snap ? <OeeBadge value={Number(snap.oee)} target={Number(s.target_oee)} /> : <span className="text-xs text-muted-foreground">—</span>}
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
