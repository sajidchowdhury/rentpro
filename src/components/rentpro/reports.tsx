"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BarChart3, Printer, BookOpen, Calendar, Layers, User, Wallet, RefreshCw,
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
import { money, shortDate } from "@/lib/format";
import { usePagination } from "@/lib/use-pagination";
import { Pager } from "@/components/rentpro/pager";
import { toast } from "sonner";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// types
interface DayBookRow { date: string; particulars: string; head: string; income: number; expense: number; balance: number; }
interface DayBook { fromDate: string; toDate: string; opening: number; rows: DayBookRow[]; totalIncome: number; totalExpense: number; net: number; closing: number; }
interface YearlyMonth { month: string; rentCollected: number; income: number; expense: number; net: number; }
interface Yearly { year: string; months: YearlyMonth[]; totalRentCollected: number; totalIncome: number; totalExpense: number; totalNet: number; }
interface AccHeadRow { headId: number | null; head: string; type: string; income: number; expense: number; net: number; count: number; }
interface AccHead { month: string; year: string; rows: AccHeadRow[]; totalIncome: number; totalExpense: number; totalNet: number; }
interface LedgerEntry { date: string; particulars: string; debit: number; credit: number; balance: number; }
interface ClientLedger { tenant: { id: number; name: string; code: string; mobile: string | null; status: string; advanceBalance: number }; leases: Array<{ id: number; propertyName: string; unitName: string; rent: number }>; asOfMonth: string; asOfYear: string; openingAdvance: number; entries: LedgerEntry[]; closingOutstanding: number; }
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
        const ts: TenantOpt[] = (d.tenants ?? []).map((t: any) => ({ id: t.id, name: t.name, code: t.code }));
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
      const r = await fetch(`/api/report/client-ledger?tenantId=${ledgerId}&month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`);
      setLedger(await r.json());
    } catch { toast.error("Failed to load ledger"); }
    finally { setLedgerLoading(false); }
  }, [ledgerId, month, year]);

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
                <div className="flex items-end gap-2">
                  <div className="w-[260px]">
                    <Label className="text-xs">Tenant</Label>
                    <Select value={String(ledgerId ?? "")} onValueChange={(v) => { setLedgerId(Number(v)); setLedger(null); }}>
                      <SelectTrigger><SelectValue placeholder="Select tenant" /></SelectTrigger>
                      <SelectContent>
                        {tenants.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.code} · {t.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button size="sm" variant="outline" onClick={fetchLedger}><RefreshCw className="size-3.5" /> Run</Button>
                  <Button size="sm" onClick={() => ledger && printHTML(`Client Ledger — ${ledger.tenant.name}`, ledgerHTML(ledger))} disabled={!ledger}><Printer className="size-3.5" /> Print</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {ledgerLoading || !ledger ? <Skeleton className="h-80 rounded" /> : <LedgerTable data={ledger} />}
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

function DayBookTable({ data }: { data: DayBook }) {
  return (
    <div className="overflow-x-auto">
    <ScrollArea className="max-h-[28rem]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead><TableHead>Particulars</TableHead><TableHead>Head</TableHead>
            <TableHead className="text-right">Income</TableHead><TableHead className="text-right">Expense</TableHead><TableHead className="text-right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="bg-muted/40"><TableCell colSpan={5} className="font-medium">Opening balance</TableCell><TableCell className="text-right font-medium">{money(data.opening)}</TableCell></TableRow>
          {data.rows.map((r, i) => (
            <TableRow key={i}>
              <TableCell className="whitespace-nowrap">{shortDate(r.date)}</TableCell>
              <TableCell className="max-w-[20rem] truncate">{r.particulars || "—"}</TableCell>
              <TableCell className="text-muted-foreground text-xs">{r.head}</TableCell>
              <TableCell className="text-right text-emerald-600 dark:text-emerald-400">{r.income ? money(r.income) : "—"}</TableCell>
              <TableCell className="text-right text-rose-600 dark:text-rose-400">{r.expense ? money(r.expense) : "—"}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{money(r.balance)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={3}>Totals</TableCell>
            <TableCell className="text-right text-emerald-600 dark:text-emerald-400">{money(data.totalIncome)}</TableCell>
            <TableCell className="text-right text-rose-600 dark:text-rose-400">{money(data.totalExpense)}</TableCell>
            <TableCell className="text-right">Net {money(data.net)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </ScrollArea>
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
      <ScrollArea className="max-h-[26rem]">
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
      </ScrollArea>
      <Pager page={paged.page} totalPages={paged.totalPages} total={paged.total} pageSize={paged.pageSize} onPrev={paged.prev} onNext={paged.next} />
    </div>
  );
}

function LedgerTable({ data }: { data: ClientLedger }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-sm rounded-md bg-muted/60 p-3">
        <div><span className="text-muted-foreground">Tenant:</span> <span className="font-medium">{data.tenant.name} ({data.tenant.code})</span></div>
        <div><span className="text-muted-foreground">Mobile:</span> {data.tenant.mobile ?? "—"}</div>
        <div><span className="text-muted-foreground">Advance held:</span> <span className="font-medium text-emerald-600 dark:text-emerald-400">{money(data.openingAdvance)}</span></div>
        <div><span className="text-muted-foreground">Closing outstanding:</span> <span className="font-bold text-rose-600 dark:text-rose-400">{money(data.closingOutstanding)}</span></div>
        <div><span className="text-muted-foreground">Leases:</span> {data.leases.length}</div>
      </div>
      <div className="overflow-x-auto">
      <ScrollArea className="max-h-[22rem]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead><TableHead>Particulars</TableHead>
              <TableHead className="text-right">Debit (due)</TableHead><TableHead className="text-right">Credit (paid)</TableHead><TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.entries.map((e, i) => (
              <TableRow key={i}>
                <TableCell className="whitespace-nowrap">{shortDate(e.date)}</TableCell>
                <TableCell className="max-w-[20rem]">{e.particulars}</TableCell>
                <TableCell className="text-right text-rose-600 dark:text-rose-400">{e.debit ? money(e.debit) : "—"}</TableCell>
                <TableCell className="text-right text-emerald-600 dark:text-emerald-400">{e.credit ? money(e.credit) : "—"}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{money(e.balance)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
      </div>
    </div>
  );
}

function DueTable({ data }: { data: ClientDue }) {
  const paged = usePagination(data.rows, 15);
  return (
    <div className="overflow-x-auto">
      <ScrollArea className="max-h-[26rem]">
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
      </ScrollArea>
      <Pager page={paged.page} totalPages={paged.totalPages} total={paged.total} pageSize={paged.pageSize} onPrev={paged.prev} onNext={paged.next} />
    </div>
  );
}

// --- printable HTML builders ---

function dayBookHTML(d: DayBook): string {
  const rows = d.rows.map((r) => `<tr><td>${shortDate(r.date)}</td><td>${r.particulars || ""}</td><td>${r.head}</td><td class="r">${r.income ? money(r.income) : ""}</td><td class="r">${r.expense ? money(r.expense) : ""}</td><td class="r">${money(r.balance)}</td></tr>`).join("");
  return `<div class="muted">${shortDate(d.fromDate)} → ${shortDate(d.toDate)} · Opening: ${money(d.opening)}</div>
    <table><thead><tr><th>Date</th><th>Particulars</th><th>Head</th><th class="r">Income</th><th class="r">Expense</th><th class="r">Balance</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan=3>Totals</td><td class="r">${money(d.totalIncome)}</td><td class="r">${money(d.totalExpense)}</td><td class="r">Net ${money(d.net)}</td></tr></tfoot></table>`;
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
