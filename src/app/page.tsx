"use client";

import { useEffect, useState, useCallback } from "react";
import { LayoutDashboard, Zap, Users, Building2, Receipt, BarChart3, Database, TrendingUp, Wallet, DoorOpen } from "lucide-react";
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
import { toast } from "sonner";

type View = "dashboard" | "generate" | "collect" | "expenses" | "vacate" | "properties";

interface MonthOpt { year: string; month: string }

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
];
const NAV_DISABLED = [
  { label: "Tenants", labelBn: "ভাড়াটিয়া", icon: Users },
  { label: "Reports", labelBn: "রিপোর্ট", icon: BarChart3 },
];

export default function RentProPage() {
  const [months, setMonths] = useState<MonthOpt[]>([]);
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [view, setView] = useState<View>("dashboard");
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [gen, setGen] = useState<GenerateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

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

  // fetch view data when month/year/view change
  const refresh = useCallback(async () => {
    if (!month || !year) return;
    // Collect, Expenses, Vacate & Properties views manage their own data fetching.
    if (view === "collect" || view === "expenses" || view === "vacate" || view === "properties") {
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
  }, [month, year, view]);

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

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      <div className="flex flex-1">
        {/* Sidebar (md+) */}
        <aside className="hidden md:flex w-60 shrink-0 flex-col border-r bg-background">
          <div className="flex items-center gap-2 px-5 h-16 border-b">
            <div className="size-8 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold">R</div>
            <div>
              <div className="font-semibold leading-tight">RentPro</div>
              <div className="text-[10px] text-muted-foreground leading-tight">Property & Rent Mgmt</div>
            </div>
          </div>
          <nav className="flex-1 p-3 space-y-1">
            {NAV.map((n) => (
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
            <div className="pt-4 pb-1 px-3 text-[10px] uppercase tracking-wider text-muted-foreground">Coming soon</div>
            {NAV_DISABLED.map((n) => (
              <div key={n.label} className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground/60 cursor-not-allowed">
                <n.icon className="size-4" />
                <span className="flex-1">{n.label}</span>
                <span className="text-[10px]">{n.labelBn}</span>
              </div>
            ))}
          </nav>
          <div className="p-3 border-t">
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
                {NAV.map((n) => (
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
                <span className="hidden sm:inline text-xs text-muted-foreground">Period</span>
                <Select value={monthKey({ year, month })} onValueChange={(v) => {
                  const m = months.find((x) => monthKey(x) === v);
                  if (m) { setMonth(m.month); setYear(m.year); }
                }}>
                  <SelectTrigger className="w-[180px] h-9">
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
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="h-9 w-64" />
                <div className="grid gap-4 md:grid-cols-4">
                  {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
                </div>
                <Skeleton className="h-72 rounded-xl" />
              </div>
            ) : view === "dashboard" && dash ? (
              <DashboardView data={dash} />
            ) : view === "generate" && gen ? (
              <GenerateRentView data={gen} onGenerate={onGenerate} generating={generating} />
            ) : view === "collect" ? (
              <CollectRentView month={month} year={year} />
            ) : view === "expenses" ? (
              <ExpensesView month={month} year={year} />
            ) : view === "vacate" ? (
              <VacateView month={month} year={year} />
            ) : view === "properties" ? (
              <PropertiesView />
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
