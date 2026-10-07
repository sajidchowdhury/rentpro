"use client";

import {
  Wallet, CheckCircle2, AlertCircle, Home, Building2, TrendingUp, TrendingDown, Phone, ArrowUpRight, Receipt,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { money, shortDate } from "@/lib/format";
import { usePagination } from "@/lib/use-pagination";
import { Pager } from "@/components/rentpro/pager";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

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
    count: number;
    predictedTotal: number;
    types: Array<{ headId: number; name: string; missingCount: number; predictedAmount: number; lastRecorded: string | null }>;
  };
}

function StatCard({
  icon: Icon, label, value, sub, accent, progress,
}: {
  icon: any; label: string; value: string; sub?: string;
  accent: string; progress?: number;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-medium text-muted-foreground">{label}</div>
            <div className="text-2xl font-bold mt-1 tracking-tight">{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
          </div>
          <div className={`size-9 rounded-lg grid place-items-center ${accent}`}>
            <Icon className="size-4" />
          </div>
        </div>
        {progress !== undefined && (
          <div className="mt-4">
            <Progress value={progress} className="h-2" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardView({ data, onGoToExpenses }: { data: DashboardData; onGoToExpenses?: () => void }) {
  const {
    month, year, generated, totalToCollect, expectedLeaseCount,
    collectedAmount, paidLeaseCount, pendingAmount, dueLeaseCount,
    vacantUnitCount, occupiedUnitCount, totalUnits, totalProperties,
    incomeThisMonth, expenseThisMonth, dueLeases, vacantUnits, recentCollections, trend, expenseDue,
  } = data;
  const duePaged = usePagination(dueLeases, 8);

  const collectPct = totalToCollect > 0
    ? Math.min(100, Math.round((collectedAmount / totalToCollect) * 100))
    : 0;
  const netCash = incomeThisMonth - expenseThisMonth;

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {month} {year} · {generated ? (
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Rent generated</Badge>
            ) : (
              <Badge variant="outline">Rent not generated yet</Badge>
            )}
          </p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Wallet} label="To Collect This Month"
          value={money(totalToCollect)}
          sub={`${expectedLeaseCount} leases · ${month} ${year}`}
          accent="bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300"
        />
        <StatCard
          icon={CheckCircle2} label="Collected So Far"
          value={money(collectedAmount)}
          sub={`${paidLeaseCount} of ${expectedLeaseCount} leases paid`}
          accent="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"
          progress={collectPct}
        />
        <StatCard
          icon={AlertCircle} label="Still Pending"
          value={money(totalToCollect - collectedAmount)}
          sub={`${dueLeaseCount} tenants haven't paid`}
          accent="bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300"
          progress={100 - collectPct}
        />
        <StatCard
          icon={Home} label="Vacant Units"
          value={String(vacantUnitCount)}
          sub={`${occupiedUnitCount} occupied · ${totalUnits} total`}
          accent="bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300"
        />
      </div>

      {/* Due expenses banner (F3) — missing monthly bills, front-of-mind */}
      <Card className={expenseDue.count > 0 ? "border-rose-200 dark:border-rose-900" : ""}>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className={`size-10 rounded-lg grid place-items-center shrink-0 ${expenseDue.count > 0 ? "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300" : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"}`}>
              <Receipt className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm flex items-center gap-2">
                {expenseDue.count > 0
                  ? <>{expenseDue.count} expense type{expenseDue.count > 1 ? "s" : ""} due — {month} {year}</>
                  : <>All recurring expenses recorded — {month} {year} 🎉</>}
              </div>
              <div className="text-xs text-muted-foreground">
                {expenseDue.count > 0
                  ? <>~ {money(expenseDue.predictedTotal)} predicted · missing bills accumulate until recorded</>
                  : "Nothing missing."}
              </div>
            </div>
            {expenseDue.count > 0 && (
              <div className="hidden md:flex flex-wrap gap-1.5 max-w-[40%]">
                {expenseDue.types.slice(0, 4).map((t) => (
                  <span key={t.headId} className="text-[11px] px-2 py-1 rounded-md bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 whitespace-nowrap" title={`${t.name} — ${t.missingCount} month(s) missing · last: ${t.lastRecorded ?? "—"}`}>
                    {t.name.length > 18 ? t.name.slice(0, 17) + "…" : t.name} · {t.missingCount}mo
                  </span>
                ))}
                {expenseDue.count > 4 && <span className="text-[11px] text-muted-foreground self-center">+{expenseDue.count - 4}</span>}
              </div>
            )}
            {expenseDue.count > 0 && (
              <Button size="sm" onClick={onGoToExpenses}>
                Record now <ArrowUpRight className="size-3.5" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Trend + Cashflow */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Rent Collection Trend</CardTitle>
            <CardDescription>Last 6 months (collected rent)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} className="fill-muted-foreground" />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} className="fill-muted-foreground" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(v: number) => [money(v), "Collected"]}
                    contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}
                  />
                  <Bar dataKey="amount" fill="oklch(0.646 0.222 41.116)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cash Flow — {month}</CardTitle>
            <CardDescription>Income vs expense (ledger)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg grid place-items-center bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <TrendingUp className="size-4" />
                </div>
                <span className="text-sm text-muted-foreground">Income</span>
              </div>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{money(incomeThisMonth)}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg grid place-items-center bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
                  <TrendingDown className="size-4" />
                </div>
                <span className="text-sm text-muted-foreground">Expense</span>
              </div>
              <span className="font-semibold text-rose-600 dark:text-rose-400">{money(expenseThisMonth)}</span>
            </div>
            <div className="border-t pt-3 flex items-center justify-between">
              <span className="text-sm font-medium">Net</span>
              <span className={`font-bold ${netCash >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                {money(netCash)}
              </span>
            </div>
            <div className="rounded-md bg-muted/60 p-2 text-[11px] text-muted-foreground flex items-center gap-2">
              <Building2 className="size-3.5" />
              {totalProperties} properties · {totalUnits} units
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Due + Vacant */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="size-4 text-rose-600" />
              Tenants Who Haven&apos;t Paid — {month} {year}
            </CardTitle>
            <CardDescription>{dueLeases.length} pending · sorted by months missed</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-[20rem]">
              <div className="divide-y">
                {duePaged.pageItems.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground text-center">
                    🎉 All tenants have paid for {month} {year}.
                  </div>
                ) : duePaged.pageItems.map((d) => (
                  <div key={d.leaseId} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                    <div className="size-9 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 grid place-items-center text-xs font-semibold shrink-0">
                      {d.monthsMissed}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{d.tenantName}</div>
                      <div className="text-xs text-muted-foreground truncate">{d.propertyName} · {d.unitName}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-sm">{money(d.rent)}</div>
                      <div className="text-[10px] text-rose-600 dark:text-rose-400">{d.monthsMissed} mo missed</div>
                    </div>
                    {d.mobile && (
                      <a href={`tel:${d.mobile}`} title={`Call ${d.mobile}`}>
                        <Button size="icon" variant="ghost" className="size-8">
                          <Phone className="size-3.5" />
                        </Button>
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
            <Pager page={duePaged.page} totalPages={duePaged.totalPages} total={duePaged.total} pageSize={duePaged.pageSize} onPrev={duePaged.prev} onNext={duePaged.next} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Home className="size-4 text-amber-600" />
              Vacant Units
            </CardTitle>
            <CardDescription>Re-rentable — not covered by any lease in {month} {year}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-80">
              <div className="divide-y">
                {vacantUnits.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground text-center">No vacant units.</div>
                ) : vacantUnits.map((v) => (
                  <div key={v.unitId} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                    <div className="size-9 rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 grid place-items-center shrink-0">
                      <Home className="size-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{v.unitName}</div>
                      <div className="text-xs text-muted-foreground truncate">{v.propertyName}</div>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">Vacant</Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Recent collections */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowUpRight className="size-4 text-emerald-600" />
            Recent Collections
          </CardTitle>
          <CardDescription>Latest rent payments across all properties</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-72">
            <div className="divide-y">
              {recentCollections.map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{c.tenantName}</div>
                    <div className="text-xs text-muted-foreground truncate">{c.propertyName} · {c.unitName}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-sm">{money(c.rent)}</div>
                    <div className="text-[10px] text-muted-foreground">{c.rentMonth} {c.rentYear}</div>
                  </div>
                  <div className="text-right w-20">
                    <div className="text-xs text-muted-foreground">{shortDate(c.receiveDate)}</div>
                    {c.status === "DONE" ? (
                      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-[10px]">Paid</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">Pending</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
