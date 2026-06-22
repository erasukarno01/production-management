import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Factory, Loader2, ShieldCheck, Cpu } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/local-db/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in — Chao Long India | INCL OEE System" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    db.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  const signIn = async () => {
    setLoading(true);
    const { error } = await db.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Signed in successfully");
    navigate({ to: "/dashboard", replace: true });
  };

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-slate-900 via-slate-800 to-red-950">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-[55%] relative overflow-hidden">
        <div className="absolute inset-0 bg-red-600/10" />
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-red-600/5 blur-3xl" />
        <div className="absolute -bottom-20 -right-20 w-[400px] h-[400px] rounded-full bg-red-500/10 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M30 0L60 30L30 60L0 30Z' fill='none' stroke='%23ffffff' stroke-width='0.5'/%3E%3C/svg%3E")`,
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative z-10 flex flex-col justify-center px-12 xl:px-20 w-full">
          <div className="mb-10">
            <img src="/logo.svg" alt="Chao Long India" className="h-20 w-auto mb-6 drop-shadow-lg" />
            <h1 className="text-4xl xl:text-5xl font-bold text-white tracking-tight leading-tight">
              Chao Long India
            </h1>
            <div className="flex items-center gap-3 mt-3">
              <Cpu className="h-5 w-5 text-red-400" />
              <p className="text-lg text-slate-300 font-medium">
                INCL Production OEE System
              </p>
            </div>
            <p className="mt-4 text-sm text-slate-400 max-w-md leading-relaxed">
              Real-time Overall Equipment Effectiveness monitoring for automotive component assembly lines.
              SMT &bull; Sub Assy &bull; Final Assy
            </p>
          </div>
          <div className="space-y-4 mt-8">
            <div className="flex items-center gap-3 text-slate-300">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-red-600/20">
                <Factory className="h-4 w-4 text-red-400" />
              </div>
              <span className="text-sm">18 production stations across 6 lines</span>
            </div>
            <div className="flex items-center gap-3 text-slate-300">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-red-600/20">
                <ShieldCheck className="h-4 w-4 text-red-400" />
              </div>
              <span className="text-sm">Real-time OEE tracking & alerts</span>
            </div>
          </div>
        </div>
      </div>
      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-[420px]">
          <div className="lg:hidden mb-8 text-center">
            <img src="/logo.svg" alt="Chao Long India" className="h-16 w-auto mx-auto mb-3" />
            <h2 className="text-xl font-bold text-white">Chao Long India</h2>
            <p className="text-sm text-slate-400">INCL OEE System</p>
          </div>
          <Card className="border-slate-700/60 bg-slate-800/80 backdrop-blur-xl shadow-2xl shadow-red-950/20">
            <CardHeader className="pb-4">
              <CardTitle className="text-2xl text-white">Sign In</CardTitle>
              <CardDescription className="text-slate-400">
                Enter your credentials to access the dashboard
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => { e.preventDefault(); signIn(); }} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-slate-300">Email</Label>
                  <Input
                    id="email" type="email" placeholder="operator@chaolong.com"
                    value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
                    className="bg-slate-900/60 border-slate-600 text-white placeholder:text-slate-500 focus:border-red-500 h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-slate-300">Password</Label>
                  <Input
                    id="password" type="password" placeholder="••••••••"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    className="bg-slate-900/60 border-slate-600 text-white placeholder:text-slate-500 focus:border-red-500 h-11"
                  />
                </div>
                <Button type="submit"
                  className="w-full h-11 bg-red-600 hover:bg-red-500 text-white font-semibold shadow-lg shadow-red-600/25 hover:shadow-red-500/30"
                  disabled={loading}>
                  {loading ? (
                    <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Authenticating...</span>
                  ) : "Sign In"}
                </Button>
              </form>
              <div className="mt-6 pt-4 border-t border-slate-700/50">
                <p className="text-xs text-center text-slate-500">
                  &copy; 2026 Chao Long India Pvt Ltd. All rights reserved.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
