"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Building2, Loader2, ShieldCheck, User, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function LoginForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) { setError("Enter username and password"); return; }
    setLoading(true); setError("");
    const res = await signIn("credentials", { username, password, redirect: false });
    setLoading(false);
    if (res?.error) { setError("Invalid username or password"); toast.error("Login failed"); }
    else toast.success("Signed in");
  }

  async function onSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) { setError("Enter username and password"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/auth/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, displayName: displayName || username, orgName: orgName || undefined }),
      });
      const d = await r.json();
      if (d.ok) {
        // auto sign in after registration
        const res = await signIn("credentials", { username, password, redirect: false });
        setLoading(false);
        if (res?.error) {
          setError("Account created but login failed — try signing in.");
          setMode("signin");
        } else {
          toast.success("Account created — welcome!");
        }
      } else {
        setLoading(false);
        setError(d.error ?? "Registration failed");
        toast.error(d.error ?? "Registration failed");
      }
    } catch {
      setLoading(false);
      setError("Registration failed");
    }
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

        <div className="bg-background border rounded-xl p-6 space-y-4 shadow-sm">
          <div className="flex rounded-md border overflow-hidden">
            <button onClick={() => { setMode("signin"); setError(""); }}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === "signin" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              Sign in
            </button>
            <button onClick={() => { setMode("signup"); setError(""); }}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === "signup" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              Sign up
            </button>
          </div>

          {mode === "signin" ? (
            <form onSubmit={onSignIn} className="space-y-4">
              <div className="space-y-1.5">
                <h1 className="text-lg font-semibold">Welcome back</h1>
                <p className="text-xs text-muted-foreground">Sign in to your RentPro account.</p>
              </div>
              <div>
                <Label htmlFor="username" className="text-xs">Username</Label>
                <div className="relative">
                  <User className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" className="pl-8" autoFocus />
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
          ) : (
            <form onSubmit={onSignUp} className="space-y-4">
              <div className="space-y-1.5">
                <h1 className="text-lg font-semibold flex items-center gap-2"><UserPlus className="size-5" /> Create account</h1>
                <p className="text-xs text-muted-foreground">New users get their own organization — your data stays yours.</p>
              </div>
              <div>
                <Label htmlFor="su-name" className="text-xs">Your name</Label>
                <Input id="su-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="John Doe" autoFocus />
              </div>
              <div>
                <Label htmlFor="su-org" className="text-xs">Organization name</Label>
                <Input id="su-org" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="John's Properties" />
              </div>
              <div>
                <Label htmlFor="su-username" className="text-xs">Username</Label>
                <div className="relative">
                  <User className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <Input id="su-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="johndoe" className="pl-8" />
                </div>
              </div>
              <div>
                <Label htmlFor="su-password" className="text-xs">Password (min 6 chars)</Label>
                <Input id="su-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </div>
              {error && <div className="text-xs text-rose-600 dark:text-rose-400">{error}</div>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <><Loader2 className="size-4 animate-spin" /> Creating…</> : "Create account"}
              </Button>
            </form>
          )}
        </div>

        {mode === "signin" && (
          <div className="mt-3 rounded-lg border bg-background p-3 text-center">
            <div className="text-[10px] text-muted-foreground">
              <ShieldCheck className="inline size-3 mr-1" />
              Owner login (default): <code className="px-1 py-0.5 rounded bg-muted">admin</code> / <code className="px-1 py-0.5 rounded bg-muted">admin123</code>
              <br />Change via <code className="px-1 py-0.5 rounded bg-muted">OWNER_USERNAME</code> / <code className="px-1 py-0.5 rounded bg-muted">OWNER_PASSWORD</code> in .env
            </div>
          </div>
        )}

        <div className="text-[10px] text-muted-foreground text-center mt-4 flex items-center justify-center gap-1">
          <Building2 className="size-3" /> RentPro · Multi-tenant SaaS · Next.js 16 + Prisma + Postgres
        </div>
      </div>
    </div>
  );
}
