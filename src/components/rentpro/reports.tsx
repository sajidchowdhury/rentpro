"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BarChart3, Printer, BookOpen, Calendar, Layers, User, Wallet, RefreshCw, Trash2, Ban, RotateCcw, Check, ChevronsUpDown, Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { money, shortDate } from "@/lib/format";
import { usePagination } from "@/lib/use-pagination";
import { Pager } from "@/components/rentpro/pager";
import { toast } from "sonner";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// types
interface DayBookRow { date: string; particulars: string; head: string; method: "CASH" | "BANK" | "MOBILE_BANK"; income: number; expense: number; balance: number; }
interface DayBook {
  fromDate: string; toDate: string;
  opening: number; openingCash: number; openingBank: number;
  rows: DayBookRow[];
  totalIncome: number; totalExpense: number;
  cashIn: number; cashOut: number; bankIn: number; bankOut: number;
  transferCashToBank: number; transferBankToCash: number;
  net: number; closing: number; closingCash: number; closingBank: number;
}
interface YearlyMonth { month: string; rentCollected: number; income: number; expense: number; net: number; }
interface Yearly { year: string; months: YearlyMonth[]; totalRentCollected: number; totalIncome: number; totalExpense: number; totalNet: number; }
interface AccHeadRow { headId: number | null; head: string; type: string; income: number; expense: number; net: number; count: number; }
interface AccHead { month: string; year: string; rows: AccHeadRow[]; totalIncome: number; totalExpense: number; totalNet: number; }
interface LedgerEntry { date: string; particulars: string; debit: number; credit: number; balance: number; collectionId?: number | null; leaseId?: number | null; rentMonth?: string | null; rentYear?: string | null; waived?: boolean; }
interface ClientLedger { tenant: { id: number; name: string; code: string; mobile: string | null; status: string; advanceBalance: number }; leases: Array<{ id: number; propertyName: string; unitName: string; rent: number }>; asOfMonth: string; asOfYear: string; fromMonth: string; fromYear: string; openingAdvance: number; entries: LedgerEntry[]; deletedMonths: Array<{ leaseId: number; month: string; year: string; unitName: string }>; closingOutstanding: number; }
interface ClientDueRow { tenantId: number; name: string; code: string; mobile: string | null; status: string; outstandingTotal: number; outstandingCount: number; advanceBalance: number; }
interface ClientDue { month: string; year: string; rows: ClientDueRow[]; totalOutstanding: number; totalTenants: number; }
interface TenantOpt { id: number; name: string; code: string; }

function printHTML(title: string, bodyInner: string) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>
      * { font-family: -apple-system, system-ui, sans-serif; }
      body { padding: 24px; color: #111; max-width: 900px; margin: 0 auto; }
      h1 { font-size: 18px; margin: 0 0 4px; }
      .muted { color: #666; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12px; }
      th, td { padding: 5px 6px; border-bottom: 1px solid #eee; text-align: left; }
      th { background: #f7f7f7; }
      .r { text-align: right; }
      tfoot td { font-weight: 700; border-top: 2px solid #333; }
      .footer { margin-top: 16px; font-size: 11px; color: #666; text-align: center; border-top: 1px solid #eee; padding-top: 8px; }
    </style></head><body><h1>RentPro — ${title}</h1>${bodyInner}<div class="footer">RentPro · Generated ${shortDate(new Date().toISOString())}</div></body></html>`;
  const w = window.open("", "_blank", "width=980,height=760");
  if (!w) { toast.error("Pop-up blocked — allow pop-ups to print."); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 250);
}

function todayLocal(): string {
  const d = new Date(); const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

export function ReportsView({ month, year }: { month: string; year: string }) {
  const [tab, setTab] = useState("daybook");

  // day book
  const [dbFrom, setDbFrom] = useState("");
  const [dbTo, setDbTo] = useState("");
  const [daybook, setDaybook] = useState<DayBook | null>(null);
  const [dbLoading, setDbLoading] = useState(false);

  // yearly
  const [yrYear, setYrYear] = useState(year);
  const [yearly, setYearly] = useState<Yearly | null>(null);
  const [yrLoading, setYrLoading] = useState(false);

  // account head
  const [acc, setAcc] = useState<AccHead | null>(null);
  const [accLoading, setAccLoading] = useState(false);

  // client ledger
  const [tenants, setTenants] = useState<TenantOpt[]>([]);
  const [ledgerId, setLedgerId] = useState<number | null>(null);
  const [ledger, setLedger] = useState<ClientLedger | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  // "from" month for the client ledger (defaults to "" = let the API pick the earliest)
  const [ledgerFromMonth, setLedgerFromMonth] = useState("");
  const [ledgerFromYear, setLedgerFromYear] = useState("");

  // client due
  const [due, setDue] = useState<ClientDue | null>(null);
  const [dueLoading, setDueLoading] = useState(false);

  // defaults: this month range for day book
  useEffect(() => {
    if (month && year) {
      const mi = MONTHS.indexOf(month);
      const from = `${year}-${String(mi + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(Number(year), mi + 1, 0).getDate();
      const to = `${year}-${String(mi + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      setDbFrom(from); setDbTo(to);
      setYrYear(year);
    }
  }, [month, year]);

  // tenant list for client-ledger picker
  useEffect(() => {
    fetch("/api/tenants-list?month=" + encodeURIComponent(month) + "&year=" + encodeURIComponent(year))
      .then((r) => r.json())
      .then((d) => {
        const ts: TenantOpt[] = (d.tenants ?? [])
          .map((t: any) => ({ id: t.id, name: t.name, code: t.code }))
          .sort((a: TenantOpt, b: TenantOpt) => a.code.localeCompare(b.code, undefined, { numeric: true }));
        setTenants(ts);
        if (ts.length > 0 && ledgerId === null) setLedgerId(ts[0].id);
      })
      .catch(() => {});
  }, [month, year, ledgerId]);

  const fetchDaybook = useCallback(async () => {
    if (!dbFrom || !dbTo) return;
    setDbLoading(true);
    try {
      const r = await fetch(`/api/report/daybook?from=${dbFrom}&to=${dbTo}`);
      setDaybook(await r.json());
    } catch { toast.error("Failed to load day book"); }
    finally { setDbLoading(false); }
  }, [dbFrom, dbTo]);

  const fetchYearly = useCallback(async () => {
    if (!yrYear) return;
    setYrLoading(true);
    try {
      const r = await fetch(`/api/report/yearly?year=${yrYear}`);
      setYearly(await r.json());
    } catch { toast.error("Failed to load yearly report"); }
    finally { setYrLoading(false); }
  }, [yrYear]);

  const fetchAcc = useCallback(async () => {
    if (!month || !year) return;
    setAccLoading(true);
    try {
      const r = await fetch(`/api/report/account-head?month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`);
      setAcc(await r.json());
    } catch { toast.error("Failed to load account-head report"); }
    finally { setAccLoading(false); }
  }, [month, year]);

  const fetchLedger = useCallback(async () => {
    if (ledgerId === null || !month || !year) return;
    setLedgerLoading(true);
    try {
      const params = new URLSearchParams({ tenantId: String(ledgerId), month, year });
      if (ledgerFromMonth && ledgerFromYear) {
        params.set("fromMonth", ledgerFromMonth);
        params.set("fromYear", ledgerFromYear);
      }
      const r = await fetch(`/api/report/client-ledger?${params}`);
      const data = await r.json();
      setLedger(data);
      // sync the "from" selector to what the API actually used (so the
      // default earliest month is shown when the user hasn't picked one)
      if (data?.fromMonth && data?.fromYear && !ledgerFromMonth) {
        setLedgerFromMonth(data.fromMonth);
        setLedgerFromYear(data.fromYear);
      }
    } catch { toast.error("Failed to load ledger"); }
    finally { setLedgerLoading(false); }
  }, [ledgerId, month, year, ledgerFromMonth, ledgerFromYear]);

  const fetchDue = useCallback(async () => {
    if (!month || !year) return;
    setDueLoading(true);
    try {
      const r = await fetch(`/api/report/client-due?month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`);
      setDue(await r.json());
    } catch { toast.error("Failed to load client due"); }
    finally { setDueLoading(false); }
  }, [month, year]);

  // auto-fetch when the active tab's params are ready
  useEffect(() => { if (tab === "daybook" && dbFrom && dbTo && !daybook) fetchDaybook(); }, [tab, dbFrom, dbTo, daybook, fetchDaybook]);
  useEffect(() => { if (tab === "yearly" && yrYear && !yearly) fetchYearly(); }, [tab, yrYear, yearly, fetchYearly]);
  useEffect(() => { if (tab === "account" && !acc) fetchAcc(); }, [tab, acc, fetchAcc]);
  useEffect(() => { if (tab === "ledger" && ledgerId !== null && !ledger) fetchLedger(); }, [tab, ledgerId, ledger, fetchLedger]);
  useEffect(() => { if (tab === "due" && !due) fetchDue(); }, [tab, due, fetchDue]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BarChart3 className="size-6 text-blue-600" />
          Reports
        </h1>
        <p className="text-sm text-muted-foreground">Day book, client ledger, yearly, account-head-wise &amp; client-due — all printable.</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="daybook" className="gap-1"><BookOpen className="size-3.5" /> Day Book</TabsTrigger>
          <TabsTrigger value="yearly" className="gap-1"><Calendar className="size-3.5" /> Yearly</TabsTrigger>
          <TabsTrigger value="account" className="gap-1"><Layers className="size-3.5" /> Account-Head</TabsTrigger>
          <TabsTrigger value="ledger" className="gap-1"><User className="size-3.5" /> Client Ledger</TabsTrigger>
          <TabsTrigger value="due" className="gap-1"><Wallet className="size-3.5" /> Client Due</TabsTrigger>
        </TabsList>

        {/* DAY BOOK */}
        <TabsContent value="daybook">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Day Book (দৈনিক হিসাব)</CardTitle>
                  <CardDescription>All income &amp; expense transactions with a running balance</CardDescription>
                </div>
                <div className="flex items-end gap-2">
                  <div><Label className="text-xs">From</Label><Input type="date" value={dbFrom} onChange={(e) => { setDbFrom(e.target.value); setDaybook(null); }} className="h-9 w-[150px]" /></div>
                  <div><Label className="text-xs">To</Label><Input type="date" value={dbTo} onChange={(e) => { setDbTo(e.target.value); setDaybook(null); }} className="h-9 w-[150px]" /></div>
                  <Button size="sm" variant="outline" onClick={fetchDaybook}><RefreshCw className="size-3.5" /> Run</Button>
                  <Button size="sm" onClick={() => daybook && printHTML("Day Book", dayBookHTML(daybook))} disabled={!daybook}><Printer className="size-3.5" /> Print</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {dbLoading || !daybook ? (
                <Skeleton className="h-64 rounded" />
              ) : (
                <DayBookTable data={daybook} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* YEARLY */}
        <TabsContent value="yearly">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Yearly Report (বার্ষিক রিপোর্ট) — {yrYear}</CardTitle>
                  <CardDescription>Month-by-month rent collected, income, expense &amp; net</CardDescription>
                </div>
                <div className="flex items-end gap-2">
                  <div><Label className="text-xs">Year</Label><Input type="number" value={yrYear} onChange={(e) => { setYrYear(e.target.value); setYearly(null); }} className="h-9 w-[100px]" /></div>
                  <Button size="sm" variant="outline" onClick={fetchYearly}><RefreshCw className="size-3.5" /> Run</Button>
                  <Button size="sm" onClick={() => yearly && printHTML(`Yearly ${yrYear}`, yearlyHTML(yearly))} disabled={!yearly}><Printer className="size-3.5" /> Print</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {yrLoading || !yearly ? <Skeleton className="h-80 rounded" /> : <YearlyTable data={yearly} />}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ACCOUNT-HEAD */}
        <TabsContent value="account">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Account-Head-Wise (আয় ব্যয় হিসাব) — {month} {year}</CardTitle>
                  <CardDescription>Income &amp; expense grouped by account head for the selected month</CardDescription>
                </div>
                <div className="flex items-end gap-2">
                  <Button size="sm" variant="outline" onClick={fetchAcc}><RefreshCw className="size-3.5" /> Run</Button>
                  <Button size="sm" onClick={() => acc && printHTML(`Account-Head — ${month} ${year}`, accHTML(acc))} disabled={!acc}><Printer className="size-3.5" /> Print</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {accLoading || !acc ? <Skeleton className="h-64 rounded" /> : <AccTable data={acc} />}
            </CardContent>
          </Card>
        </TabsContent>

        {/* CLIENT LEDGER */}
        <TabsContent value="ledger">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Client Ledger (ভাড়াটিয়ার লেজার)</CardTitle>
                  <CardDescription>Per-tenant statement: rent due vs paid, running outstanding</CardDescription>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-[240px]">
                    <Label className="text-xs">Tenant (search by code or name)</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                          {ledgerId ? (() => {
                            const t = tenants.find((x) => x.id === ledgerId);
                            return t ? `${t.code} · ${t.name}` : "Select tenant";
                          })() : "Select tenant"}
                          <ChevronsUpDown className="size-4 opacity-50 shrink-0" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[300px] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search code or name…" />
                          <CommandList>
                            <CommandEmpty>No tenant found.</CommandEmpty>
                            <CommandGroup>
                              {tenants.map((t) => (
                                <CommandItem
                                  key={t.id}
                                  value={`${t.code} ${t.name}`}
                                  onSelect={() => { setLedgerId(t.id); setLedger(null); setLedgerFromMonth(""); setLedgerFromYear(""); }}
                                  className="flex items-center gap-2"
                                >
                                  <Check className={`size-4 ${ledgerId === t.id ? "opacity-100" : "opacity-0"}`} />
                                  <span className="font-mono text-xs">{t.code}</span>
                                  <span className="truncate">{t.name}</span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="w-[150px]">
                    <Label className="text-xs">From month</Label>
                    <Select value={ledgerFromMonth} onValueChange={(v) => { setLedgerFromMonth(v); setLedger(null); }}>
                      <SelectTrigger><SelectValue placeholder="Start" /></SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m) => <SelectItem key={m} value={m}>{m.slice(0, 3)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-[100px]">
                    <Label className="text-xs">From year</Label>
                    <Select value={ledgerFromYear} onValueChange={(v) => { setLedgerFromYear(v); setLedger(null); }}>
                      <SelectTrigger><SelectValue placeholder="Year" /></SelectTrigger>
                      <SelectContent>
                        {["2023","2024","2025","2026","2027"].map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button size="sm" variant="outline" onClick={fetchLedger}><RefreshCw className="size-3.5" /> Run</Button>
                  <Button size="sm" onClick={() => ledger && printHTML(`Client Ledger — ${ledger.tenant.name}`, ledgerHTML(ledger))} disabled={!ledger}><Printer className="size-3.5" /> Print</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {ledgerLoading || !ledger ? <Skeleton className="h-80 rounded" /> : <LedgerTable data={ledger} onChanged={fetchLedger} />}
            </CardContent>
          </Card>
        </TabsContent>

        {/* CLIENT DUE */}
        <TabsContent value="due">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Client Due (ভাড়াটিয়ার বকেয়া) — {month} {year}</CardTitle>
                  <CardDescription>All tenants with outstanding rent, sorted by amount</CardDescription>
                </div>
                <div className="flex items-end gap-2">
                  <Button size="sm" variant="outline" onClick={fetchDue}><RefreshCw className="size-3.5" /> Run</Button>
                  <Button size="sm" onClick={() => due && printHTML(`Client Due — ${month} ${year}`, dueHTML(due))} disabled={!due}><Printer className="size-3.5" /> Print</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {dueLoading || !due ? <Skeleton className="h-80 rounded" /> : <DueTable data={due} />}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- tables ---

function MethodBadge({ method }: { method: DayBookRow["method"] }) {
  if (method === "BANK") {
    return <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100 text-[10px]">Bank</Badge>;
  }
  if (method === "MOBILE_BANK") {
    return <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100 text-[10px]">Mobile</Badge>;
  }
  return <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">Cash</Badge>;
}

/** The opening / closing balance card — mirrors the legacy Day Book layout:
 *  Total | Bank Accounts | Cash in Hand. */
function BalanceSplitCard({
  title, total, bank, cash,
}: { title: string; total: number; bank: number; cash: number }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 min-w-[15rem]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
        <span className="text-base font-bold tabular-nums">{money(total)}</span>
      </div>
      <Separator className="my-2" />
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full bg-sky-500" /> Bank Accounts
        </span>
        <span className="font-medium tabular-nums text-sky-700 dark:text-sky-300">{money(bank)}</span>
      </div>
      <div className="flex items-center justify-between text-xs mt-1">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full bg-amber-500" /> Cash in Hand
        </span>
        <span className="font-medium tabular-nums text-amber-700 dark:text-amber-300">{money(cash)}</span>
      </div>
    </div>
  );
}

function DayBookTable({ data }: { data: DayBook }) {
  return (
    <div className="space-y-4">
      {/* Opening + closing balance split cards */}
      <div className="flex flex-wrap gap-3">
        <BalanceSplitCard title="Opening Balance" total={data.opening} bank={data.openingBank} cash={data.openingCash} />
        <BalanceSplitCard title="Closing Balance" total={data.closing} bank={data.closingBank} cash={data.closingCash} />
        {/* period movement summary */}
        <div className="rounded-lg border p-3 flex-1 min-w-[20rem]">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Period Movement</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            <div className="flex justify-between"><span className="flex items-center gap-1.5 text-muted-foreground"><span className="size-2 rounded-full bg-emerald-500" /> Cash received</span><span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">{money(data.cashIn)}</span></div>
            <div className="flex justify-between"><span className="flex items-center gap-1.5 text-muted-foreground"><span className="size-2 rounded-full bg-rose-500" /> Cash paid</span><span className="font-medium tabular-nums text-rose-600 dark:text-rose-400">{money(data.cashOut)}</span></div>
            <div className="flex justify-between"><span className="flex items-center gap-1.5 text-muted-foreground"><span className="size-2 rounded-full bg-emerald-500" /> Bank received</span><span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">{money(data.bankIn)}</span></div>
            <div className="flex justify-between"><span className="flex items-center gap-1.5 text-muted-foreground"><span className="size-2 rounded-full bg-rose-500" /> Bank paid</span><span className="font-medium tabular-nums text-rose-600 dark:text-rose-400">{money(data.bankOut)}</span></div>
          </div>
          {(data.transferCashToBank > 0 || data.transferBankToCash > 0) && (
            <>
              <Separator className="my-2" />
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Fund transfers <span className="normal-case font-normal">(not income/expense)</span></div>
              <div className="grid grid-cols-1 gap-1.5 text-xs">
                {data.transferCashToBank > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Cash → Bank</span><span className="font-medium tabular-nums text-sky-700 dark:text-sky-300">{money(data.transferCashToBank)}</span></div>
                )}
                {data.transferBankToCash > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Bank → Cash</span><span className="font-medium tabular-nums text-amber-700 dark:text-amber-300">{money(data.transferBankToCash)}</span></div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

    <div className="overflow-x-auto">
    <div className="max-h-[28rem] overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead><TableHead>Particulars</TableHead><TableHead>Head</TableHead><TableHead className="text-center">Method</TableHead>
            <TableHead className="text-right">Income</TableHead><TableHead className="text-right">Expense</TableHead><TableHead className="text-right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="bg-muted/40"><TableCell colSpan={6} className="font-medium">Opening balance</TableCell><TableCell className="text-right font-medium">{money(data.opening)}</TableCell></TableRow>
          {data.rows.map((r, i) => (
            <TableRow key={i}>
              <TableCell className="whitespace-nowrap">{shortDate(r.date)}</TableCell>
              <TableCell className="max-w-[20rem] truncate">{r.particulars || "—"}</TableCell>
              <TableCell className="text-muted-foreground text-xs">{r.head}</TableCell>
              <TableCell className="text-center"><MethodBadge method={r.method} /></TableCell>
              <TableCell className="text-right text-emerald-600 dark:text-emerald-400">{r.income ? money(r.income) : "—"}</TableCell>
              <TableCell className="text-right text-rose-600 dark:text-rose-400">{r.expense ? money(r.expense) : "—"}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{money(r.balance)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={4}>Totals</TableCell>
            <TableCell className="text-right text-emerald-600 dark:text-emerald-400">{money(data.totalIncome)}</TableCell>
            <TableCell className="text-right text-rose-600 dark:text-rose-400">{money(data.totalExpense)}</TableCell>
            <TableCell className="text-right">Net {money(data.net)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
    </div>
    </div>
  );
}

function YearlyTable({ data }: { data: Yearly }) {
  return (
    <div className="overflow-x-auto">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead className="text-right">Rent Collected</TableHead>
          <TableHead className="text-right">Total Income</TableHead>
          <TableHead className="text-right">Total Expense</TableHead>
          <TableHead className="text-right">Net</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.months.map((m) => (
          <TableRow key={m.month}>
            <TableCell className="font-medium">{m.month}</TableCell>
            <TableCell className="text-right tabular-nums">{money(m.rentCollected)}</TableCell>
            <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{money(m.income)}</TableCell>
            <TableCell className="text-right tabular-nums text-rose-600 dark:text-rose-400">{money(m.expense)}</TableCell>
            <TableCell className={`text-right font-medium tabular-nums ${m.net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{money(m.net)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Total {data.year}</TableCell>
          <TableCell className="text-right">{money(data.totalRentCollected)}</TableCell>
          <TableCell className="text-right">{money(data.totalIncome)}</TableCell>
          <TableCell className="text-right">{money(data.totalExpense)}</TableCell>
          <TableCell className="text-right font-bold">{money(data.totalNet)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
    </div>
  );
}

function AccTable({ data }: { data: AccHead }) {
  const paged = usePagination(data.rows, 15);
  return (
    <div className="overflow-x-auto">
      <div className="max-h-[26rem] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account Head</TableHead><TableHead>Type</TableHead>
              <TableHead className="text-right">Income</TableHead><TableHead className="text-right">Expense</TableHead>
              <TableHead className="text-right">Net</TableHead><TableHead className="text-right">Txns</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.pageItems.map((r) => (
            <TableRow key={String(r.headId ?? "—")}>
              <TableCell className="font-medium">{r.head}</TableCell>
              <TableCell><Badge variant="outline" className="text-[10px]">{r.type}</Badge></TableCell>
              <TableCell className="text-right text-emerald-600 dark:text-emerald-400">{r.income ? money(r.income) : "—"}</TableCell>
              <TableCell className="text-right text-rose-600 dark:text-rose-400">{r.expense ? money(r.expense) : "—"}</TableCell>
              <TableCell className={`text-right font-medium ${r.net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{money(r.net)}</TableCell>
              <TableCell className="text-right text-muted-foreground">{r.count}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2}>Totals — {data.month} {data.year}</TableCell>
            <TableCell className="text-right">{money(data.totalIncome)}</TableCell>
            <TableCell className="text-right">{money(data.totalExpense)}</TableCell>
            <TableCell className="text-right font-bold">{money(data.totalNet)}</TableCell>
            <TableCell></TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      </div>
      <Pager page={paged.page} totalPages={paged.totalPages} total={paged.total} pageSize={paged.pageSize} onPrev={paged.prev} onNext={paged.next} />
    </div>
  );
}

function LedgerTable({ data, onChanged }: { data: ClientLedger; onChanged?: () => void }) {
  const [showDeleted, setShowDeleted] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const toggleRow = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((prev) => {
      if (prev.size === data.entries.length) return new Set();
      return new Set(data.entries.map((_, i) => i));
    });
  };

  async function deleteEntry(e: LedgerEntry) {
    if (!e.collectionId) return;
    if (!confirm(`Delete this payment?\n"${e.particulars}"\nThis removes the invoice from the ledger.`)) return;
    try {
      const r = await fetch("/api/collect/delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: e.collectionId }),
      });
      const d = await r.json();
      if (d.ok) { toast.success("Payment deleted"); onChanged?.(); }
      else toast.error(d.error ?? "Failed");
    } catch { toast.error("Failed to delete"); }
  }
  async function deleteDue(e: LedgerEntry) {
    if (!e.leaseId || !e.rentMonth || !e.rentYear) return;
    if (!confirm(`Delete this rent due?\n"${e.particulars}"\nThe due will be removed from the ledger (tenant was gone, etc.).`)) return;
    try {
      const r = await fetch("/api/lease/waive", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaseId: e.leaseId, month: e.rentMonth, year: e.rentYear }),
      });
      const d = await r.json();
      if (d.ok) { toast.success(`Deleted due for ${e.rentMonth} ${e.rentYear}`); onChanged?.(); }
      else toast.error(d.error ?? "Failed");
    } catch { toast.error("Failed to delete"); }
  }
  async function restoreDue(dm: { leaseId: number; month: string; year: string }) {
    try {
      const r = await fetch("/api/lease/unwaive", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaseId: dm.leaseId, month: dm.month, year: dm.year }),
      });
      const d = await r.json();
      if (d.ok) { toast.success(`Restored ${dm.month} ${dm.year}`); onChanged?.(); }
      else toast.error(d.error ?? "Failed");
    } catch { toast.error("Failed to restore"); }
  }
  async function bulkDelete() {
    const entries = [...selected].map((i) => data.entries[i]).filter(Boolean);
    const payments = entries.filter((e) => e.collectionId);
    const dues = entries.filter((e) => e.leaseId && e.rentMonth && e.rentYear && e.debit > 0);
    if (payments.length === 0 && dues.length === 0) return;
    if (!confirm(`Delete ${entries.length} selected row(s)?\n• ${payments.length} payment(s) will be deleted\n• ${dues.length} rent due(s) will be removed (waived)\nThis cannot be undone from the UI (restore via the deleted-months panel).`)) return;
    setBulkBusy(true);
    let ok = 0, fail = 0;
    try {
      // delete payments
      for (const e of payments) {
        try {
          const r = await fetch("/api/collect/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: e.collectionId }) });
          const d = await r.json();
          if (d.ok) ok++; else fail++;
        } catch { fail++; }
      }
      // waive rent dues
      for (const e of dues) {
        try {
          const r = await fetch("/api/lease/waive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leaseId: e.leaseId, month: e.rentMonth, year: e.rentYear }) });
          const d = await r.json();
          if (d.ok) ok++; else fail++;
        } catch { fail++; }
      }
      setSelected(new Set());
      if (fail > 0) toast.warning(`${ok} deleted, ${fail} failed`);
      else toast.success(`${ok} row(s) deleted`);
      onChanged?.();
    } finally { setBulkBusy(false); }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-sm rounded-md bg-muted/60 p-3">
        <div><span className="text-muted-foreground">Tenant:</span> <span className="font-medium">{data.tenant.name} ({data.tenant.code})</span></div>
        <div><span className="text-muted-foreground">Mobile:</span> {data.tenant.mobile ?? "—"}</div>
        <div><span className="text-muted-foreground">Advance held:</span> <span className="font-medium text-emerald-600 dark:text-emerald-400">{money(data.openingAdvance)}</span></div>
        <div><span className="text-muted-foreground">Closing outstanding:</span> <span className="font-bold text-rose-600 dark:text-rose-400">{money(data.closingOutstanding)}</span></div>
        <div><span className="text-muted-foreground">Leases:</span> {data.leases.length}</div>
        {data.deletedMonths.length > 0 && (
          <button onClick={() => setShowDeleted(!showDeleted)} className="text-xs text-amber-600 dark:text-amber-400 hover:underline ml-auto">
            {data.deletedMonths.length} month{data.deletedMonths.length > 1 ? "s" : ""} deleted — {showDeleted ? "hide" : "show & restore"}
          </button>
        )}
      </div>

      {/* deleted months (hidden by default — toggle to show + restore) */}
      {showDeleted && data.deletedMonths.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20 p-3">
          <div className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-2">Deleted rent due months (restore to bring back the due)</div>
          <div className="flex flex-wrap gap-2">
            {data.deletedMonths.map((dm, i) => (
              <button key={i} onClick={() => restoreDue(dm)} className="text-[11px] px-2 py-1 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900 flex items-center gap-1" title={`${dm.unitName}`}>
                <RotateCcw className="size-3" /> {dm.month.slice(0, 3)} {dm.year}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* bulk action bar */}
      {selected.size > 0 && onChanged && (
        <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20 px-4 py-2.5">
          <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
            {selected.size} row{selected.size > 1 ? "s" : ""} selected
            ({[...selected].map((i) => data.entries[i]).filter((e) => e?.collectionId).length} payment
            · {[...selected].map((i) => data.entries[i]).filter((e) => e?.debit > 0 && e?.leaseId).length} rent-due)
          </span>
          <Button size="sm" variant="destructive" onClick={bulkDelete} disabled={bulkBusy} className="ml-auto">
            {bulkBusy ? "Deleting…" : <><Trash2 className="size-3.5" /> Delete selected</>}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Cancel</Button>
        </div>
      )}

      <div className="overflow-x-auto">
      <div className="max-h-[22rem] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {onChanged && <TableHead className="w-8"><Checkbox checked={selected.size === data.entries.length && data.entries.length > 0} onCheckedChange={toggleAll} aria-label="Select all" /></TableHead>}
              <TableHead>Date</TableHead><TableHead>Particulars</TableHead>
              <TableHead className="text-right">Debit (due)</TableHead><TableHead className="text-right">Credit (paid)</TableHead><TableHead className="text-right">Balance</TableHead>
              {onChanged && <TableHead className="text-right">Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.entries.map((e, i) => (
              <TableRow key={i}>
                {onChanged && <TableCell className="w-8"><Checkbox checked={selected.has(i)} onCheckedChange={() => toggleRow(i)} aria-label="Select row" /></TableCell>}
                <TableCell className="whitespace-nowrap">{shortDate(e.date)}</TableCell>
                <TableCell className="max-w-[20rem]">{e.particulars}</TableCell>
                <TableCell className="text-right text-rose-600 dark:text-rose-400">{e.debit ? money(e.debit) : "—"}</TableCell>
                <TableCell className="text-right text-emerald-600 dark:text-emerald-400">{e.credit ? money(e.credit) : "—"}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{money(e.balance)}</TableCell>
                {onChanged && (
                  <TableCell className="text-right">
                    {e.collectionId && (
                      <Button size="icon" variant="ghost" className="size-7" onClick={() => deleteEntry(e)} title="Delete this payment">
                        <Trash2 className="size-3.5 text-rose-500" />
                      </Button>
                    )}
                    {e.debit > 0 && e.leaseId && (
                      <Button size="icon" variant="ghost" className="size-7" onClick={() => deleteDue(e)} title="Delete this month's rent due">
                        <Trash2 className="size-3.5 text-amber-500" />
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      </div>
    </div>
  );
}

function DueTable({ data }: { data: ClientDue }) {
  const paged = usePagination(data.rows, 15);
  return (
    <div className="overflow-x-auto">
      <div className="max-h-[26rem] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead><TableHead>Tenant</TableHead><TableHead>Mobile</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-right">Outstanding</TableHead><TableHead className="text-right">Months</TableHead>
              <TableHead className="text-right">Advance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.pageItems.map((r) => (
            <TableRow key={r.tenantId}>
              <TableCell className="font-mono text-xs">{r.code}</TableCell>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell className="text-muted-foreground text-xs">{r.mobile ?? "—"}</TableCell>
              <TableCell className="text-center">
                {r.status === "GONE" ? <Badge variant="secondary" className="text-[10px]">Gone</Badge> : <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-[10px]">Active</Badge>}
              </TableCell>
              <TableCell className="text-right font-semibold text-rose-600 dark:text-rose-400 tabular-nums">{money(r.outstandingTotal)}</TableCell>
              <TableCell className="text-right tabular-nums">{r.outstandingCount}</TableCell>
              <TableCell className="text-right text-emerald-600 dark:text-emerald-400 tabular-nums">{r.advanceBalance ? money(r.advanceBalance) : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={4}>Total — {data.totalTenants} tenants</TableCell>
            <TableCell className="text-right font-bold">{money(data.totalOutstanding)}</TableCell>
            <TableCell colSpan={2}></TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      </div>
      <Pager page={paged.page} totalPages={paged.totalPages} total={paged.total} pageSize={paged.pageSize} onPrev={paged.prev} onNext={paged.next} />
    </div>
  );
}

// --- printable HTML builders ---

function dayBookHTML(d: DayBook): string {
  const rows = d.rows.map((r) => {
    const m = r.method === "BANK" ? "Bank" : r.method === "MOBILE_BANK" ? "Mobile" : "Cash";
    return `<tr><td>${shortDate(r.date)}</td><td>${r.particulars || ""}</td><td>${r.head}</td><td>${m}</td><td class="r">${r.income ? money(r.income) : ""}</td><td class="r">${r.expense ? money(r.expense) : ""}</td><td class="r">${money(r.balance)}</td></tr>`;
  }).join("");
  return `<div class="muted">${shortDate(d.fromDate)} → ${shortDate(d.toDate)}</div>
    <table class="compact"><tbody>
      <tr><th colspan=2>Opening Balance</th><th class="r">${money(d.opening)}</th><td>Bank ${money(d.openingBank)} · Cash ${money(d.openingCash)}</td></tr>
      <tr><th colspan=2>Closing Balance</th><th class="r">${money(d.closing)}</th><td>Bank ${money(d.closingBank)} · Cash ${money(d.closingCash)}</td></tr>
      <tr><td colspan=4>Movement — Cash in ${money(d.cashIn)} / out ${money(d.cashOut)} · Bank in ${money(d.bankIn)} / out ${money(d.bankOut)}${(d.transferCashToBank > 0 || d.transferBankToCash > 0) ? ` · Transfers Cash→Bank ${money(d.transferCashToBank)} / Bank→Cash ${money(d.transferBankToCash)} (excluded from totals)` : ""}</td></tr>
    </tbody></table>
    <table><thead><tr><th>Date</th><th>Particulars</th><th>Head</th><th>Method</th><th class="r">Income</th><th class="r">Expense</th><th class="r">Balance</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan=4>Totals</td><td class="r">${money(d.totalIncome)}</td><td class="r">${money(d.totalExpense)}</td><td class="r">Net ${money(d.net)}</td></tr></tfoot></table>`;
}

function yearlyHTML(d: Yearly): string {
  const rows = d.months.map((m) => `<tr><td>${m.month}</td><td class="r">${money(m.rentCollected)}</td><td class="r">${money(m.income)}</td><td class="r">${money(m.expense)}</td><td class="r">${money(m.net)}</td></tr>`).join("");
  return `<div class="muted">Year ${d.year}</div>
    <table><thead><tr><th>Month</th><th class="r">Rent Collected</th><th class="r">Income</th><th class="r">Expense</th><th class="r">Net</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>Total</td><td class="r">${money(d.totalRentCollected)}</td><td class="r">${money(d.totalIncome)}</td><td class="r">${money(d.totalExpense)}</td><td class="r">${money(d.totalNet)}</td></tr></tfoot></table>`;
}

function accHTML(d: AccHead): string {
  const rows = d.rows.map((r) => `<tr><td>${r.head}</td><td>${r.type}</td><td class="r">${r.income ? money(r.income) : ""}</td><td class="r">${r.expense ? money(r.expense) : ""}</td><td class="r">${money(r.net)}</td><td class="r">${r.count}</td></tr>`).join("");
  return `<div class="muted">Account-Head-Wise — ${d.month} ${d.year}</div>
    <table><thead><tr><th>Head</th><th>Type</th><th class="r">Income</th><th class="r">Expense</th><th class="r">Net</th><th class="r">Txns</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan=2>Totals</td><td class="r">${money(d.totalIncome)}</td><td class="r">${money(d.totalExpense)}</td><td class="r">${money(d.totalNet)}</td><td></td></tr></tfoot></table>`;
}

function ledgerHTML(d: ClientLedger): string {
  const rows = d.entries.map((e) => `<tr><td>${shortDate(e.date)}</td><td>${e.particulars}</td><td class="r">${e.debit ? money(e.debit) : ""}</td><td class="r">${e.credit ? money(e.credit) : ""}</td><td class="r">${money(e.balance)}</td></tr>`).join("");
  const leases = d.leases.map((l) => `${l.propertyName} · ${l.unitName} (${money(l.rent)}/mo)`).join("<br>");
  return `<div class="muted">Tenant: ${d.tenant.name} (${d.tenant.code}) · Mobile: ${d.tenant.mobile ?? "—"} · Advance: ${money(d.openingAdvance)} · Closing outstanding: ${money(d.closingOutstanding)}</div>
    <div class="muted">Leases:<br>${leases}</div>
    <table><thead><tr><th>Date</th><th>Particulars</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function dueHTML(d: ClientDue): string {
  const rows = d.rows.map((r) => `<tr><td>${r.code}</td><td>${r.name}</td><td>${r.mobile ?? ""}</td><td>${r.status}</td><td class="r">${money(r.outstandingTotal)}</td><td class="r">${r.outstandingCount}</td><td class="r">${r.advanceBalance ? money(r.advanceBalance) : ""}</td></tr>`).join("");
  return `<div class="muted">Client Due — ${d.month} ${d.year} · ${d.totalTenants} tenants · Total outstanding: ${money(d.totalOutstanding)}</div>
    <table><thead><tr><th>Code</th><th>Tenant</th><th>Mobile</th><th>Status</th><th class="r">Outstanding</th><th class="r">Months</th><th class="r">Advance</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan=4>Total</td><td class="r">${money(d.totalOutstanding)}</td><td colspan=2></td></tr></tfoot></table>`;
}
