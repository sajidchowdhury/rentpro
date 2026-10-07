"use client";

import { Zap, CheckCircle2, AlertCircle, Phone, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { money } from "@/lib/format";
import { usePagination } from "@/lib/use-pagination";
import { Pager } from "@/components/rentpro/pager";

interface GenerateRow {
  leaseId: number; tenantName: string; unitName: string; propertyName: string;
  mobile: string | null; rent: number; gasBill: number; serviceCharge: number;
  otherBill: number; total: number; status: "PAID" | "DUE" | "PARTIAL";
}
interface GenerateData {
  month: string; year: string; generated: boolean;
  rows: GenerateRow[]; toGenerateCount: number; alreadyCollectedCount: number;
  totalToCollect: number; alreadyCollectedAmount: number;
}

function StatusBadge({ status }: { status: GenerateRow["status"] }) {
  if (status === "PAID")
    return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Already collected</Badge>;
  if (status === "PARTIAL")
    return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Partial</Badge>;
  return <Badge variant="outline" className="text-rose-700 border-rose-300">To generate</Badge>;
}

export function GenerateRentView({
  data, onGenerate, generating,
}: {
  data: GenerateData;
  onGenerate: () => void;
  generating: boolean;
}) {
  const {
    month, year, generated, rows, toGenerateCount, alreadyCollectedCount,
    totalToCollect, alreadyCollectedAmount,
  } = data;
  const paged = usePagination(rows, 12);

  const toGenerateAmount = rows
    .filter((r) => r.status !== "PAID")
    .reduce((s, r) => s + r.total, 0);

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
            Auto-create rent due rows for every active lease for{" "}
            <span className="font-medium text-foreground">{month} {year}</span>.
            Idempotent — safe to re-run.
          </p>
        </div>
        <Button onClick={onGenerate} disabled={generating || toGenerateCount === 0 || generated} size="lg">
          {generating ? (
            <>
              <Sparkles className="size-4 animate-pulse" /> Generating…
            </>
          ) : generated ? (
            <>
              <CheckCircle2 className="size-4" /> Already Generated
            </>
          ) : (
            <>
              <Zap className="size-4" /> Generate {month} {year} Rent
            </>
          )}
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
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
              <Zap className="size-5" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Total This Month</div>
              <div className="text-xl font-bold">{rows.length} leases</div>
              <div className="text-xs text-muted-foreground">{money(totalToCollect)}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Generated banner */}
      {generated && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="size-5 shrink-0" />
          <span>
            Rent schedule for <strong>{month} {year}</strong> has been generated.{" "}
            {toGenerateCount > 0 ? (
              <>Due rows are now visible on the dashboard.</>
            ) : (
              <>All leases for this month were already collected — nothing new to generate.</>
            )}
          </span>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rent Schedule Preview</CardTitle>
          <CardDescription>
            Every lease covering {month} {year}. Rows already collected are skipped on generate.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[28rem]">
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
                      No active leases cover {month} {year}.
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
          </ScrollArea>
          <Pager page={paged.page} totalPages={paged.totalPages} total={paged.total} pageSize={paged.pageSize} onPrev={paged.prev} onNext={paged.next} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        💡 In the production build, &quot;Generate&quot; inserts idempotent{" "}
        <code className="px-1 py-0.5 rounded bg-muted">rent_schedule</code> rows (one per active lease)
        into Postgres, guarded by a unique constraint on{" "}
        <code className="px-1 py-0.5 rounded bg-muted">(leaseId, month, year)</code> — so re-running
        never creates duplicates. Here it&apos;s simulated in-memory from your real data.
      </p>
    </div>
  );
}
