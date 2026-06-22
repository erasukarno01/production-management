import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { db } from "@/integrations/local-db/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/products")({
  ssr: false,
  component: ProductsPage,
});

type ProductRow = {
  id: string; code: string; name: string; model: string | null; serial_prefix: string | null;
  cycle_time_sec: number; ng_target_ratio: number; active: boolean;
};

function ProductsPage() {
  const { isSupervisor } = useAuth();
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);

  const load = async () => {
    const { data } = await db.from("products").select("*").order("code");
    setRows((data as any) ?? []);
  };
  useEffect(() => { load(); }, []);

  const del = async (id: string) => {
    if (!confirm("Delete this product?")) return;
    const { error } = await db.from("products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted"); load();
  };
  const toggleActive = async (p: ProductRow) => {
    const { error } = await db.from("products").update({ active: p.active ? 0 : 1 }).eq("id", p.id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <AppShell title="Master Products">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Products</CardTitle>
          {isSupervisor && (
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
              <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> New Product</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{editing ? "Edit Product" : "New Product"}</DialogTitle></DialogHeader>
                <ProductForm initial={editing} onDone={() => { setOpen(false); setEditing(null); load(); }} />
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Model</TableHead><TableHead>Serial Prefix</TableHead>
                <TableHead className="text-right">Cycle (s)</TableHead><TableHead className="text-right">NG Target</TableHead>
                <TableHead>Status</TableHead><TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No products yet.</TableCell></TableRow>}
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.code}</TableCell>
                  <TableCell>{p.name}</TableCell>
                  <TableCell className="text-muted-foreground">{p.model ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{p.serial_prefix ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{Number(p.cycle_time_sec).toFixed(1)}</TableCell>
                  <TableCell className="text-right font-mono">{(Number(p.ng_target_ratio) * 100).toFixed(2)}%</TableCell>
                  <TableCell>
                    {isSupervisor
                      ? <Switch checked={p.active} onCheckedChange={() => toggleActive(p)} />
                      : <Badge variant={p.active ? "default" : "outline"}>{p.active ? "Active" : "Inactive"}</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    {isSupervisor && (
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => { setEditing(p); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => del(p.id)}><Trash2 className="h-3.5 w-3.5 text-danger" /></Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}

function ProductForm({ initial, onDone }: { initial: ProductRow | null; onDone: () => void }) {
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [serialPrefix, setSerialPrefix] = useState(initial?.serial_prefix ?? "");
  const [cycle, setCycle] = useState(Number(initial?.cycle_time_sec ?? 30));
  const [ngTarget, setNgTarget] = useState(Number(initial?.ng_target_ratio ?? 0.02) * 100);
  const [active, setActive] = useState(!!initial?.active);

  const submit = async () => {
    if (!code || !name) return toast.error("Code and name required");
    const payload = { code, name, model: model || null, serial_prefix: serialPrefix || null, cycle_time_sec: cycle, ng_target_ratio: ngTarget / 100, active: active ? 1 : 0 };
    const q = initial
      ? db.from("products").update(payload).eq("id", initial.id)
      : db.from("products").insert(payload);
    const { error } = await q;
    if (error) return toast.error(error.message);
    toast.success(initial ? "Updated" : "Created");
    onDone();
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Code *</Label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. PROD-001" /></div>
        <div><Label>Model</Label><Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. V2" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Serial Prefix</Label><Input value={serialPrefix} onChange={(e) => setSerialPrefix(e.target.value)} placeholder="e.g. 0008" /></div>
        <div><Label>Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Cycle Time (sec/pcs)</Label><Input type="number" step="0.1" value={cycle} onChange={(e) => setCycle(Number(e.target.value))} /></div>
        <div><Label>NG Target (%)</Label><Input type="number" step="0.01" value={ngTarget} onChange={(e) => setNgTarget(Number(e.target.value))} /></div>
      </div>
      <div className="flex items-center gap-2"><Switch checked={active} onCheckedChange={setActive} /><Label>Active</Label></div>
      <Button onClick={submit} className="w-full">{initial ? "Save Changes" : "Create Product"}</Button>
    </div>
  );
}
