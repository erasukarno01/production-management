import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Plus, Pencil, Trash2, Search, Shield, User as UserIcon, RefreshCw } from "lucide-react";
import { db } from "@/integrations/local-db/client";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/users")({
  ssr: false,
  component: UsersPage,
});

const ROLES = ["admin", "supervisor", "operator", "viewer"] as const;

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-red-500/15 text-red-400 border-red-500/30",
  supervisor: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  operator: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  viewer: "bg-gray-500/15 text-gray-400 border-gray-500/30",
};

const LOCAL_API_URL = typeof window !== "undefined" ? window.location.origin : `http://localhost:${import.meta.env.VITE_API_PORT || "5907"}`;

async function apiFetch(path: string, options?: RequestInit) {
  const stored = typeof window !== "undefined" ? localStorage.getItem("oauth_session") : null;
  const token = stored ? JSON.parse(stored).access_token : null;
  const res = await fetch(`${LOCAL_API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options?.headers },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || json.error || "Request failed");
  return json;
}

function UsersPage() {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [roles, setRoles] = useState<Record<string, string[]>>({});
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);

  // Form state
  const [formEmail, setFormEmail] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formName, setFormName] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formLineId, setFormLineId] = useState("__none__");
  const [formRoles, setFormRoles] = useState<Set<string>>(new Set());
  const [resetPwd, setResetPwd] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const results = await Promise.all([
        db.from("profiles").select("*"),
        db.from("user_roles").select("*"),
        db.from("lines").select("*").order("name"),
      ]);
      setProfiles(results[0].data ?? []);
      const grouped: Record<string, string[]> = {};
      (results[1].data ?? []).forEach((row: any) => {
        grouped[row.user_id] = [...(grouped[row.user_id] ?? []), row.role];
      });
      setRoles(grouped);
      setLines(results[2].data ?? []);
    } catch (err: any) {
      console.error("load error:", err);
      toast.error("Failed to load users: " + (err.message || "Unknown error"));
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return profiles;
    const q = search.toLowerCase();
    return profiles.filter((u) => u.full_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.id?.toLowerCase().includes(q));
  }, [profiles, search]);

  const openCreate = () => {
    setEditingUser(null);
    setFormEmail("");
    setFormUsername("");
    setFormName("");
    setFormPassword("");
    setFormLineId("__none__");
    setFormRoles(new Set());
    setResetPwd(false);
    setShowPwd(false);
    setDialogOpen(true);
  };

  const openEdit = (user: any) => {
    setEditingUser(user);
    setFormEmail(user.email || "");
    setFormUsername(user.username || "");
    setFormName(user.full_name || "");
    setFormPassword("");
    setFormLineId(user.line_id || "__none__");
    setFormRoles(new Set(roles[user.id] ?? []));
    setResetPwd(false);
    setShowPwd(false);
    setDialogOpen(true);
  };

  const toggleRole = (role: string) => {
    setFormRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role); else next.add(role);
      return next;
    });
  };

  const submit = async () => {
    if (!formEmail) return toast.error("Email is required");
    if (formRoles.size === 0) return toast.error("Select at least one role");

    if (editingUser) {
      const body: any = { email: formEmail, fullName: formName, username: formUsername, roles: Array.from(formRoles), line_id: formLineId === "__none__" ? null : formLineId };
      if (resetPwd && formPassword) {
        if (formPassword.length < 4) return toast.error("Password must be at least 4 characters");
        body.password = formPassword;
      }
      try {
        await apiFetch(`/api/admin/users/${encodeURIComponent(editingUser.id)}`, {
          method: "PUT", body: JSON.stringify(body),
        });
        toast.success("User updated");
      } catch (err: any) {
        return toast.error(err.message);
      }
    } else {
      if (!formPassword) return toast.error("Password is required");
      if (formPassword.length < 4) return toast.error("Password must be at least 4 characters");
      try {
        await apiFetch("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({ email: formEmail, username: formUsername, password: formPassword, fullName: formName, roles: Array.from(formRoles), line_id: formLineId === "__none__" ? null : formLineId }),
        });
        toast.success("User created");
      } catch (err: any) {
        return toast.error(err.message);
      }
    }

    setDialogOpen(false);
    load();
  };

  const delUser = async (user: any) => {
    if (!confirm(`Delete user "${user.full_name || user.id}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
      toast.success("User deleted");
      load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const getLineName = (lineId: string) => lines.find((l) => l.id === lineId)?.name ?? "—";

  return (
    <AppShell title="User Management">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" /> User Management
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1", loading && "animate-spin")} /> Refresh
            </Button>
            <Dialog open={dialogOpen} onOpenChange={(v) => { if (!v) setEditingUser(null); setDialogOpen(v); }}>
              <DialogTrigger asChild>
                <Button size="sm" onClick={openCreate}><Plus className="h-3.5 w-3.5 mr-1" /> Add User</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <UserIcon className="h-4 w-4" /> {editingUser ? "Edit User" : "Create User"}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div>
                    <Label>Email *</Label>
                    <Input value={formEmail} onChange={(e) => setFormEmail(e.target.value)} disabled={!!editingUser} placeholder="user@example.com" />
                  </div>
                  <div>
                    <Label>Username</Label>
                    <Input value={formUsername} onChange={(e) => setFormUsername(e.target.value)} placeholder="Login username (optional)" />
                  </div>
                  <div>
                    <Label>Full Name</Label>
                    <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Full name" />
                  </div>
                    <div>
                      <Label>{editingUser ? "New Password" : "Password *"}</Label>
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Input
                            type={showPwd ? "text" : "password"}
                            value={formPassword}
                            onChange={(e) => setFormPassword(e.target.value)}
                            placeholder={editingUser ? "Leave empty to keep current" : "Min 4 characters"}
                            className="pr-10"
                          />
                          <button type="button" onClick={() => setShowPwd((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                            {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      {editingUser && (
                        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground whitespace-nowrap cursor-pointer">
                          <input type="checkbox" checked={resetPwd} onChange={(e) => setResetPwd(e.target.checked)} />
                          Reset
                        </label>
                      )}
                    </div>
                  </div>
                  <div>
                    <Label>Line</Label>
                    <Select value={formLineId} onValueChange={setFormLineId}>
                      <SelectTrigger><SelectValue placeholder="No line" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— No line —</SelectItem>
                        {lines.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Roles *</Label>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      {ROLES.map((role) => (
                        <label
                          key={role}
                          className={cn(
                            "flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer text-xs font-medium transition-colors",
                            formRoles.has(role)
                              ? ROLE_COLORS[role]
                              : "border-muted text-muted-foreground hover:border-foreground/30",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={formRoles.has(role)}
                            onChange={() => toggleRole(role)}
                            className="cursor-pointer"
                          />
                          {role}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    <Button variant="outline" onClick={() => { setDialogOpen(false); setEditingUser(null); }} className="flex-1">Cancel</Button>
                    <Button onClick={submit} className="flex-1">{editingUser ? "Update" : "Create"}</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="px-4 pb-3">
            <div className="relative w-64">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search users..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
            </div>
          </div>
          <div className="rounded-md border mx-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8 text-[11px] font-semibold uppercase">Name</TableHead>
                  <TableHead className="h-8 text-[11px] font-semibold uppercase">Username</TableHead>
                  <TableHead className="h-8 text-[11px] font-semibold uppercase">Email</TableHead>
                  <TableHead className="h-8 text-[11px] font-semibold uppercase">Roles</TableHead>
                  <TableHead className="h-8 text-[11px] font-semibold uppercase">Line</TableHead>
                  <TableHead className="h-8 text-[11px] font-semibold uppercase w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-xs">Loading...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                      <UserIcon className="h-6 w-6 opacity-30 mx-auto mb-2" />
                      <span className="text-xs">{search ? "No users match your search." : "No users yet."}</span>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((u) => {
                    const userRoles = roles[u.id] ?? [];
                    return (
                      <TableRow key={u.id} className="h-10">
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center">
                              <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                                {(u.full_name || u.id).slice(0, 2)}
                              </span>
                            </div>
                            <span className="text-sm font-medium">{u.full_name || "—"}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground font-mono">{u.username || "—"}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground font-mono">{u.email || u.id}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {userRoles.length === 0 ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              userRoles.map((r) => (
                                <Badge key={r} className={cn("text-[10px] font-medium px-1.5 py-0 border", ROLE_COLORS[r])}>
                                  {r}
                                </Badge>
                              ))
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs">{u.line_id ? getLineName(u.line_id) : "—"}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); openEdit(u); }} title="Edit">
                              <Pencil className="h-3.5 w-3.5 text-blue-400" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); delUser(u); }} title="Delete">
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}