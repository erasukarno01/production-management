import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { AlertTriangle, ChevronLeft, ClipboardList, Gauge, LayoutDashboard, LogOut, Monitor, Moon, Package, Settings, ShieldCheck, Sun, TimerOff, Waves, Users, Cog, Radio } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { db } from "@/integrations/local-db/client";
import { useAuth } from "@/lib/auth";
import { useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/alerts", label: "Alerts", icon: AlertTriangle },
  { to: "/downtime", label: "Downtime", icon: TimerOff },
  { to: "/tv", label: "TV Display", icon: Monitor },
];
const ADMIN_NAV = [
  { to: "/admin/structure", label: "Structure", icon: Cog },
  { to: "/admin/products", label: "Products", icon: Package },
  { to: "/admin/work-orders", label: "Work Orders", icon: ClipboardList },
  { to: "/admin/edge-nodes", label: "Edge Nodes", icon: Radio },
  { to: "/admin/users", label: "Users", icon: Users },
];

export function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  const { user, isAdmin, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [alertCount, setAlertCount] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const toggleSidebar = () => setCollapsed((c) => !c);

  useEffect(() => {
    const load = async () => {
      try {
        const { count } = await db.from("alerts").select("id", { count: "exact", head: true }).is("acknowledged_at", null);
        setAlertCount(count ?? 0);
      } catch (_) { /* alerts count not critical */ }
    };
    load();
    const ch = db.channel("alerts-count")
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, load)
      .subscribe();
    return () => { db.removeChannel(ch); };
  }, []);

  const handleSignOut = async () => {
    await signOut();
    router.navigate({ to: "/auth", replace: true });
  };

  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex min-h-screen w-full bg-background">
        <aside className={cn("hidden md:flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 ease-in-out overflow-hidden sticky top-0 h-screen", collapsed ? "w-16" : "w-[9.75rem]")}>
          <button
            type="button"
            onClick={toggleSidebar}
            className={cn("flex items-center gap-2 border-b border-sidebar-border hover:bg-sidebar-accent/50 transition-colors text-left w-full",
              collapsed ? "justify-center px-3 py-5" : "px-3 py-5"
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <img src="/logo.svg" alt="Chao Long India" className="h-8 w-8 shrink-0 object-contain" />
            <div className={cn(
              "flex-1 min-w-0 overflow-hidden transition-all duration-300 ease-in-out",
              collapsed ? "max-w-0 opacity-0" : "max-w-[8rem] opacity-100"
            )}>
              <div className="text-sm font-bold leading-tight whitespace-nowrap truncate">Chao Long India</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap truncate">OEE System</div>
            </div>
            <div className={cn(
              "text-sidebar-foreground/60 transition-all duration-300 ease-in-out overflow-hidden",
              collapsed ? "max-w-0 opacity-0" : "max-w-[1rem] opacity-100"
            )}>
              <ChevronLeft className="h-4 w-4 shrink-0" />
            </div>
          </button>
          <nav className="flex-1 px-2 py-4 space-y-1">
            {NAV.map((item) => {
              const active = pathname.startsWith(item.to);
              return (
                <NavItem key={item.to} item={item} active={active} collapsed={collapsed}>
                  {item.to === "/alerts" && alertCount > 0 && (
                    <span className={cn(
                      "rounded-full bg-danger px-1.5 text-[10px] font-semibold text-danger-foreground transition-all duration-300 ease-in-out overflow-hidden whitespace-nowrap",
                      collapsed ? "max-w-0 opacity-0" : "max-w-[2rem] opacity-100"
                    )}>
                      {alertCount}
                    </span>
                  )}
                </NavItem>
              );
            })}
            {isAdmin && (
              <div className={cn(
                "pt-4 pb-1 flex items-center gap-1 transition-all duration-300 ease-in-out overflow-hidden",
                collapsed ? "justify-center" : "px-2"
              )}>
                <ShieldCheck className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className={cn(
                  "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-all duration-300 ease-in-out overflow-hidden whitespace-nowrap",
                  collapsed ? "max-w-0 opacity-0" : "max-w-[8rem] opacity-100"
                )}>
                  Admin
                </span>
              </div>
            )}
            {isAdmin && ADMIN_NAV.map((item) => {
              const active = pathname.startsWith(item.to);
              return <NavItem key={item.to} item={item} active={active} collapsed={collapsed} />;
            })}
          </nav>
          <div className="border-t border-sidebar-border py-3 px-3 text-xs text-muted-foreground transition-all duration-300 ease-in-out overflow-hidden text-center">
            <div className={cn(
              "truncate transition-all duration-300 ease-in-out overflow-hidden whitespace-nowrap text-left",
              collapsed ? "max-w-0 opacity-0" : "max-w-[8rem] opacity-100"
            )}>
              {user?.email}
            </div>
            <div className={cn(
              "h-2 w-2 rounded-full bg-success mx-auto transition-all duration-300 ease-in-out",
              collapsed ? "opacity-100 max-w-[0.5rem]" : "max-w-0 opacity-0"
            )} title={user?.email} />
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/80 px-4 backdrop-blur md:px-6">
            <h1 className="text-base md:text-lg font-semibold truncate">{title ?? "Dashboard"}</h1>
            <div className="flex items-center gap-2">
              <ThemeSwitcher theme={theme} setTheme={setTheme} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2">
                    <span className="hidden sm:inline">{user?.email?.split("@")[0]}</span>
                    <Settings className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} className="text-danger">
                    <LogOut className="h-4 w-4 mr-2" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}

function NavItem({ item, active, collapsed, children }: { item: { to: string; label: string; icon: typeof Gauge }; active: boolean; collapsed: boolean; children?: ReactNode }) {
  const Icon = item.icon;
  const link = (
    <Link to={item.to}
      className={cn("flex items-center rounded-md px-3 py-2 text-sm transition-colors",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60",
        collapsed ? "justify-center" : "justify-between gap-2"
      )}>
      <span className={cn("flex items-center transition-all duration-300 ease-in-out", collapsed ? "gap-0" : "gap-2")}>
        <Icon className="h-4 w-4 shrink-0" />
        <span className={cn(
          "truncate transition-all duration-300 ease-in-out overflow-hidden whitespace-nowrap",
          collapsed ? "max-w-0 opacity-0" : "max-w-[8rem] opacity-100"
        )}>
          {item.label}
        </span>
      </span>
      <span className={cn(
        "transition-all duration-300 ease-in-out overflow-hidden",
        collapsed ? "max-w-0 opacity-0" : "max-w-[2rem] opacity-100"
      )}>
        {children}
      </span>
    </Link>
  );
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  }
  return link;
}


function ThemeSwitcher({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const options: { value: Theme; icon: typeof Sun; label: string }[] = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
    { value: "blue", icon: Waves, label: "Blue" },
  ];
  return (
    <div className="hidden sm:flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5">
      {options.map((o) => {
        const Icon = o.icon;
        const active = theme === o.value;
        return (
          <button key={o.value} onClick={() => setTheme(o.value)}
            className={cn("flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            title={o.label}>
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
