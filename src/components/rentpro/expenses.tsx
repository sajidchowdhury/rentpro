"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Receipt, CheckCircle2, AlertTriangle, History, Plus, Zap, Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/lib/format";
import { usePagination } from "@/lib/use-pagination";
import { Pager } from "@/components/rentpro/pager";
import { toast } from "sonner";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface ExpenseTypeStatus {
  headId: number; name: string;
  recurring: boolean; recordCount: number;
  recordedInAsOf: boolean; asOfAmount: number; predictedAmount: number;
  lastRecorded: { month: string; year: string; amount: number } | null;
  missingMonths: { month: string; year: string }[];
  recent: { month: string; year: string; amount: number }[];
  backfilledCount: number;
}
interface Tracker {
  month: string; year: string;
  types: ExpenseTypeStatus[];
  recordedCount: number; recordedTotal: number;
  dueCount: number; dueTotal: number;
  backfillCount: number;
}

function todayLocal(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

export function ExpensesView({ month, year }: { month: string; year: string }) {
  const [tracker, setTracker] = useState<Tracker | null>(null);
  const [heads, setHeads] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // record dialog
  const [open, setOpen] = useState(false);
  const [dHeadId, setDHeadId] = useState<number | null>(null);
  const [dMonth, setDMonth] = useState(month);
  const [dYear, setDYear] = useState(year);
  const [dAmount, setDAmount] = useState(0);
  const [dDate, setDDate] = useState(todayLocal());
  const [dNote, setDNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [batchMissing, setBatchMissing] = useState<{ month: string; year: string }[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/expenses?month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`);
      const d = await r.json();
      setTracker(d as Tracker);
    } catch {
      toast.error("Failed to load expenses");
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    fetch("/api/expense-heads").then((r) => r.json()).then((d) => setHeads(d.heads ?? [])).catch(() => {});
  }, []);

  function openRecord(t: ExpenseTypeStatus) {
    setDHeadId(t.headId);
    const firstMissing = t.missingMonths[0];
    setDMonth(firstMissing?.month ?? month);
    setDYear(firstMissing?.year ?? year);
    setDAmount(t.predictedAmount || t.lastRecorded?.amount || 0);
    setDDate(todayLocal());
    setDNote("");
    setBatchMissing(t.missingMonths);
    setOpen(true);
  }

  function openNew() {
    setDHeadId(heads[0]?.id ?? null);
    setDMonth(month); setDYear(year);
    setDAmount(0); setDDate(todayLocal()); setDNote("");
    setBatchMissing([]);
    setOpen(true);
  }

  async function submitRecord(batch: boolean) {
    if (!dHeadId) { toast.error("Pick an expense type."); return; }
    if (!batch && dAmount <= 0) { toast.error("Amount must be greater than zero."); return; }
    setSubmitting(true);
    try {
      if (batch && batchMissing.length > 0) {
        const r = await fetch("/api/record-expense-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: batchMissing.map((m) => ({
              accountHeadId: dHeadId, month: m.month, year: m.year,
              amount: dAmount, date: dDate, note: dNote || `Back-filled ${dAmount}`,
            })),
          }),
        });
        const d = await r.json();
        if (d.ok) toast.success(`Recorded ${batchMissing.length} missing months (${money(dAmount)} each)`);
        else toast.error(d.errors?.join("; ") || "Batch failed");
      } else {
        const r = await fetch("/api/record-expense", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountHeadId: dHeadId, month: dMonth, year: dYear,
            amount: dAmount, date: dDate, note: dNote,
          }),
        });
        const d = await r.json();
        if (!d.ok) { toast.error(d.error || "Record failed"); return; }
        toast.success(`Recorded ${money(dAmount)} for ${dMonth} ${dYear}`);
      }
      setOpen(false);
      refresh();
    } catch {
      toast.error("Record failed");
    } finally {
      setSubmitting(false);
    }
  }

  const typesPaged = usePagination(tracker?.types ?? [], 12);
  const duePaged = usePagination(tracker ? tracker.types.filter((t) => t.recurring && !t.recordedInAsOf) : [], 8);

  if (loading || !tracker) {
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

  const dueTypes = tracker.types.filter((t) => t.recurring && !t.recordedInAsOf);
  const recordedTypes = tracker.types.filter((t) => t.recordedInAsOf);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Receipt className="size-6 text-rose-600" />
            Recurring Expenses
          </h1>
          <p className="text-sm text-muted-foreground">
            Never miss a monthly bill — see what&apos;s recorded vs. due for {month} {year}, and back-fill missed months.
          </p>
        </div>
        <Button onClick={openNew} variant="outline">
          <Plus className="size-4" /> Record Expense
        </Button>
      </div>

      {/* Summary */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="size-11 rounded-lg grid place-items-center bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="size-5" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Recorded This Month</div>
              <div className="text-xl font-bold">{tracker.recordedCount} types</div>
              <div className="text-xs text-muted-foreground">{money(tracker.recordedTotal)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="size-11 rounded-lg grid place-items-center bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
              <AlertTriangle className="size-5" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Due This Month</div>
              <div className="text-xl font-bold">{tracker.dueCount} types</div>
              <div className="text-xs text-muted-foreground">~ {money(tracker.dueTotal)} predicted</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="size-11 rounded-lg grid place-items-center bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300">
              <History className="size-5" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Back-fill Needed</div>
              <div className="text-xl font-bold">{tracker.backfillCount} months</div>
              <div className="text-xs text-muted-foreground">across {dueTypes.length} recurring types</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Due / missing — the pain point */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="size-4 text-rose-600" />
            Due &amp; Missing — {month} {year}
          </CardTitle>
          <CardDescription>Recurring expenses not yet recorded this month, with their missing months</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[24rem]">
            <div className="divide-y">
              {duePaged.pageItems.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  🎉 All recurring expenses are recorded for {month} {year}.
                </div>
              ) : duePaged.pageItems.map((t) => (
                <div key={t.headId} className="px-4 py-3 hover:bg-muted/40">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm flex items-center gap-2">
                        {t.name}
                        <Badge variant="secondary" className="text-[10px]">Recurring</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Last recorded: {t.lastRecorded ? `${t.lastRecorded.month} ${t.lastRecorded.year} (${money(t.lastRecorded.amount)})` : "—"}
                        {" · "}Predicted: {money(t.predictedAmount)}
                      </div>
                      {t.missingMonths.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {t.missingMonths.slice(-5).map((m) => (
                            <span key={`${m.month}-${m.year}`} className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                              {m.month.slice(0, 3)} {m.year}
                            </span>
                          ))}
                          {t.missingMonths.length > 5 && (
                            <span className="text-[10px] px-1.5 py-0.5 text-muted-foreground">+{t.missingMonths.length - 5} more</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {t.missingMonths.length > 0 && (
                        <Button size="sm" variant="outline" onClick={() => openRecord(t)}>
                          <Zap className="size-3.5" /> Record {t.missingMonths.length} mo
                        </Button>
                      )}
                      <Button size="sm" onClick={() => openRecord(t)}>
                        Record <Receipt className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          <Pager page={duePaged.page} totalPages={duePaged.totalPages} total={duePaged.total} pageSize={duePaged.pageSize} onPrev={duePaged.prev} onNext={duePaged.next} />
        </CardContent>
      </Card>

      {/* Recorded this month */}
      {recordedTypes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-600" />
              Recorded This Month — {money(tracker.recordedTotal)}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-64">
              <div className="divide-y">
                {recordedTypes.map((t) => (
                  <div key={t.headId} className="px-4 py-3 flex items-center gap-3 hover:bg-muted/40">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{t.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.recurring ? "Recurring" : "One-off"} · {t.recordCount} months on record
                        {t.backfilledCount > 0 && <> · {t.backfilledCount} back-filled</>}
                      </div>
                    </div>
                    <div className="font-semibold text-sm">{money(t.asOfAmount)}</div>
                    <Button size="sm" variant="ghost" onClick={() => openRecord(t)}>+ Month</Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Full table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Expense Types</CardTitle>
          <CardDescription>Recent history per type (last 6 months)</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="max-h-96">
            <div className="divide-y">
              {typesPaged.pageItems.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No expense records yet.</div>
              ) : typesPaged.pageItems.map((t) => (
                <div key={t.headId} className="px-4 py-3 hover:bg-muted/40">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm flex items-center gap-2">
                        {t.name}
                        {t.recurring
                          ? <Badge variant="secondary" className="text-[10px]">Recurring</Badge>
                          : <Badge variant="outline" className="text-[10px]">One-off</Badge>}
                      </div>
                      {/* recent history as compact text */}
                      {t.recent.length > 0 && (
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[10px] text-muted-foreground">
                          {t.recent.slice().reverse().map((r, i) => (
                            <span key={i} title={`${r.month} ${r.year}`}>
                              {r.month.slice(0, 3)} {r.year.slice(-2)}: <span className="font-medium text-foreground">{money(r.amount)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right w-24">
                      {t.recordedInAsOf ? (
                        <>
                          <div className="text-xs text-emerald-600 dark:text-emerald-400">Recorded</div>
                          <div className="font-semibold text-sm">{money(t.asOfAmount)}</div>
                        </>
                      ) : t.recurring ? (
                        <>
                          <div className="text-xs text-rose-600 dark:text-rose-400">Missing</div>
                          <div className="text-xs text-muted-foreground">~ {money(t.predictedAmount)}</div>
                        </>
                      ) : (
                        <div className="text-xs text-muted-foreground">—</div>
                      )}
                    </div>
                    {t.missingMonths.length > 0 && (
                      <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100 text-[10px]">{t.missingMonths.length} due</Badge>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => openRecord(t)}>Record</Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          <Pager page={typesPaged.page} totalPages={typesPaged.totalPages} total={typesPaged.total} pageSize={typesPaged.pageSize} onPrev={typesPaged.prev} onNext={typesPaged.next} />
        </CardContent>
      </Card>

      {/* Record dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Expense</DialogTitle>
            <DialogDescription>
              {batchMissing.length > 0
                ? `${batchMissing.length} missing month(s) for this type — record them all (back-fill) or pick one.`
                : "Record a monthly expense. Recording a past month = back-fill."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-xs">Expense Type</Label>
              <Select value={String(dHeadId ?? "")} onValueChange={(v) => setDHeadId(Number(v))}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {heads.map((h) => (
                    <SelectItem key={h.id} value={String(h.id)}>{h.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">For Month</Label>
                <Select value={dMonth} onValueChange={setDMonth}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Year</Label>
                <Input type="number" value={dYear} onChange={(e) => setDYear(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Amount (৳)</Label>
                <Input type="number" value={dAmount} onChange={(e) => setDAmount(Number(e.target.value))} />
              </div>
              <div>
                <Label className="text-xs">Recorded Date</Label>
                <Input type="date" value={dDate} onChange={(e) => setDDate(e.target.value)} />
              </div>
            </div>

            <div>
              <Label className="text-xs">Note</Label>
              <Input value={dNote} onChange={(e) => setDNote(e.target.value)} placeholder="optional" />
            </div>

            {batchMissing.length > 1 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 p-3 text-xs text-amber-800 dark:text-amber-200">
                <div className="flex items-center gap-2 font-medium mb-1">
                  <History className="size-3.5" /> Back-fill available
                </div>
                {batchMissing.length} missing month(s): {batchMissing.map((m) => `${m.month.slice(0, 3)} ${m.year}`).join(", ")}
              </div>
            )}
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            {batchMissing.length > 1 && (
              <Button variant="secondary" onClick={() => submitRecord(true)} disabled={submitting}>
                <Zap className="size-4" /> Record all {batchMissing.length} months
              </Button>
            )}
            <Button onClick={() => submitRecord(false)} disabled={submitting || dAmount <= 0}>
              {submitting ? "Saving…" : <>Record {money(dAmount)}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
