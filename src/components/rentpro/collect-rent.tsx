"use client";

import { useEffect, useState, useCallback } from "react";
import QRCode from "qrcode";
import {
  Wallet, Search, Phone, ArrowRight, CheckCircle2, AlertCircle, Printer,
  Banknote, Smartphone, Landmark, Clock, Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { money, shortDate } from "@/lib/format";
import { usePagination } from "@/lib/use-pagination";
import { Pager } from "@/components/rentpro/pager";
import { toast } from "sonner";

interface TenantSummary {
  id: number; code: string; name: string; mobile: string | null;
  status: "ACTIVE" | "GONE"; leaseCount: number;
  outstandingCount: number; outstandingTotal: number; advanceBalance: number;
}
interface DueRow {
  leaseId: number; month: string; year: string; propertyName: string; unitName: string;
  rent: number; gasBill: number; serviceCharge: number; otherBill: number;
  total: number; collected: number; remaining: number;
  status: "DUE" | "PARTIAL" | "OVERDUE" | "PAID";
}
interface Ledger {
  tenant: { id: number; name: string; mobile: string | null; code: string; status: string; advanceBalance: number };
  leases: Array<{ id: number; propertyName: string; unitName: string; rent: number; status: string }>;
  dueRows: DueRow[];
  outstandingTotal: number; outstandingCount: number;
  recentCollections: Array<{ id: number; month: string; year: string; rent: number; receiveDate: string | null; status: string }>;
}
interface Receipt {
  receiptNo: string; receiptId: number; date: string;
  tenantName: string; tenantMobile: string | null; tenantCode: string;
  propertyName: string; unitName: string; leaseId: number;
  month: string; year: string;
  lineItems: Array<{ label: string; amount: number }>;
  total: number; advanceAdjusted: number; netPayable: number;
  method: string; payLater: boolean; note: string; qrData: string;
}

function StatusBadge({ status }: { status: DueRow["status"] }) {
  if (status === "OVERDUE")
    return <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100">Overdue</Badge>;
  if (status === "PARTIAL")
    return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Partial</Badge>;
  return <Badge variant="outline" className="text-blue-700 border-blue-300">Due</Badge>;
}

function todayLocal(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 10);
}

export function CollectRentView({ month, year, initialTenantId }: { month: string; year: string; initialTenantId?: number | null }) {
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(initialTenantId ?? null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loadingTenants, setLoadingTenants] = useState(true);
  const [loadingLedger, setLoadingLedger] = useState(false);

  // collect dialog
  const [collectRow, setCollectRow] = useState<DueRow | null>(null);
  const [fRent, setFRent] = useState(0);
  const [fGas, setFGas] = useState(0);
  const [fService, setFService] = useState(0);
  const [fOther, setFOther] = useState(0);
  const [method, setMethod] = useState<"CASH" | "BANK" | "MOBILE_BANK">("CASH");
  const [advanceAdjust, setAdvanceAdjust] = useState(0);
  const [payLater, setPayLater] = useState(false);
  const [note, setNote] = useState("");
  const [receiveDate, setReceiveDate] = useState(todayLocal());
  const [submitting, setSubmitting] = useState(false);

  // receipt dialog
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [qrUrl, setQrUrl] = useState<string>("");

  // load tenant list
  const refreshTenants = useCallback(async () => {
    setLoadingTenants(true);
    try {
      const r = await fetch(`/api/tenants?month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`);
      const d = await r.json();
      setTenants(d.tenants ?? []);
    } catch {
      toast.error("Failed to load tenants");
    } finally {
      setLoadingTenants(false);
    }
  }, [month, year]);

  // load selected tenant's ledger
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

  useEffect(() => { refreshTenants(); }, [refreshTenants]);
  useEffect(() => { refreshLedger(); }, [refreshLedger]);

  // QR for receipt
  useEffect(() => {
    if (!receipt) { setQrUrl(""); return; }
    QRCode.toDataURL(receipt.qrData, { margin: 1, width: 160 })
      .then(setQrUrl)
      .catch(() => setQrUrl(""));
  }, [receipt]);

  const filtered = tenants.filter((t) =>
    !search ||
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.code.includes(search) ||
    (t.mobile ?? "").includes(search)
  );
  const paged = usePagination(filtered, 10);
  const duePaged = usePagination(ledger?.dueRows ?? [], 8);

  function openCollect(row: DueRow) {
    setCollectRow(row);
    setFRent(row.rent);
    setFGas(row.gasBill);
    setFService(row.serviceCharge);
    setFOther(row.otherBill);
    setMethod("CASH");
    setAdvanceAdjust(0);
    setPayLater(false);
    setNote("");
    setReceiveDate(todayLocal());
  }

  function presetFull() {
    if (!collectRow) return;
    setFRent(collectRow.rent); setFGas(collectRow.gasBill);
    setFService(collectRow.serviceCharge); setFOther(collectRow.otherBill);
    setAdvanceAdjust(0); setPayLater(false);
  }
  function presetAdvance() {
    if (!collectRow || !ledger) return;
    const total = fRent + fGas + fService + fOther;
    const avail = ledger.tenant.advanceBalance;
    setAdvanceAdjust(Math.min(avail, total));
    setPayLater(false);
  }
  function presetPayLater() {
    if (!collectRow) return;
    setFRent(collectRow.rent); setFGas(collectRow.gasBill);
    setFService(collectRow.serviceCharge); setFOther(collectRow.otherBill);
    setAdvanceAdjust(0); setPayLater(true);
  }

  const formTotal = fRent + fGas + fService + fOther;
  const netPayable = Math.max(0, formTotal - (payLater ? 0 : advanceAdjust));

  async function submitCollect() {
    if (!collectRow || !ledger) return;
    if (formTotal <= 0) { toast.error("Enter an amount greater than zero."); return; }
    setSubmitting(true);
    try {
      const r = await fetch("/api/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: ledger.tenant.id,
          leaseId: collectRow.leaseId,
          month: collectRow.month,
          year: collectRow.year,
          rent: fRent, gasBill: fGas, serviceCharge: fService, otherBill: fOther,
          method, advanceAdjust: payLater ? 0 : advanceAdjust,
          payLater, note, receiveDate,
        }),
      });
      const d = await r.json();
      if (d.ok && d.receipt) {
        toast.success(`Collected ${money(d.receipt.netPayable)} — ${d.receipt.receiptNo}`);
        setCollectRow(null);
        setReceipt(d.receipt);
        refreshLedger();
        refreshTenants();
      } else {
        toast.error(d.error ?? "Collection failed");
      }
    } catch {
      toast.error("Collection failed");
    } finally {
      setSubmitting(false);
    }
  }

  function printReceipt(rcpt: Receipt) {
    const items = rcpt.lineItems
      .map((it) => `<tr><td>${it.label}</td><td style="text-align:right">${money(it.amount)}</td></tr>`)
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${rcpt.receiptNo}</title>
      <style>
        * { font-family: -apple-system, system-ui, sans-serif; }
        body { padding: 24px; color: #111; max-width: 480px; margin: 0 auto; }
        h1 { font-size: 18px; margin: 0 0 4px; }
        .muted { color: #666; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
        td, th { padding: 6px 0; border-bottom: 1px solid #eee; }
        .total { font-weight: 700; font-size: 15px; }
        .qr { text-align: center; margin: 12px 0; }
        .footer { margin-top: 16px; font-size: 11px; color: #666; text-align: center; border-top: 1px solid #eee; padding-top: 8px; }
      </style></head>
      <body>
        <h1>RentPro — Money Receipt</h1>
        <div class="muted">${rcpt.propertyName} · ${rcpt.unitName}</div>
        <div class="muted">Receipt No: <strong>${rcpt.receiptNo}</strong> &nbsp; Date: ${shortDate(rcpt.date)}</div>
        <hr style="margin:8px 0">
        <table>
          <tr><td>Tenant</td><td style="text-align:right">${rcpt.tenantName} (${rcpt.tenantCode})</td></tr>
          <tr><td>Mobile</td><td style="text-align:right">${rcpt.tenantMobile ?? "—"}</td></tr>
          <tr><td>Period</td><td style="text-align:right">${rcpt.month} ${rcpt.year}</td></tr>
        </table>
        <table>
          <thead><tr><th style="text-align:left">Particulars</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody>${items}
          <tr><td>Total</td><td style="text-align:right">${money(rcpt.total)}</td></tr>
          ${rcpt.advanceAdjusted ? `<tr><td>Less: Advance Adjusted</td><td style="text-align:right">- ${money(rcpt.advanceAdjusted)}</td></tr>` : ""}
        </table>
        <div class="total" style="text-align:right">Net Payable: ${money(rcpt.netPayable)} ${rcpt.payLater ? "(Pay Later)" : `via ${rcpt.method}`}</div>
        ${qrUrl ? `<div class="qr"><img src="${qrUrl}" width="120" height="120" alt="QR"/><div class="muted">Scan to verify</div></div>` : ""}
        ${rcpt.note ? `<div class="muted">Note: ${rcpt.note}</div>` : ""}
        <div class="footer">RentPro · Multi-tenant SaaS ready · Generated ${shortDate(rcpt.date)}</div>
      </body></html>`;
    const w = window.open("", "_blank", "width=520,height=720");
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
          <Wallet className="size-6 text-emerald-600" />
          Collect Rent
        </h1>
        <p className="text-sm text-muted-foreground">
          Pick a tenant, see every outstanding month in one list, collect{" "}
          <span className="text-foreground">full / partial / advance-adjust / pay-later</span>{" "}
          — with an auto-generated receipt. Period: {month} {year}.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* Tenant picker */}
        <Card className="lg:col-span-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Tenants</CardTitle>
            <CardDescription>Sorted by outstanding amount</CardDescription>
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search name / code / mobile"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-[26rem]">
              <div className="divide-y">
                {loadingTenants ? (
                  [0, 1, 2, 3].map((i) => (
                    <div key={i} className="p-3"><Skeleton className="h-12 rounded" /></div>
                  ))
                ) : paged.pageItems.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground text-center">No tenants.</div>
                ) : paged.pageItems.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                      selectedId === t.id ? "bg-accent" : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{t.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {t.code} · {t.leaseCount} lease{t.leaseCount > 1 ? "s" : ""}
                        {t.advanceBalance > 0 && <> · adv {money(t.advanceBalance)}</>}
                      </div>
                    </div>
                    {t.outstandingCount > 0 ? (
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

        {/* Ledger / due months */}
        <Card className="lg:col-span-8">
          <CardContent className="p-0">
            {!selectedId ? (
              <div className="h-[32rem] grid place-items-center text-center">
                <div>
                  <Wallet className="size-10 text-muted-foreground/40 mx-auto mb-2" />
                  <div className="text-sm text-muted-foreground">Select a tenant to see their outstanding months.</div>
                </div>
              </div>
            ) : loadingLedger || !ledger ? (
              <div className="p-6 space-y-3">
                <Skeleton className="h-16 rounded" />
                <Skeleton className="h-64 rounded" />
              </div>
            ) : (
              <div>
                {/* Tenant header */}
                <div className="p-4 border-b flex flex-wrap items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-lg flex items-center gap-2">
                      {ledger.tenant.name}
                      {ledger.tenant.status === "GONE" && <Badge variant="secondary" className="text-[10px]">Gone</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {ledger.tenant.code} · {ledger.leases.length} lease(s)
                      {ledger.tenant.mobile && <> · {ledger.tenant.mobile}</>}
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Outstanding</div>
                      <div className="font-bold text-rose-600 dark:text-rose-400">{money(ledger.outstandingTotal)}</div>
                      <div className="text-[10px] text-muted-foreground">{ledger.outstandingCount} months</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Advance</div>
                      <div className="font-bold text-emerald-600 dark:text-emerald-400">{money(ledger.tenant.advanceBalance)}</div>
                      <div className="text-[10px] text-muted-foreground">held</div>
                    </div>
                  </div>
                </div>

                {/* Due rows */}
                <ScrollArea className="max-h-[24rem]">
                  <div className="divide-y">
                    {duePaged.pageItems.length === 0 ? (
                      <div className="p-8 text-center text-sm text-muted-foreground">
                        🎉 No outstanding months for {ledger.tenant.name}.
                      </div>
                    ) : duePaged.pageItems.map((r, i) => (
                      <div key={`${r.leaseId}-${r.month}-${r.year}`} className="px-4 py-3 hover:bg-muted/40">
                        <div className="flex items-center gap-3">
                          <div className="size-9 rounded-lg bg-muted grid place-items-center text-xs font-semibold shrink-0">
                            {String(i + 1).padStart(2, "0")}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm">
                              {r.month} {r.year} <span className="text-muted-foreground font-normal">· {r.propertyName} · {r.unitName}</span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Rent {money(r.rent)}
                              {r.gasBill ? <> · Gas {money(r.gasBill)}</> : null}
                              {r.serviceCharge ? <> · Service {money(r.serviceCharge)}</> : null}
                              {r.collected > 0 && <> · Already paid {money(r.collected)}</>}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-sm">{money(r.remaining)}</div>
                            <div className="text-[10px] text-muted-foreground">remaining</div>
                          </div>
                          <StatusBadge status={r.status} />
                          <Button size="sm" onClick={() => openCollect(r)}>
                            Collect <ArrowRight className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                <Pager page={duePaged.page} totalPages={duePaged.totalPages} total={duePaged.total} pageSize={duePaged.pageSize} onPrev={duePaged.prev} onNext={duePaged.next} />

                {/* Recent collections */}
                {ledger.recentCollections.length > 0 && (
                  <div className="border-t">
                    <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent payments</div>
                    <ScrollArea className="max-h-40">
                      <div className="divide-y">
                        {ledger.recentCollections.map((c) => (
                          <div key={c.id} className="px-4 py-2 flex items-center gap-3 text-sm">
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

      {/* Collect dialog */}
      <Dialog open={!!collectRow} onOpenChange={(o) => !o && setCollectRow(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Collect Rent — {collectRow?.month} {collectRow?.year}</DialogTitle>
            <DialogDescription>
              {collectRow?.propertyName} · {collectRow?.unitName} · {ledger?.tenant.name}
            </DialogDescription>
          </DialogHeader>

          {collectRow && (
            <div className="space-y-4">
              {/* presets */}
              <div className="grid grid-cols-3 gap-2">
                <Button type="button" variant="outline" size="sm" onClick={presetFull}>
                  <CheckCircle2 className="size-3.5" /> Full
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={presetAdvance} disabled={(ledger?.tenant.advanceBalance ?? 0) <= 0}>
                  <Wallet className="size-3.5" /> From Advance
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={presetPayLater}>
                  <Clock className="size-3.5" /> Pay Later
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground -mt-2">
                Edit any amount below for a <strong>partial</strong> collection.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Rent</Label>
                  <Input type="number" value={fRent} onChange={(e) => setFRent(Number(e.target.value))} />
                </div>
                <div>
                  <Label className="text-xs">Gas Bill</Label>
                  <Input type="number" value={fGas} onChange={(e) => setFGas(Number(e.target.value))} />
                </div>
                <div>
                  <Label className="text-xs">Service Charge</Label>
                  <Input type="number" value={fService} onChange={(e) => setFService(Number(e.target.value))} />
                </div>
                <div>
                  <Label className="text-xs">Other Bill</Label>
                  <Input type="number" value={fOther} onChange={(e) => setFOther(Number(e.target.value))} />
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Payment Method</Label>
                  <Select value={method} onValueChange={(v) => setMethod(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CASH"><span className="flex items-center gap-2"><Banknote className="size-3.5" /> Cash</span></SelectItem>
                      <SelectItem value="BANK"><span className="flex items-center gap-2"><Landmark className="size-3.5" /> Bank</span></SelectItem>
                      <SelectItem value="MOBILE_BANK"><span className="flex items-center gap-2"><Smartphone className="size-3.5" /> Mobile</span></SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Receive Date</Label>
                  <Input type="date" value={receiveDate} onChange={(e) => setReceiveDate(e.target.value)} />
                </div>
              </div>

              <div>
                <Label className="text-xs">Adjust from Advance (avail: {money(ledger?.tenant.advanceBalance ?? 0)})</Label>
                <Input
                  type="number" value={advanceAdjust}
                  disabled={payLater}
                  onChange={(e) => setAdvanceAdjust(Number(e.target.value))}
                  placeholder="0"
                />
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium flex items-center gap-2"><Clock className="size-4" /> Pay Later</div>
                  <div className="text-[11px] text-muted-foreground">Record the due now; collect cash later.</div>
                </div>
                <Switch checked={payLater} onCheckedChange={setPayLater} />
              </div>

              <div>
                <Label className="text-xs">Note</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
              </div>

              <div className="flex items-center justify-between rounded-md bg-muted/60 px-4 py-3">
                <span className="text-sm font-medium">Net Payable</span>
                <span className="text-lg font-bold">{money(netPayable)}</span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCollectRow(null)}>Cancel</Button>
            <Button onClick={submitCollect} disabled={submitting || formTotal <= 0}>
              {submitting ? <><Sparkles className="size-4 animate-pulse" /> Saving…</> : <>Collect {money(netPayable)}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receipt dialog */}
      <Dialog open={!!receipt} onOpenChange={(o) => !o && setReceipt(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-emerald-600" /> Payment Recorded
            </DialogTitle>
            <DialogDescription>Receipt {receipt?.receiptNo}</DialogDescription>
          </DialogHeader>
          {receipt && (
            <div className="space-y-3">
              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tenant</span>
                  <span className="font-medium">{receipt.tenantName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Unit</span>
                  <span className="font-medium text-right">{receipt.propertyName}<br/>{receipt.unitName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Period</span>
                  <span className="font-medium">{receipt.month} {receipt.year}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Method</span>
                  <span className="font-medium">{receipt.payLater ? "Pay Later" : receipt.method}</span>
                </div>
                <Separator />
                <table className="w-full text-sm">
                  <tbody>
                    {receipt.lineItems.map((it) => (
                      <tr key={it.label}><td>{it.label}</td><td className="text-right">{money(it.amount)}</td></tr>
                    ))}
                    <tr className="font-medium"><td>Total</td><td className="text-right">{money(receipt.total)}</td></tr>
                    {receipt.advanceAdjusted > 0 && (
                      <tr><td>Less: Advance</td><td className="text-right">- {money(receipt.advanceAdjusted)}</td></tr>
                    )}
                  </tbody>
                </table>
                <Separator />
                <div className="flex justify-between items-center">
                  <span className="font-semibold">Net Payable</span>
                  <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{money(receipt.netPayable)}</span>
                </div>
              </div>
              {qrUrl && (
                <div className="flex flex-col items-center gap-1 py-2">
                  <img src={qrUrl} alt="Receipt QR" width={120} height={120} />
                  <span className="text-[11px] text-muted-foreground">Scan to verify</span>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceipt(null)}>Close</Button>
            <Button onClick={() => receipt && printReceipt(receipt)}>
              <Printer className="size-4" /> Print Receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
