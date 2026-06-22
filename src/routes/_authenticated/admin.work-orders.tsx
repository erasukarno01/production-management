import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronUp, ChevronDown, ChevronsUpDown, Plus, Trash2, Search, Send, Pencil } from "lucide-react";
import { format } from "date-fns";
import { db } from "@/integrations/local-db/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/work-orders")({
  ssr: false,
  component: WorkOrdersPage,
});

const STATUSES = ["draft", "open", "in_progress", "done", "cancelled"] as const;
type Status = typeof STATUSES[number];

const PER_PAGE_OPTIONS = [10, 25, 50, 100];

const RIGHT_ALIGNED = new Set(["qty", "actual_qty", "ng_qty", "otr", "per", "qr", "oee"]);

const COL_WIDTHS: Record<string, string> = {
  wo_number: "w-[110px]", product: "w-[150px]", line: "w-[130px]",
  qty: "w-[60px]", actual_qty: "w-[60px]", ng_qty: "w-[50px]",
  start: "w-[105px]", end: "w-[105px]",
  otr: "w-[52px]", per: "w-[52px]", qr: "w-[48px]", oee: "w-[52px]",
  status: "w-[78px]", actions: "w-[80px]",
};

const COLUMNS: { key: string; label: string; sortable: boolean }[] = [
  { key: "wo_number", label: "WO #", sortable: true },
  { key: "product", label: "Product", sortable: true },
  { key: "line", label: "Line", sortable: true },
  { key: "qty", label: "Plan", sortable: true },
  { key: "actual_qty", label: "Actual", sortable: true },
  { key: "ng_qty", label: "NG", sortable: true },
  { key: "start", label: "Start", sortable: true },
  { key: "end", label: "End", sortable: true },
  { key: "otr", label: "OTR", sortable: true },
  { key: "per", label: "PER", sortable: true },
  { key: "qr", label: "QR", sortable: true },
  { key: "oee", label: "OEE", sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "actions", label: "", sortable: false },
];

const STATUS_BADGE: Record<Status, string> = {
  draft: "bg-gray-500/20 text-gray-300",
  open: "bg-blue-500/20 text-blue-300",
  in_progress: "bg-amber-500/20 text-amber-300",
  done: "bg-green-500/20 text-green-300",
  cancelled: "bg-red-500/20 text-red-300",
};

const STATUS_ACTIONS: Record<Status, { label: string; icon: any; variant: string; next: Status }[]> = {
  draft: [{ label: "Open", icon: Send, variant: "outline text-blue-400 border-blue-500/30 hover:bg-blue-500/10", next: "open" as Status }],
  open: [],
  in_progress: [],
  done: [],
  cancelled: [],
};

function getStations(wo: any, stations: any[]) {
  if (!wo.station_ids) return wo.stations ? [wo.stations] : [];
  try {
    const ids: string[] = JSON.parse(wo.station_ids);
    return ids.map((id: string) => stations.find((s) => s.id === id)).filter(Boolean);
  } catch { return wo.stations ? [wo.stations] : []; }
}

function isOverdue(wo: any): boolean {
  if (!wo.planned_end) return false;
  if (wo.status === "done" || wo.status === "cancelled") return false;
  return new Date(wo.planned_end) < new Date();
}

function WorkOrdersPage() {
  const { isSupervisor, user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [lines, setLines] = useState<any[]>([]);
  const [stations, setStations] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editingWo, setEditingWo] = useState<any>(null);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [lineFilter, setLineFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const [sortCol, setSortCol] = useState<string>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const load = async () => {
    const [w, p, l, s] = await Promise.all([
      db.from("work_orders").select("*, products(code,name,cycle_time_sec), lines(name), stations(name)").order("created_at", { ascending: false }),
      db.from("products").select("*").eq("active", true).order("code"),
      db.from("lines").select("*").order("name"),
      db.from("stations").select("*").order("name"),
    ]);
    const woData = w.data ?? [];

    // Auto-status berdasarkan Actual Qty
    const toUpdate: { id: string; status: string }[] = [];
    for (const wo of woData) {
      const aq = wo.actual_qty ?? 0;
      const pq = wo.planned_qty ?? 0;
      if (wo.status === "open" && aq > 0 && aq < pq) {
        toUpdate.push({ id: wo.id, status: "in_progress" });
      } else if ((wo.status === "open" || wo.status === "in_progress") && aq > 0 && aq >= pq) {
        toUpdate.push({ id: wo.id, status: "done" });
      }
    }
    for (const u of toUpdate) {
      await db.from("work_orders").update({ status: u.status }).eq("id", u.id);
    }

    if (toUpdate.length > 0) {
      const refreshed = await db.from("work_orders").select("*, products(code,name,cycle_time_sec), lines(name), stations(name)").order("created_at", { ascending: false });
      setRows(refreshed.data ?? []);
    } else {
      setRows(woData);
    }
    setProducts(p.data ?? []);
    setLines(l.data ?? []);
    setStations(s.data ?? []);
  };
  useEffect(() => { load(); }, []);

  // Periodic auto-check every 30s
  useEffect(() => {
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => { setPage(1); }, [statusFilter, lineFilter, search, perPage]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortCol !== col) return <ChevronsUpDown className="h-3 w-3 opacity-30" />;
    return sortDir === "asc"
      ? <ChevronUp className="h-3 w-3 text-primary" />
      : <ChevronDown className="h-3 w-3 text-primary" />;
  };

  const filtered = useMemo(() => {
    let data = [...rows];
    if (statusFilter !== "all") data = data.filter((r) => r.status === statusFilter);
    if (lineFilter !== "all") data = data.filter((r) => r.line_id === lineFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      data = data.filter((r) => r.wo_number?.toLowerCase().includes(q));
    }
    return data;
  }, [rows, statusFilter, lineFilter, search]);

  const sorted = useMemo(() => {
    const data = [...filtered];
    data.sort((a, b) => {
      let va: any, vb: any;
      switch (sortCol) {
        case "wo_number": va = a.wo_number; vb = b.wo_number; break;
        case "product": va = a.products?.name ?? ""; vb = b.products?.name ?? ""; break;
        case "line": va = a.lines?.name ?? ""; vb = b.lines?.name ?? ""; break;
        case "qty": va = a.planned_qty ?? 0; vb = b.planned_qty ?? 0; break;
        case "actual_qty": va = a.actual_qty ?? 0; vb = b.actual_qty ?? 0; break;
        case "ng_qty": va = a.ng_qty ?? 0; vb = b.ng_qty ?? 0; break;
        case "per": va = a.per ?? 0; vb = b.per ?? 0; break;
        case "otr": va = a.otr ?? 0; vb = b.otr ?? 0; break;
        case "qr": va = a.qr ?? 0; vb = b.qr ?? 0; break;
        case "oee": va = a.oee ?? 0; vb = b.oee ?? 0; break;
        case "start": va = a.planned_start ?? ""; vb = b.planned_start ?? ""; break;
        case "end": va = a.planned_end ?? ""; vb = b.planned_end ?? ""; break;
        case "status": va = a.status ?? ""; vb = b.status ?? ""; break;
        default: va = a[sortCol] ?? ""; vb = b[sortCol] ?? "";
      }
      if (typeof va === "string") return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === "asc" ? va - vb : vb - va;
    });
    return data;
  }, [filtered, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const safePage = Math.min(page, totalPages);
  const paginated = useMemo(() => {
    const start = (safePage - 1) * perPage;
    return sorted.slice(start, start + perPage);
  }, [sorted, safePage, perPage]);

  const pageNumbers = useMemo(() => {
    const pages: (number | string)[] = [];
    const total = totalPages;
    if (total <= 7) {
      for (let i = 1; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);
      if (safePage > 3) pages.push("...");
      for (let i = Math.max(2, safePage - 1); i <= Math.min(total - 1, safePage + 1); i++) pages.push(i);
      if (safePage < total - 2) pages.push("...");
      pages.push(total);
    }
    return pages;
  }, [totalPages, safePage]);

  const updateStatus = async (id: string, status: Status, msg?: string) => {
    const { error } = await db.from("work_orders").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(msg ?? `Status → ${status.replace("_", " ")}`);
    load();
  };

  const del = async (id: string) => {
    if (!confirm("Delete this work order?")) return;
    const { error } = await db.from("work_orders").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  };

  const start = (safePage - 1) * perPage + 1;
  const end = Math.min(safePage * perPage, sorted.length);

  return (
    <AppShell title="Work Orders">
      <Card className="border-0 shadow-none">
        <CardHeader className="px-0 pt-0 pb-2 flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold">Work Orders</span>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input placeholder="Search WO..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-7 h-7 w-44 text-[11px]" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-7 text-[11px] w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-[11px]">All status</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="text-[11px] capitalize">{s.replace("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={lineFilter} onValueChange={setLineFilter}>
              <SelectTrigger className="h-7 text-[11px] w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-[11px]">All lines</SelectItem>
                {lines.map((l) => <SelectItem key={l.id} value={l.id} className="text-[11px]">{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground">
              <span className="font-semibold text-foreground">{sorted.length}</span>
              {STATUSES.filter((s) => rows.some((r) => r.status === s)).map((s) => (
                <span key={s} className="flex items-center gap-1">
                  <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_BADGE[s].split(" ")[0])} />
                  {rows.filter((r) => r.status === s).length}<span className="hidden sm:inline">&nbsp;{s.replace("_", " ")}</span>
                </span>
              ))}
              {rows.filter(isOverdue).length > 0 && (
                <span className="flex items-center gap-1 text-red-400 font-semibold">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  {rows.filter(isOverdue).length} overdue
                </span>
              )}
            </div>
            {isSupervisor && (
              <Dialog open={open} onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) setEditingWo(null); }}>
                <DialogTrigger asChild>
                  <Button size="sm" className="h-7 text-[11px] gap-1"><Plus className="h-3 w-3" /> New WO</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>{editingWo ? "Edit Work Order" : "Create Work Order"}</DialogTitle></DialogHeader>
                  <WoForm products={products} lines={lines} stations={stations} userId={user?.id} woData={editingWo} onDone={() => { setOpen(false); setEditingWo(null); load(); }} />
                </DialogContent>
              </Dialog>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {COLUMNS.map((col) => (
                    <TableHead
                      key={col.key}
                      className={cn(
                        "h-7 px-1 text-[10px] font-semibold uppercase tracking-wider",
                        COL_WIDTHS[col.key],
                        col.sortable && "cursor-pointer select-none hover:text-foreground transition-colors",
                        RIGHT_ALIGNED.has(col.key) && "text-right",
                        col.key === "actions" && "text-right",
                      )}
                      onClick={() => col.sortable && handleSort(col.key)}
                    >
                      <span className="grid grid-cols-[1fr_12px] items-center justify-items-end gap-0.5">
                        <span className="truncate">{col.label}</span>
                        {col.sortable ? <SortIcon col={col.key} /> : <span />}
                      </span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={14} className="text-center text-muted-foreground py-10">
                      <div className="flex flex-col items-center gap-2">
                        <Search className="h-6 w-6 opacity-30" />
                        <span>No work orders found.</span>
                        {(search || statusFilter !== "all" || lineFilter !== "all") && (
                          <Button variant="link" size="sm" onClick={() => { setSearch(""); setStatusFilter("all"); setLineFilter("all"); }}>
                            Clear filters
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginated.map((r) => {
                    const overdue = isOverdue(r);
                    const actions = STATUS_ACTIONS[r.status as Status] ?? [];
                    return (
                      <TableRow key={r.id} className={cn("h-7", overdue && "bg-red-500/5")}>
                        <TableCell className={cn("px-1 font-mono text-[10px] truncate", COL_WIDTHS["wo_number"])}>{r.wo_number}</TableCell>
                        <TableCell className={cn("px-1 text-[10px] leading-tight", COL_WIDTHS["product"])}>
                          <span className="truncate block max-w-full">{r.products?.name ?? "—"}</span>
                          <span className="text-muted-foreground/70">{r.products?.code}{r.products?.cycle_time_sec ? ` ${r.products.cycle_time_sec}s` : ""}</span>
                        </TableCell>
                        <TableCell className={cn("px-1 text-[10px]", COL_WIDTHS["line"])}>
                          <span className={cn("px-1 py-0.5 rounded font-medium inline-block",
                            r.lines?.name?.toLowerCase().includes("smt") ? "bg-blue-500/15 text-blue-400"
                            : r.lines?.name?.toLowerCase().includes("final") ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-amber-500/15 text-amber-400"
                          )}>
                            {r.lines?.name ?? "—"}
                          </span>
                          {(() => {
                            const s = getStations(r, stations);
                            if (s.length === 0) return null;
                            if (s.length === 1) return <span className="block text-[9px] text-muted-foreground truncate leading-tight mt-0.5">{s[0].name}</span>;
                            return (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="block text-[9px] text-muted-foreground truncate leading-tight mt-0.5 cursor-help underline decoration-dotted">{s.length} stations</span>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" align="start" className="text-[11px] leading-relaxed space-y-0.5">
                                  {s.map((st: any) => <div key={st.id}>{st.name}</div>)}
                                </TooltipContent>
                              </Tooltip>
                            );
                          })()}
                        </TableCell>
                        <TableCell className={cn("px-1 text-right font-mono text-[10px]", COL_WIDTHS["qty"])}>{r.planned_qty?.toLocaleString() ?? "—"}</TableCell>
                        <TableCell className={cn("px-1 text-right font-mono text-[10px]", COL_WIDTHS["actual_qty"])}>{r.actual_qty?.toLocaleString() ?? "—"}</TableCell>
                        <TableCell className={cn("px-1 text-right font-mono text-[10px] text-red-400", COL_WIDTHS["ng_qty"])}>{r.ng_qty?.toLocaleString() ?? "—"}</TableCell>
                        <TableCell className={cn("px-1 text-[10px] whitespace-nowrap", COL_WIDTHS["start"])}>{r.planned_start ? format(new Date(r.planned_start), "dd MMM yyyy, HH:mm") : <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className={cn("px-1 text-[10px] whitespace-nowrap", COL_WIDTHS["end"])}>
                          {r.planned_end ? format(new Date(r.planned_end), "dd MMM yyyy, HH:mm") : <span className="text-muted-foreground">—</span>}
                          {overdue && <span className="ml-1 text-[9px] font-bold text-red-400">!</span>}
                        </TableCell>
                        <TableCell className={cn("px-1", COL_WIDTHS["otr"])}>
                          <span className="grid grid-cols-[1fr_12px] items-center justify-items-end">
                            <span className="text-right font-mono text-[10px]">
                              {r.otr != null ? <span className={r.otr >= 0.85 ? "text-green-400" : r.otr >= 0.75 ? "text-yellow-400" : "text-red-400"}>{(r.otr * 100).toFixed(1)}</span> : <span className="text-muted-foreground">—</span>}
                            </span>
                            <span />
                          </span>
                        </TableCell>
                        <TableCell className={cn("px-1", COL_WIDTHS["per"])}>
                          <span className="grid grid-cols-[1fr_12px] items-center justify-items-end">
                            <span className="text-right font-mono text-[10px]">
                              {r.per != null ? <span className={r.per >= 0.85 ? "text-green-400" : r.per >= 0.75 ? "text-yellow-400" : "text-red-400"}>{(r.per * 100).toFixed(1)}</span> : <span className="text-muted-foreground">—</span>}
                            </span>
                            <span />
                          </span>
                        </TableCell>
                        <TableCell className={cn("px-1", COL_WIDTHS["qr"])}>
                          <span className="grid grid-cols-[1fr_12px] items-center justify-items-end">
                            <span className="text-right font-mono text-[10px]">
                              {r.qr != null ? <span className={r.qr >= 0.98 ? "text-green-400" : r.qr >= 0.95 ? "text-yellow-400" : "text-red-400"}>{(r.qr * 100).toFixed(1)}</span> : <span className="text-muted-foreground">—</span>}
                            </span>
                            <span />
                          </span>
                        </TableCell>
                        <TableCell className={cn("px-1", COL_WIDTHS["oee"])}>
                          <span className="grid grid-cols-[1fr_12px] items-center justify-items-end">
                            <span className="text-right font-mono text-[10px] font-bold">
                              {r.oee != null ? <span className={r.oee >= 0.85 ? "text-green-400" : r.oee >= 0.75 ? "text-yellow-400" : "text-red-400"}>{(r.oee * 100).toFixed(1)}</span> : <span className="text-muted-foreground">—</span>}
                            </span>
                            <span />
                          </span>
                        </TableCell>
                        <TableCell className={cn("px-1", COL_WIDTHS["status"])}>
                          <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", STATUS_BADGE[r.status as Status])}>
                            {r.status.replace("_", " ")}
                          </span>
                        </TableCell>
                        <TableCell className={cn("px-1 text-right", COL_WIDTHS["actions"])}>
                          <div className="flex items-center justify-end gap-0.5">
                            {isSupervisor && actions.map((action) => (
                              <Button
                                key={action.next}
                                variant="outline"
                                size="sm"
                                className={cn("h-6 px-1.5 text-[9px]", action.variant)}
                                onClick={() => updateStatus(r.id, action.next, `WO ${r.wo_number} → ${action.label}`)}
                                title={action.label}
                              >
                                <action.icon className="h-2.5 w-2.5 mr-0.5" />
                                {action.label}
                              </Button>
                            ))}
                            {(r.status === "draft" || r.status === "open") && isSupervisor && (
                              <>
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setEditingWo(r); setOpen(true); }} title="Edit">
                                  <Pencil className="h-3 w-3 text-blue-400" />
                                </Button>
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => del(r.id)} title="Delete">
                                  <Trash2 className="h-3 w-3 text-danger" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {sorted.length > 0 && (
            <div className="flex items-center justify-between mt-2 gap-2">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{start}–{end} of {sorted.length}</span>
                <Select value={String(perPage)} onValueChange={(v) => setPerPage(Number(v))}>
                  <SelectTrigger className="h-6 w-16 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PER_PAGE_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)} className="text-[11px]">{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-0.5">
                <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} className="h-6 px-2 text-[10px]">Prev</Button>
                {pageNumbers.map((p, i) =>
                  typeof p === "string"
                    ? <span key={`ellipsis-${i}`} className="px-0.5 text-[10px] text-muted-foreground">…</span>
                    : <Button key={p} variant={p === safePage ? "default" : "outline"} size="sm" onClick={() => setPage(p)} className="h-6 min-w-[1.5rem] px-1 text-[10px]">{p}</Button>
                )}
                <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)} className="h-6 px-2 text-[10px]">Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}

function WoForm({ products, lines, stations, userId, onDone, woData }: { products: any[]; lines: any[]; stations: any[]; userId?: string; onDone: () => void; woData?: any }) {
  const isEdit = !!woData;
  const [woNumber, setWoNumber] = useState(woData?.wo_number || `WO-${format(new Date(), "yyyyMMdd-HHmm")}`);
  const [productId, setProductId] = useState(woData?.product_id || "");
  const [lineId, setLineId] = useState(woData?.line_id || "");
  const [selectedStations, setSelectedStations] = useState<Set<string>>(
    new Set(woData?.station_ids ? JSON.parse(woData.station_ids) : [])
  );
  const [qty, setQty] = useState(woData?.planned_qty || 100);
  const [actualQty, setActualQty] = useState(woData?.actual_qty || 0);
  const [ngQty, setNgQty] = useState(woData?.ng_qty || 0);
  const [per, setPer] = useState(woData?.per || "");
  const [otr, setOtr] = useState(woData?.otr || "");
  const [qr, setQr] = useState(woData?.qr || "");
  const [oee, setOee] = useState(woData?.oee || "");
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [start, setStart] = useState(woData?.planned_start ? format(new Date(woData.planned_start), "yyyy-MM-dd'T'HH:mm") : `${todayStr}T08:00`);
  const [end, setEnd] = useState(woData?.planned_end ? format(new Date(woData.planned_end), "yyyy-MM-dd'T'HH:mm") : `${todayStr}T17:00`);

  const selectedProduct = products.find((p) => p.id === productId);
  const stationOptions = stations.filter((s) => s.line_id === lineId);

  const toggleStation = (stationId: string) => {
    const updated = new Set(selectedStations);
    if (updated.has(stationId)) {
      updated.delete(stationId);
    } else {
      updated.add(stationId);
    }
    setSelectedStations(updated);
  };

  const toggleAllStations = () => {
    if (selectedStations.size === stationOptions.length) {
      setSelectedStations(new Set());
    } else {
      setSelectedStations(new Set(stationOptions.map((s) => s.id)));
    }
  };

  const submit = async (status: "draft" | "open") => {
    if (!woNumber || !productId || !lineId) return toast.error("WO #, product, dan line harus diisi");
    if (qty <= 0) return toast.error("Plan Qty harus > 0");
    if (!start) return toast.error("Plan Start harus diisi");
    if (!end) return toast.error("Plan End harus diisi");
    if (new Date(end) <= new Date(start)) return toast.error("Plan End harus lebih besar dari Plan Start");
    if (selectedStations.size === 0) return toast.error("Pilih minimal 1 station");

    const payload = {
      wo_number: woNumber,
      product_id: productId,
      line_id: lineId,
      station_ids: JSON.stringify(Array.from(selectedStations)),
      planned_qty: qty,
      planned_start: start ? new Date(start).toISOString() : null,
      planned_end: end ? new Date(end).toISOString() : null,
      actual_qty: actualQty,
      ng_qty: ngQty,
      per: per ? parseFloat(per) : null,
      otr: otr ? parseFloat(otr) : null,
      qr: qr ? parseFloat(qr) : null,
      oee: oee ? parseFloat(oee) : null,
      status,
      updated_by: userId,
    };

    const { error } = isEdit
      ? await db.from("work_orders").update(payload).eq("id", woData.id)
      : await db.from("work_orders").insert({ ...payload, created_by: userId });

    if (error) return toast.error(error.message);
    toast.success(isEdit ? "WO diupdate" : (status === "draft" ? "WO saved as draft" : "WO opened"));
    onDone();
  };

  return (
    <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-4">
      <div>
        <Label>WO Number *</Label>
        <Input value={woNumber} onChange={(e) => setWoNumber(e.target.value)} disabled={isEdit} />
      </div>

      <div>
        <Label>Product *</Label>
        <Select value={productId} onValueChange={setProductId} disabled={isEdit}>
          <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
          <SelectContent>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedProduct && (
          <div className="mt-1.5 flex gap-2 text-[10px] text-muted-foreground flex-wrap">
            {selectedProduct.model && <span>Model: {selectedProduct.model}</span>}
            {selectedProduct.cycle_time_sec && <span>Cycle: {selectedProduct.cycle_time_sec}s</span>}
            <span>NG target: {(selectedProduct.ng_target_ratio * 100).toFixed(0)}%</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Line *</Label>
          <Select value={lineId} onValueChange={(v) => { setLineId(v); setSelectedStations(new Set()); }} disabled={isEdit}>
            <SelectTrigger><SelectValue placeholder="Line" /></SelectTrigger>
            <SelectContent>
              {lines.map((l) => (<SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Planned Qty *</Label>
          <Input type="number" min="1" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
        </div>
      </div>

      {lineId && (
        <div>
          <Label className="flex items-center gap-2">
            Stations * ({selectedStations.size}/{stationOptions.length})
          </Label>
          <div className="border rounded-md p-2 space-y-2 max-h-[150px] overflow-y-auto bg-muted/30">
            {stationOptions.length === 0 ? (
              <span className="text-[10px] text-muted-foreground">No stations available</span>
            ) : (
              <>
                <div className="flex items-center gap-2 pb-1 border-b">
                  <input
                    type="checkbox"
                    id="select-all"
                    checked={selectedStations.size === stationOptions.length && stationOptions.length > 0}
                    onChange={toggleAllStations}
                    className="cursor-pointer"
                  />
                  <label htmlFor="select-all" className="text-xs font-medium cursor-pointer">
                    Select All
                  </label>
                </div>
                {stationOptions.map((s) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`station-${s.id}`}
                      checked={selectedStations.has(s.id)}
                      onChange={() => toggleStation(s.id)}
                      className="cursor-pointer"
                    />
                    <label htmlFor={`station-${s.id}`} className="text-xs cursor-pointer flex-1">
                      {s.name}
                    </label>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Planned Start *</Label>
          <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <Label>Planned End *</Label>
          <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>

      {isEdit && (
        <>
          <hr />
          <div className="text-sm font-semibold">Production Data (Editable)</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Actual Qty</Label>
              <Input type="number" min="0" value={actualQty} onChange={(e) => setActualQty(Number(e.target.value))} />
            </div>
            <div>
              <Label>NG Qty</Label>
              <Input type="number" min="0" value={ngQty} onChange={(e) => setNgQty(Number(e.target.value))} />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div>
              <Label>OTR %</Label>
              <Input type="number" min="0" max="100" step="0.1" value={otr} onChange={(e) => setOtr(e.target.value)} placeholder="0.0" />
            </div>
            <div>
              <Label>PER %</Label>
              <Input type="number" min="0" max="100" step="0.1" value={per} onChange={(e) => setPer(e.target.value)} placeholder="0.0" />
            </div>
            <div>
              <Label>QR %</Label>
              <Input type="number" min="0" max="100" step="0.1" value={qr} onChange={(e) => setQr(e.target.value)} placeholder="0.0" />
            </div>
            <div>
              <Label>OEE %</Label>
              <Input type="number" min="0" max="100" step="0.1" value={oee} onChange={(e) => setOee(e.target.value)} placeholder="0.0" />
            </div>
          </div>
        </>
      )}

      <div className="flex items-center gap-2 pt-2">
        <Button variant="outline" onClick={onDone} className="flex-1">Cancel</Button>
        {isEdit ? (
          <Button onClick={() => submit("draft")} className="flex-1 gap-1">
            Update
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => submit("draft")} className="flex-1">
              Save as Draft
            </Button>
            <Button onClick={() => submit("open")} className="flex-1 gap-1">
              <Send className="h-4 w-4" /> Open
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
