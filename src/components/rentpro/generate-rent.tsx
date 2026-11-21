"use client";

import { useEffect, useState, useCallback } from "react";
import { Zap, CheckCircle2, AlertCircle, Phone, Sparkles, Users, RefreshCw, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { money } from "@/lib/format";
import { usePagination } from "@/lib/use-pagination";
import { Pager } from "@/components/rentpro/pager";
import { toast } from "sonner";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const YEARS = ["2022","2023","2024","2025","2026","2027"];

interface GenerateRow {
  leaseId: number; tenantId: number; tenantName: string; unitName: string; propertyName: string;
  mobile: string | null; rent: number; gasBill: number; serviceCharge: number;
  otherBill: number; total: number; status: "PAID" | "DUE" | "PARTIAL" | "INVOICED";
  hasPendingInvoice?: boolean;
}
interface GenerateData {
  month: string; year: string; generated: boolean;
  rows: GenerateRow[]; toGenerateCount: number; alreadyCollectedCount: number;
  totalToCollect: number; alreadyCollectedAmount: number;
}
interface TenantOpt { id: number; name: string; code: string; }

function StatusBadge({ status }: { status: GenerateRow["status"] }) {
  if (status === "PAID")
    return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Already collected</Badge>;
  if (status === "INVOICED")
    return <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100">Invoice created</Badge>;
  if (status === "PARTIAL")
    return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Partial</Badge>;
  return <Badge variant="outline" className="text-rose-700 border-rose-300">To generate</Badge>;
}

export function GenerateRentView({ month, year }: { month: string; year: string }) {
  // Local period selector — defaults to the header period but the user can
  // change it inline without touching the global selector. This makes the
  // Generate flow self-contained: pick year → month → tenant → generate.
  const [selYear, setSelYear] = useState(year || String(new Date().getFullYear()));
  const [selMonth, setSelMonth] = useState(month || MONTHS[new Date().getMonth()]);
  const [selTenant, setSelTenant] = useState<string>("all");
  const [data, setData] = useState<GenerateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [tenants, setTenants] = useState<TenantOpt[]>([]);

  const refresh = useCallback(async () => {
    if (!selMonth || !selYear) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ month: selMonth, year: selYear });
      if (selTenant !== "all") params.set("tenantId", selTenant);
      const r = await fetch(`/api/generate-rent?${params}`);
      setData(await r.json());
    } catch {
      toast.error("Failed to load preview");
    } finally {
      setLoading(false);
    }
  }, [selMonth, selYear, selTenant]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    fetch(`/api/tenants-list?month=${encodeURIComponent(selMonth)}&year=${encodeURIComponent(selYear)}`)
      .then((r) => r.json())
      .then((d) => setTenants((d.tenants ?? []).map((t: any) => ({ id: t.id, name: t.name, code: t.code }))))
      .catch(() => {});
  }, [selMonth, selYear]);

  const onGenerate = async () => {
    setGenerating(true);
    try {
      const params = new URLSearchParams({ month: selMonth, year: selYear });
      if (selTenant !== "all") params.set("tenantId", selTenant);
      const r = await fetch(`/api/generate-rent?${params}`, { method: "POST" });
      const d = await r.json();
      if (d.ok) {
        toast.success(d.message);
        setData(d.preview as GenerateData);
      } else {
        toast.error(d.error ?? "Generation failed");
      }
    } catch {
      toast.error("Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  // hooks must be called before any early return — use safe defaults when data is null
  const rows = data?.rows ?? [];
  const paged = usePagination(rows, 12);

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-48" />
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  const { toGenerateCount, alreadyCollectedCount, totalToCollect, alreadyCollectedAmount, generated } = data;
  const toGenerateAmount = rows
    .filter((r) => r.status === "DUE")
    .reduce((s, r) => s + r.total, 0);
  const invoicedCount = rows.filter((r) => r.status === "INVOICED").length;
  // Generate is enabled when there are DUE rows (new invoices) OR INVOICED
  // rows (stale pending invoices that can be regenerated).
  const canGenerate = toGenerateCount > 0 || invoicedCount > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Zap className="size-6 text-amber-500" />
          Generate Monthly Rent
        </h1>
        <p className="text-sm text-muted-foreground">
          Create rent invoices for any month. Pick the year, month and tenant below — already-paid months are skipped, stale unpaid invoices are replaced.
        </p>
      </div>

      {/* Period + tenant selector card */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Calendar className="size-4" /> Generate for:
            </div>
            <div className="w-[120px]">
              <Select value={selYear} onValueChange={(v) => { setSelYear(v); }}>
                <SelectTrigger><SelectValue placeholder="Year" /></SelectTrigger>
                <SelectContent>
                  {YEARS.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-[160px]">
              <Select value={selMonth} onValueChange={(v) => { setSelMonth(v); }}>
                <SelectTrigger><SelectValue placeholder="Month" /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-[260px]">
              <Select value={selTenant} onValueChange={(v) => setSelTenant(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tenants ({tenants.length})</SelectItem>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.code} · {t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
                <RefreshCw className="size-3.5" /> Refresh
              </Button>
              <Button onClick={onGenerate} disabled={generating || !canGenerate} size="lg">
                {generating ? (
                  <><Sparkles className="size-4 animate-pulse" /> Generating…</>
                ) : (
                  <><Zap className="size-4" /> Generate {selMonth} {selYear}</>
                )}
              </Button>
            </div>
          </div>
          {/* helper line */}
          <div className="mt-2 text-xs text-muted-foreground">
            {canGenerate ? (
              <>
                Ready to generate <span className="font-medium text-foreground">{toGenerateCount}</span> new invoice{toGenerateCount !== 1 ? "s" : ""}
                {invoicedCount > 0 && <> + replace <span className="font-medium text-foreground">{invoicedCount}</span> stale unpaid invoice{invoicedCount !== 1 ? "s" : ""}</>}.
              </>
            ) : (
              <>All rent for {selMonth} {selYear} is already collected — nothing to generate.</>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="size-11 rounded-lg grid place-items-center bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
              <AlertCircle className="size-5" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">To Generate</div>
              <div className="text-xl font-bold">{toGenerateCount} leases</div>
              <div className="text-xs text-muted-foreground">{money(toGenerateAmount)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="size-11 rounded-lg grid place-items-center bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300">
              <CheckCircle2 className="size-5" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Invoice Created</div>
              <div className="text-xl font-bold">{invoicedCount} leases</div>
              <div className="text-xs text-muted-foreground">unpaid · can regenerate</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="size-11 rounded-lg grid place-items-center bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="size-5" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Already Collected</div>
              <div className="text-xl font-bold">{alreadyCollectedCount} leases</div>
              <div className="text-xs text-muted-foreground">{money(alreadyCollectedAmount)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="size-11 rounded-lg grid place-items-center bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
              <Users className="size-5" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Total This Month</div>
              <div className="text-xl font-bold">{rows.length} leases</div>
              <div className="text-xs text-muted-foreground">{money(totalToCollect)}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Generated / result banner */}
      {generated && !canGenerate && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="size-5 shrink-0" />
          <span>
            All rent invoices for <strong>{selMonth} {selYear}</strong>{selTenant !== "all" ? " (this tenant)" : ""} have already been created — nothing new to generate.
          </span>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rent Schedule Preview — {selMonth} {selYear}</CardTitle>
          <CardDescription>
            {selTenant === "all" ? "All tenants" : tenants.find((t) => String(t.id) === selTenant)?.name} · Invoiced rows are replaced on regenerate; paid rows are skipped.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[28rem] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property / Unit</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead className="text-right">Rent</TableHead>
                  <TableHead className="text-right">Bills</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.pageItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No active leases cover {selMonth} {selYear}{selTenant !== "all" ? " for this tenant" : ""}. The lease may have ended before or start after this month.
                    </TableCell>
                  </TableRow>
                ) : paged.pageItems.map((r) => {
                  const bills = r.gasBill + r.serviceCharge + r.otherBill;
                  return (
                    <TableRow key={r.leaseId} className={r.status === "PAID" ? "opacity-60" : ""}>
                      <TableCell>
                        <div className="font-medium text-sm">{r.propertyName}</div>
                        <div className="text-xs text-muted-foreground">{r.unitName}</div>
                      </TableCell>
                      <TableCell className="font-medium">{r.tenantName}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.rent)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {bills > 0 ? money(bills) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{money(r.total)}</TableCell>
                      <TableCell className="text-center"><StatusBadge status={r.status} /></TableCell>
                      <TableCell>
                        {r.mobile && (
                          <a href={`tel:${r.mobile}`} title={`Call ${r.mobile}`}>
                            <Button size="icon" variant="ghost" className="size-8">
                              <Phone className="size-3.5" />
                            </Button>
                          </a>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Pager page={paged.page} totalPages={paged.totalPages} total={paged.total} pageSize={paged.pageSize} onPrev={paged.prev} onNext={paged.next} />
        </CardContent>
      </Card>
    </div>
  );
}
