import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, Check, Download } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { db } from "@/integrations/local-db/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { downloadCsv } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/alerts")({
  ssr: false,
  component: AlertsPage,
});

function AlertsPage() {
  const { isSupervisor, user } = useAuth();
  const [alerts, setAlerts] = useState<any[]>([]);
  const [filter, setFilter] = useState<"open" | "all">("open");

  const load = async () => {
    let q = db.from("alerts").select("*, stations(name, lines(name))").order("created_at", { ascending: false }).limit(200);
    if (filter === "open") q = q.is("acknowledged_at", null);
    const { data } = await q;
    setAlerts(data ?? []);
  };

  useEffect(() => {
    load();
    const ch = db.channel("alerts-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, load).subscribe();
    return () => { db.removeChannel(ch); };
  }, [filter]);

  const ack = async (id: string) => {
    const { error } = await db.from("alerts").update({ acknowledged_at: new Date().toISOString(), acknowledged_by: user?.id }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Alert acknowledged");
  };

  return (
    <AppShell title="Alerts">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Alerts</CardTitle>
          <div className="flex items-center gap-2">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
              <TabsList><TabsTrigger value="open">Open</TabsTrigger><TabsTrigger value="all">All</TabsTrigger></TabsList>
            </Tabs>
            <Button variant="outline" size="sm" onClick={() => downloadCsv(
              `alerts-${format(new Date(), "yyyyMMdd-HHmm")}.csv`,
              alerts.map((a) => ({
                created_at: a.created_at, level: a.level, message: a.message,
                line: a.stations?.lines?.name, station: a.stations?.name,
                acknowledged_at: a.acknowledged_at,
              })))}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">No alerts.</div> : (
            <div className="divide-y divide-border">
              {alerts.map((a) => (
                <div key={a.id} className="py-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={a.level === "critical" ? "destructive" : "secondary"} className="capitalize">{a.level}</Badge>
                      <Link to="/station/$stationId" params={{ stationId: a.station_id }} className="font-medium hover:underline truncate">
                        {a.stations?.lines?.name} · {a.stations?.name}
                      </Link>
                    </div>
                    <div className="text-sm text-muted-foreground mt-0.5">{a.message}</div>
                    <div className="text-xs text-muted-foreground">{format(new Date(a.created_at), "MMM d, HH:mm:ss")}</div>
                  </div>
                  {a.acknowledged_at ? (
                    <Badge variant="outline" className="gap-1"><Check className="h-3 w-3" /> Ack'd</Badge>
                  ) : isSupervisor ? (
                    <Button size="sm" variant="outline" onClick={() => ack(a.id)}>Acknowledge</Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
