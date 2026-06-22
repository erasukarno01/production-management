import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Download } from "lucide-react";
import { db } from "@/integrations/local-db/client";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/downtime")({
  ssr: false,
  component: DowntimePage,
});

function DowntimePage() {
  const [events, setEvents] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const load = async () => {
    const { data } = await db.from("downtime_events")
      .select("*, stations(name, lines(name, categories(name)))")
      .order("started_at", { ascending: false }).limit(500);
    setEvents(data ?? []);
  };
  useEffect(() => {
    load();
    const ch = db.channel("dt-page").on("postgres_changes", { event: "*", schema: "public", table: "downtime_events" }, load).subscribe();
    return () => { db.removeChannel(ch); };
  }, []);

  const filtered = events.filter((e) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return [e.stations?.name, e.stations?.lines?.name, e.reason, e.category, e.note].some((v) => v && String(v).toLowerCase().includes(s));
  });

  return (
    <AppShell title="Downtime Log">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">All Downtime Events</CardTitle>
          <div className="flex items-center gap-2">
            <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
            <Button variant="outline" size="sm" onClick={() => downloadCsv(
              `downtime-${format(new Date(), "yyyyMMdd-HHmm")}.csv`,
              filtered.map((e) => ({
                started_at: e.started_at, ended_at: e.ended_at, duration_sec: e.duration_sec,
                category: e.category, reason: e.reason, note: e.note,
                category_group: e.stations?.lines?.categories?.name,
                line: e.stations?.lines?.name, station: e.stations?.name,
              })))}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground border-b border-border">
                <tr><th className="text-left py-2 pr-3">When</th><th className="text-left pr-3">Line</th><th className="text-left pr-3">Station</th><th className="text-left pr-3">Category</th><th className="text-left pr-3">Reason</th><th className="text-right">Duration</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 pr-3 whitespace-nowrap">{format(new Date(e.started_at), "MMM d, HH:mm")}</td>
                    <td className="pr-3">{e.stations?.lines?.name}</td>
                    <td className="pr-3 font-medium">{e.stations?.name}</td>
                    <td className="pr-3"><Badge variant="outline" className="capitalize">{e.category}</Badge></td>
                    <td className="pr-3 text-muted-foreground">{e.reason ?? "—"}</td>
                    <td className="text-right tabular-nums">{e.duration_sec ? `${Math.round(e.duration_sec/60)}m` : "—"}</td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No events.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
