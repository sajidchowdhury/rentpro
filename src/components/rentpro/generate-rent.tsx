"use client";

import { useEffect, useState, useCallback } from "react";
import { Zap, CheckCircle2, AlertCircle, Phone, Sparkles, Users } from "lucide-react";
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

interface GenerateRow {
  leaseId: number; tenantId: number; tenantName: string; unitName: string; propertyName: string;
  mobile: string | null; rent: number; gasBill: number; serviceCharge: number;
  otherBill: number; total: number; status: "PAID" | "DUE" | "PARTIAL" | "INVOICED";
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
  const [data, setData] = useState<GenerateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [tenants, setTenants] = useState<TenantOpt[]>([]);
  // null = All tenants; a number = specific tenant
  const [selTenant, setSelTenant] = useState<string>("all");

  const refresh = useCallback(async () => {
    if (!month || !year) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ month, year });
      if (selTenant !== "all") params.set("tenantId", selTenant);
      const r = await fetch(`/api/generate-rent?${params}`);
      setData(await r.json());
    } catch {
      toast.error("Failed to load preview");
    } finally {
      setLoading(false);
    }
  }, [month, year, selTenant]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    fetch(`/api/tenants-list?month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`)
      .then((r) => r.json())
      .then((d) => setTenants((d.tenants ?? []).map((t: any) => ({ id: t.id, name: t.name, code: t.code }))))
      .catch(() => {});
  }, [month, year]);

  const onGenerate = async () => {
    setGenerating(true);
    try {
      const params = new URLSearchParams({ month, year });
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Zap className="size-6 text-amber-500" />
            Generate Monthly Rent
          </h1>
          <p className="text-sm text-muted-foreground">
            Create rent invoices for{" "}
            <span className="font-medium text-foreground">{month} {year}</span>.
            Idempotent — already-created invoices are skipped.
          </p>
        </div>
        <div className="flex items-end gap-2">
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
          <Button onClick={onGenerate} disabled={generating || toGenerateCount === 0} size="lg">
            {generating ? (
              <><Sparkles className="size-4 animate-pulse" /> Generating…</>
            ) : (
              <><Zap className="size-4" /> Generate {month} {year}</>
            )}
          </Button>
        </div>
      </div>

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
              <div className="text-xs text-muted-foreground">already invoiced</div>
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
      {generated && toGenerateCount === 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="size-5 shrink-0" />
          <span>
            All rent invoices for <strong>{month} {year}</strong>{selTenant !== "all" ? " (this tenant)" : ""} have already been created — nothing new to generate.
          </span>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rent Schedule Preview</CardTitle>
          <CardDescription>
            {selTenant === "all" ? "All tenants" : tenants.find((t) => String(t.id) === selTenant)?.name} · {month} {year}. Invoiced rows are skipped on generate.
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
                      No active leases cover {month} {year}{selTenant !== "all" ? " for this tenant" : ""}.
                    </TableCell>
                  </TableRow>
                ) : paged.pageItems.map((r) => {
                  const bills = r.gasBill + r.serviceCharge + r.otherBill;
                  return (
                    <TableRow key={r.leaseId} className={r.status === "PAID" || r.status === "INVOICED" ? "opacity-60" : ""}>
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
