import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Download, Plus } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/local-db/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { OeeGauge } from "@/components/OeeGauge";
import { TrendChart } from "@/components/TrendChart";
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
import { DowntimeBarChart } from "@/components/DowntimeBarChart";
import { bucketize, type Bucket } from "@/lib/shift";
import { downloadCsv } from "@/lib/csv";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/station/$stationId")({
  ssr: false,
  component: StationDetail,
});

function StationDetail() {
  const { stationId } = Route.useParams();
  const { isOperator } = useAuth();
  const [station, setStation] = useState<any>(null);
  const [latest, setLatest] = useState<any>(null);
  
  const [downtimes, setDowntimes] = useState<any[]>([]);
  const [rawSnaps, setRawSnaps] = useState<any[]>([]);
  const [dtOpen, setDtOpen] = useState(false);
  const [bucket, setBucket] = useState<Bucket>("hourly");

  const load = async () => {
    const { data: st } = await db.from("stations").select("*, lines(name, target_oee, categories(name))").eq("id", stationId).single();
    setStation(st);
    const { data: snaps } = await db.from("oee_snapshots").select("*").eq("station_id", stationId).order("ts", { ascending: false }).limit(1000);
    setLatest(snaps?.[0]);
    setRawSnaps((snaps ?? []).slice().reverse());
    const { data: dt } = await db.from("downtime_events").select("*").eq("station_id", stationId).order("started_at", { ascending: false }).limit(200);
    setDowntimes(dt ?? []);
  };

  useEffect(() => {
    load();
    const ch = db.channel(`station-${stationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "oee_snapshots", filter: `station_id=eq.${stationId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "downtime_events", filter: `station_id=eq.${stationId}` }, load)
      .subscribe();
    return () => { db.removeChannel(ch); };
  }, [stationId]);

  return (
    <AppShell title={station?.name ?? "Station"}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/line/$lineId" params={{ lineId: station?.line_id ?? "" }}><ArrowLeft className="h-4 w-4 mr-1" /> {station?.lines?.name ?? "Back"}</Link>
          </Button>
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

        {latest ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><CardContent className="p-4 flex justify-center"><OeeGauge label="OEE" value={Number(latest.oee)} target={Number(station?.target_oee ?? 0.85)} /></CardContent></Card>
            <Card><CardContent className="p-4 flex justify-center"><OeeGauge label="Availability" value={Number(latest.availability)} /></CardContent></Card>
            <Card><CardContent className="p-4 flex justify-center"><OeeGauge label="Performance" value={Number(latest.performance)} /></CardContent></Card>
            <Card><CardContent className="p-4 flex justify-center"><OeeGauge label="Quality" value={Number(latest.quality)} /></CardContent></Card>
          </div>
        ) : <div className="text-muted-foreground">No snapshots yet.</div>}

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
                `station-${station?.name ?? stationId}-${format(new Date(), "yyyyMMdd-HHmm")}.csv`,
                rawSnaps.map((s) => ({
                  ts: s.ts, availability: s.availability, performance: s.performance, quality: s.quality, oee: s.oee,
                })))}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {(() => {
              const trend = bucketize(rawSnaps.map((s) => ({ ts: s.ts, oee: Number(s.oee) })), bucket);
              return trend.length ? <TrendChart data={trend} /> : <div className="py-12 text-center text-sm text-muted-foreground">Awaiting data…</div>;
            })()}
          </CardContent>
        </Card>

        {(() => {
          const since = Date.now() - 24 * 3600_000;
          const recent = rawSnaps.filter((s) => new Date(s.ts).getTime() >= since);
          // Hourly Plan vs Actual
          const hourly: Record<string, { plan: number; actual: number }> = {};
          recent.forEach((s) => {
            const key = format(new Date(s.ts), "HH:00");
            const b = hourly[key] ?? (hourly[key] = { plan: 0, actual: 0 });
            b.plan += Number(s.plan_count ?? 0);
            b.actual += Number(s.total_count ?? 0);
          });
          const prodData = Object.entries(hourly).sort(([a],[b]) => a.localeCompare(b)).map(([label, v]) => ({ label, ...v }));
          // NG totals
          const totalGood = recent.reduce((a, s) => a + Number(s.good_count ?? 0), 0);
          const totalAll = recent.reduce((a, s) => a + Number(s.total_count ?? 0), 0);
          const totalNg = recent.reduce((a, s) => a + Number(s.ng_count ?? Math.max(0, Number(s.total_count ?? 0) - Number(s.good_count ?? 0))), 0);
          const ngTarget = Number(station?.ng_target_ratio ?? 0.02);
          // Downtime by category
          const sinceIso = new Date(since).toISOString();
          const dtRecent = downtimes.filter((d) => d.started_at >= sinceIso);
          const dtAgg: Record<string, number> = { breakdown: 0, changeover: 0, material: 0, quality: 0, idle: 0, other: 0 };
          dtRecent.forEach((d) => { dtAgg[d.category] = (dtAgg[d.category] ?? 0) + Number(d.duration_sec ?? 0) / 60; });
          const speedlossMin = recent.reduce((a, s) => a + Number(s.speedloss_sec ?? 0), 0) / 60;
          const dtData = [
            ...Object.entries(dtAgg).map(([category, minutes]) => ({ category, minutes })),
            { category: "speedloss", minutes: speedlossMin },
          ];
          return (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle className="text-base">Output Production — Plan vs Actual (Pcs / Hour, last 24h)</CardTitle></CardHeader>
                <CardContent>
                  {prodData.length ? <ProductionBarChart data={prodData} /> : <div className="py-12 text-center text-sm text-muted-foreground">Awaiting data…</div>}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">NG Quantity & Ratio (24h)</CardTitle></CardHeader>
                <CardContent>
                  {totalAll > 0
                    ? <NgDonutChart good={totalGood} ng={totalNg} target={ngTarget} />
                    : <div className="py-12 text-center text-sm text-muted-foreground">No production data.</div>}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Downtime + Speedloss (minutes, 24h)</CardTitle></CardHeader>
                <CardContent>
                  <DowntimeBarChart data={dtData} />
                </CardContent>
              </Card>
            </div>
          );
        })()}

        <Card>
          <CardHeader><CardTitle className="text-base">Recent Downtime</CardTitle></CardHeader>
          <CardContent>
            {downtimes.length === 0 ? <div className="text-sm text-muted-foreground">No downtime events.</div> : (
              <div className="divide-y divide-border">
                {downtimes.map((d) => (
                  <div key={d.id} className="py-2 flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium capitalize">{d.category} — {d.reason ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{format(new Date(d.started_at), "MMM d, HH:mm")}{d.duration_sec ? ` · ${Math.round(d.duration_sec/60)}m` : ""}</div>
                    </div>
                    {d.note && <div className="text-xs text-muted-foreground max-w-xs truncate">{d.note}</div>}
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
