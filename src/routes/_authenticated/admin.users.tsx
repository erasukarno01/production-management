import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { db } from "@/integrations/local-db/client";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ROLES = ["admin", "supervisor", "operator", "viewer"] as const;

export const Route = createFileRoute("/_authenticated/admin/users")({
  ssr: false,
  component: UsersPage,
});

function UsersPage() {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [roles, setRoles] = useState<Record<string, string[]>>({});

  const load = async () => {
    const { data: p } = await db.from("profiles").select("*");
    setProfiles(p ?? []);
    const { data: r } = await db.from("user_roles").select("*");
    const grouped: Record<string, string[]> = {};
    (r ?? []).forEach((row: any) => {
      grouped[row.user_id] = [...(grouped[row.user_id] ?? []), row.role];
    });
    setRoles(grouped);
  };
  useEffect(() => { load(); }, []);

  const setUserRole = async (userId: string, role: string) => {
    // remove existing roles, set single role
    await db.from("user_roles").delete().eq("user_id", userId);
    const { error } = await db.from("user_roles").insert({ user_id: userId, role: role as any });
    if (error) return toast.error(error.message);
    toast.success("Role updated");
    load();
  };

  return (
    <AppShell title="User Management">
      <Card>
        <CardHeader><CardTitle className="text-base">Users & Roles</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {profiles.map((u) => {
              const userRoles = roles[u.id] ?? [];
              const primary = userRoles[0] ?? "viewer";
              return (
                <div key={u.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <div>
                    <div className="font-medium">{u.full_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground font-mono">{u.id.slice(0, 8)}…</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {userRoles.map((r) => <Badge key={r} variant="outline" className="capitalize">{r}</Badge>)}
                    <Select value={primary} onValueChange={(v) => setUserRole(u.id, v)}>
                      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
            {profiles.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">No users yet.</div>}
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
