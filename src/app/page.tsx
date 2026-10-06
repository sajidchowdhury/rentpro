"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";
import { LayoutDashboard, Zap, Users, Building2, Receipt, BarChart3, Database, TrendingUp, Wallet, DoorOpen, Globe, ShieldCheck, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DashboardView } from "@/components/rentpro/dashboard";
import { GenerateRentView } from "@/components/rentpro/generate-rent";
import { CollectRentView } from "@/components/rentpro/collect-rent";
import { ExpensesView } from "@/components/rentpro/expenses";
import { VacateView } from "@/components/rentpro/vacate";
import { PropertiesView } from "@/components/rentpro/properties";
import { TenantsView } from "@/components/rentpro/tenants";
import { ReportsView } from "@/components/rentpro/reports";
import { PlatformView } from "@/components/rentpro/platform";
import { LoginForm } from "@/components/rentpro/login-form";
import { getAllowedViews, ROLE_LABEL, type Role, type ViewId } from "@/lib/rbac";
import { toast } from "sonner";

type View = ViewId;

interface MonthOpt { year: string; month: string }

interface OrgSummary {
  id: string; name: string; shortName: string | null; plan: "TRIAL" | "ACTIVE" | "EXPIRED";
  isOwner: boolean; currency: string; defaultLocale: "bn" | "en";
}

interface DashboardData {
  month: string; year: string; generated: boolean;
  totalToCollect: number; expectedLeaseCount: number;
  collectedAmount: number; paidLeaseCount: number;
  pendingAmount: number; dueLeaseCount: number;
  vacantUnitCount: number; occupiedUnitCount: number;
  totalUnits: number; totalProperties: number;
  incomeThisMonth: number; expenseThisMonth: number;
  dueLeases: Array<{ leaseId: number; tenantName: string; unitName: string; propertyName: string; mobile: string | null; rent: number; monthsMissed: number }>;
  vacantUnits: Array<{ unitId: number; unitName: string; propertyName: string }>;
  recentCollections: Array<{ id: number; tenantName: string; unitName: string; propertyName: string; rent: number; rentMonth: string; rentYear: string; receiveDate: string | null; status: string }>;
  trend: Array<{ label: string; amount: number }>;
  expenseDue: {
    count: number; predictedTotal: number;
    types: Array<{ headId: number; name: string; missingCount: number; predictedAmount: number; lastRecorded: string | null }>;
  };
}
interface GenerateData {
  month: string; year: string; generated: boolean;
  rows: Array<{ leaseId: number; tenantName: string; unitName: string; propertyName: string; mobile: string | null; rent: number; gasBill: number; serviceCharge: number; otherBill: number; total: number; status: "PAID" | "DUE" | "PARTIAL" }>;
  toGenerateCount: number; alreadyCollectedCount: number; totalToCollect: number; alreadyCollectedAmount: number;
}

const NAV: { id: View; label: string; labelBn: string; icon: any; active: boolean }[] = [
  { id: "dashboard", label: "Dashboard", labelBn: "ড্যাশবোর্ড", icon: LayoutDashboard, active: true },
  { id: "generate", label: "Generate Rent", labelBn: "ভাড়া জেনারেট", icon: Zap, active: true },
  { id: "collect", label: "Collect Rent", labelBn: "কালেকশন", icon: Wallet, active: true },
  { id: "expenses", label: "Expenses", labelBn: "খরচ", icon: Receipt, active: true },
  { id: "vacate", label: "Vacate & Settle", labelBn: "ভাড়া ছাড়", icon: DoorOpen, active: true },
  { id: "properties", label: "Properties", labelBn: "ভবন", icon: Building2, active: true },
  { id: "tenants", label: "Tenants", labelBn: "ভাড়াটিয়া", icon: Users, active: true },
  { id: "reports", label: "Reports", labelBn: "রিপোর্ট", icon: BarChart3, active: true },
  { id: "platform", label: "Platform", labelBn: "প্ল্যাটফর্ম", icon: Globe, active: true },
];
const NAV_DISABLED: { label: string; labelBn: string; icon: any }[] = [];

export default function RentProPage() {
  const [months, setMonths] = useState<MonthOpt[]>([]);
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [view, setView] = useState<View>("dashboard");
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [gen, setGen] = useState<GenerateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [collectTenantId, setCollectTenantId] = useState<number | null>(null);
  const [activeOrg, setActiveOrg] = useState<OrgSummary | null>(null);
  const [ownsData, setOwnsData] = useState(true);
  const [dataSource, setDataSource] = useState<"real" | "demo">("real");
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);

  // load available months
  useEffect(() => {
    fetch("/api/months")
      .then((r) => r.json())
      .then((d) => {
        const ms: MonthOpt[] = d.months ?? [];
        setMonths(ms);
        if (ms.length > 0) {
          setMonth(ms[0].month);
          setYear(ms[0].year);
        }
      })
      .catch(() => toast.error("Failed to load months"));
  }, []);

  // F9: load the active org + the org list (for the header switcher)
  const refreshOrg = useCallback(async () => {
    try {
      const [a, l] = await Promise.all([
        fetch("/api/organization").then((r) => r.json()),
        fetch("/api/organizations").then((r) => r.json()),
      ]);
      setActiveOrg(a.organization ?? null);
      setOwnsData(a.ownsData ?? true);
      setDataSource(a.dataSource ?? "real");
      setOrgs(l.organizations ?? []);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { refreshOrg(); }, [refreshOrg]);

  const switchOrg = useCallback(async (id: string) => {
    try {
      await fetch("/api/organization/activate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setDash(null); setGen(null); // force refetch of data views
      setView("dashboard");
      await refreshOrg();
      toast.success("Switched organization");
    } catch { toast.error("Failed to switch org"); }
  }, [refreshOrg]);

  // fetch view data when month/year/view change
  const refresh = useCallback(async () => {
    if (!month || !year) return;
    // Collect, Expenses, Vacate, Properties, Tenants, Reports & Platform views
    // manage their own data fetching.
    if (view === "collect" || view === "expenses" || view === "vacate" || view === "properties" || view === "tenants" || view === "reports" || view === "platform") {
      setLoading(false);
      return;
    }
    // Data isolation (F9): if the active org doesn't own the loaded data,
    // don't fetch dashboard/generate data — the shell shows an empty-org state.
    if (!ownsData) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      if (view === "dashboard") {
        const r = await fetch(`/api/dashboard?month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`);
        const d = await r.json();
        setDash(d as DashboardData);
      } else {
        const r = await fetch(`/api/generate-rent?month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`);
        const d = await r.json();
        setGen(d as GenerateData);
      }
    } catch {
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [month, year, view, ownsData]);

  useEffect(() => { refresh(); }, [refresh]);

  const onGenerate = async () => {
    setGenerating(true);
    try {
      const r = await fetch(`/api/generate-rent?month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`, { method: "POST" });
      const d = await r.json();
      if (d.ok) {
        toast.success(d.message);
        setGen(d.preview as GenerateData);
      } else {
        toast.error(d.error ?? "Generation failed");
      }
    } catch {
      toast.error("Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const monthKey = (m: MonthOpt) => `${m.year}-${m.month}`;

  // ── Point 2: auth gate + role-based nav ──────────────────────────────
  const { data: session, status } = useSession();
  const role = (session?.user as any)?.role as Role | undefined;
  const allowedViews = getAllowedViews(role);

  // if the current view isn't allowed for this role, fall back to dashboard
  useEffect(() => {
    if (session && !allowedViews.includes(view)) setView("dashboard");
  }, [session, allowedViews, view]);

  const visibleNav = NAV.filter((n) => allowedViews.includes(n.id));

  if (status === "loading") {
    return (
      <div className="min-h-screen grid place-items-center bg-muted/30">
        <div className="size-8 rounded-full border-2 border-muted-foreground/30 border-t-primary animate-spin" />
      </div>
    );
  }
  if (!session) return <LoginForm />;

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      <div className="flex flex-1">
        {/* Sidebar (md+) */}
        <aside className="hidden md:flex w-60 shrink-0 flex-col border-r bg-background">
          <div className="flex items-center gap-2 px-5 h-16 border-b">
            <div className="size-8 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold">{(activeOrg?.name ?? "RentPro").slice(0, 1)}</div>
            <div className="min-w-0">
              <div className="font-semibold leading-tight truncate">{activeOrg?.name ?? "RentPro"}</div>
              <div className="text-[10px] text-muted-foreground leading-tight">{activeOrg ? (activeOrg.isOwner ? "Owner org" : activeOrg.plan === "TRIAL" ? "Trial client" : "Client") : "Property & Rent Mgmt"}</div>
            </div>
          </div>
          <nav className="flex-1 p-3 space-y-1">
            {visibleNav.map((n) => (
              <button
                key={n.id}
                onClick={() => setView(n.id)}
                className={cn(
                  "w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors text-left",
                  view === n.id ? "bg-primary text-primary-foreground" : "hover:bg-accent text-foreground"
                )}
              >
                <n.icon className="size-4" />
                <span className="flex-1">{n.label}</span>
                <span className={cn("text-[10px]", view === n.id ? "text-primary-foreground/70" : "text-muted-foreground")}>{n.labelBn}</span>
              </button>
            ))}
          </nav>
          <div className="p-3 border-t space-y-2">
            <div className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2">
              <div className="size-7 rounded-full bg-primary text-primary-foreground grid place-items-center text-[10px] font-semibold shrink-0">
                {(session.user?.name ?? "U").slice(0, 1)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{session.user?.name ?? "User"}</div>
                <div className="text-[10px] text-muted-foreground">{ROLE_LABEL[role ?? "TENANT"]}</div>
              </div>
              <Button size="icon" variant="ghost" className="size-7" onClick={() => signOut()} title="Sign out">
                <LogOut className="size-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
              <Database className="size-3.5 shrink-0" />
              <span>Live: real dump data</span>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
            <div className="flex flex-wrap items-center gap-3 px-4 md:px-6 h-16">
              {/* mobile brand */}
              <div className="md:hidden flex items-center gap-2 font-semibold">
                <div className="size-7 rounded-md bg-primary text-primary-foreground grid place-items-center text-sm font-bold">R</div>
                RentPro
              </div>
              {/* mobile view tabs */}
              <div className="md:hidden flex gap-1">
                {visibleNav.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => setView(n.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-xs font-medium",
                      view === n.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {n.label}
                  </button>
                ))}
              </div>

              <div className="flex-1" />

              <div className="flex items-center gap-2">
                {/* F9 org switcher */}
                {orgs.length > 0 && (
                  <Select value={activeOrg?.id ?? ""} onValueChange={(v) => switchOrg(v)}>
                    <SelectTrigger className="w-[170px] h-9 gap-1">
                      <Globe className="size-3.5 text-muted-foreground" />
                      <SelectValue placeholder="Organization" />
                    </SelectTrigger>
                    <SelectContent>
                      {orgs.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          <span className="flex items-center gap-2">
                            {o.isOwner && <ShieldCheck className="size-3 text-emerald-500" />}
                            {o.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <span className="hidden sm:inline text-xs text-muted-foreground">Period</span>
                <Select value={monthKey({ year, month })} onValueChange={(v) => {
                  const m = months.find((x) => monthKey(x) === v);
                  if (m) { setMonth(m.month); setYear(m.year); }
                }}>
                  <SelectTrigger className="w-[160px] h-9">
                    <SelectValue placeholder="Select month" />
                  </SelectTrigger>
                  <SelectContent>
                    {months.map((m) => (
                      <SelectItem key={monthKey(m)} value={monthKey(m)}>
                        {m.month} {m.year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </header>

          {/* Content */}
          <div className="flex-1 p-4 md:p-6">
            {/* demo-data banner */}
            {dataSource === "demo" && view !== "platform" && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                <Database className="size-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Showing DEMO data.</span> No legacy dump was found, so the app
                  seeded a small demo dataset so you can log in and explore. To see your <span className="font-medium">real</span> data,
                  mount your dump — set <code className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900">LEGACY_SQL_PATH</code> to its path
                  (and for Docker: put it in <code className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900">./data/</code> + <code className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900">docker compose up -d</code>).
                </div>
              </div>
            )}
            {/* F9: platform admin view always available (super-admin) */}
            {view === "platform" ? (
              <PlatformView onChanged={refreshOrg} onSwitchOrg={switchOrg} />
            ) : !ownsData && view !== "platform" ? (
              /* Data isolation — this org has no data loaded */
              <div className="h-[32rem] grid place-items-center text-center">
                <div className="max-w-md">
                  <Globe className="size-12 text-muted-foreground/40 mx-auto mb-3" />
                  <div className="text-lg font-semibold">{activeOrg?.name ?? "This organization"}</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    This client organization has no data yet. Their properties, tenants &amp; collections
                    are isolated from the owner org — you can&apos;t see the owner&apos;s data here.
                  </div>
                  <div className="text-xs text-muted-foreground mt-3">
                    💡 In production, each org&apos;s data lives in its own Postgres rows (scoped by <code className="px-1 py-0.5 rounded bg-muted">organization_id</code>).
                    For this prototype, only the owner org has the migrated dump data.
                  </div>
                  <div className="flex gap-2 justify-center mt-4">
                    <Button variant="outline" onClick={() => switchOrg("org_1")}>
                      <ShieldCheck className="size-4" /> Switch to owner org
                    </Button>
                    <Button variant="outline" onClick={() => setView("platform")}>
                      <Globe className="size-4" /> Manage orgs
                    </Button>
                  </div>
                </div>
              </div>
            ) : loading ? (
              <div className="space-y-4">
                <Skeleton className="h-9 w-64" />
                <div className="grid gap-4 md:grid-cols-4">
                  {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
                </div>
                <Skeleton className="h-72 rounded-xl" />
              </div>
            ) : view === "dashboard" && dash ? (
              <DashboardView data={dash} onGoToExpenses={() => setView("expenses")} />
            ) : view === "generate" && gen ? (
              <GenerateRentView data={gen} onGenerate={onGenerate} generating={generating} />
            ) : view === "collect" ? (
              <CollectRentView month={month} year={year} initialTenantId={collectTenantId} />
            ) : view === "expenses" ? (
              <ExpensesView month={month} year={year} />
            ) : view === "vacate" ? (
              <VacateView month={month} year={year} />
            ) : view === "properties" ? (
              <PropertiesView />
            ) : view === "tenants" ? (
              <TenantsView month={month} year={year} onCollect={(tid) => { setCollectTenantId(tid); setView("collect"); }} />
            ) : view === "reports" ? (
              <ReportsView month={month} year={year} />
            ) : (
              <div className="text-muted-foreground">No data.</div>
            )}
          </div>
        </main>
      </div>

      {/* Sticky footer */}
      <footer className="border-t bg-background">
        <div className="px-4 md:px-6 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-3.5" />
            <span>RentPro prototype — powered by your real <span className="font-medium text-foreground">osudlagb_home_rent</span> data (3,651 rows, parsed in-memory).</span>
          </div>
          <div>Multi-tenant SaaS ready · Next.js 16 + Prisma + Postgres</div>
        </div>
      </footer>
    </div>
  );
}
