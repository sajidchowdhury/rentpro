"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Users, Search, Phone, Wallet, ArrowRight, CheckCircle2, Receipt, Building2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { money, shortDate } from "@/lib/format";
import { usePagination } from "@/lib/use-pagination";
import { Pager } from "@/components/rentpro/pager";
import { toast } from "sonner";

interface TenantDir {
  id: number; code: string; name: string; mobile: string | null;
  familyMember: string | null; status: "ACTIVE" | "GONE";
  leaseCount: number; activeLeaseCount: number;
  advanceBalance: number; outstandingCount: number; outstandingTotal: number;
}
interface Ledger {
  tenant: { id: number; name: string; mobile: string | null; code: string; status: string; advanceBalance: number };
  leases: Array<{ id: number; propertyName: string; unitName: string; rent: number; status: string }>;
  dueRows: Array<{ leaseId: number; month: string; year: string; propertyName: string; unitName: string; rent: number; total: number; remaining: number; status: string }>;
  outstandingTotal: number; outstandingCount: number;
  recentCollections: Array<{ id: number; month: string; year: string; rent: number; receiveDate: string | null; status: string }>;
}

type Filter = "ALL" | "ACTIVE" | "GONE";

export function TenantsView({
  month, year, onCollect,
}: {
  month: string; year: string; onCollect: (tenantId: number) => void;
}) {
  const [tenants, setTenants] = useState<TenantDir[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingLedger, setLoadingLedger] = useState(false);

  const refreshList = useCallback(async () => {
    setLoadingList(true);
    try {
      const r = await fetch(`/api/tenants-list?month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`);
      const d = await r.json();
      setTenants(d.tenants ?? []);
    } catch {
      toast.error("Failed to load tenants");
    } finally {
      setLoadingList(false);
    }
  }, [month, year]);

  const refreshLedger = useCallback(async () => {
    if (selectedId === null) { setLedger(null); return; }
    setLoadingLedger(true);
    try {
      const r = await fetch(`/api/tenant-ledger?tenantId=${selectedId}&month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`);
      const d = await r.json();
      setLedger(d);
    } catch {
      toast.error("Failed to load ledger");
    } finally {
      setLoadingLedger(false);
    }
  }, [selectedId, month, year]);

  useEffect(() => { refreshList(); }, [refreshList]);
  useEffect(() => { refreshLedger(); }, [refreshLedger]);

  const filtered = tenants.filter((t) => {
    if (filter !== "ALL" && t.status !== filter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      t.code.includes(search) ||
      (t.mobile ?? "").includes(search) ||
      (t.familyMember ?? "").toLowerCase().includes(q)
    );
  });
  const paged = usePagination(filtered, 10);
  const dueRowsPaged = usePagination(ledger?.dueRows ?? [], 8);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Users className="size-6 text-blue-600" />
          Tenants
        </h1>
        <p className="text-sm text-muted-foreground">
          {tenants.length} tenants · directory with leases, advance &amp; outstanding. Period: {month} {year}.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* Tenant list */}
        <Card className="lg:col-span-5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Directory</CardTitle>
            <div className="flex gap-2 mt-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input placeholder="Search name / code / mobile" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9" />
              </div>
              <div className="flex rounded-md border overflow-hidden">
                {(["ALL", "ACTIVE", "GONE"] as Filter[]).map((f) => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-3 h-9 text-xs font-medium transition-colors ${filter === f ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                    {f === "ALL" ? "All" : f === "ACTIVE" ? "Active" : "Gone"}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-[30rem]">
              <div className="divide-y">
                {loadingList ? (
                  [0, 1, 2, 3, 4].map((i) => <div key={i} className="p-3"><Skeleton className="h-14 rounded" /></div>)
                ) : paged.pageItems.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground text-center">No tenants match.</div>
                ) : paged.pageItems.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${selectedId === t.id ? "bg-accent" : "hover:bg-muted/50"}`}
                  >
                    <div className={`size-9 rounded-full grid place-items-center text-xs font-semibold shrink-0 ${t.status === "GONE" ? "bg-muted text-muted-foreground" : "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300"}`}>
                      {t.code}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate flex items-center gap-2">
                        {t.name}
                        {t.status === "GONE" && <Badge variant="secondary" className="text-[10px]">Gone</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {t.leaseCount} lease{t.leaseCount !== 1 ? "s" : ""} ({t.activeLeaseCount} active)
                        {t.advanceBalance > 0 && <> · adv {money(t.advanceBalance)}</>}
                      </div>
                    </div>
                    {t.outstandingTotal > 0 ? (
                      <div className="text-right">
                        <div className="font-semibold text-sm text-rose-600 dark:text-rose-400">{money(t.outstandingTotal)}</div>
                        <div className="text-[10px] text-muted-foreground">{t.outstandingCount} due</div>
                      </div>
                    ) : (
                      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-[10px]">Clear</Badge>
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>
            <Pager page={paged.page} totalPages={paged.totalPages} total={paged.total} pageSize={paged.pageSize} onPrev={paged.prev} onNext={paged.next} />
          </CardContent>
        </Card>

        {/* Tenant detail */}
        <Card className="lg:col-span-7">
          <CardContent className="p-0">
            {!selectedId ? (
              <div className="h-[38rem] grid place-items-center text-center">
                <div>
                  <Users className="size-10 text-muted-foreground/40 mx-auto mb-2" />
                  <div className="text-sm text-muted-foreground">Pick a tenant to see their leases, advance &amp; outstanding.</div>
                </div>
              </div>
            ) : loadingLedger || !ledger ? (
              <div className="p-6 space-y-3"><Skeleton className="h-16 rounded" /><Skeleton className="h-72 rounded" /></div>
            ) : (
              <div>
                {/* header */}
                <div className="p-4 border-b flex flex-wrap items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-lg flex items-center gap-2">
                      {ledger.tenant.name}
                      {ledger.tenant.status === "GONE" && <Badge variant="secondary">Gone</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {ledger.tenant.code}
                      {ledger.tenant.mobile && <> · {ledger.tenant.mobile}</>}
                      {" · "}{ledger.leases.length} lease{ledger.leases.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Outstanding</div>
                      <div className="font-bold text-rose-600 dark:text-rose-400">{money(ledger.outstandingTotal)}</div>
                      <div className="text-[10px] text-muted-foreground">{ledger.outstandingCount} mo</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Advance</div>
                      <div className="font-bold text-emerald-600 dark:text-emerald-400">{money(ledger.tenant.advanceBalance)}</div>
                      <div className="text-[10px] text-muted-foreground">held</div>
                    </div>
                  </div>
                  <Button size="sm" onClick={() => onCollect(ledger.tenant.id)}>
                    <Wallet className="size-3.5" /> Collect
                  </Button>
                </div>

                {/* leases */}
                <div className="px-4 py-3 border-b">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Leases</div>
                  <div className="space-y-2">
                    {ledger.leases.map((l) => (
                      <div key={l.id} className="flex items-center gap-3 text-sm">
                        <Building2 className="size-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="truncate">{l.propertyName} · {l.unitName}</div>
                        </div>
                        <div className="text-muted-foreground">{money(l.rent)}/mo</div>
                        {l.status === "ACTIVE"
                          ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-[10px]">Active</Badge>
                          : <Badge variant="secondary" className="text-[10px]">Closed</Badge>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* due rows */}
                {ledger.dueRows.length > 0 && (
                  <div className="px-4 py-3 border-b">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                      <Receipt className="size-3" /> Unpaid months
                    </div>
                    <ScrollArea className="max-h-48">
                      <div className="space-y-1.5">
                        {dueRowsPaged.pageItems.map((r) => (
                          <div key={`${r.leaseId}-${r.month}-${r.year}`} className="flex items-center gap-2 text-xs">
                            <span className="w-24 shrink-0">{r.month} {r.year}</span>
                            <span className="flex-1 truncate text-muted-foreground">{r.unitName}</span>
                            <span className="font-medium">{money(r.remaining)}</span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                    <Pager page={dueRowsPaged.page} totalPages={dueRowsPaged.totalPages} total={dueRowsPaged.total} pageSize={dueRowsPaged.pageSize} onPrev={dueRowsPaged.prev} onNext={dueRowsPaged.next} />
                  </div>
                )}

                {/* recent collections */}
                {ledger.recentCollections.length > 0 && (
                  <div className="px-4 py-3">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Recent payments</div>
                    <ScrollArea className="max-h-40">
                      <div className="divide-y">
                        {ledger.recentCollections.map((c) => (
                          <div key={c.id} className="py-2 flex items-center gap-3 text-sm">
                            <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                            <div className="flex-1">{c.month} {c.year}</div>
                            <div className="font-medium">{money(c.rent)}</div>
                            <div className="text-xs text-muted-foreground w-20 text-right">{shortDate(c.receiveDate)}</div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
