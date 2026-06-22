import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { db } from "@/integrations/local-db/client";

export type Role = "admin" | "supervisor" | "operator" | "viewer";

type LocalUser = { id: string; email?: string; roles?: Role[] };

type AuthCtx = {
  user: LocalUser | null;
  roles: Role[];
  loading: boolean;
  isAdmin: boolean;
  isSupervisor: boolean;
  isOperator: boolean;
  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null, roles: [], loading: true,
  isAdmin: false, isSupervisor: false, isOperator: false,
  signOut: async () => {}, refreshRoles: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRoles = async (uid: string | undefined, fallbackRoles?: Role[]) => {
    if (!uid) { setRoles([]); return; }
    const { data } = await db.from("user_roles").select("role").eq("user_id", uid);
    const loaded = ((data ?? []).map((r: any) => r.role as Role));
    setRoles(loaded.length > 0 ? loaded : (fallbackRoles ?? []));
  };

  useEffect(() => {
    let mounted = true;
    db.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setUser(data.user);
      loadRoles(data.user?.id, data.user?.roles as Role[] | undefined).finally(() => setLoading(false));
    });
    const { data: sub } = db.auth.onAuthStateChange((_event: any, session: any) => {
      setUser(session?.user ?? null);
      loadRoles(session?.user?.id, (session?.user as any)?.roles as Role[] | undefined);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  const value: AuthCtx = {
    user, roles, loading,
    isAdmin: roles.includes("admin"),
    isSupervisor: roles.includes("supervisor") || roles.includes("admin"),
    isOperator: roles.includes("operator") || roles.includes("admin"),
    signOut: async () => { await db.auth.signOut(); },
    refreshRoles: async () => loadRoles(user?.id),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
