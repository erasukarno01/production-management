import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { db } from "@/integrations/local-db/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ChevronRight, ChevronDown, Folder, LineChart, Box,
  Plus, Pencil, Trash2, Check, X, SquareStack,
  Key, Copy
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/structure")({
  ssr: false,
  component: StructurePage,
});

const API_BASE = '';

function StructurePage() {
  const [tree, setTree] = useState<any[]>([]);
  const [tokens, setTokens] = useState<Record<string, any>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Record<string, { field: string; value: string }>>({});
  const [adding, setAdding] = useState<Record<string, { name: string; target_oee?: string }>>({});
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const load = async () => {
    const [c, l, s, t] = await Promise.all([
      db.from("categories").select("*").order("sort_order"),
      db.from("lines").select("*").order("sort_order"),
      db.from("stations").select("*").order("sort_order"),
      fetch(API_BASE + '/api/admin/tokens', { headers: authHeaders() }).then(r => r.json()).catch(() => ({ data: [] })),
    ]);
    const cats = c.data ?? [];
    const lines = l.data ?? [];
    const stations = s.data ?? [];
    const tokenMap: Record<string, any> = {};
    (t.data ?? []).forEach((tk: any) => { if (tk.station_id) tokenMap[tk.station_id] = tk; });
    setTokens(tokenMap);
    const treeData = cats.map((cat: any) => ({
      ...cat,
      _children: lines.filter((l: any) => l.category_id === cat.id).map((line: any) => ({
        ...line,
        _children: stations.filter((s: any) => s.line_id === line.id),
      })),
    }));
    setTree(treeData);
    const open: Record<string, boolean> = {};
    treeData.forEach((cat: any) => { open[cat.id] = true; cat._children.forEach((l: any) => { open[l.id] = true; }); });
    setExpanded(open);
  };

  useEffect(() => { load(); }, []);

  const toggle = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  const startEdit = (id: string, field: string, value: any) => {
    setEditing({ ...editing, [id]: { field, value: String(value ?? "") } });
  };

  const cancelEdit = (id: string) => {
    const next = { ...editing };
    delete next[id];
    setEditing(next);
  };

  const saveEdit = async (table: string, id: string) => {
    const edit = editing[id];
    if (!edit) return;
    const payload: any = {};
    if (edit.field === "name") payload.name = edit.value;
    if (edit.field === "target_oee") payload.target_oee = parseFloat(edit.value) / 100;
    const { error } = await db.from(table as any).update(payload).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    const next = { ...editing };
    delete next[id];
    setEditing(next);
    load();
  };

  const handleKeyDown = (e: React.KeyboardEvent, table: string, id: string) => {
    if (e.key === "Enter") saveEdit(table, id);
    if (e.key === "Escape") cancelEdit(id);
  };

  const startAdd = (parentKey: string, targetOee = true) => {
    setAdding({ ...adding, [parentKey]: targetOee ? { name: "", target_oee: "85" } : { name: "" } });
  };

  const cancelAdd = (key: string) => {
    const next = { ...adding };
    delete next[key];
    setAdding(next);
  };

  const saveAdd = async (table: string, parentKey: string, data: any) => {
    const add = adding[parentKey];
    if (!add || !add.name.trim()) return toast.error("Name is required");
    const payload: any = { name: add.name.trim() };
    if (add.target_oee) payload.target_oee = parseFloat(add.target_oee) / 100;
    const { error } = await db.from(table as any).insert({ ...payload, ...data, sort_order: 999 });
    if (error) return toast.error(error.message);
    toast.success("Created");
    cancelAdd(parentKey);
    load();
  };

  const del = async (table: string, id: string) => {
    const { error } = await db.from(table as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  };

  // ── Token Management ──
  const authHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const stored = localStorage.getItem('oauth_session');
      if (stored) {
        const session = JSON.parse(stored);
        if (session.access_token) headers['Authorization'] = 'Bearer ' + session.access_token;
      }
    } catch {}
    return headers;
  };

  const generateToken = async (stationId: string, nodeName: string) => {
    try {
      const res = await fetch(API_BASE + '/api/admin/tokens', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ node_name: nodeName, station_id: stationId, label: nodeName }),
      });
      const result = await res.json();
      if (result.error) return toast.error(result.error);
      toast.success('Token generated for ' + nodeName);
      load();
    } catch (err: any) { toast.error(err.message); }
  };

  const copyToken = async (stationId: string) => {
    const token = tokens[stationId];
    if (!token?.token) return;
    try {
      const res = await fetch(API_BASE + '/api/admin/tokens', { headers: authHeaders() });
      const all = await res.json();
      const full = (all.data ?? []).find((t: any) => t.station_id === stationId);
      const tokenStr = full?.token || token.token;
      await navigator.clipboard.writeText(tokenStr);
      setCopiedToken(stationId);
      setTimeout(() => setCopiedToken(null), 2000);
      toast.success('Token copied');
    } catch { toast.error('Failed to copy'); }
  };

  const revokeToken = async (tokenId: string, stationName: string) => {
    if (!confirm('Revoke token for ' + stationName + '?')) return;
    try {
      await fetch(API_BASE + '/api/admin/tokens/' + tokenId, { method: 'DELETE', headers: authHeaders() });
      toast.success('Token revoked');
      load();
    } catch (err: any) { toast.error(err.message); }
  };

  // ── Helpers ──
  const catColor = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes("smt")) return { bg: "bg-blue-500/10 hover:bg-blue-500/15", border: "border-l-blue-500", icon: "text-blue-400" };
    if (n.includes("sub") || n.includes("final")) return { bg: "bg-amber-500/10 hover:bg-amber-500/15", border: "border-l-amber-500", icon: "text-amber-400" };
    return { bg: "", border: "border-l-gray-500", icon: "text-gray-400" };
  };

  const oeeBadge = (val: number) => {
    const pct = (val * 100).toFixed(0);
    const cls = val >= 0.85 ? "bg-green-500/20 text-green-400" : val >= 0.75 ? "bg-yellow-500/20 text-yellow-400" : "bg-red-500/20 text-red-400";
    return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cls}`}>{pct}%</span>;
  };

  const tokenCount = Object.keys(tokens).length;
  const stationCount = tree.reduce((sum, cat) => sum + (cat._children || []).reduce((s: number, l: any) => s + (l._children || []).length, 0), 0);

  // ── Render Station Row ──
  const renderStation = (st: any) => {
    const token = tokens[st.id];
    const isEditingName = editing[st.id]?.field === "name";
    const isEditingOee = editing[st.id]?.field === "target_oee";

    return (
      <div key={st.id} className="flex items-center gap-1.5 pl-12 pr-3 py-1 border-b border-border/50 hover:bg-muted/20 transition-colors group">
        <Box className="h-3 w-3 text-muted-foreground shrink-0" />

        {isEditingName ? (
          <Input value={editing[st.id].value} onChange={(e) => setEditing({ ...editing, [st.id]: { ...editing[st.id], value: e.target.value } })} className="h-6 text-xs flex-1 max-w-[200px]" onKeyDown={(e) => handleKeyDown(e, "stations", st.id)} autoFocus />
        ) : (
          <span className="text-xs font-medium w-[160px] truncate">{st.name}</span>
        )}

        {/* Token Status */}
        {!isEditingName && !isEditingOee && (
          <span className="flex items-center gap-1 shrink-0">
            {token ? (
              <>
                <span className="flex items-center gap-1 text-[11px] font-mono bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded" title={token.token}>
                  {copiedToken === st.id ? <Check className="h-2.5 w-2.5 shrink-0" /> : <Key className="h-2.5 w-2.5 shrink-0" />}
                  {token.token}
                </span>
                <Button variant="ghost" size="sm" className="h-5 w-5 p-0 shrink-0" onClick={() => copyToken(st.id)} title="Copy token">
                  <Copy className="h-3 w-3 text-muted-foreground" />
                </Button>
                <Button variant="ghost" size="sm" className="h-5 w-5 p-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => revokeToken(token.id, st.name)} title="Revoke">
                  <X className="h-3 w-3 text-red-400" />
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground" onClick={() => generateToken(st.id, st.name.toUpperCase().replace(/\s+/g, '_'))} title="Generate token">
                <Key className="h-2.5 w-2.5 mr-1" /> Generate
              </Button>
            )}
          </span>
        )}

        {/* OEE Badge */}
        {isEditingOee ? (
          <Input value={editing[st.id].value} onChange={(e) => setEditing({ ...editing, [st.id]: { ...editing[st.id], value: e.target.value } })} className="h-6 text-xs w-16 text-center" onKeyDown={(e) => handleKeyDown(e, "stations", st.id)} autoFocus />
        ) : (
          <span className="w-[44px] text-center">{oeeBadge(st.target_oee)}</span>
        )}

        {/* Action Buttons */}
        {isEditingName || isEditingOee ? (
          <span className="flex items-center gap-0.5 w-[44px] shrink-0">
            <Button size="icon" variant="ghost" className="h-5 w-5 p-0" onClick={() => saveEdit("stations", st.id)}><Check className="h-3 w-3 text-green-400" /></Button>
            <Button size="icon" variant="ghost" className="h-5 w-5 p-0" onClick={() => cancelEdit(st.id)}><X className="h-3 w-3 text-muted-foreground" /></Button>
          </span>
        ) : (
          <span className="flex items-center gap-0 w-[72px] shrink-0 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
            <Button size="icon" variant="ghost" className="h-5 w-5 p-0" onClick={() => startEdit(st.id, "name", st.name)} title="Rename"><Pencil className="h-3 w-3 text-muted-foreground" /></Button>
            <Button size="icon" variant="ghost" className="h-5 w-5 p-0" onClick={() => startEdit(st.id, "target_oee", (st.target_oee * 100).toFixed(0))} title="Edit target OEE"><span className="text-[9px] font-bold text-amber-400">%</span></Button>
            <Button size="icon" variant="ghost" className="h-5 w-5 p-0" onClick={() => { if (confirm("Delete this station?")) del("stations", st.id); }} title="Delete"><Trash2 className="h-3 w-3 text-red-400" /></Button>
          </span>
        )}
      </div>
    );
  };

  return (
    <AppShell title="Structure Management">
      <div className="space-y-2">
        {/* Compact Header */}
        <div className="flex items-center justify-between bg-card rounded-lg border border-border px-4 py-2">
          <div className="flex items-center gap-2">
            <SquareStack className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-bold">Production Structure</span>
            <span className="text-[11px] text-muted-foreground">
              {tree.length} categories · {tree.reduce((s, c) => s + (c._children?.length || 0), 0)} lines · {stationCount} stations
              {tokenCount > 0 && <span className="text-green-400"> · {tokenCount} tokens</span>}
            </span>
          </div>
          <Button size="sm" onClick={() => startAdd("_cat")} className="h-7 gap-1 text-xs"><Plus className="h-3 w-3" /> Add Category</Button>
        </div>

        {adding["_cat"] && (
          <div className="flex items-center gap-1.5 bg-blue-500/5 border border-blue-500/20 rounded-md px-3 py-1.5">
            <Input value={adding["_cat"].name} onChange={(e) => setAdding({ ...adding, _cat: { ...adding["_cat"], name: e.target.value } })} placeholder="Category name" className="h-7 text-xs flex-1 max-w-[180px]" onKeyDown={(e) => e.key === "Enter" && saveAdd("categories", "_cat", { sort_order: tree.length + 1 })} autoFocus />
            <Button size="sm" onClick={() => saveAdd("categories", "_cat", { sort_order: tree.length + 1 })} className="h-7 w-7 p-0"><Check className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="ghost" onClick={() => cancelAdd("_cat")} className="h-7 w-7 p-0"><X className="h-3.5 w-3.5" /></Button>
          </div>
        )}

        {/* Tree */}
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          {tree.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground text-sm"><Folder className="h-8 w-8 mx-auto mb-2 opacity-30" />No categories yet.</div>
          ) : (
            tree.map((cat) => {
              const cc = catColor(cat.name);
              const catLines = cat._children || [];
              const isCatExp = expanded[cat.id];
              const catStationCount = catLines.reduce((s: number, l: any) => s + (l._children?.length || 0), 0);

              return (
                <div key={cat.id}>
                  {/* ── Category Row ── */}
                  <div className={cn("flex items-center gap-1.5 px-3 py-1.5 border-l-4 border-b border-border transition-colors group cursor-pointer select-none", cc.bg, cc.border)} onClick={() => toggle(cat.id)}>
                    <div className="h-4 w-4 grid place-items-center text-muted-foreground shrink-0">
                      {isCatExp ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </div>
                    <Folder className={cn("h-3.5 w-3.5 shrink-0", cc.icon)} />
                    {editing[cat.id]?.field === "name" ? (
                      <Input value={editing[cat.id].value} onChange={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} className="h-6 text-xs flex-1 max-w-[180px]" onKeyDown={(e) => { e.stopPropagation(); handleKeyDown(e, "categories", cat.id); }} autoFocus />
                    ) : (
                      <span className="flex-1 text-xs font-semibold">{cat.name}</span>
                    )}
                    <span className="text-[10px] text-muted-foreground">{catStationCount} stn · {catLines.length} ln</span>
                    {!editing[cat.id]?.field && (
                      <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                        <Button size="icon" variant="ghost" className="h-5 w-5 p-0" onClick={() => startEdit(cat.id, "name", cat.name)} title="Rename"><Pencil className="h-3 w-3 text-muted-foreground" /></Button>
                        <Button size="icon" variant="ghost" className="h-5 w-5 p-0" onClick={() => { if (confirm("Delete category?")) del("categories", cat.id); }} title="Delete"><Trash2 className="h-3 w-3 text-red-400" /></Button>
                        <Button size="icon" variant="ghost" className="h-5 w-5 p-0" onClick={() => startAdd(`line-${cat.id}`)} title="Add line"><Plus className="h-3 w-3 text-blue-400" /></Button>
                      </span>
                    )}
                    {editing[cat.id]?.field === "name" && (
                      <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                        <Button size="icon" variant="ghost" className="h-5 w-5 p-0" onClick={() => saveEdit("categories", cat.id)}><Check className="h-3 w-3 text-green-400" /></Button>
                        <Button size="icon" variant="ghost" className="h-5 w-5 p-0" onClick={() => cancelEdit(cat.id)}><X className="h-3 w-3 text-muted-foreground" /></Button>
                      </span>
                    )}
                  </div>

                  {isCatExp && (
                    <div>
                      {adding[`line-${cat.id}`] && (
                        <div className="flex items-center gap-1.5 pl-8 pr-3 py-1 bg-blue-500/5 border-b border-border/50">
                          <LineChart className="h-3 w-3 text-muted-foreground shrink-0" />
                          <Input value={adding[`line-${cat.id}`].name} onChange={(e) => setAdding({ ...adding, [`line-${cat.id}`]: { ...adding[`line-${cat.id}`], name: e.target.value } })} placeholder="Line name" className="h-6 text-xs flex-1 max-w-[150px]" onKeyDown={(e) => e.key === "Enter" && saveAdd("lines", `line-${cat.id}`, { category_id: cat.id })} autoFocus />
                          <Input value={adding[`line-${cat.id}`].target_oee} onChange={(e) => setAdding({ ...adding, [`line-${cat.id}`]: { ...adding[`line-${cat.id}`], target_oee: e.target.value } })} placeholder="OEE %" className="h-6 text-xs w-16" onKeyDown={(e) => e.key === "Enter" && saveAdd("lines", `line-${cat.id}`, { category_id: cat.id })} />
                          <Button size="icon" variant="ghost" className="h-6 w-6 p-0" onClick={() => saveAdd("lines", `line-${cat.id}`, { category_id: cat.id })}><Check className="h-3 w-3 text-green-400" /></Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6 p-0" onClick={() => cancelAdd(`line-${cat.id}`)}><X className="h-3 w-3 text-muted-foreground" /></Button>
                        </div>
                      )}

                      {catLines.length === 0 && !adding[`line-${cat.id}`] && (
                        <div className="pl-8 pr-3 py-1 text-[11px] text-muted-foreground border-b border-border/50 italic">No lines — <button className="text-blue-400 hover:underline" onClick={(e) => { e.stopPropagation(); startAdd(`line-${cat.id}`); }}>add one</button></div>
                      )}

                      {catLines.map((line: any) => {
                        const stations = line._children || [];
                        const isLineExp = expanded[line.id];
                        return (
                          <div key={line.id}>
                            {/* ── Line Row ── */}
                            <div className="flex items-center gap-1.5 pl-8 pr-3 py-1.5 border-b border-border/50 hover:bg-muted/20 transition-colors group" onClick={() => toggle(line.id)}>
                              <div className="h-4 w-4 grid place-items-center text-muted-foreground shrink-0">
                                {isLineExp ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                              </div>
                              <LineChart className="h-3 w-3 text-muted-foreground shrink-0" />
                              {editing[line.id]?.field === "name" ? (
                                <Input value={editing[line.id].value} onChange={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} className="h-6 text-xs flex-1 max-w-[150px]" onKeyDown={(e) => { e.stopPropagation(); handleKeyDown(e, "lines", line.id); }} autoFocus />
                              ) : editing[line.id]?.field === "target_oee" ? (
                                <Input value={editing[line.id].value} onChange={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} className="h-6 text-xs w-16" onKeyDown={(e) => { e.stopPropagation(); handleKeyDown(e, "lines", line.id); }} autoFocus />
                              ) : (
                                <span className="flex-1 text-xs font-medium">{line.name}</span>
                              )}
                              {oeeBadge(line.target_oee)}
                              <span className="text-[10px] text-muted-foreground shrink-0">{stations.length} stn</span>
                              {!editing[line.id]?.field && (
                                <span className="flex items-center gap-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                                  <Button size="icon" variant="ghost" className="h-5 w-5 p-0" onClick={() => startEdit(line.id, "name", line.name)} title="Rename"><Pencil className="h-3 w-3 text-muted-foreground" /></Button>
                                  <Button size="icon" variant="ghost" className="h-5 w-5 p-0" onClick={() => startEdit(line.id, "target_oee", (line.target_oee * 100).toFixed(0))} title="Target OEE"><span className="text-[9px] font-bold text-amber-400">%</span></Button>
                                  <Button size="icon" variant="ghost" className="h-5 w-5 p-0" onClick={() => { if (confirm("Delete line?")) del("lines", line.id); }} title="Delete"><Trash2 className="h-3 w-3 text-red-400" /></Button>
                                  <Button size="icon" variant="ghost" className="h-5 w-5 p-0" onClick={() => startAdd(`station-${line.id}`, false)} title="Add station"><Plus className="h-3 w-3 text-blue-400" /></Button>
                                </span>
                              )}
                              {editing[line.id]?.field && (
                                <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                                  <Button size="icon" variant="ghost" className="h-5 w-5 p-0" onClick={() => saveEdit("lines", line.id)}><Check className="h-3 w-3 text-green-400" /></Button>
                                  <Button size="icon" variant="ghost" className="h-5 w-5 p-0" onClick={() => cancelEdit(line.id)}><X className="h-3 w-3 text-muted-foreground" /></Button>
                                </span>
                              )}
                            </div>

                            {isLineExp && (
                              <div>
                                {adding[`station-${line.id}`] && (
                                  <div className="flex items-center gap-1.5 pl-12 pr-3 py-1 bg-blue-500/5 border-b border-border/50">
                                    <Box className="h-3 w-3 text-muted-foreground shrink-0" />
                                    <Input value={adding[`station-${line.id}`].name} onChange={(e) => setAdding({ ...adding, [`station-${line.id}`]: { ...adding[`station-${line.id}`], name: e.target.value } })} placeholder="Station name" className="h-6 text-xs flex-1 max-w-[160px]" onKeyDown={(e) => e.key === "Enter" && saveAdd("stations", `station-${line.id}`, { line_id: line.id })} autoFocus />
                                    <Button size="icon" variant="ghost" className="h-6 w-6 p-0" onClick={() => saveAdd("stations", `station-${line.id}`, { line_id: line.id })}><Check className="h-3 w-3 text-green-400" /></Button>
                                    <Button size="icon" variant="ghost" className="h-6 w-6 p-0" onClick={() => cancelAdd(`station-${line.id}`)}><X className="h-3 w-3 text-muted-foreground" /></Button>
                                  </div>
                                )}
                                {stations.length === 0 && !adding[`station-${line.id}`] && (
                                  <div className="pl-12 pr-3 py-1 text-[11px] text-muted-foreground border-b border-border/50 italic">No stations — <button className="text-blue-400 hover:underline" onClick={(e) => { e.stopPropagation(); startAdd(`station-${line.id}`, false); }}>add one</button></div>
                                )}
                                {stations.map((st: any) => renderStation(st))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </AppShell>
  );
}
