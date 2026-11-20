"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Users, Search, Phone, Wallet, ArrowRight, CheckCircle2, Receipt, Building2, TrendingDown, Pencil, Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { money, shortDate } from "@/lib/format";
import { usePagination } from "@/lib/use-pagination";
import { Pager } from "@/components/rentpro/pager";
import { toast } from "sonner";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

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

  // rent-change dialog
  const [rcOpen, setRcOpen] = useState(false);
  const [rcLeaseId, setRcLeaseId] = useState<number | null>(null);
  const [rcCurrentRent, setRcCurrentRent] = useState(0);
  const [rcMonth, setRcMonth] = useState("");
  const [rcYear, setRcYear] = useState("");
  const [rcRent, setRcRent] = useState(0);
  const [rcGas, setRcGas] = useState(0);
  const [rcService, setRcService] = useState(0);
  const [rcOther, setRcOther] = useState(0);
  const [rcReason, setRcReason] = useState("");
  const [rcBusy, setRcBusy] = useState(false);
  const [rcExisting, setRcExisting] = useState<Array<{ effectiveDate: string; rent: number; reason: string }>>([]);

  // edit-tenant dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editTenant, setEditTenant] = useState<TenantDir | null>(null);
  const [eName, setEName] = useState("");
  const [eCode, setECode] = useState("");
  const [eMobile, setEMobile] = useState("");
  const [eFamily, setEFamily] = useState("");
  const [eStatus, setEStatus] = useState<"ACTIVE" | "GONE">("ACTIVE");
  const [eBusy, setEBusy] = useState(false);

  function openEdit(t: TenantDir) {
    setEditTenant(t);
    setEName(t.name);
    setECode(t.code);
    setEMobile(t.mobile ?? "");
    setEFamily(t.familyMember ?? "");
    setEStatus(t.status);
    setEditOpen(true);
  }
  async function submitEdit() {
    if (!editTenant) return;
    if (!eName.trim()) { toast.error("Name is required"); return; }
    if (!eCode.trim()) { toast.error("Code is required"); return; }
    setEBusy(true);
    try {
      const r = await fetch("/api/tenant/update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editTenant.id,
          name: eName.trim(),
          code: eCode.trim(),
          mobile: eMobile.trim() || null,
          familyMember: eFamily.trim() || null,
          status: eStatus,
        }),
      });
      const d = await r.json();
      if (d.ok) {
        toast.success("Tenant updated");
        setEditOpen(false);
        await refreshList();
        if (selectedId === editTenant.id) await refreshLedger();
      } else toast.error(d.error ?? "Failed");
    } catch { toast.error("Failed to update"); }
    finally { setEBusy(false); }
  }
  async function deleteTenant(t: TenantDir) {
    if (!confirm(`Delete tenant "${t.name}" (${t.code})?\n\nThis is only allowed if the tenant has no transactions (collections, leases, adjustments).`)) return;
    try {
      const r = await fetch("/api/tenant/delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id }),
      });
      const d = await r.json();
      if (d.ok) {
        toast.success("Tenant deleted");
        if (selectedId === t.id) setSelectedId(null);
        await refreshList();
      } else {
        toast.error(d.error ?? "Failed");
      }
    } catch { toast.error("Failed to delete"); }
  }

  async function openRentChange(l: { id: number; rent: number }) {
    setRcLeaseId(l.id);
    setRcCurrentRent(l.rent);
    setRcRent(l.rent); // default new rent = current (user adjusts)
    setRcGas(0); setRcService(0); setRcOther(0);
    setRcReason("");
    const now = new Date();
    setRcMonth(MONTHS[now.getMonth()]);
    setRcYear(String(now.getFullYear()));
    setRcExisting([]);
    setRcOpen(true);
    // fetch existing rent changes for this lease (in the background)
    try {
      const r = await fetch(`/api/lease/rent-changes?leaseId=${l.id}`);
      const d = await r.json();
      setRcExisting(d.changes ?? []);
    } catch { /* ignore */ }
  }
  async function submitRentChange() {
    if (!rcLeaseId || !rcMonth || !rcYear) { toast.error("Month and year are required"); return; }
    if (!(rcRent > 0)) { toast.error("New rent must be greater than zero"); return; }
    // effectiveDate = first day of the selected month
    const effectiveDate = `${rcYear}-${String(MONTHS.indexOf(rcMonth) + 1).padStart(2, "0")}-01`;
    setRcBusy(true);
    try {
      const r = await fetch("/api/lease/rent-change", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaseId: rcLeaseId, effectiveDate,
          rent: rcRent, gasBill: rcGas, serviceCharge: rcService, otherBill: rcOther,
          reason: rcReason,
        }),
      });
      const d = await r.json();
      if (d.ok) {
        toast.success(`Rent change recorded — ${rcMonth} ${rcYear}`);
        setRcOpen(false);
        refreshLedger();
      } else toast.error(d.error ?? "Failed");
    } catch { toast.error("Failed to save"); }
    finally { setRcBusy(false); }
  }
  async function deleteRentChangeEntry(effectiveDate: string) {
    if (!rcLeaseId) return;
    if (!confirm(`Delete this rent change (effective ${effectiveDate})?\n\nThe rent will revert to the previous value for affected months.`)) return;
    try {
      const r = await fetch("/api/lease/rent-change/delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaseId: rcLeaseId, effectiveDate }),
      });
      const d = await r.json();
      if (d.ok) {
        toast.success("Rent change deleted");
        // refresh existing list + the ledger
        setRcExisting((prev) => prev.filter((c) => c.effectiveDate !== effectiveDate));
        refreshLedger();
      } else toast.error(d.error ?? "Failed");
    } catch { toast.error("Failed to delete"); }
  }

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
            <div className="max-h-[30rem] overflow-y-auto">
              <div className="divide-y">
                {loadingList ? (
                  [0, 1, 2, 3, 4].map((i) => <div key={i} className="p-3"><Skeleton className="h-14 rounded" /></div>)
                ) : paged.pageItems.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground text-center">No tenants match.</div>
                ) : paged.pageItems.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer ${selectedId === t.id ? "bg-accent" : "hover:bg-muted/50"}`}
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
                    <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Button size="icon" variant="ghost" className="size-7" onClick={() => openEdit(t)} title="Edit tenant">
                        <Pencil className="size-3.5 text-sky-500" />
                      </Button>
                      <Button size="icon" variant="ghost" className="size-7 text-rose-600 hover:text-rose-700" onClick={() => deleteTenant(t)} title="Delete tenant (blocked if it has transactions)">
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
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
                      <div key={l.id} className="flex items-center gap-3 text-sm rounded-md border p-2.5">
                        <Building2 className="size-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="truncate">{l.propertyName} · {l.unitName}</div>
                          <div className="text-[11px] text-muted-foreground">{money(l.rent)}/mo</div>
                        </div>
                        {l.status === "ACTIVE"
                          ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-[10px]">Active</Badge>
                          : <Badge variant="secondary" className="text-[10px]">Closed</Badge>}
                        {l.status === "ACTIVE" && (
                          <Button size="icon" variant="ghost" className="size-7" onClick={() => openRentChange(l)} title="Record a rent change (with reason + effective date)">
                            <TrendingDown className="size-3.5 text-amber-500" />
                          </Button>
                        )}
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
                    <div className="max-h-48 overflow-y-auto">
                      <div className="space-y-1.5">
                        {dueRowsPaged.pageItems.map((r) => (
                          <div key={`${r.leaseId}-${r.month}-${r.year}`} className="flex items-center gap-2 text-xs">
                            <span className="w-24 shrink-0">{r.month} {r.year}</span>
                            <span className="flex-1 truncate text-muted-foreground">{r.unitName}</span>
                            <span className="font-medium">{money(r.remaining)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <Pager page={dueRowsPaged.page} totalPages={dueRowsPaged.totalPages} total={dueRowsPaged.total} pageSize={dueRowsPaged.pageSize} onPrev={dueRowsPaged.prev} onNext={dueRowsPaged.next} />
                  </div>
                )}

                {/* recent collections */}
                {ledger.recentCollections.length > 0 && (
                  <div className="px-4 py-3">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Recent payments</div>
                    <div className="max-h-40 overflow-y-auto">
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
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Rent Change dialog */}
      <Dialog open={rcOpen} onOpenChange={(o) => { if (!o) setRcOpen(false); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><TrendingDown className="size-4" /> Record Rent Change</DialogTitle>
            <DialogDescription>The new rent applies from the selected month onward. The ledger, dashboard, day book, and reports all update automatically.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* current rent display */}
            <div className="rounded-md bg-muted/60 px-3 py-2 text-sm flex items-center justify-between">
              <span className="text-muted-foreground">Current rent</span>
              <span className="font-bold text-lg">৳{rcCurrentRent.toLocaleString()}</span>
            </div>

            {/* effective month + year */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Effective from month</Label>
                <Select value={rcMonth} onValueChange={setRcMonth}>
                  <SelectTrigger><SelectValue placeholder="Month" /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Year</Label>
                <Select value={rcYear} onValueChange={setRcYear}>
                  <SelectTrigger><SelectValue placeholder="Year" /></SelectTrigger>
                  <SelectContent>
                    {["2022","2023","2024","2025","2026","2027"].map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* new rent + bills */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">New rent (৳) <span className="text-rose-500">*</span></Label>
                <Input type="number" value={rcRent} onChange={(e) => setRcRent(Number(e.target.value))} />
              </div>
              <div>
                <Label className="text-xs">Gas bill (৳)</Label>
                <Input type="number" value={rcGas} onChange={(e) => setRcGas(Number(e.target.value))} />
              </div>
              <div>
                <Label className="text-xs">Service charge (৳)</Label>
                <Input type="number" value={rcService} onChange={(e) => setRcService(Number(e.target.value))} />
              </div>
              <div>
                <Label className="text-xs">Other bill (৳)</Label>
                <Input type="number" value={rcOther} onChange={(e) => setRcOther(Number(e.target.value))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Reason (shown in the ledger)</Label>
              <Input value={rcReason} onChange={(e) => setRcReason(e.target.value)} placeholder="e.g. Room split into two, rent reduced from 5000 to 3000" />
            </div>

            {/* live preview */}
            {rcMonth && rcYear && rcRent > 0 && (
              <div className="rounded-md border border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20 px-3 py-2.5 text-xs">
                <div className="font-medium text-blue-700 dark:text-blue-300 mb-1">Preview</div>
                <div className="text-muted-foreground">
                  From <span className="font-medium text-foreground">{rcMonth} {rcYear}</span> onward, the rent will be
                  <span className="font-medium text-rose-600 dark:text-rose-400"> ৳{rcRent.toLocaleString()}</span>
                  {rcRent !== rcCurrentRent && (
                    <span className="text-emerald-600 dark:text-emerald-400"> ({rcRent < rcCurrentRent ? "down" : "up"} from ৳{rcCurrentRent.toLocaleString()})</span>
                  )}.
                </div>
                <div className="text-muted-foreground mt-0.5">
                  Months before {rcMonth} {rcYear} keep the rent that was in effect then.
                </div>
              </div>
            )}

            {/* existing rent changes (with delete) */}
            {rcExisting.length > 0 && (
              <div className="rounded-md border px-3 py-2.5">
                <div className="text-xs font-medium text-muted-foreground mb-2">Existing rent changes for this lease</div>
                <div className="space-y-1.5">
                  {rcExisting.map((c, i) => {
                    const [y, mo] = c.effectiveDate.split("-");
                    const monthName = MONTHS[Number(mo) - 1];
                    return (
                      <div key={i} className="flex items-center gap-2 text-sm rounded-md bg-muted/40 px-2 py-1.5">
                        <div className="flex-1 min-w-0">
                          <span className="font-medium">{monthName} {y}</span>
                          <span className="text-muted-foreground"> → ৳{c.rent.toLocaleString()}</span>
                          {c.reason && <span className="text-muted-foreground text-xs"> · {c.reason}</span>}
                        </div>
                        <Button size="icon" variant="ghost" className="size-6 text-rose-600 hover:text-rose-700 shrink-0" onClick={() => deleteRentChangeEntry(c.effectiveDate)} title="Delete this rent change">
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRcOpen(false)}>Cancel</Button>
            <Button onClick={submitRentChange} disabled={rcBusy || !rcMonth || !rcYear || !(rcRent > 0)}>
              {rcBusy ? "Saving…" : "Record Change"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Tenant dialog */}
      <Dialog open={editOpen} onOpenChange={(o) => { if (!o) setEditOpen(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="size-4" /> Edit Tenant</DialogTitle>
            <DialogDescription>{editTenant ? `${editTenant.code} · ${editTenant.name}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Name</Label>
                <Input value={eName} onChange={(e) => setEName(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Code</Label>
                <Input value={eCode} onChange={(e) => setECode(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Mobile</Label>
                <Input value={eMobile} onChange={(e) => setEMobile(e.target.value)} placeholder="optional" />
              </div>
              <div>
                <Label className="text-xs">Family member</Label>
                <Input value={eFamily} onChange={(e) => setEFamily(e.target.value)} placeholder="optional" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <div className="flex gap-2">
                <Button size="sm" variant={eStatus === "ACTIVE" ? "default" : "outline"} onClick={() => setEStatus("ACTIVE")}>Active</Button>
                <Button size="sm" variant={eStatus === "GONE" ? "default" : "outline"} onClick={() => setEStatus("GONE")}>Gone</Button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground rounded-md bg-muted/50 p-3">
              Changes here flow to the tenant directory, collect-rent picker, client ledger, and all reports — they all read from the same tenant record.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={submitEdit} disabled={eBusy}>
              {eBusy ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
