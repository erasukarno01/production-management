import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Radio, Plus, Trash2, RefreshCw, Monitor, Wifi, WifiOff } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { db } from "@/integrations/local-db/client";

export const Route = createFileRoute("/_authenticated/admin/edge-nodes")({
  ssr: false,
  component: EdgeNodesPage,
});

function EdgeNodesPage() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [stations, setStations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [n, s] = await Promise.all([
      db.from("edge_nodes").select("*").order("updated_at", { ascending: false }),
      db.from("stations").select("*, lines(name, categories(name))").order("sort_order"),
    ]);
    setNodes(n.data ?? []);
    setStations(s.data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const assignStation = async (nodeId: string, stationId: string) => {
    const { error } = await db.from("edge_nodes").update({ station_id: stationId, updated_at: new Date().toISOString() }).eq("id", nodeId);
    if (error) return toast.error(error.message);
    toast.success("Station assigned");
    load();
  };

  const deleteNode = async (id: string) => {
    if (!confirm("Delete this edge node?")) return;
    const { error } = await db.from("edge_nodes").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Edge node deleted");
    load();
  };

  const getStationName = (stationId: string) => {
    const s = stations.find((st: any) => st.id === stationId);
    if (!s) return "—";
    const line = s.lines?.name ? ` · ${s.lines.name}` : "";
    return `${s.name}${line}`;
  };

  return (
    <AppShell title="Edge Nodes">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Radio className="h-4 w-4" /> Edge Node Registration
          </CardTitle>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} /> Refresh
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Node Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned Station</TableHead>
                  <TableHead>Last Seen</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                ) : nodes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-10">
                      <div className="flex flex-col items-center gap-2">
                        <Radio className="h-8 w-8 opacity-30" />
                        <span className="text-sm text-muted-foreground">No edge nodes registered yet.</span>
                        <span className="text-xs text-muted-foreground">Edge nodes register automatically when they start up via /api/edge/register</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  nodes.map((node) => (
                    <TableRow key={node.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Monitor className="h-4 w-4 text-muted-foreground" />
                          <span className="font-mono text-sm font-medium">{node.node_name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {node.status === "active" ? (
                          <Badge className="bg-green-500/20 text-green-400 border-0 flex items-center gap-1 w-fit">
                            <Wifi className="h-3 w-3" /> Active
                          </Badge>
                        ) : (
                          <Badge className="bg-gray-500/20 text-gray-400 border-0 flex items-center gap-1 w-fit">
                            <WifiOff className="h-3 w-3" /> {node.status}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select value={node.station_id || ""} onValueChange={(v) => assignStation(node.id, v)}>
                          <SelectTrigger className="h-8 text-xs max-w-[250px]">
                            <SelectValue placeholder="Select station..." />
                          </SelectTrigger>
                          <SelectContent>
                            {stations.map((st: any) => (
                              <SelectItem key={st.id} value={st.id}>
                                {st.name} · {st.lines?.name ?? "—"} · {st.lines?.categories?.name ?? ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {node.last_seen ? new Date(node.last_seen).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => deleteNode(node.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-danger" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 p-3 bg-muted/30 rounded-md border border-border">
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">ℹ️ How Edge Nodes Register</h4>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Each production-edge workstation calls <code className="bg-muted px-1 rounded text-[10px]">POST /api/edge/register</code> with its <code className="bg-muted px-1 rounded text-[10px]">node_name</code> and <code className="bg-muted px-1 rounded text-[10px]">station_id</code> on startup.
              The station_id must match a station ID from the <strong>Structure</strong> admin page.
              Once registered, the edge node pushes OEE snapshots to <code className="bg-muted px-1 rounded text-[10px]">POST /api/sync</code>.
            </p>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
