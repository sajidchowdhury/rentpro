"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Building2, Loader2, ShieldCheck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const DEMO = [
  { username: "E1013", label: "Admin (E1013)", desc: "all 9 screens" },
  { username: "staff", label: "Data Entry (staff)", desc: "dashboard + collect + expenses + tenants" },
];

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) { setError("Enter username and password"); return; }
    setLoading(true); setError("");
    const res = await signIn("credentials", { username, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError("Invalid username or password");
      toast.error("Login failed");
    } else {
      toast.success("Signed in");
      // useSession will re-render the shell automatically
    }
  }

  async function quickDemo(u: string) {
    setUsername(u); setPassword("101010Sajid");
    setLoading(true); setError("");
    const res = await signIn("credentials", { username: u, password: "101010Sajid", redirect: false });
    setLoading(false);
    if (res?.error) { setError("Demo login failed"); toast.error("Login failed"); }
    else toast.success("Signed in");
  }

  return (
    <div className="min-h-screen grid place-items-center bg-muted/30 p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-6">
          <div className="size-10 rounded-xl bg-primary text-primary-foreground grid place-items-center font-bold text-lg">R</div>
          <div>
            <div className="font-bold text-lg leading-tight">RentPro</div>
            <div className="text-[11px] text-muted-foreground leading-tight">Property &amp; Rent Management</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="bg-background border rounded-xl p-6 space-y-4 shadow-sm">
          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold">Sign in</h1>
            <p className="text-xs text-muted-foreground">Use your RentPro account to continue.</p>
          </div>
          <div>
            <Label htmlFor="username" className="text-xs">Username</Label>
            <div className="relative">
              <User className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="E1013" className="pl-8" autoFocus />
            </div>
          </div>
          <div>
            <Label htmlFor="password" className="text-xs">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          {error && <div className="text-xs text-rose-600 dark:text-rose-400">{error}</div>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <><Loader2 className="size-4 animate-spin" /> Signing in…</> : "Sign in"}
          </Button>
        </form>

        <div className="mt-4 rounded-lg border bg-background p-3">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
            <ShieldCheck className="size-3" /> Quick demo login
          </div>
          <div className="space-y-2">
            {DEMO.map((d) => (
              <button key={d.username} type="button" onClick={() => quickDemo(d.username)} disabled={loading}
                className="w-full text-left rounded-md border px-3 py-2 hover:bg-muted/50 transition-colors disabled:opacity-50">
                <div className="text-sm font-medium">{d.label}</div>
                <div className="text-[11px] text-muted-foreground">{d.desc}</div>
              </button>
            ))}
          </div>
          <div className="text-[10px] text-muted-foreground mt-2">Password for all demo users: <code className="px-1 py-0.5 rounded bg-muted">101010Sajid</code></div>
        </div>

        <div className="text-[10px] text-muted-foreground text-center mt-4 flex items-center justify-center gap-1">
          <Building2 className="size-3" /> RentPro · Multi-tenant SaaS · Next.js 16 + Prisma + Postgres
        </div>
      </div>
    </div>
  );
}
