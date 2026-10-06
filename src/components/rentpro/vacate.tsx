"use client";

import { useEffect, useState, useCallback } from "react";
import QRCode from "qrcode";
import {
  DoorOpen, CheckCircle2, AlertCircle, Wallet, ArrowRight, ArrowLeft,
  Printer, Home, UserX, Sparkles, Calendar,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { money, shortDate } from "@/lib/format";
import { toast } from "sonner";

interface ActiveLease {
  leaseId: number; tenantId: number; tenantName: string; tenantCode: string;
  mobile: string | null; unitId: number; unitName: string; propertyName: string;
  rent: number; advance: number; outstandingMonths: number; outstandingTotal: number;
  advanceBalance: number; agreementStart: string | null;
}
interface Preview {
  lease: {
    id: number; tenantId: number; tenantName: string; tenantCode: string;
    mobile: string | null; unitId: number; unitName: string; propertyName: string;
    rent: number; gasBill: number; serviceCharge: number; otherBill: number;
    agreementStart: string | null; advancePayment: number;
  };
  vacateDate: string;
  outstandingMonths: { month: string; year: string; rent: number; bills: number; total: number }[];
  outstandingRentTotal: number; outstandingBillsTotal: number; outstandingTotal: number;
  advanceBalance: number;
  suggestedType: "REFUND" | "ADJUST" | "BOTH";
  suggestedAdjust: number; suggestedRefund: number;
  suggestedNetPayable: number; suggestedNetRefund: number;
}
interface Settlement {
  id: number; leaseId: number; tenantId: number; unitId: number;
  propertyName: string; unitName: string; tenantName: string;
  vacateDate: string; outstandingRent: number; outstandingBills: number;
  advanceBalance: number; advanceAdjusted: number; advanceRefunded: number;
  netPayableByTenant: number; netRefundByOwner: number;
  settlementType: "REFUND" | "ADJUST" | "BOTH"; tenantMarkedGone: boolean;
  note: string; settledAt: string;
}

const STEPS = ["Confirm", "Outstanding", "Advance", "Review", "Done"];

function todayLocal(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

export function VacateView({ month, year }: { month: string; year: string }) {
  const [leases, setLeases] = useState<ActiveLease[]>([]);
  const [search, setSearch] = useState("");
  const [selectedLeaseId, setSelectedLeaseId] = useState<number | null>(null);
  const [vacateDate, setVacateDate] = useState(todayLocal());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingLeases, setLoadingLeases] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const [step, setStep] = useState(1);
  const [setType, setSetType] = useState<"REFUND" | "ADJUST" | "BOTH">("ADJUST");
  const [advanceAdjusted, setAdvanceAdjusted] = useState(0);
  const [advanceRefunded, setAdvanceRefunded] = useState(0);
  const [note, setNote] = useState("");
  const [settling, setSettling] = useState(false);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [qrUrl, setQrUrl] = useState("");

  const refreshLeases = useCallback(async () => {
    setLoadingLeases(true);
    try {
      const r = await fetch(`/api/active-leases?month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`);
      const d = await r.json();
      setLeases(d.leases ?? []);
    } catch {
      toast.error("Failed to load active leases");
    } finally {
      setLoadingLeases(false);
    }
  }, [month, year]);

  useEffect(() => { refreshLeases(); }, [refreshLeases]);

  // fetch preview when lease + date chosen
  useEffect(() => {
    if (!selectedLeaseId || !vacateDate) { setPreview(null); return; }
    let cancelled = false;
    setLoadingPreview(true);
    fetch(`/api/settlement-preview?leaseId=${selectedLeaseId}&vacateDate=${encodeURIComponent(vacateDate)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) { setPreview(null); return; }
        setPreview(d as Preview);
        setSetType(d.suggestedType);
        setAdvanceAdjusted(d.suggestedAdjust);
        setAdvanceRefunded(d.suggestedRefund);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingPreview(false); });
    return () => { cancelled = true; };
  }, [selectedLeaseId, vacateDate]);

  // QR for settlement statement
  useEffect(() => {
    if (!settlement) { setQrUrl(""); return; }
    const data = `RENTPRO|SETTLE|${settlement.id}|${settlement.tenantName}|${settlement.vacateDate}|net=${settlement.netPayableByTenant - settlement.netRefundByOwner}`;
    QRCode.toDataURL(data, { margin: 1, width: 140 }).then(setQrUrl).catch(() => setQrUrl(""));
  }, [settlement]);

  const filtered = leases.filter((l) =>
    !search ||
    l.tenantName.toLowerCase().includes(search.toLowerCase()) ||
    l.tenantCode.includes(search) ||
    l.unitName.toLowerCase().includes(search.toLowerCase())
  );

  const selectedLease = leases.find((l) => l.leaseId === selectedLeaseId) ?? null;

  function startSettlement(l: ActiveLease) {
    setSelectedLeaseId(l.leaseId);
    setVacateDate(todayLocal());
    setSettlement(null);
    setStep(1);
  }

  function useSuggested() {
    if (!preview) return;
    setSetType(preview.suggestedType);
    setAdvanceAdjusted(preview.suggestedAdjust);
    setAdvanceRefunded(preview.suggestedRefund);
  }

  const netPayable = preview ? Math.max(0, preview.outstandingTotal - advanceAdjusted) : 0;
  const netRefund = advanceRefunded;
  const advanceOk = preview ? (advanceAdjusted + advanceRefunded) <= preview.advanceBalance : true;

  async function confirmSettle() {
    if (!preview || !selectedLeaseId) return;
    if (!advanceOk) { toast.error("Adjust + refund cannot exceed the advance held."); return; }
    setSettling(true);
    try {
      const r = await fetch("/api/settle-lease", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaseId: selectedLeaseId, vacateDate,
          advanceAdjusted, advanceRefunded, note,
        }),
      });
      const d = await r.json();
      if (d.ok && d.settlement) {
        toast.success("Settlement complete — unit is now vacant.");
        setSettlement(d.settlement as Settlement);
        setStep(5);
        refreshLeases();
      } else {
        toast.error(d.error ?? "Settlement failed");
      }
    } catch {
      toast.error("Settlement failed");
    } finally {
      setSettling(false);
    }
  }

  function reset() {
    setSelectedLeaseId(null);
    setPreview(null);
    setSettlement(null);
    setStep(1);
  }

  function printStatement(s: Settlement) {
    const net = s.netPayableByTenant - s.netRefundByOwner;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Settlement ${s.id}</title>
      <style>
        * { font-family: -apple-system, system-ui, sans-serif; }
        body { padding: 24px; color: #111; max-width: 520px; margin: 0 auto; }
        h1 { font-size: 18px; margin: 0 0 4px; }
        .muted { color: #666; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
        td, th { padding: 6px 0; border-bottom: 1px solid #eee; }
        .total { font-weight: 700; font-size: 15px; }
        .net { font-size: 18px; font-weight: 800; }
        .footer { margin-top: 16px; font-size: 11px; color: #666; text-align: center; border-top: 1px solid #eee; padding-top: 8px; }
        .badge { display:inline-block; padding:2px 8px; border-radius:4px; background:#eee; font-size:11px; }
      </style></head>
      <body>
        <h1>RentPro — Vacate Settlement Statement</h1>
        <div class="muted">${s.propertyName} · ${s.unitName}</div>
        <div class="muted">Statement #${s.id} · Vacate date: ${shortDate(s.vacateDate)} · Settled: ${shortDate(s.settledAt)}</div>
        <hr style="margin:8px 0">
        <table>
          <tr><td>Tenant</td><td style="text-align:right">${s.tenantName}</td></tr>
          <tr><td>Lease / Unit</td><td style="text-align:right">${s.unitName}</td></tr>
        </table>
        <table>
          <tr><td>Outstanding Rent</td><td style="text-align:right">${money(s.outstandingRent)}</td></tr>
          <tr><td>Outstanding Utility Bills</td><td style="text-align:right">${money(s.outstandingBills)}</td></tr>
          <tr class="total"><td>Total Outstanding</td><td style="text-align:right">${money(s.outstandingRent + s.outstandingBills)}</td></tr>
          <tr><td>Less: Advance Adjusted</td><td style="text-align:right">- ${money(s.advanceAdjusted)}</td></tr>
          <tr><td>Advance Refunded to Tenant</td><td style="text-align:right">${money(s.advanceRefunded)}</td></tr>
        </table>
        <div class="total" style="text-align:right">Net ${net >= 0 ? "payable by tenant" : "refund to tenant"}: <span class="net">${money(Math.abs(net))}</span></div>
        <div style="margin-top:8px"><span class="badge">${s.settlementType}</span> <span class="muted">Advance held was ${money(s.advanceBalance)}</span></div>
        ${qrUrl ? `<div style="text-align:center;margin:12px 0"><img src="${qrUrl}" width="120" height="120" alt="QR"/><div class="muted">Scan to verify</div></div>` : ""}
        ${s.note ? `<div class="muted">Note: ${s.note}</div>` : ""}
        <div class="footer">RentPro · Multi-tenant SaaS ready · Unit is now VACANT and available for re-rent.</div>
      </body></html>`;
    const w = window.open("", "_blank", "width=560,height=760");
    if (!w) { toast.error("Pop-up blocked — allow pop-ups to print."); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 250);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <DoorOpen className="size-6 text-amber-600" />
          Vacate &amp; Settlement
        </h1>
        <p className="text-sm text-muted-foreground">
          Guided move-out: settles all dues, refunds/adjusts the advance, frees the room — in one flow. Period: {month} {year}.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* Active leases picker */}
        <Card className="lg:col-span-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Active Leases</CardTitle>
            <CardDescription>Tenants currently occupying a unit</CardDescription>
            <Input
              placeholder="Search tenant / code / unit"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-2 h-9"
            />
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[30rem]">
              <div className="divide-y">
                {loadingLeases ? (
                  [0, 1, 2, 3].map((i) => <div key={i} className="p-3"><Skeleton className="h-14 rounded" /></div>)
                ) : filtered.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground text-center">No active leases.</div>
                ) : filtered.map((l) => (
                  <button
                    key={l.leaseId}
                    onClick={() => startSettlement(l)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                      selectedLeaseId === l.leaseId ? "bg-accent" : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{l.tenantName}</div>
                      <div className="text-xs text-muted-foreground truncate">{l.propertyName} · {l.unitName}</div>
                    </div>
                    <div className="text-right">
                      {l.outstandingTotal > 0 ? (
                        <>
                          <div className="font-semibold text-sm text-rose-600 dark:text-rose-400">{money(l.outstandingTotal)}</div>
                          <div className="text-[10px] text-muted-foreground">{l.outstandingMonths} mo due</div>
                        </>
                      ) : (
                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-[10px]">Clear</Badge>
                      )}
                      {l.advanceBalance > 0 && (
                        <div className="text-[10px] text-emerald-600 dark:text-emerald-400">adv {money(l.advanceBalance)}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Wizard */}
        <Card className="lg:col-span-8">
          <CardContent className="p-0">
            {!selectedLeaseId ? (
              <div className="h-[32rem] grid place-items-center text-center">
                <div>
                  <DoorOpen className="size-10 text-muted-foreground/40 mx-auto mb-2" />
                  <div className="text-sm text-muted-foreground">Pick an active lease to start the settlement wizard.</div>
                </div>
              </div>
            ) : !selectedLease && !settlement ? (
              <div className="p-6 text-sm text-muted-foreground">Loading lease…</div>
            ) : (
              <div>
                {/* Stepper */}
                <div className="flex items-center gap-1 px-4 py-3 border-b overflow-x-auto">
                  {STEPS.map((label, i) => {
                    const n = i + 1;
                    const active = step === n;
                    const done = step > n;
                    return (
                      <div key={label} className="flex items-center gap-1 shrink-0">
                        <div className={`size-6 rounded-full grid place-items-center text-[11px] font-semibold ${
                          active ? "bg-primary text-primary-foreground" : done ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
                        }`}>
                          {done ? <CheckCircle2 className="size-3.5" /> : n}
                        </div>
                        <span className={`text-xs ${active ? "font-medium" : "text-muted-foreground"}`}>{label}</span>
                        {n < STEPS.length && <div className="w-4 h-px bg-border mx-1" />}
                      </div>
                    );
                  })}
                </div>

                <div className="p-5 min-h-[24rem]">
                  {/* STEP 1 — Confirm */}
                  {step === 1 && (
                    <div className="space-y-4">
                      <CardTitle className="text-base flex items-center gap-2"><Calendar className="size-4" /> Confirm move-out</CardTitle>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div><div className="text-xs text-muted-foreground">Tenant</div><div className="font-medium">{selectedLease.tenantName} ({selectedLease.tenantCode})</div></div>
                        <div><div className="text-xs text-muted-foreground">Mobile</div><div className="font-medium">{selectedLease.mobile ?? "—"}</div></div>
                        <div><div className="text-xs text-muted-foreground">Property</div><div className="font-medium">{selectedLease.propertyName}</div></div>
                        <div><div className="text-xs text-muted-foreground">Unit</div><div className="font-medium">{selectedLease.unitName}</div></div>
                        <div><div className="text-xs text-muted-foreground">Agreement start</div><div className="font-medium">{selectedLease.agreementStart ? shortDate(selectedLease.agreementStart) : "—"}</div></div>
                        <div><div className="text-xs text-muted-foreground">Monthly rent</div><div className="font-medium">{money(selectedLease.rent)}</div></div>
                      </div>
                      <div className="max-w-xs">
                        <Label className="text-xs">Vacate date</Label>
                        <Input type="date" value={vacateDate} onChange={(e) => setVacateDate(e.target.value)} />
                      </div>
                      <div className="flex justify-end">
                        <Button onClick={() => setStep(2)} disabled={loadingPreview}>
                          {loadingPreview ? "Computing…" : <>Next <ArrowRight className="size-4" /></>}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* STEP 2 — Outstanding */}
                  {step === 2 && preview && (
                    <div className="space-y-4">
                      <CardTitle className="text-base flex items-center gap-2"><AlertCircle className="size-4 text-rose-600" /> Outstanding rent &amp; bills</CardTitle>
                      {preview.outstandingMonths.length === 0 ? (
                        <div className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-2"><CheckCircle2 className="size-4" /> No outstanding months — fully paid up to {shortDate(preview.vacateDate)}.</div>
                      ) : (
                        <ScrollArea className="max-h-64">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Month</TableHead>
                                <TableHead className="text-right">Rent</TableHead>
                                <TableHead className="text-right">Bills</TableHead>
                                <TableHead className="text-right">Total</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {preview.outstandingMonths.map((m) => (
                                <TableRow key={`${m.month}-${m.year}`}>
                                  <TableCell>{m.month} {m.year}</TableCell>
                                  <TableCell className="text-right">{money(m.rent)}</TableCell>
                                  <TableCell className="text-right text-muted-foreground">{m.bills > 0 ? money(m.bills) : "—"}</TableCell>
                                  <TableCell className="text-right font-medium">{money(m.total)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </ScrollArea>
                      )}
                      <div className="grid grid-cols-3 gap-3 text-sm">
                        <div className="rounded-md bg-muted/60 p-3"><div className="text-xs text-muted-foreground">Rent due</div><div className="font-semibold">{money(preview.outstandingRentTotal)}</div></div>
                        <div className="rounded-md bg-muted/60 p-3"><div className="text-xs text-muted-foreground">Bills due</div><div className="font-semibold">{money(preview.outstandingBillsTotal)}</div></div>
                        <div className="rounded-md bg-rose-50 dark:bg-rose-950/40 p-3"><div className="text-xs text-rose-600 dark:text-rose-400">Total due</div><div className="font-bold text-rose-600 dark:text-rose-400">{money(preview.outstandingTotal)}</div></div>
                      </div>
                      <div className="flex justify-between">
                        <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft className="size-4" /> Back</Button>
                        <Button onClick={() => setStep(3)}>Next <ArrowRight className="size-4" /></Button>
                      </div>
                    </div>
                  )}

                  {/* STEP 3 — Advance */}
                  {step === 3 && preview && (
                    <div className="space-y-4">
                      <CardTitle className="text-base flex items-center gap-2"><Wallet className="size-4 text-emerald-600" /> Advance handling</CardTitle>
                      <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/40 p-3 text-sm">
                        Advance held: <span className="font-bold text-emerald-700 dark:text-emerald-400">{money(preview.advanceBalance)}</span>
                        <div className="text-xs text-muted-foreground mt-0.5">Suggested: {preview.suggestedType} — adjust {money(preview.suggestedAdjust)}, refund {money(preview.suggestedRefund)}</div>
                      </div>
                      <div className="flex gap-2">
                        {(["ADJUST", "REFUND", "BOTH"] as const).map((t) => (
                          <Button key={t} size="sm" variant={setType === t ? "default" : "outline"} onClick={() => setSetType(t)}>{t}</Button>
                        ))}
                        <Button size="sm" variant="ghost" onClick={useSuggested}><Sparkles className="size-3.5" /> Suggested</Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Adjust against due (৳)</Label>
                          <Input type="number" value={advanceAdjusted} onChange={(e) => setAdvanceAdjusted(Number(e.target.value))} />
                        </div>
                        <div>
                          <Label className="text-xs">Refund to tenant (৳)</Label>
                          <Input type="number" value={advanceRefunded} onChange={(e) => setAdvanceRefunded(Number(e.target.value))} />
                        </div>
                      </div>
                      {!advanceOk && (
                        <div className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1"><AlertCircle className="size-3.5" /> Adjust + refund ({money(advanceAdjusted + advanceRefunded)}) exceeds advance held ({money(preview.advanceBalance)}).</div>
                      )}
                      <div className="flex justify-between">
                        <Button variant="outline" onClick={() => setStep(2)}><ArrowLeft className="size-4" /> Back</Button>
                        <Button onClick={() => setStep(4)} disabled={!advanceOk}>Next <ArrowRight className="size-4" /></Button>
                      </div>
                    </div>
                  )}

                  {/* STEP 4 — Review */}
                  {step === 4 && preview && (
                    <div className="space-y-4">
                      <CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="size-4 text-emerald-600" /> Review &amp; settle</CardTitle>
                      <div className="rounded-lg border p-4 space-y-2 text-sm">
                        <div className="flex justify-between"><span className="text-muted-foreground">Total outstanding</span><span className="font-semibold">{money(preview.outstandingTotal)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Advance adjusted</span><span>- {money(advanceAdjusted)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Advance refunded</span><span>{money(advanceRefunded)}</span></div>
                        <Separator />
                        <div className="flex justify-between items-center">
                          <span className="font-medium">Net payable by tenant</span>
                          <span className="text-lg font-bold text-rose-600 dark:text-rose-400">{money(netPayable)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="font-medium">Net refund to tenant</span>
                          <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{money(netRefund)}</span>
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs">Note</Label>
                        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
                      </div>
                      <div className="rounded-md bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-800 dark:text-amber-200">
                        On confirm: the lease is closed, <strong>{selectedLease.unitName}</strong> becomes <strong>VACANT</strong>, and {selectedLease.tenantName} is marked <strong>Gone</strong> (if no other active leases).
                      </div>
                      <div className="flex justify-between">
                        <Button variant="outline" onClick={() => setStep(3)}><ArrowLeft className="size-4" /> Back</Button>
                        <Button onClick={confirmSettle} disabled={settling} variant="default">
                          {settling ? <><Sparkles className="size-4 animate-pulse" /> Settling…</> : <>Confirm &amp; Settle <DoorOpen className="size-4" /></>}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* STEP 5 — Done */}
                  {step === 5 && settlement && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 p-4">
                        <CheckCircle2 className="size-6 text-emerald-600 shrink-0" />
                        <div>
                          <div className="font-semibold text-emerald-800 dark:text-emerald-200">Settlement complete</div>
                          <div className="text-xs text-emerald-700 dark:text-emerald-300">
                            <Home className="inline size-3" /> {settlement.unitName} is now VACANT
                            {" · "}
                            {settlement.tenantMarkedGone
                              ? <><UserX className="inline size-3" /> {settlement.tenantName} marked Gone</>
                              : <>{settlement.tenantName} still has another active lease</>}
                            {" · Statement #"}{settlement.id}
                          </div>
                        </div>
                      </div>
                      <div className="rounded-lg border p-4 space-y-2 text-sm">
                        <div className="flex justify-between"><span className="text-muted-foreground">Outstanding (rent + bills)</span><span>{money(settlement.outstandingRent + settlement.outstandingBills)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Advance adjusted</span><span>- {money(settlement.advanceAdjusted)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Advance refunded</span><span>{money(settlement.advanceRefunded)}</span></div>
                        <Separator />
                        <div className="flex justify-between items-center"><span className="font-medium">Net payable by tenant</span><span className="font-bold">{money(settlement.netPayableByTenant)}</span></div>
                        <div className="flex justify-between items-center"><span className="font-medium">Net refund to tenant</span><span className="font-bold text-emerald-600 dark:text-emerald-400">{money(settlement.netRefundByOwner)}</span></div>
                      </div>
                      {qrUrl && <div className="flex justify-center"><img src={qrUrl} alt="QR" width={120} height={120} /></div>}
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={reset}>Settle another</Button>
                        <Button onClick={() => printStatement(settlement)}><Printer className="size-4" /> Print Statement</Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
