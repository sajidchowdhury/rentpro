// ============================================================================
// rentData.ts — server-only data layer for the RentPro prototype UI.
// ----------------------------------------------------------------------------
// Loads the legacy `osudlagb_home_rent.sql` dump ONCE (cached in module scope),
// normalizes it into the RentPro model shapes (Property, Unit, Tenant, Lease,
// Collection, Transaction), and exposes query functions that power the
// Dashboard and "Generate this month's rent" screens with REAL data.
//
// In production this module is replaced by Prisma queries against PostgreSQL;
// the function signatures stay the same so the UI doesn't change.
// ============================================================================

import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import {
  parseLegacyDump,
  rowToObject,
  toNum,
  toDate,
  type Cell,
} from "@/lib/legacyParser";

// --- model shapes (mirrors prisma/schema.prisma) ---------------------------
export interface Property {
  id: number;
  name: string;
  type: "BUILDING" | "OPEN_SPACE" | "ROOFTOP" | "MIXED";
  unitCount: number;
}
export interface Unit {
  id: number;
  propertyId: number;
  name: string;
  type: string;
  defaultRent: number;
  notes: string | null;
}
export interface Tenant {
  id: number;
  code: string;
  name: string;
  mobile: string | null;
  status: "ACTIVE" | "GONE";
  familyMember: string | null;
}
export interface Lease {
  id: number;
  tenantId: number;
  unitId: number;
  propertyId: number;
  agreementStart: Date | null;
  agreementEnd: Date | null;
  rent: number;
  advance: number;
  gasBill: number;
  moylarBill: number;
  serviceCharge: number;
  otherBill: number;
  status: "ACTIVE" | "CLOSED";
  tenantName: string;
  unitName: string;
  propertyName: string;
}
export interface Collection {
  id: number;
  leaseId: number;
  tenantId: number;
  rent: number;
  gasBill: number;
  moylarBill: number;
  serviceCharge: number;
  otherBill: number;
  rentMonth: string;
  rentYear: string;
  receiveDate: Date | null;
  status: "PENDING" | "DONE";
}
export interface Txn {
  id: number;
  inAmount: number;
  outAmount: number;
  transectionDate: Date | null;
  note: string | null;
  type: string;
}

// --- in-memory "generated schedules" store (prototype only) ---------------
// In production these are real rent_schedule rows in Postgres. Here we just
// remember which (month, year) the user has "generated" so the UI reflects it.
const generatedMonths = new Set<string>(); // key: "YYYY|MonthName"

// --- dump loader (cached) --------------------------------------------------
const DUMP_CANDIDATES = [
  // sandbox preview (the cloned legacy repo)
  "rent-project/osudlagb_home_rent.sql",
  // when run inside the rentpro repo itself
  "../rent-project/osudlagb_home_rent.sql",
  process.env.LEGACY_SQL_PATH ?? "",
].filter(Boolean);

interface Dataset {
  properties: Property[];
  units: Unit[];
  tenants: Tenant[];
  leases: Lease[];
  collections: Collection[];
  txns: Txn[];
}

let cache: Dataset | null = null;

function findDump(): string | null {
  for (const c of DUMP_CANDIDATES) {
    try {
      const p = c.startsWith("/")
        ? c
        : `${process.cwd()}/${c}`.replace(/\/+/g, "/");
      if (existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function str(v: Cell): string {
  return v === null || v === "" ? "" : String(v);
}
function num(v: Cell): number {
  return toNum(v);
}
function dt(v: Cell): Date | null {
  return toDate(v);
}

function loadDataset(): Dataset {
  if (cache) return cache;

  const path = findDump();
  if (!path) {
    console.warn("[rentData] No legacy dump found — UI will show empty state.");
    cache = { properties: [], units: [], tenants: [], leases: [], collections: [], txns: [] };
    return cache;
  }

  const sql = readFileSync(path, "utf-8");
  const parsed = parseLegacyDump(sql);

  const rows = (t: string) => {
    const tbl = parsed.tables.get(t);
    return tbl ? tbl.rows.map((r) => rowToObject(tbl, r)) : [];
  };

  const properties: Property[] = rows("setup_vobon").map((r) => ({
    id: num(r.id),
    name: str(r.vobon_name) || `Property ${r.id}`,
    type: "BUILDING",
    unitCount: num(r.unit_no),
  }));
  const propName = (id: number) =>
    properties.find((p) => p.id === id)?.name ?? "—";

  const units: Unit[] = rows("setup_unit").map((r) => ({
    id: num(r.id),
    propertyId: num(r.vobon_id),
    name: str(r.unit_name) || `Unit ${r.id}`,
    type: "SHOP",
    defaultRent: num(r.rent),
    notes: str(r.notes) || null,
  }));
  const unitName = (id: number) =>
    units.find((u) => u.id === id)?.name ?? "—";

  const tenants: Tenant[] = rows("setup_client").map((r) => ({
    id: num(r.id),
    code: str(r.code) || String(r.id),
    name: str(r.client_name) || `Tenant ${r.id}`,
    mobile: str(r.mobile) || null,
    status: r.client_status === "Gone" ? "GONE" : "ACTIVE",
    familyMember: str(r.family_member) || null,
  }));
  const tenantName = (id: number) =>
    tenants.find((t) => t.id === id)?.name ?? "—";

  const leases: Lease[] = rows("assign_unit")
    .map((r) => ({
      id: num(r.id),
      tenantId: num(r.client_id),
      unitId: num(r.unit_id),
      propertyId: num(r.vobon_id),
      agreementStart: dt(r.aggrement_start),
      agreementEnd: dt(r.aggrement_ends),
      rent: num(r.rent),
      advance: num(r.advance_payment),
      gasBill: num(r.gus_bill),
      moylarBill: num(r.moylar_bill),
      serviceCharge: num(r.service_charge),
      otherBill: num(r.other_bill),
      status: r.client_status === "Gone" ? "CLOSED" : "ACTIVE",
      tenantName: tenantName(num(r.client_id)),
      unitName: unitName(num(r.unit_id)),
      propertyName: propName(num(r.vobon_id)),
    }))
    .filter((l) => l.id && l.tenantId && l.unitId);

  const collections: Collection[] = rows("collect_rent")
    .map((r) => ({
      id: num(r.id),
      leaseId: num(r.assign_unit_id),
      tenantId: num(r.client_id),
      rent: num(r.rent),
      gasBill: num(r.gus_bill),
      moylarBill: num(r.moylar_bill),
      serviceCharge: num(r.service_charge),
      otherBill: num(r.other_bill),
      rentMonth: str(r.rent_month),
      rentYear: str(r.rent_year),
      receiveDate: dt(r.receive_date),
      status: r.collection_status === "Done" ? "DONE" : "PENDING",
    }))
    .filter((c) => c.id && c.rentMonth && c.rentYear);

  const txns: Txn[] = rows("account_transection")
    .map((r) => ({
      id: num(r.id),
      inAmount: num(r.in_amount),
      outAmount: num(r.out_amount),
      transectionDate: dt(r.transection_date),
      note: str(r.note) || null,
      type: str(r.transection_type) || "INCOME",
    }))
    .filter((t) => t.id);

  cache = { properties, units, tenants, leases, collections, txns };
  console.log(
    `[rentData] Loaded dump: ${properties.length} properties, ${units.length} units, ${tenants.length} tenants, ${leases.length} leases, ${collections.length} collections, ${txns.length} transactions.`
  );
  return cache;
}

// --- month helpers ---------------------------------------------------------
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthIndex(name: string): number {
  return MONTHS.indexOf(name);
}
/** Comparable key: year*12 + monthIndex (0-based). null → -Infinity/Infinity. */
function keyFromYM(year: string, month: string): number {
  const y = Number(year);
  const m = monthIndex(month);
  if (!Number.isFinite(y) || m < 0) return -1;
  return y * 12 + m;
}
function dateKey(d: Date | null): number | null {
  if (!d) return null;
  return d.getFullYear() * 12 + d.getMonth();
}
function txnInMonth(t: Txn, year: string, month: string): boolean {
  if (!t.transectionDate) return false;
  return (
    String(t.transectionDate.getFullYear()) === year &&
    MONTHS[t.transectionDate.getMonth()] === month
  );
}

function leaseCoversMonth(lease: Lease, targetKey: number): boolean {
  const start = dateKey(lease.agreementStart);
  const end = dateKey(lease.agreementEnd);
  if (start === null) return false;
  if (start > targetKey) return false;
  if (end !== null && end < targetKey) return false;
  return true;
}

// --- public query functions ------------------------------------------------
export interface DashboardData {
  month: string;
  year: string;
  generated: boolean;
  totalToCollect: number;
  expectedLeaseCount: number;
  collectedAmount: number;
  paidLeaseCount: number;
  pendingAmount: number;
  dueLeaseCount: number;
  vacantUnitCount: number;
  occupiedUnitCount: number;
  totalUnits: number;
  totalProperties: number;
  incomeThisMonth: number;
  expenseThisMonth: number;
  dueLeases: Array<{
    leaseId: number;
    tenantName: string;
    unitName: string;
    propertyName: string;
    mobile: string | null;
    rent: number;
    monthsMissed: number;
  }>;
  vacantUnits: Array<{ unitId: number; unitName: string; propertyName: string }>;
  recentCollections: Array<{
    id: number;
    tenantName: string;
    unitName: string;
    propertyName: string;
    rent: number;
    rentMonth: string;
    rentYear: string;
    receiveDate: Date | null;
    status: string;
  }>;
  trend: Array<{ label: string; amount: number }>;
}

export function getAvailableMonths(): { year: string; month: string }[] {
  const ds = loadDataset();
  const set = new Set<string>();
  for (const c of ds.collections) set.add(`${c.rentYear}|${c.rentMonth}`);
  const arr = [...set]
    .map((k) => {
      const [year, month] = k.split("|");
      return { year, month, key: keyFromYM(year, month) };
    })
    .sort((a, b) => b.key - a.key)
    .map(({ year, month }) => ({ year, month }));
  if (arr.length === 0) {
    // fallback to "now"
    const d = new Date();
    return [{ year: String(d.getFullYear()), month: MONTHS[d.getMonth()] }];
  }
  return arr;
}

function tenantMobile(id: number, ds: Dataset): string | null {
  return ds.tenants.find((t) => t.id === id)?.mobile ?? null;
}
function unitForLease(leaseId: number, ds: Dataset) {
  const lease = ds.leases.find((l) => l.id === leaseId);
  if (!lease) return null;
  return ds.units.find((u) => u.id === lease.unitId) ?? null;
}

export function getDashboard(month: string, year: string): DashboardData {
  const ds = loadDataset();
  const targetKey = keyFromYM(year, month);
  const generated = generatedMonths.has(`${year}|${month}`);

  // leases covering this month
  const leasesForMonth = ds.leases.filter((l) =>
    leaseCoversMonth(l, targetKey)
  );
  const expectedAmount = leasesForMonth.reduce((s, l) => s + l.rent, 0);

  // collections for this month, by lease
  const colsForMonth = ds.collections.filter(
    (c) => c.rentMonth === month && c.rentYear === year
  );
  const paidLeaseIds = new Set(
    colsForMonth.filter((c) => c.status === "DONE").map((c) => c.leaseId)
  );
  const collectedAmount = colsForMonth
    .filter((c) => c.status === "DONE")
    .reduce((s, c) => s + c.rent, 0);
  const pendingAmount = colsForMonth
    .filter((c) => c.status === "PENDING")
    .reduce((s, c) => s + c.rent, 0);

  // due leases = covering this month but no DONE collection
  const dueLeases = leasesForMonth
    .filter((l) => !paidLeaseIds.has(l.id))
    .map((l) => {
      const monthsMissed = countMissingMonths(ds, l, targetKey);
      return {
        leaseId: l.id,
        tenantName: l.tenantName,
        unitName: l.unitName,
        propertyName: l.propertyName,
        mobile: tenantMobile(l.tenantId, ds),
        rent: l.rent,
        monthsMissed,
      };
    })
    .sort((a, b) => b.monthsMissed - a.monthsMissed || b.rent - a.rent);

  const paidLeaseCount = leasesForMonth.filter((l) =>
    paidLeaseIds.has(l.id)
  ).length;

  // vacant vs occupied units (relative to the selected month)
  const occupiedUnitIds = new Set(
    ds.leases
      .filter((l) => leaseCoversMonth(l, targetKey))
      .map((l) => l.unitId)
  );
  const vacantUnits = ds.units
    .filter((u) => !occupiedUnitIds.has(u.id))
    .map((u) => ({
      unitId: u.id,
      unitName: u.name,
      propertyName:
        ds.properties.find((p) => p.id === u.propertyId)?.name ?? "—",
    }));

  // recent collections (latest 8 by receive date)
  const recentCollections = [...ds.collections]
    .sort((a, b) => {
      const da = a.receiveDate?.getTime() ?? 0;
      const db = b.receiveDate?.getTime() ?? 0;
      return db - da;
    })
    .slice(0, 8)
    .map((c) => {
      const lease = ds.leases.find((l) => l.id === c.leaseId);
      const unit = lease ? unitForLease(lease.id, ds) : null;
      return {
        id: c.id,
        tenantName: lease?.tenantName ?? "—",
        unitName: unit?.name ?? "—",
        propertyName: lease?.propertyName ?? "—",
        rent: c.rent,
        rentMonth: c.rentMonth,
        rentYear: c.rentYear,
        receiveDate: c.receiveDate,
        status: c.status,
      };
    });

  // 6-month trend ending at the selected month
  const trend: { label: string; amount: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const k = targetKey - i;
    if (k < 0) continue;
    const y = Math.floor(k / 12);
    const m = k % 12;
    const monthName = MONTHS[m];
    const amount = ds.collections
      .filter(
        (c) =>
          c.rentYear === String(y) &&
          c.rentMonth === monthName &&
          c.status === "DONE"
      )
      .reduce((s, c) => s + c.rent, 0);
    trend.push({
      label: `${monthName.slice(0, 3)} ${y}`,
      amount,
    });
  }

  // cash flow this month
  const monthTxns = ds.txns.filter((t) => txnInMonth(t, year, month));
  const incomeThisMonth = monthTxns.reduce((s, t) => s + t.inAmount, 0);
  const expenseThisMonth = monthTxns.reduce((s, t) => s + t.outAmount, 0);

  return {
    month,
    year,
    generated,
    totalToCollect: expectedAmount,
    expectedLeaseCount: leasesForMonth.length,
    collectedAmount,
    paidLeaseCount,
    pendingAmount,
    dueLeaseCount: dueLeases.length,
    vacantUnitCount: vacantUnits.length,
    occupiedUnitCount: occupiedUnitIds.size,
    totalUnits: ds.units.length,
    totalProperties: ds.properties.length,
    incomeThisMonth,
    expenseThisMonth,
    dueLeases,
    vacantUnits,
    recentCollections,
    trend,
  };
}

/** Count how many months (ending at targetKey) a lease has missed payment. */
function countMissingMonths(ds: Dataset, lease: Lease, targetKey: number): number {
  const start = dateKey(lease.agreementStart);
  if (start === null) return 0;
  const from = Math.max(start, targetKey - 11); // last up-to-12 months
  let missing = 0;
  for (let k = from; k <= targetKey; k++) {
    const y = Math.floor(k / 12);
    const m = MONTHS[k % 12];
    const has = ds.collections.some(
      (c) =>
        c.leaseId === lease.id &&
        c.rentYear === String(y) &&
        c.rentMonth === m &&
        c.status === "DONE"
    );
    if (!has) missing++;
  }
  return missing;
}

export interface GeneratePreviewRow {
  leaseId: number;
  tenantName: string;
  unitName: string;
  propertyName: string;
  mobile: string | null;
  rent: number;
  gasBill: number;
  serviceCharge: number;
  otherBill: number;
  total: number;
  status: "PAID" | "DUE" | "PARTIAL";
}
export interface GeneratePreview {
  month: string;
  year: string;
  generated: boolean;
  rows: GeneratePreviewRow[];
  toGenerateCount: number;
  alreadyCollectedCount: number;
  totalToCollect: number;
  alreadyCollectedAmount: number;
}

export function getGeneratePreview(
  month: string,
  year: string
): GeneratePreview {
  const ds = loadDataset();
  const targetKey = keyFromYM(year, month);
  const generated = generatedMonths.has(`${year}|${month}`);

  const leasesForMonth = ds.leases.filter((l) =>
    leaseCoversMonth(l, targetKey)
  );
  const colsForMonth = ds.collections.filter(
    (c) => c.rentMonth === month && c.rentYear === year
  );

  const rows: GeneratePreviewRow[] = leasesForMonth
    .map((l) => {
      const leaseCols = colsForMonth.filter((c) => c.leaseId === l.id);
      const paidCols = leaseCols.filter((c) => c.status === "DONE");
      const collectedSum = paidCols.reduce((s, c) => s + c.rent, 0);
      let status: "PAID" | "DUE" | "PARTIAL" = "DUE";
      if (paidCols.length > 0 && collectedSum >= l.rent) status = "PAID";
      else if (paidCols.length > 0) status = "PARTIAL";
      return {
        leaseId: l.id,
        tenantName: l.tenantName,
        unitName: l.unitName,
        propertyName: l.propertyName,
        mobile: tenantMobile(l.tenantId, ds),
        rent: l.rent,
        gasBill: l.gasBill,
        serviceCharge: l.serviceCharge,
        otherBill: l.otherBill,
        total: l.rent + l.gasBill + l.serviceCharge + l.otherBill,
        status,
      } as GeneratePreviewRow;
    })
    .sort((a, b) => {
      const order = { DUE: 0, PARTIAL: 1, PAID: 2 } as const;
      return order[a.status] - order[b.status] || b.rent - a.rent;
    });

  const toGenerate = rows.filter((r) => r.status !== "PAID");
  const already = rows.filter((r) => r.status === "PAID");

  return {
    month,
    year,
    generated,
    rows,
    toGenerateCount: toGenerate.length,
    alreadyCollectedCount: already.length,
    totalToCollect: rows.reduce((s, r) => s + r.total, 0),
    alreadyCollectedAmount: already.reduce((s, r) => s + r.rent, 0),
  };
}

/** Prototype "generate" — marks the month as generated in memory. */
export function markMonthGenerated(month: string, year: string): void {
  generatedMonths.add(`${year}|${month}`);
}
