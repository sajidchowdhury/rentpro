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
import bcrypt from "bcryptjs";
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
// How a payment physically moved — drives the cash vs bank split in the
// Day Book report (mirrors legacy `account_transection.transection_by`).
export type PaymentMethod = "CASH" | "BANK" | "MOBILE_BANK";

// Normalizes the legacy free-text `transection_by` value into one of our
// PaymentMethod buckets. Anything we don't recognize defaults to CASH.
export function normalizeMethod(raw: string | null | undefined): PaymentMethod {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return "CASH";
  if (v === "cash") return "CASH";
  if (v === "bank") return "BANK";
  if (v.startsWith("mobile") || v.includes("bkash") || v.includes("nagad") || v.includes("rocket")) {
    return "MOBILE_BANK";
  }
  return "CASH";
}

// Detects whether a transaction is an internal fund transfer (cash -> bank
// or bank -> cash) based on the legacy `data_inserted_from` marker. These are
// NOT income or expense — they just move money between the cash box and a
// bank account — so the Day Book must exclude them from the income/expense
// rows and totals (while still reflecting them in the cash/bank balances).
export function isTransferMarker(dataInsertedFrom: string | null | undefined): boolean {
  const v = (dataInsertedFrom ?? "").trim().toUpperCase();
  return v === "MONEY-TRANSFER-FROM" || v === "MONEY-TRANSFER-TO";
}
export interface Txn {
  id: number;
  inAmount: number;
  outAmount: number;
  transectionDate: Date | null;
  note: string | null;
  type: "INCOME" | "EXPENSE" | "TRANSFER" | "ADJUSTMENT";
  accountHeadId: number | null;
  accountHeadName: string;
  // Cash vs Bank — every rent collection / expense / transfer moves money
  // out of (or into) either the cash box or a bank account. This is what lets
  // the Day Book show a separate Cash-in-hand and Bank balance.
  method: PaymentMethod;
  // Legacy `data_inserted_from` — the screen/action that created the row.
  // Used to detect fund transfers ('MONEY-TRANSFER-FROM'/'MONEY-TRANSFER-TO')
  // which are NOT income or expense (just moving money between cash & bank)
  // and must be excluded from the Day Book income/expense rows + totals.
  dataInsertedFrom: string | null;
}

export interface AccountHead {
  id: number;
  name: string;
  type: "INCOME" | "EXPENSE" | "BOTH" | "ASSET" | "LIABILITY";
  // Explicit "recurring monthly" flag — set by the manager when creating /
  // editing an account head. For legacy dump heads (which don't carry this
  // field), it defaults to false; the dashboard's recurring detection still
  // falls back to "recorded in 2+ months" dynamically.
  recurringMonthly: boolean;
}

// A rent change event — when the rent for a lease changes (e.g. room made
// smaller, rent increased, bills adjusted). The effectiveDate is the first
// month the new rent applies. The ledger/dues look up the rent that was in
// effect for each month using this history.
export interface RentChange {
  effectiveDate: string; // ISO date (first of the month the change takes effect)
  rent: number;
  gasBill: number;
  moylarBill: number;
  serviceCharge: number;
  otherBill: number;
  reason: string;
  recordedAt: string; // ISO timestamp
}

export interface ExpenseRec {
  headId: number;
  headName: string;
  month: string;
  year: string;
  amount: number;
  recordedDate: Date;
  isBackfill: boolean;
}

// F9 — multi-tenant SaaS: each client is an Organization. The owner org
// (org_1, seeded from setup_company) owns the loaded dump data; other orgs
// are demo clients with no data (isolated).
export interface Organization {
  id: string;
  name: string;
  shortName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo: string | null;
  currency: string;
  defaultLocale: "bn" | "en";
  plan: "TRIAL" | "ACTIVE" | "EXPIRED";
  trialEndsAt: string | null;
  createdAt: string;
  isOwner: boolean;
}

// A managed user — NOT from the legacy dump. Seeded at startup (the owner) or
// created via signup. Each user is linked to their own org. The owner's org
// (org_1) owns the loaded dump data; signup orgs start empty.
export interface ManagedUser {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string;
  role: "ADMIN" | "MANAGER" | "DATA_ENTRY";
  orgId: string;
  status: "Active" | "Inactive";
}

// --- global singleton store -------------------------------------------------
// Next.js dev (Turbopack) can give each API route its own module instance of
// this file, which would reset module-level state between requests. Backing
// the state on `globalThis` guarantees every route shares the same dataset.
interface RentProStore {
  cache: Dataset | null;
  expenseRecs: ExpenseRec[] | null;
  generatedMonths: Set<string>;
  tenantAdjustments: Map<number, number>;
  // (leaseId|month|year) entries where rent is waived
  waivedMonths: Set<string>;
  // Rent change history per lease — tracks rent/bills changes over time
  // with an effective date + reason (e.g. "room made smaller, split into two").
  // The ledger/dues use the rent that was in effect at each month.
  leaseRentChanges: Map<number, RentChange[]>;
  nextCollectionId: number;
  nextTxnId: number;
  nextSettlementId: number;
  settlements: SettlementRecord[];
  nextPropertyId: number;
  nextUnitId: number;
  nextAccountHeadId: number;
  organizations: Organization[] | null;
  activeOrgId: string | null;
  nextOrgId: number;
  dataSource: "real" | "demo" | null;
  managedUsers: ManagedUser[] | null;
  nextManagedUserId: number;
}
function getStore(): RentProStore {
  const g = globalThis as unknown as { __rentproStore__?: RentProStore };
  if (!g.__rentproStore__) {
    g.__rentproStore__ = {
      cache: null,
      expenseRecs: null,
      generatedMonths: new Set(),
      tenantAdjustments: new Map(),
      waivedMonths: new Set(),
      leaseRentChanges: new Map(),
      nextCollectionId: 1_000_000,
      nextTxnId: 1_000_000,
      nextSettlementId: 1_000_000,
      settlements: [],
      nextPropertyId: 1_000_000,
      nextUnitId: 1_000_000,
      nextAccountHeadId: 1_000_000,
      organizations: null,
      activeOrgId: null,
      nextOrgId: 2,
      dataSource: null,
      managedUsers: null,
      nextManagedUserId: 2,
    };
  }
  // Migrate: an older code version may have created the store without newer
  // fields. HMR keeps globalThis across reloads, so add any missing fields
  // here rather than crashing on S.<field>.
  const s = g.__rentproStore__;
  if (s.settlements === undefined) s.settlements = [];
  if (s.nextSettlementId === undefined) s.nextSettlementId = 1_000_000;
  if (s.nextPropertyId === undefined) s.nextPropertyId = 1_000_000;
  if (s.nextUnitId === undefined) s.nextUnitId = 1_000_000;
  if (s.nextAccountHeadId === undefined) s.nextAccountHeadId = 1_000_000;
  if (s.expenseRecs === undefined) s.expenseRecs = null;
  if (s.generatedMonths === undefined) s.generatedMonths = new Set();
  if (s.tenantAdjustments === undefined) s.tenantAdjustments = new Map();
  if (s.waivedMonths === undefined) s.waivedMonths = new Set();
  if (s.leaseRentChanges === undefined) s.leaseRentChanges = new Map();
  if (s.nextCollectionId === undefined) s.nextCollectionId = 1_000_000;
  if (s.nextTxnId === undefined) s.nextTxnId = 1_000_000;
  if (s.organizations === undefined) s.organizations = null;
  if (s.activeOrgId === undefined) s.activeOrgId = null;
  if (s.nextOrgId === undefined) s.nextOrgId = 2;
  if (s.dataSource === undefined) s.dataSource = null;
  if (s.managedUsers === undefined) s.managedUsers = null;
  if (s.nextManagedUserId === undefined) s.nextManagedUserId = 2;
  return s;
}
const S = getStore();

// (generatedMonths lives on the global store S above so it survives HMR.)

// --- dump loader (cached) --------------------------------------------------
const DUMP_CANDIDATES = [
  // when run from inside the rentpro repo itself (the dump ships in the
  // repo root). This is the path that works after `git clone` + `bun run dev`.
  "osudlagb_home_rent.sql",
  // sandbox preview (the cloned legacy repo sits alongside)
  "rent-project/osudlagb_home_rent.sql",
  "../rent-project/osudlagb_home_rent.sql",
  "../../rent-project/osudlagb_home_rent.sql",
  // the two utf8 / backup variants that also ship in the repo
  "backup_2026-10-18_utf8.sql",
  process.env.LEGACY_SQL_PATH ?? "",
].filter(Boolean);

interface Dataset {
  properties: Property[];
  units: Unit[];
  tenants: Tenant[];
  leases: Lease[];
  collections: Collection[];
  txns: Txn[];
  accountHeads: AccountHead[];
  company: {
    name: string;
    shortName: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    logo: string | null;
  } | null;
  users: AuthUser[];
}

// F2 (point 2) — auth + RBAC. Users come from the dump's `admin` table;
// passwords are bcrypt ($2y$ -> $2b$ for Node). A demo Data-Entry user is
// added so role-based menu access is demonstrable.
export type Role = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "DATA_ENTRY" | "TENANT";
export interface AuthUser {
  id: number;
  username: string;
  passwordHash: string; // bcrypt, $2b$ (converted from legacy $2y$)
  displayName: string;
  role: Role;
  status: "Active" | "Inactive";
}


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
  if (S.cache) return S.cache;

  const path = findDump();
  if (!path) {
    console.warn(
      "[rentData] No legacy dump found — running with an EMPTY dataset.\n" +
      "  Looking for: osudlagb_home_rent.sql in the repo root (or rent-project/,\n" +
      "  ../rent-project/, or LEGACY_SQL_PATH env var).\n" +
      "  Fix: ensure osudlagb_home_rent.sql is in the rentpro repo root, or set\n" +
      "  LEGACY_SQL_PATH=/absolute/path/to/your/dump.sql in .env"
    );
    const empty: Dataset = { properties: [], units: [], tenants: [], leases: [], collections: [], txns: [], accountHeads: [], company: null, users: [] };
    S.cache = empty;
    S.dataSource = "real";
    return empty;
  }

  // turbopackIgnore: the dump path is dynamic (LEGACY_SQL_PATH), so Turbopack
  // can't statically trace it and would otherwise copy the whole project into
  // the standalone bundle. The file is read at runtime from a mounted volume.
  const sql = readFileSync(/*turbopackIgnore: true*/ path, "utf-8");
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

  const accountHeads: AccountHead[] = rows("setup_ac_head")
    .map((r) => ({
      id: num(r.id),
      name: str(r.account_head) || `Head ${r.id}`,
      type: (str(r.account_type) || "EXPENSE").toUpperCase() as AccountHead["type"],
      // Legacy dump has no recurring flag — default false. The dashboard /
      // expenses screens detect recurring dynamically (2+ months recorded)
      // for these, but a manager can flip this on explicitly via the edit
      // dialog to pin a head as recurring.
      recurringMonthly: false,
    }))
    .filter((a) => a.id);
  const headMap = new Map(accountHeads.map((a) => [a.id, a]));
  const headName = (id: number | null) =>
    id ? headMap.get(id)?.name ?? "" : "";
  const headType = (id: number | null) =>
    id ? headMap.get(id)?.type ?? "EXPENSE" : "EXPENSE";

  const txns: Txn[] = rows("account_transection")
    .map((r) => {
      const ahId = r.transection_head_id === null || r.transection_head_id === "" ? null : num(r.transection_head_id);
      const dif = str(r.data_inserted_from) || null;
      const difUpper = (dif ?? "").toUpperCase();
      const headNameUpper = headName(ahId).toUpperCase();
      // Fund transfers (cash -> bank / bank -> cash) are not income or expense.
      // Detect them two ways for robustness: (1) the legacy marker
      // data_inserted_from = 'MONEY-TRANSFER-FROM'/'MONEY-TRANSFER-TO', and
      // (2) the account head name being 'FUND TRANSFER' (head id 3 in the
      // dump). Either way -> mark as TRANSFER so the Day Book excludes them
      // from income/expense rows + totals while keeping them in the balance.
      const isFundTransferHead = headNameUpper === "FUND TRANSFER";
      // Advance adjustments, due adjustments, and shop opening/closing
      // payments are internal / non-operating bookkeeping that the old report
      // excluded from the Day Book entirely (it only listed RENT COLLECTION,
      // ADD INCOME, ADD EXPENSE rows). Mark them as ADJUSTMENT so they're
      // excluded from rows, totals, period movement, AND the opening balance.
      const isAdjustmentHead = headNameUpper === "ADVANCE ADJUSTMENT" || headNameUpper === "DUE ADJUSTMENT";
      const isAdjustmentMarker = difUpper === "ADVANCE ADJUSTMENT";
      const isShopEvent = difUpper === "SHOP OPENING PAYMENT" || difUpper === "SHOP CLOSING PAYMENT";
      let type: Txn["type"];
      if (isTransferMarker(dif) || isFundTransferHead) type = "TRANSFER";
      else if (isAdjustmentMarker || isAdjustmentHead || isShopEvent) type = "ADJUSTMENT";
      else type = headType(ahId);
      return {
        id: num(r.id),
        inAmount: num(r.in_amount),
        outAmount: num(r.out_amount),
        transectionDate: dt(r.transection_date),
        note: str(r.note) || null,
        accountHeadId: ahId,
        accountHeadName: headName(ahId),
        type,
        method: normalizeMethod(str(r.transection_by)),
        dataInsertedFrom: dif,
      } as Txn;
    })
    .filter((t) => t.id);

  const companyRows = rows("setup_company").map((r) => ({
    name: str(r.name) || "My Organization",
    shortName: str(r.short_name) || null,
    address: str(r.address) || null,
    phone: str(r.phone) || null,
    email: str(r.email) || null,
    logo: str(r.logo) || null,
  }));
  const company = companyRows[0] ?? null;

  // F2 (point 2): users for auth — from the dump's `admin` table. Passwords
  // Users are NOT loaded from the legacy `admin` table. Auth uses managedUsers
  // (store-managed, seeded with the owner at startup + grown via signup).
  const users: AuthUser[] = [];

  const result: Dataset = { properties, units, tenants, leases, collections, txns, accountHeads, company, users };
  S.cache = result;
  S.dataSource = "real";
  console.log(
    `[rentData] Loaded dump: ${properties.length} properties, ${units.length} units, ${tenants.length} tenants, ${leases.length} leases, ${collections.length} collections, ${txns.length} transactions, ${accountHeads.length} account heads.`
  );
  return result;
}

/** What the data layer is currently reading from: "real" (your dump) or
 *  "demo" (no dump found — seeded fallback so the app still works). */
export function getDataSource(): "real" | "demo" {
  if (!S.cache) loadDataset();
  return (S.dataSource ?? "real") as "real" | "demo";
}

/** Clear all data-derived + user-action caches so the next read re-scans the
 *  dump fresh. Used by the sidebar "Reload data" action — lets you mount the
 *  dump and pick it up without a full server restart. Returns the new source. */
export function reloadDataSource(): "real" | "demo" {
  S.cache = null;
  S.expenseRecs = null;
  S.dataSource = null;
  S.organizations = null;
  S.activeOrgId = null;
  S.generatedMonths.clear();
  S.tenantAdjustments.clear();
  S.settlements.length = 0;
  loadDataset();          // re-scan findDump() -> real or demo
  ensureOrganizations();  // re-seed orgs from the (new) cache
  return getDataSource();
}

// --- demo seed (used when no legacy dump is mounted) -----------------------
// A small, representative dataset so the app is fully explorable out of the
// box (login + all screens) even before you mount your real dump. Demo users
// reuse the documented password "101010Sajid".
function seedDemoDataset(): Dataset {
  const now = new Date();
  const nowKey = now.getFullYear() * 12 + now.getMonth();
  const accountHeads: AccountHead[] = [
    { id: 1, name: "RENT COLLECTION", type: "INCOME", recurringMonthly: false },
    { id: 2, name: "ELECTRICITY BILL", type: "EXPENSE", recurringMonthly: true },
    { id: 3, name: "GAS BILL", type: "EXPENSE", recurringMonthly: true },
  ];
  const properties: Property[] = [{ id: 1, name: "Demo Market", type: "BUILDING", unitCount: 5 }];
  const units: Unit[] = [
    { id: 1, propertyId: 1, name: "Shop 1 (ground floor)", type: "SHOP", defaultRent: 15000, notes: null, status: "VACANT" },
    { id: 2, propertyId: 1, name: "Shop 2 (ground floor)", type: "SHOP", defaultRent: 12000, notes: null, status: "VACANT" },
    { id: 3, propertyId: 1, name: "Shop 3 (ground floor)", type: "SHOP", defaultRent: 10000, notes: null, status: "VACANT" },
    { id: 4, propertyId: 1, name: "Room 1 (1st floor)", type: "ROOM", defaultRent: 6000, notes: null, status: "VACANT" },
    { id: 5, propertyId: 1, name: "Godown", type: "GODOWN", defaultRent: 4000, notes: null, status: "VACANT" },
  ];
  const tenants: Tenant[] = [
    { id: 1, code: "D001", name: "Demo Tenant 1", mobile: "+8801700000001", nid: null, familyMember: "Demo Biz 1", status: "ACTIVE", farewelDate: null, advanceBalance: 30000 },
    { id: 2, code: "D002", name: "Demo Tenant 2", mobile: "+8801700000002", nid: null, familyMember: "Demo Biz 2", status: "ACTIVE", farewelDate: null, advanceBalance: 0 },
    { id: 3, code: "D003", name: "Demo Tenant 3", mobile: "+8801700000003", nid: null, familyMember: "Demo Biz 3", status: "ACTIVE", farewelDate: null, advanceBalance: 0 },
    { id: 4, code: "D004", name: "Demo Tenant 4", mobile: "+8801700000004", nid: null, familyMember: "Demo Biz 4", status: "ACTIVE", farewelDate: null, advanceBalance: 0 },
  ];
  const start = new Date(now.getFullYear() - 1, 0, 1); // Jan last year
  const leases: Lease[] = [
    { id: 1, tenantId: 1, unitId: 1, propertyId: 1, agreementStart: start, agreementEnd: new Date(now.getFullYear() + 1, 11, 31), actualRent: 15000, rent: 15000, advance: 30000, advancePaymentDate: start, gasBill: 0, moylarBill: 0, serviceCharge: 0, otherBill: 0, status: "ACTIVE", vacatedAt: null, tenantName: "Demo Tenant 1", unitName: "Shop 1 (ground floor)", propertyName: "Demo Market" },
    { id: 2, tenantId: 2, unitId: 2, propertyId: 1, agreementStart: start, agreementEnd: new Date(now.getFullYear() + 1, 11, 31), actualRent: 12000, rent: 12000, advance: 0, advancePaymentDate: null, gasBill: 0, moylarBill: 0, serviceCharge: 0, otherBill: 0, status: "ACTIVE", vacatedAt: null, tenantName: "Demo Tenant 2", unitName: "Shop 2 (ground floor)", propertyName: "Demo Market" },
    { id: 3, tenantId: 3, unitId: 3, propertyId: 1, agreementStart: start, agreementEnd: new Date(now.getFullYear() + 1, 11, 31), actualRent: 10000, rent: 10000, advance: 0, advancePaymentDate: null, gasBill: 0, moylarBill: 0, serviceCharge: 0, otherBill: 0, status: "ACTIVE", vacatedAt: null, tenantName: "Demo Tenant 3", unitName: "Shop 3 (ground floor)", propertyName: "Demo Market" },
    { id: 4, tenantId: 4, unitId: 4, propertyId: 1, agreementStart: start, agreementEnd: new Date(now.getFullYear() + 1, 11, 31), actualRent: 6000, rent: 6000, advance: 0, advancePaymentDate: null, gasBill: 0, moylarBill: 0, serviceCharge: 0, otherBill: 0, status: "ACTIVE", vacatedAt: null, tenantName: "Demo Tenant 4", unitName: "Room 1 (1st floor)", propertyName: "Demo Market" },
  ];
  // mark occupied units
  units[0].status = "OCCUPIED"; units[1].status = "OCCUPIED"; units[2].status = "OCCUPIED"; units[3].status = "OCCUPIED";

  // collections for the last 3 months (DONE) for tenants 1-3 (current month unpaid for demo "due")
  const collections: Collection[] = [];
  let cid = 1;
  for (let off = 2; off >= 1; off--) {
    const k = nowKey - off;
    const y = String(Math.floor(k / 12));
    const m = MONTHS[k % 12];
    const recv = new Date(Math.floor(k / 12), (k % 12), 10);
    for (const l of leases.slice(0, 3)) {
      collections.push({ id: cid++, leaseId: l.id, tenantId: l.tenantId, rent: l.rent, gasBill: 0, moylarBill: 0, serviceCharge: 0, otherBill: 0, rentMonth: m, rentYear: y, receiveDate: recv, status: "DONE" });
    }
  }
  // transactions: rent income (for each collection) + electricity expense per month
  const txns: Txn[] = [];
  let tid = 1;
  for (const c of collections) {
    txns.push({ id: tid++, inAmount: c.rent, outAmount: 0, transectionDate: c.receiveDate, note: `Rent — ${c.rentMonth} ${c.rentYear}`, type: "INCOME", accountHeadId: 1, accountHeadName: "RENT COLLECTION", method: "CASH", dataInsertedFrom: "RENT COLLECTION" });
  }
  for (let off = 2; off >= 0; off--) {
    const k = nowKey - off;
    const d = new Date(Math.floor(k / 12), (k % 12), 12);
    txns.push({ id: tid++, inAmount: 0, outAmount: 2200, transectionDate: d, note: `Electricity — ${MONTHS[k % 12]}`, type: "EXPENSE", accountHeadId: 2, accountHeadName: "ELECTRICITY BILL", method: "CASH", dataInsertedFrom: "ADD EXPENSE" });
    txns.push({ id: tid++, inAmount: 0, outAmount: 800, transectionDate: d, note: `Gas — ${MONTHS[k % 12]}`, type: "EXPENSE", accountHeadId: 3, accountHeadName: "GAS BILL", method: "CASH", dataInsertedFrom: "ADD EXPENSE" });
  }

  // demo users — reuse the documented password "101010Sajid"
  const ownerHash = "$2b$10$gVTTK2PDSP.GiF3ingQa9.kNLWqWkMHBIp16sG19s5EvxpVxQl2zW";
  const users: AuthUser[] = [
    { id: 43, username: "E1013", passwordHash: ownerHash, displayName: "Demo Admin", role: "ADMIN", status: "Active" },
    { id: 9001, username: "staff", passwordHash: ownerHash, displayName: "Demo Staff", role: "DATA_ENTRY", status: "Active" },
  ];

  return {
    properties, units, tenants, leases, collections, txns, accountHeads,
    company: { name: "RentPro Demo", shortName: "Demo", address: "Demo City", phone: null, email: null, logo: null },
    users,
  };
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
  expenseDue: {
    count: number;
    predictedTotal: number;
    types: Array<{
      headId: number;
      name: string;
      missingCount: number;
      predictedAmount: number;
      lastRecorded: string | null;
    }>;
  };
  // Recurring monthly expense heads (recorded in 2+ months historically) with
  // their status for the selected month — so the manager can see at a glance
  // which monthly bills (electricity, gas, cleaning...) are recorded vs
  // still pending for this month.
  recurringExpenses: Array<{
    headId: number;
    name: string;
    recorded: boolean;
    asOfAmount: number;
    predictedAmount: number;
    lastRecorded: string | null;
    missingCount: number;
  }>;
  // Monthly rent status timeline — last 12 months ending at the selected
  // month. Shows whether each month has rent generated (collections exist)
  // and how many leases paid vs expected. Lets the manager see at a glance
  // "July done, Aug/Sep/Oct missing = 3 months behind".
  rentStatusTimeline: Array<{
    month: string;
    year: string;
    label: string;
    isCurrent: boolean;
    expectedCount: number;
    paidCount: number;
    collectedAmount: number;
    generated: boolean; // true if any collection record exists for this month
  }>;
}

export function getAvailableMonths(): { year: string; month: string }[] {
  const ds = loadDataset();
  const set = new Set<string>();
  // months that have actual collection data
  for (const c of ds.collections) set.add(`${c.rentYear}|${c.rentMonth}`);

  // ALWAYS include a window around "now" so the manager can select the
  // current month (and recent months) even before any rent is generated /
  // collected for them. Without this, the period selector is stuck at the
  // last month that has data (e.g. July when it's actually October).
  // Window: 6 months back through 1 month ahead of the current month.
  const now = new Date();
  const nowKey = now.getFullYear() * 12 + now.getMonth();
  for (let off = -6; off <= 1; off++) {
    const k = nowKey + off;
    if (k < 0) continue;
    const y = Math.floor(k / 12);
    const m = MONTHS[k % 12];
    set.add(`${y}|${m}`);
  }

  const arr = [...set]
    .map((k) => {
      const [year, month] = k.split("|");
      return { year, month, key: keyFromYM(year, month) };
    })
    .sort((a, b) => b.key - a.key)
    .map(({ year, month }) => ({ year, month }));
  if (arr.length === 0) {
    // fallback to "now"
    return [{ year: String(now.getFullYear()), month: MONTHS[now.getMonth()] }];
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
  const generated = S.generatedMonths.has(`${year}|${month}`);

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

  // recurring expenses due this month (F3) — surfaced on the dashboard so
  // missing electricity/gas bills are front-of-mind.
  const expTracker = getExpenseTracker(month, year);
  const dueExpTypes = expTracker.types.filter((t) => t.recurring && !t.recordedInAsOf);
  const expenseDue = {
    count: dueExpTypes.length,
    predictedTotal: dueExpTypes.reduce((s, t) => s + t.predictedAmount, 0),
    types: dueExpTypes
      .slice(0, 6)
      .map((t) => ({
        headId: t.headId,
        name: t.name,
        missingCount: t.missingMonths.length,
        predictedAmount: t.predictedAmount,
        lastRecorded: t.lastRecorded ? `${t.lastRecorded.month} ${t.lastRecorded.year}` : null,
      })),
  };

  // --- Recurring monthly expense heads (full list with status for this month) ---
  // A head is "recurring" if it's been recorded in 2+ distinct months. Show
  // ALL of them (recorded + pending) so the manager sees the full monthly
  // bill checklist, not just the missing ones.
  const recurringExpenses = expTracker.types
    .filter((t) => t.recurring)
    .map((t) => ({
      headId: t.headId,
      name: t.name,
      recorded: t.recordedInAsOf,
      asOfAmount: t.asOfAmount,
      predictedAmount: t.predictedAmount,
      lastRecorded: t.lastRecorded ? `${t.lastRecorded.month} ${t.lastRecorded.year}` : null,
      missingCount: t.missingMonths.length,
    }))
    .sort((a, b) => Number(a.recorded) - Number(b.recorded) || a.name.localeCompare(b.name));

  // --- Monthly rent status timeline (last 12 months) ---
  // For each month, show whether any collections exist (generated) and how
  // many leases paid vs expected. This lets the manager see gaps: "July done,
  // Aug/Sep/Oct missing = 3 months behind".
  const rentStatusTimeline: DashboardData["rentStatusTimeline"] = [];
  for (let i = 11; i >= 0; i--) {
    const k = targetKey - i;
    if (k < 0) continue;
    const y = Math.floor(k / 12);
    const m = MONTHS[k % 12];
    const monthName = m;
    const yearStr = String(y);
    const expected = ds.leases.filter((l) => leaseCoversMonth(l, k)).length;
    const monthCols = ds.collections.filter(
      (c) => c.rentMonth === monthName && c.rentYear === yearStr
    );
    const paid = monthCols.filter((c) => c.status === "DONE").length;
    const collected = monthCols
      .filter((c) => c.status === "DONE")
      .reduce((s, c) => s + c.rent, 0);
    rentStatusTimeline.push({
      month: monthName,
      year: yearStr,
      label: `${monthName.slice(0, 3)} ${yearStr}`,
      isCurrent: k === targetKey,
      expectedCount: expected,
      paidCount: paid,
      collectedAmount: collected,
      generated: monthCols.length > 0,
    });
  }

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
    expenseDue,
    recurringExpenses,
    rentStatusTimeline,
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
    // skip waived months (tenant was gone — not counted as missing)
    if (isLeaseMonthWaived(lease.id, m, String(y))) continue;
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
  tenantId: number;
  tenantName: string;
  unitName: string;
  propertyName: string;
  mobile: string | null;
  rent: number;
  gasBill: number;
  serviceCharge: number;
  otherBill: number;
  total: number;
  // PAID = collected enough; INVOICED = PENDING collection exists (invoice
  // created, not paid yet); DUE = no collection exists; PARTIAL = some paid
  status: "PAID" | "DUE" | "PARTIAL" | "INVOICED";
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
  year: string,
  tenantId?: number
): GeneratePreview {
  const ds = loadDataset();
  const targetKey = keyFromYM(year, month);
  const generated = S.generatedMonths.has(`${year}|${month}`);

  const leasesForMonth = ds.leases.filter(
    (l) => leaseCoversMonth(l, targetKey) && (tenantId === undefined || l.tenantId === tenantId)
  );
  const colsForMonth = ds.collections.filter(
    (c) => c.rentMonth === month && c.rentYear === year
  );

  const rows: GeneratePreviewRow[] = leasesForMonth
    .map((l) => {
      const leaseCols = colsForMonth.filter((c) => c.leaseId === l.id);
      const paidCols = leaseCols.filter((c) => c.status === "DONE");
      const pendingCols = leaseCols.filter((c) => c.status === "PENDING");
      const collectedSum = paidCols.reduce((s, c) => s + c.rent, 0);
      let status: GeneratePreviewRow["status"] = "DUE";
      if (paidCols.length > 0 && collectedSum >= l.rent) status = "PAID";
      else if (paidCols.length > 0) status = "PARTIAL";
      else if (pendingCols.length > 0) status = "INVOICED";
      return {
        leaseId: l.id,
        tenantId: l.tenantId,
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
      const order = { DUE: 0, PARTIAL: 1, INVOICED: 2, PAID: 3 } as const;
      return order[a.status] - order[b.status] || b.rent - a.rent;
    });

  const toGenerate = rows.filter((r) => r.status === "DUE");
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

// --- idempotent rent generation: create PENDING collections (invoices) ---
// Checks if a collection already exists for each lease+month before creating.
// Returns {created, skipped} so the UI can report "N invoices created, M
// already existed".

export function generateRentForLease(
  leaseId: number,
  month: string,
  year: string
): { created: boolean; alreadyExists: boolean } {
  const ds = loadDataset();
  const lease = ds.leases.find((l) => l.id === leaseId);
  if (!lease) return { created: false, alreadyExists: false };
  // idempotency: skip if ANY collection (DONE or PENDING) exists for this
  // lease+month — the invoice was already created (or the rent was collected).
  const exists = ds.collections.some(
    (c) => c.leaseId === leaseId && c.rentMonth === month && c.rentYear === year
  );
  if (exists) return { created: false, alreadyExists: true };
  // create a PENDING collection (the invoice) with the lease's rent + bills
  ds.collections.push({
    id: S.nextCollectionId++,
    leaseId,
    tenantId: lease.tenantId,
    rent: lease.rent,
    gasBill: lease.gasBill,
    moylarBill: lease.moylarBill,
    serviceCharge: lease.serviceCharge,
    otherBill: lease.otherBill,
    rentMonth: month,
    rentYear: year,
    receiveDate: null,
    status: "PENDING",
  });
  return { created: true, alreadyExists: false };
}

export function generateRentForTenant(
  tenantId: number,
  month: string,
  year: string
): { created: number; skipped: number } {
  const ds = loadDataset();
  const targetKey = keyFromYM(year, month);
  const leases = ds.leases.filter(
    (l) => l.tenantId === tenantId && l.status === "ACTIVE" && leaseCoversMonth(l, targetKey)
  );
  let created = 0, skipped = 0;
  for (const l of leases) {
    const r = generateRentForLease(l.id, month, year);
    if (r.created) created++;
    else skipped++;
  }
  return { created, skipped };
}

export function generateRentForAll(
  month: string,
  year: string
): { created: number; skipped: number; tenantCount: number } {
  const ds = loadDataset();
  const targetKey = keyFromYM(year, month);
  const tenantIds = new Set(
    ds.leases
      .filter((l) => l.status === "ACTIVE" && leaseCoversMonth(l, targetKey))
      .map((l) => l.tenantId)
  );
  let created = 0, skipped = 0;
  for (const tid of tenantIds) {
    const r = generateRentForTenant(tid, month, year);
    created += r.created;
    skipped += r.skipped;
  }
  return { created, skipped, tenantCount: tenantIds.size };
}

/** Prototype "generate" — marks the month as generated in memory. */
export function markMonthGenerated(month: string, year: string): void {
  S.generatedMonths.add(`${year}|${month}`);
}

// --- waive / unwaive a month's rent due (tenant was gone, etc.) ---
// Key format: `${leaseId}|${month}|${year}`
function waiveKey(leaseId: number, month: string, year: string): string {
  return `${leaseId}|${month}|${year}`;
}
export function waiveLeaseMonth(leaseId: number, month: string, year: string): void {
  S.waivedMonths.add(waiveKey(leaseId, month, year));
}
export function unwaiaveLeaseMonth(leaseId: number, month: string, year: string): void {
  S.waivedMonths.delete(waiveKey(leaseId, month, year));
}
export function isLeaseMonthWaived(leaseId: number, month: string, year: string): boolean {
  return S.waivedMonths.has(waiveKey(leaseId, month, year));
}

// --- delete a collection record (a month's invoice/payment) by id ---
export function deleteCollection(id: number): { ok: boolean; error?: string } {
  const ds = loadDataset();
  const idx = ds.collections.findIndex((c) => c.id === id);
  if (idx === -1) return { ok: false, error: "Collection not found" };
  ds.collections.splice(idx, 1);
  return { ok: true };
}

// --- edit a collection (payment) record ---
// Lets the manager correct a payment's rent amount, bills, rent month/year,
// receive date, and status. This is critical for migration cleanup — fixing
// wrong amounts or dates that came from the old software. The change flows
// to the full ledger + dashboard + day book (they all read from collections).
export function updateCollection(opts: {
  id: number;
  rent?: number;
  gasBill?: number;
  moylarBill?: number;
  serviceCharge?: number;
  otherBill?: number;
  rentMonth?: string;
  rentYear?: string;
  receiveDate?: string | null;
  status?: "PENDING" | "DONE";
}): { ok: boolean; error?: string } {
  const ds = loadDataset();
  const c = ds.collections.find((x) => x.id === opts.id);
  if (!c) return { ok: false, error: "Collection not found" };
  if (opts.rent !== undefined) c.rent = Number(opts.rent) || 0;
  if (opts.gasBill !== undefined) c.gasBill = Number(opts.gasBill) || 0;
  if (opts.moylarBill !== undefined) c.moylarBill = Number(opts.moylarBill) || 0;
  if (opts.serviceCharge !== undefined) c.serviceCharge = Number(opts.serviceCharge) || 0;
  if (opts.otherBill !== undefined) c.otherBill = Number(opts.otherBill) || 0;
  if (opts.rentMonth !== undefined) c.rentMonth = String(opts.rentMonth);
  if (opts.rentYear !== undefined) c.rentYear = String(opts.rentYear);
  if (opts.receiveDate !== undefined) c.receiveDate = opts.receiveDate ? new Date(opts.receiveDate) : null;
  if (opts.status !== undefined) c.status = opts.status;
  return { ok: true };
}

// --- lease rent change history ---------------------------------------------
// Tracks rent/bills changes per lease with an effective date + reason.
// The ledger/dues use the rent that was in effect for each month.

export function addRentChange(
  leaseId: number,
  effectiveDate: string,
  rent: number,
  gasBill: number,
  moylarBill: number,
  serviceCharge: number,
  otherBill: number,
  reason: string
): { ok: boolean; error?: string } {
  const ds = loadDataset();
  const lease = ds.leases.find((l) => l.id === leaseId);
  if (!lease) return { ok: false, error: "Lease not found" };
  const changes = S.leaseRentChanges.get(leaseId) ?? [];
  changes.push({
    effectiveDate,
    rent: Number(rent) || 0,
    gasBill: Number(gasBill) || 0,
    moylarBill: Number(moylarBill) || 0,
    serviceCharge: Number(serviceCharge) || 0,
    otherBill: Number(otherBill) || 0,
    reason: reason || "",
    recordedAt: new Date().toISOString(),
  });
  // sort by effective date ascending
  changes.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  S.leaseRentChanges.set(leaseId, changes);
  // also update the lease's current rent (for the dashboard/preview)
  lease.rent = Number(rent) || 0;
  lease.gasBill = Number(gasBill) || 0;
  lease.moylarBill = Number(moylarBill) || 0;
  lease.serviceCharge = Number(serviceCharge) || 0;
  lease.otherBill = Number(otherBill) || 0;
  return { ok: true };
}

export function getLeaseRentChanges(leaseId: number): RentChange[] {
  return S.leaseRentChanges.get(leaseId) ?? [];
}

// Returns the rent/bills that were in effect for a lease at a given month.
// Looks up the rent-change history (the latest change with effectiveDate <=
// the target month). If no change history, falls back to the lease's current
// rent (backward compatible with existing data).
export function getRentForMonth(
  lease: Lease,
  month: string,
  year: string
): { rent: number; gasBill: number; moylarBill: number; serviceCharge: number; otherBill: number } {
  const changes = S.leaseRentChanges.get(lease.id);
  if (!changes || changes.length === 0) {
    // no history — use the lease's current values (backward compatible)
    return { rent: lease.rent, gasBill: lease.gasBill, moylarBill: lease.moylarBill, serviceCharge: lease.serviceCharge, otherBill: lease.otherBill };
  }
  // find the latest change that took effect on or before the target month
  const targetKey = keyFromYM(year, month);
  let applicable = null;
  for (const c of changes) {
    const cKey = keyFromYM(c.effectiveDate.slice(0, 4), MONTHS[Number(c.effectiveDate.slice(5, 7)) - 1]);
    if (cKey <= targetKey) applicable = c;
  }
  if (applicable) {
    return { rent: applicable.rent, gasBill: applicable.gasBill, moylarBill: applicable.moylarBill, serviceCharge: applicable.serviceCharge, otherBill: applicable.otherBill };
  }
  // no change before this month — use the lease's original rent (the first
  // change's values represent the NEW rent; before that, the lease.rent was
  // the original. But since we update lease.rent on addRentChange, we can't
  // recover the original. So if there are changes but none before this month,
  // we use the lease's current rent as a fallback.)
  return { rent: lease.rent, gasBill: lease.gasBill, moylarBill: lease.moylarBill, serviceCharge: lease.serviceCharge, otherBill: lease.otherBill };
}

// --- backup / restore -------------------------------------------------------
// Exports the FULL in-memory state (dataset + store changes) as a JSON-
// serializable object. Import replaces the state. This is the safety net
// for the migration: backup before making changes, restore if something
// goes wrong.

export function exportState(): unknown {
  const ds = loadDataset();
  // serialize dates as ISO strings
  const serializeDate = (d: Date | null) => d ? d.toISOString() : null;
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    dataset: {
      properties: ds.properties,
      units: ds.units,
      tenants: ds.tenants,
      leases: ds.leases.map((l) => ({
        ...l,
        agreementStart: serializeDate(l.agreementStart),
        agreementEnd: serializeDate(l.agreementEnd),
      })),
      collections: ds.collections.map((c) => ({
        ...c,
        receiveDate: serializeDate(c.receiveDate),
      })),
      txns: ds.txns.map((t) => ({
        ...t,
        transectionDate: serializeDate(t.transectionDate),
      })),
      accountHeads: ds.accountHeads,
      company: ds.company,
    },
    store: {
      generatedMonths: [...S.generatedMonths],
      tenantAdjustments: [...S.tenantAdjustments.entries()],
      waivedMonths: [...S.waivedMonths],
      leaseRentChanges: [...S.leaseRentChanges.entries()].map(([k, v]) => [k, v]),
      expenseRecs: S.expenseRecs?.map((r) => ({ ...r, recordedDate: serializeDate(r.recordedDate) })) ?? null,
      settlements: S.settlements,
      nextCollectionId: S.nextCollectionId,
      nextTxnId: S.nextTxnId,
      nextSettlementId: S.nextSettlementId,
      nextPropertyId: S.nextPropertyId,
      nextUnitId: S.nextUnitId,
      nextAccountHeadId: S.nextAccountHeadId,
    },
  };
}

export function importState(data: any): { ok: boolean; error?: string } {
  try {
    if (!data || !data.dataset) return { ok: false, error: "Invalid backup file" };
    const d = data.dataset;
    const parseDate = (s: any) => s ? new Date(s) : null;
    const ds: Dataset = {
      properties: d.properties ?? [],
      units: d.units ?? [],
      tenants: d.tenants ?? [],
      leases: (d.leases ?? []).map((l: any) => ({
        ...l,
        agreementStart: parseDate(l.agreementStart),
        agreementEnd: parseDate(l.agreementEnd),
      })),
      collections: (d.collections ?? []).map((c: any) => ({
        ...c,
        receiveDate: parseDate(c.receiveDate),
      })),
      txns: (d.txns ?? []).map((t: any) => ({
        ...t,
        transectionDate: parseDate(t.transectionDate),
      })),
      accountHeads: d.accountHeads ?? [],
      company: d.company ?? null,
      users: [],
    };
    S.cache = ds;
    S.dataSource = "real";
    // restore store fields
    const st = data.store;
    if (st) {
      if (st.generatedMonths) S.generatedMonths = new Set(st.generatedMonths);
      if (st.tenantAdjustments) S.tenantAdjustments = new Map(st.tenantAdjustments);
      if (st.waivedMonths) S.waivedMonths = new Set(st.waivedMonths);
      if (st.leaseRentChanges) S.leaseRentChanges = new Map(st.leaseRentChanges);
      if (st.expenseRecs) S.expenseRecs = st.expenseRecs.map((r: any) => ({ ...r, recordedDate: parseDate(r.recordedDate) }));
      if (st.settlements) S.settlements = st.settlements;
      if (st.nextCollectionId) S.nextCollectionId = st.nextCollectionId;
      if (st.nextTxnId) S.nextTxnId = st.nextTxnId;
      if (st.nextSettlementId) S.nextSettlementId = st.nextSettlementId;
      if (st.nextPropertyId) S.nextPropertyId = st.nextPropertyId;
      if (st.nextUnitId) S.nextUnitId = st.nextUnitId;
      if (st.nextAccountHeadId) S.nextAccountHeadId = st.nextAccountHeadId;
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Import failed" };
  }
}

// ============================================================================
// F2 — UNIFIED RENT COLLECTION
// ----------------------------------------------------------------------------
// getTenantList:  all tenants with leases + their outstanding summary.
// getTenantLedger: one tenant's due months (oldest first), advance, recent.
// collectRent:    record a collection (full/partial/advance-adjust/pay-later)
//                  + create ledger transaction + return a printable receipt.
// ============================================================================

// (nextCollectionId, nextTxnId, tenantAdjustments live on the global store S.)

function tenantAdvanceBalance(tenantId: number, ds: Dataset): number {
  const initial = ds.leases
    .filter((l) => l.tenantId === tenantId)
    .reduce((s, l) => s + l.advance, 0);
  const adjusted = S.tenantAdjustments.get(tenantId) ?? 0;
  return Math.max(0, initial - adjusted);
}

export interface TenantSummary {
  id: number;
  code: string;
  name: string;
  mobile: string | null;
  status: "ACTIVE" | "GONE";
  leaseCount: number;
  outstandingCount: number;
  outstandingTotal: number;
  advanceBalance: number;
}

export function getTenantList(
  asOfMonth: string,
  asOfYear: string
): TenantSummary[] {
  const ds = loadDataset();
  const asOfKey = keyFromYM(asOfYear, asOfMonth);
  const out: TenantSummary[] = [];

  for (const t of ds.tenants) {
    const leases = ds.leases.filter((l) => l.tenantId === t.id);
    if (leases.length === 0) continue;
    let outstandingCount = 0;
    let outstandingTotal = 0;
    for (const l of leases) {
      const startK = dateKey(l.agreementStart);
      if (startK === null) continue;
      const fromK = Math.max(startK, asOfKey - 23); // last 24 months
      for (let k = fromK; k <= asOfKey; k++) {
        const y = Math.floor(k / 12);
        const m = MONTHS[k % 12];
        const collected = ds.collections
          .filter(
            (c) =>
              c.leaseId === l.id &&
              c.rentMonth === m &&
              c.rentYear === String(y) &&
              c.status === "DONE"
          )
          .reduce((s, c) => s + c.rent, 0);
        const ri = getRentForMonth(l, m, String(y));
        const total = ri.rent + ri.gasBill + ri.serviceCharge + ri.otherBill;
        if (collected < total) {
          outstandingCount++;
          outstandingTotal += total - collected;
        }
      }
    }
    out.push({
      id: t.id,
      code: t.code,
      name: t.name,
      mobile: t.mobile,
      status: t.status,
      leaseCount: leases.length,
      outstandingCount,
      outstandingTotal,
      advanceBalance: tenantAdvanceBalance(t.id, ds),
    });
  }

  // biggest dues first; always-paid tenants still appear (useful to collect)
  return out.sort((a, b) => b.outstandingTotal - a.outstandingTotal);
}

export interface TenantDirectoryEntry {
  id: number;
  code: string;
  name: string;
  mobile: string | null;
  familyMember: string | null;
  status: "ACTIVE" | "GONE";
  leaseCount: number;
  activeLeaseCount: number;
  advanceBalance: number;
  outstandingCount: number;
  outstandingTotal: number;
}

/** All tenants for the directory (sorted by name), with lease/advance/outstanding
 *  summary relative to the as-of month. Includes Gone tenants (unlike
 *  getTenantList, which is the collect-picker sorted by dues). */
export function getTenants(
  asOfMonth: string,
  asOfYear: string
): TenantDirectoryEntry[] {
  const ds = loadDataset();
  const asOfKey = keyFromYM(asOfYear, asOfMonth);
  const out: TenantDirectoryEntry[] = [];

  for (const t of ds.tenants) {
    const leases = ds.leases.filter((l) => l.tenantId === t.id);
    const activeLeaseCount = leases.filter((l) => l.status === "ACTIVE").length;
    let outstandingCount = 0;
    let outstandingTotal = 0;
    for (const l of leases) {
      const startK = dateKey(l.agreementStart);
      if (startK === null) continue;
      const fromK = Math.max(startK, asOfKey - 23);
      for (let k = fromK; k <= asOfKey; k++) {
        const y = Math.floor(k / 12);
        const m = MONTHS[k % 12];
        const collected = ds.collections
          .filter(
            (c) =>
              c.leaseId === l.id &&
              c.rentMonth === m &&
              c.rentYear === String(y) &&
              c.status === "DONE"
          )
          .reduce((s, c) => s + c.rent, 0);
        const ri = getRentForMonth(l, m, String(y));
        const total = ri.rent + ri.gasBill + ri.serviceCharge + ri.otherBill;
        if (collected < total) {
          outstandingCount++;
          outstandingTotal += total - collected;
        }
      }
    }
    out.push({
      id: t.id,
      code: t.code,
      name: t.name,
      mobile: t.mobile,
      familyMember: t.familyMember,
      status: t.status,
      leaseCount: leases.length,
      activeLeaseCount,
      advanceBalance: tenantAdvanceBalance(t.id, ds),
      outstandingCount,
      outstandingTotal,
    });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name, "bn"));
}

export interface DueRow {
  leaseId: number;
  month: string;
  year: string;
  propertyName: string;
  unitName: string;
  rent: number;
  gasBill: number;
  serviceCharge: number;
  otherBill: number;
  total: number;
  collected: number;
  remaining: number;
  status: "DUE" | "PARTIAL" | "OVERDUE" | "PAID";
}
export interface TenantLedger {
  tenant: {
    id: number;
    name: string;
    mobile: string | null;
    code: string;
    status: "ACTIVE" | "GONE";
    advanceBalance: number;
  };
  leases: Array<{
    id: number;
    propertyName: string;
    unitName: string;
    rent: number;
    status: "ACTIVE" | "CLOSED";
  }>;
  dueRows: DueRow[];
  outstandingTotal: number;
  outstandingCount: number;
  recentCollections: Array<{
    id: number;
    month: string;
    year: string;
    rent: number;
    receiveDate: string | null;
    status: string;
  }>;
}

export function getTenantLedger(
  tenantId: number,
  asOfMonth: string,
  asOfYear: string
): TenantLedger | null {
  const ds = loadDataset();
  const tenant = ds.tenants.find((t) => t.id === tenantId);
  if (!tenant) return null;
  const asOfKey = keyFromYM(asOfYear, asOfMonth);
  const leases = ds.leases.filter((l) => l.tenantId === tenantId);

  const dueRows: DueRow[] = [];
  for (const l of leases) {
    const startK = dateKey(l.agreementStart);
    if (startK === null) continue;
    const fromK = Math.max(startK, asOfKey - 23);
    for (let k = fromK; k <= asOfKey; k++) {
      const y = Math.floor(k / 12);
      const m = MONTHS[k % 12];
      // skip waived months (tenant was gone — no rent due)
      if (isLeaseMonthWaived(l.id, m, String(y))) continue;
      const cols = ds.collections.filter(
        (c) =>
          c.leaseId === l.id && c.rentMonth === m && c.rentYear === String(y)
      );
      const collected = cols
        .filter((c) => c.status === "DONE")
        .reduce((s, c) => s + c.rent, 0);
      const ri = getRentForMonth(l, m, String(y));
      const total = ri.rent + ri.gasBill + ri.serviceCharge + ri.otherBill;
      let status: DueRow["status"];
      if (collected >= total) status = "PAID";
      else if (collected > 0) status = "PARTIAL";
      else status = k < asOfKey ? "OVERDUE" : "DUE";
      if (status !== "PAID") {
        dueRows.push({
          leaseId: l.id,
          month: m,
          year: String(y),
          propertyName: l.propertyName,
          unitName: l.unitName,
          rent: l.rent,
          gasBill: l.gasBill,
          serviceCharge: l.serviceCharge,
          otherBill: l.otherBill,
          total,
          collected,
          remaining: total - collected,
          status,
        });
      }
    }
  }
  // oldest first — pay previous dues before current
  dueRows.sort(
    (a, b) => keyFromYM(a.year, a.month) - keyFromYM(b.year, b.month)
  );

  const recentCollections = ds.collections
    .filter((c) => c.tenantId === tenantId)
    .sort((a, b) => {
      const da = a.receiveDate?.getTime() ?? 0;
      const db = b.receiveDate?.getTime() ?? 0;
      return db - da;
    })
    .slice(0, 6)
    .map((c) => ({
      id: c.id,
      month: c.rentMonth,
      year: c.rentYear,
      rent: c.rent,
      receiveDate: c.receiveDate ? c.receiveDate.toISOString() : null,
      status: c.status,
    }));

  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      mobile: tenant.mobile,
      code: tenant.code,
      status: tenant.status,
      advanceBalance: tenantAdvanceBalance(tenantId, ds),
    },
    leases: leases.map((l) => ({
      id: l.id,
      propertyName: l.propertyName,
      unitName: l.unitName,
      rent: l.rent,
      status: l.status,
    })),
    dueRows,
    outstandingTotal: dueRows.reduce((s, r) => s + r.remaining, 0),
    outstandingCount: dueRows.length,
    recentCollections,
  };
}

export interface CollectPayload {
  tenantId: number;
  leaseId: number;
  month: string;
  year: string;
  rent: number;
  gasBill: number;
  serviceCharge: number;
  otherBill: number;
  method: "CASH" | "BANK" | "MOBILE_BANK";
  advanceAdjust: number;
  payLater: boolean;
  note: string;
  receiveDate: string; // ISO
}

export interface Receipt {
  receiptNo: string;
  receiptId: number;
  date: string;
  tenantName: string;
  tenantMobile: string | null;
  tenantCode: string;
  propertyName: string;
  unitName: string;
  leaseId: number;
  month: string;
  year: string;
  lineItems: Array<{ label: string; amount: number }>;
  total: number;
  advanceAdjusted: number;
  netPayable: number;
  method: string;
  payLater: boolean;
  note: string;
  qrData: string;
}

export function collectRent(p: CollectPayload): {
  ok: boolean;
  error?: string;
  receipt?: Receipt;
} {
  const ds = loadDataset();
  const tenant = ds.tenants.find((t) => t.id === p.tenantId);
  const lease = ds.leases.find((l) => l.id === p.leaseId);
  if (!tenant) return { ok: false, error: "Tenant not found" };
  if (!lease) return { ok: false, error: "Lease not found" };

  const total =
    Number(p.rent) + Number(p.gasBill) + Number(p.serviceCharge) + Number(p.otherBill);
  if (total <= 0) return { ok: false, error: "Amount must be greater than zero" };

  const receive = p.receiveDate ? new Date(p.receiveDate) : new Date();
  const id = S.nextCollectionId++;

  // record the collection
  ds.collections.push({
    id,
    leaseId: lease.id,
    tenantId: tenant.id,
    rent: Number(p.rent),
    gasBill: Number(p.gasBill),
    moylarBill: 0,
    serviceCharge: Number(p.serviceCharge),
    otherBill: Number(p.otherBill),
    rentMonth: p.month,
    rentYear: p.year,
    receiveDate: receive,
    status: p.payLater ? "PENDING" : "DONE",
  });

  // advance adjustment
  let advanceAdjusted = 0;
  if (!p.payLater && p.advanceAdjust > 0) {
    const avail = tenantAdvanceBalance(tenant.id, ds);
    advanceAdjusted = Math.min(Number(p.advanceAdjust), avail, total);
    if (advanceAdjusted > 0) {
      S.tenantAdjustments.set(
        tenant.id,
        (S.tenantAdjustments.get(tenant.id) ?? 0) + advanceAdjusted
      );
    }
  }

  // ledger transaction (cash actually received excludes the advance-adjusted part)
  if (!p.payLater) {
    const cashIn = Math.max(0, total - advanceAdjusted);
    if (cashIn > 0) {
      ds.txns.push({
        id: S.nextTxnId++,
        inAmount: cashIn,
        outAmount: 0,
        transectionDate: receive,
        note: `Rent collection — ${tenant.name} — ${p.month} ${p.year}`,
        type: "INCOME",
        method: p.method === "BANK" ? "BANK" : p.method === "MOBILE_BANK" ? "MOBILE_BANK" : "CASH",
        dataInsertedFrom: "RENT COLLECTION",
      });
    }
  }

  const receiptNo = `RP-${p.year}${String(monthIndex(p.month) + 1).padStart(2, "0")}-${String(
    id
  ).slice(-5)}`;

  const lineItems: { label: string; amount: number }[] = [
    { label: "Rent", amount: Number(p.rent) },
  ];
  if (p.gasBill) lineItems.push({ label: "Gas Bill", amount: Number(p.gasBill) });
  if (p.serviceCharge) lineItems.push({ label: "Service Charge", amount: Number(p.serviceCharge) });
  if (p.otherBill) lineItems.push({ label: "Other Bill", amount: Number(p.otherBill) });

  const receipt: Receipt = {
    receiptNo,
    receiptId: id,
    date: receive.toISOString(),
    tenantName: tenant.name,
    tenantMobile: tenant.mobile,
    tenantCode: tenant.code,
    propertyName: lease.propertyName,
    unitName: lease.unitName,
    leaseId: lease.id,
    month: p.month,
    year: p.year,
    lineItems,
    total,
    advanceAdjusted,
    netPayable: total - advanceAdjusted,
    method: p.method,
    payLater: p.payLater,
    note: p.note,
    qrData: `RENTPRO|${receiptNo}|${tenant.code}|${p.month} ${p.year}|${(total - advanceAdjusted).toFixed(2)}`,
  };

  return { ok: true, receipt };
}

// ============================================================================
// F3 — RECURRING EXPENSE TRACKER (electricity / gas / service)
// ----------------------------------------------------------------------------
// Tracks recurring monthly expenses, flags months that were never recorded
// (so you never silently miss an electricity bill), supports back-fill
// (record January's bill in February), and predicts amounts from history.
//
// Prototype source of truth: an in-memory `expenseRecs` array seeded from the
// legacy EXPENSE transactions (each expense txn -> a record for its month).
// New recordings append here AND post a transaction (so the dashboard cash
// flow stays in sync). In production these are `expense_record` rows in
// Postgres, each linked to a `transaction` via `transactionId`.
// ============================================================================

// (ExpenseRec interface is defined near the top; expenseRecs lives on S.)

function ensureExpenseRecs(): ExpenseRec[] {
  if (S.expenseRecs) return S.expenseRecs;
  const ds = loadDataset();
  const map = new Map<string, ExpenseRec>();
  for (const t of ds.txns) {
    if (t.type !== "EXPENSE" || t.outAmount <= 0 || !t.transectionDate || !t.accountHeadId) continue;
    const y = String(t.transectionDate.getFullYear());
    const m = MONTHS[t.transectionDate.getMonth()];
    const key = `${t.accountHeadId}|${m}|${y}`;
    const ex = map.get(key);
    if (ex) {
      ex.amount += t.outAmount;
      if (t.transectionDate > ex.recordedDate) ex.recordedDate = t.transectionDate;
    } else {
      map.set(key, {
        headId: t.accountHeadId,
        headName: t.accountHeadName,
        month: m,
        year: y,
        amount: t.outAmount,
        recordedDate: t.transectionDate,
        isBackfill: false,
      });
    }
  }
  const seeded: ExpenseRec[] = [...map.values()];
  S.expenseRecs = seeded;
  console.log(`[rentData] Seeded ${seeded.length} expense records from legacy transactions.`);
  return seeded;
}

export interface ExpenseRecordSummary {
  month: string;
  year: string;
  amount: number;
}
export interface ExpenseTypeStatus {
  headId: number;
  name: string;
  recurring: boolean;
  recordCount: number;
  recordedInAsOf: boolean;
  asOfAmount: number;
  predictedAmount: number;
  lastRecorded: ExpenseRecordSummary | null;
  missingMonths: { month: string; year: string }[];
  recent: ExpenseRecordSummary[];
  backfilledCount: number;
}
export interface ExpenseTracker {
  month: string;
  year: string;
  types: ExpenseTypeStatus[];
  recordedCount: number;
  recordedTotal: number;
  dueCount: number;
  dueTotal: number;
  backfillCount: number;
}

export function getExpenseTracker(month: string, year: string): ExpenseTracker {
  const ds = loadDataset();
  const recs = ensureExpenseRecs();
  const asOfKey = keyFromYM(year, month);

  // aggregate by (headId, month, year)
  const agg = new Map<string, ExpenseRec>();
  for (const r of recs) {
    const key = `${r.headId}|${r.month}|${r.year}`;
    const ex = agg.get(key);
    if (ex) {
      ex.amount += r.amount;
      if (r.recordedDate > ex.recordedDate) ex.recordedDate = r.recordedDate;
      ex.isBackfill = ex.isBackfill || r.isBackfill;
    } else {
      agg.set(key, { ...r });
    }
  }

  const headsWithRecs = new Set([...agg.values()].map((r) => r.headId));
  const types: ExpenseTypeStatus[] = [];

  for (const hid of headsWithRecs) {
    const headRecs = [...agg.values()].filter((r) => r.headId === hid);
    const sorted = headRecs.sort(
      (a, b) => keyFromYM(a.year, a.month) - keyFromYM(b.year, b.month)
    );
    const distinct = new Set(sorted.map((r) => `${r.year}|${r.month}`)).size;
    // A head is "recurring" if the manager explicitly marked it so, OR it's
    // been recorded in 2+ distinct months historically (auto-detection for
    // legacy dump heads that don't carry the explicit flag).
    const head = ds.accountHeads.find((a) => a.id === hid);
    const recurring = (head?.recurringMonthly ?? false) || distinct >= 2;
    const asOfRec = sorted.find((r) => r.month === month && r.year === year);
    const last3 = sorted.slice(-3);
    const predicted = last3.length
      ? last3.reduce((s, r) => s + r.amount, 0) / last3.length
      : 0;
    const lastRec = sorted[sorted.length - 1] ?? null;
    const firstRec = sorted[0] ?? null;
    // Missing months: scan EVERY month from firstRecorded (capped 24 months
    // back from asOf) to asOf, flagging any month with no record. This catches
    // gaps BEFORE the last recorded month too (e.g. paid Jan+Mar, missed Feb).
    const missingMonths: { month: string; year: string }[] = [];
    if (recurring && firstRec) {
      const firstK = keyFromYM(firstRec.year, firstRec.month);
      const fromK = Math.max(firstK, asOfKey - 23);
      for (let k = fromK; k <= asOfKey; k++) {
        const y = String(Math.floor(k / 12));
        const m = MONTHS[k % 12];
        if (!sorted.some((r) => r.month === m && r.year === y)) {
          missingMonths.push({ month: m, year: y });
        }
      }
    }
    types.push({
      headId: hid,
      name: ds.accountHeads.find((a) => a.id === hid)?.name ?? "",
      recurring,
      recordCount: distinct,
      recordedInAsOf: !!asOfRec,
      asOfAmount: asOfRec?.amount ?? 0,
      predictedAmount: Math.round(predicted),
      lastRecorded: lastRec
        ? { month: lastRec.month, year: lastRec.year, amount: lastRec.amount }
        : null,
      missingMonths,
      recent: sorted
        .slice(-6)
        .reverse()
        .map((r) => ({ month: r.month, year: r.year, amount: r.amount })),
      backfilledCount: sorted.filter((r) => r.isBackfill).length,
    });
  }

  // due (recurring & not recorded this month) first, then by missing count
  types.sort((a, b) => {
    const aDue = a.recurring && !a.recordedInAsOf ? 1 : 0;
    const bDue = b.recurring && !b.recordedInAsOf ? 1 : 0;
    if (aDue !== bDue) return bDue - aDue;
    return b.missingMonths.length - a.missingMonths.length;
  });

  const recordedTypes = types.filter((t) => t.recordedInAsOf);
  const dueTypes = types.filter((t) => t.recurring && !t.recordedInAsOf);

  return {
    month,
    year,
    types,
    recordedCount: recordedTypes.length,
    recordedTotal: recordedTypes.reduce((s, t) => s + t.asOfAmount, 0),
    dueCount: dueTypes.length,
    dueTotal: dueTypes.reduce((s, t) => s + t.predictedAmount, 0),
    backfillCount: types.reduce((s, t) => s + t.missingMonths.length, 0),
  };
}

export interface RecordExpensePayload {
  accountHeadId: number;
  month: string;
  year: string;
  amount: number;
  date: string; // ISO recorded date
  note: string;
  method?: PaymentMethod;
}

export function recordExpense(
  p: RecordExpensePayload
): { ok: boolean; error?: string } {
  const ds = loadDataset();
  const recs = ensureExpenseRecs();
  const head = ds.accountHeads.find((a) => a.id === p.accountHeadId);
  if (!head) return { ok: false, error: "Expense head not found" };
  if (p.amount <= 0) return { ok: false, error: "Amount must be greater than zero" };

  const date = p.date ? new Date(p.date) : new Date();
  const forKey = keyFromYM(p.year, p.month);
  const recKey = date.getFullYear() * 12 + date.getMonth();
  const isBackfill = recKey !== forKey;

  // 1) expense record (for-month attribution — what the tracker reads)
  recs.push({
    headId: head.id,
    headName: head.name,
    month: p.month,
    year: p.year,
    amount: Number(p.amount),
    recordedDate: date,
    isBackfill,
  });

  // 2) ledger transaction (cash-out, for dashboard cash flow sync)
  ds.txns.push({
    id: S.nextTxnId++,
    inAmount: 0,
    outAmount: Number(p.amount),
    transectionDate: date,
    note: p.note || `${head.name} — ${p.month} ${p.year}`,
    type: "EXPENSE",
    accountHeadId: head.id,
    accountHeadName: head.name,
    method: p.method ?? "CASH",
    dataInsertedFrom: "ADD EXPENSE",
  });

  return { ok: true };
}

/** Convenience: record one expense for each of a list of (month, year) — used
 *  by the "Record all missing months" back-fill action. */
export function recordExpenseBatch(
  items: RecordExpensePayload[]
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const it of items) {
    const r = recordExpense(it);
    if (!r.ok && r.error) errors.push(`${it.accountHeadId} ${it.month} ${it.year}: ${r.error}`);
  }
  return { ok: errors.length === 0, errors };
}

/** All expense account heads — for the record dialog's type dropdown. */
export function getExpenseHeads(): Array<{ id: number; name: string; recurring: boolean }> {
  const ds = loadDataset();
  return ds.accountHeads
    .filter((a) => a.type === "EXPENSE" || a.type === "BOTH")
    .map((a) => ({ id: a.id, name: a.name, recurring: a.recurringMonthly }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** All account heads (income + expense + both + asset + liability) — for the
 *  management list on the Expenses screen (add / edit / list all types). */
export function getAllAccountHeads(): AccountHead[] {
  const ds = loadDataset();
  return [...ds.accountHeads].sort((a, b) => a.name.localeCompare(b.name, "bn"));
}

/** Create a new account head (expense type). Returns the new id. */
export function createAccountHead(
  name: string,
  type: AccountHead["type"],
  recurringMonthly: boolean
): { ok: boolean; error?: string; id?: number } {
  const ds = loadDataset();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name is required" };
  // prevent exact-duplicate names (case-insensitive)
  const dup = ds.accountHeads.some(
    (a) => a.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (dup) return { ok: false, error: `An account head named "${trimmed}" already exists` };
  const id = S.nextAccountHeadId++;
  ds.accountHeads.push({ id, name: trimmed, type, recurringMonthly });
  return { ok: true, id };
}

/** Edit an existing account head (rename, change type, toggle recurring). */
export function updateAccountHead(
  id: number,
  name: string,
  type: AccountHead["type"],
  recurringMonthly: boolean
): { ok: boolean; error?: string } {
  const ds = loadDataset();
  const head = ds.accountHeads.find((a) => a.id === id);
  if (!head) return { ok: false, error: "Account head not found" };
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name is required" };
  // prevent duplicate name on a DIFFERENT head
  const dup = ds.accountHeads.some(
    (a) => a.id !== id && a.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (dup) return { ok: false, error: `Another account head named "${trimmed}" already exists` };
  head.name = trimmed;
  head.type = type;
  head.recurringMonthly = recurringMonthly;
  return { ok: true };
}

// ============================================================================
// F5 — VACATE & SETTLEMENT WIZARD
// ----------------------------------------------------------------------------
// getActiveLeases:     leases still ACTIVE, with outstanding + advance summary
//                      — the picker for "which tenant/room is leaving".
// getSettlementPreview: computes outstanding rent + utility bills for the
//                      unpaid months up to the vacate date, the tenant's
//                      advance balance, and a suggested refund/adjust split.
// settleLease:         posts the settlement transactions, closes the lease,
//                      frees the unit (VACANT), and marks the tenant GONE if
//                      they have no other active leases. Returns a printable
//                      settlement statement.
// ============================================================================

export interface SettlementRecord {
  id: number;
  leaseId: number;
  tenantId: number;
  unitId: number;
  propertyName: string;
  unitName: string;
  tenantName: string;
  vacateDate: string;
  outstandingRent: number;
  outstandingBills: number;
  advanceBalance: number;
  advanceAdjusted: number;
  advanceRefunded: number;
  netPayableByTenant: number;
  netRefundByOwner: number;
  settlementType: "REFUND" | "ADJUST" | "BOTH";
  tenantMarkedGone: boolean;
  note: string;
  settledAt: string;
}

export interface ActiveLeaseSummary {
  leaseId: number;
  tenantId: number;
  tenantName: string;
  tenantCode: string;
  mobile: string | null;
  unitId: number;
  unitName: string;
  propertyName: string;
  rent: number;
  advance: number;
  outstandingMonths: number;
  outstandingTotal: number;
  advanceBalance: number;
  agreementStart: string | null;
}

/** Leases that are still ACTIVE — candidates for vacate. */
export function getActiveLeases(asOfMonth: string, asOfYear: string): ActiveLeaseSummary[] {
  const ds = loadDataset();
  const asOfKey = keyFromYM(asOfYear, asOfMonth);
  const out: ActiveLeaseSummary[] = [];
  for (const l of ds.leases) {
    if (l.status !== "ACTIVE") continue;
    const startK = dateKey(l.agreementStart);
    const fromK = startK === null ? asOfKey : Math.max(startK, asOfKey - 23);
    let outstandingMonths = 0;
    let outstandingTotal = 0;
    for (let k = fromK; k <= asOfKey; k++) {
      const y = Math.floor(k / 12);
      const m = MONTHS[k % 12];
      const collected = ds.collections
        .filter(
          (c) =>
            c.leaseId === l.id &&
            c.rentMonth === m &&
            c.rentYear === String(y) &&
            c.status === "DONE"
        )
        .reduce((s, c) => s + c.rent, 0);
      const ri = getRentForMonth(l, m, String(y));
      const total = ri.rent + ri.gasBill + ri.serviceCharge + ri.otherBill;
      if (collected < total) {
        outstandingMonths++;
        outstandingTotal += total - collected;
      }
    }
    const tenant = ds.tenants.find((t) => t.id === l.tenantId);
    out.push({
      leaseId: l.id,
      tenantId: l.tenantId,
      tenantName: l.tenantName,
      tenantCode: tenant?.code ?? String(l.tenantId),
      mobile: tenant?.mobile ?? null,
      unitId: l.unitId,
      unitName: l.unitName,
      propertyName: l.propertyName,
      rent: l.rent,
      advance: l.advance,
      outstandingMonths,
      outstandingTotal,
      advanceBalance: tenantAdvanceBalance(l.tenantId, ds),
      agreementStart: l.agreementStart ? l.agreementStart.toISOString().slice(0, 10) : null,
    });
  }
  return out.sort((a, b) => b.outstandingTotal - a.outstandingTotal);
}

export interface OutstandingMonth {
  month: string;
  year: string;
  rent: number;
  bills: number;
  total: number;
}
export interface SettlementPreview {
  lease: {
    id: number;
    tenantId: number;
    tenantName: string;
    tenantCode: string;
    mobile: string | null;
    unitId: number;
    unitName: string;
    propertyName: string;
    rent: number;
    gasBill: number;
    serviceCharge: number;
    otherBill: number;
    agreementStart: string | null;
    advancePayment: number;
  };
  vacateDate: string;
  outstandingMonths: OutstandingMonth[];
  outstandingRentTotal: number;
  outstandingBillsTotal: number;
  outstandingTotal: number;
  advanceBalance: number;
  suggestedType: "REFUND" | "ADJUST" | "BOTH";
  suggestedAdjust: number;
  suggestedRefund: number;
  suggestedNetPayable: number;
  suggestedNetRefund: number;
}

export function getSettlementPreview(
  leaseId: number,
  vacateDate: string
): SettlementPreview | { error: string } {
  const ds = loadDataset();
  const lease = ds.leases.find((l) => l.id === leaseId);
  if (!lease) return { error: "Lease not found" };
  if (lease.status !== "ACTIVE") return { error: "Lease is not active (already settled)" };

  const vacate = vacateDate ? new Date(vacateDate) : new Date();
  const vacateKey = vacate.getFullYear() * 12 + vacate.getMonth();
  const startK = dateKey(lease.agreementStart);
  const fromK = startK === null ? vacateKey : Math.max(startK, vacateKey - 23);

  const outstandingMonths: OutstandingMonth[] = [];
  for (let k = fromK; k <= vacateKey; k++) {
    const y = Math.floor(k / 12);
    const m = MONTHS[k % 12];
    const collected = ds.collections
      .filter(
        (c) =>
          c.leaseId === lease.id &&
          c.rentMonth === m &&
          c.rentYear === String(y) &&
          c.status === "DONE"
      )
      .reduce((s, c) => s + c.rent, 0);
    const rent = lease.rent;
    const bills = lease.gasBill + lease.serviceCharge + lease.otherBill;
    const total = rent + bills;
    if (collected < total) {
      outstandingMonths.push({
        month: m,
        year: String(y),
        rent,
        bills,
        total: total - collected,
      });
    }
  }

  const outstandingRentTotal = outstandingMonths.reduce((s, r) => s + r.rent, 0);
  const outstandingBillsTotal = outstandingMonths.reduce((s, r) => s + r.bills, 0);
  const outstandingTotal = outstandingRentTotal + outstandingBillsTotal;
  const advanceBalance = tenantAdvanceBalance(lease.tenantId, ds);

  // suggested split
  const suggestedAdjust = Math.min(advanceBalance, outstandingTotal);
  const suggestedRefund = Math.max(0, advanceBalance - outstandingTotal);
  const suggestedNetPayable = Math.max(0, outstandingTotal - advanceBalance);
  const suggestedNetRefund = suggestedRefund;
  let suggestedType: "REFUND" | "ADJUST" | "BOTH" = "REFUND";
  if (suggestedAdjust > 0 && suggestedRefund > 0) suggestedType = "BOTH";
  else if (suggestedAdjust > 0) suggestedType = "ADJUST";

  const tenant = ds.tenants.find((t) => t.id === lease.tenantId);
  return {
    lease: {
      id: lease.id,
      tenantId: lease.tenantId,
      tenantName: lease.tenantName,
      tenantCode: tenant?.code ?? String(lease.tenantId),
      mobile: tenant?.mobile ?? null,
      unitId: lease.unitId,
      unitName: lease.unitName,
      propertyName: lease.propertyName,
      rent: lease.rent,
      gasBill: lease.gasBill,
      serviceCharge: lease.serviceCharge,
      otherBill: lease.otherBill,
      agreementStart: lease.agreementStart ? lease.agreementStart.toISOString().slice(0, 10) : null,
      advancePayment: lease.advance,
    },
    vacateDate: vacate.toISOString().slice(0, 10),
    outstandingMonths,
    outstandingRentTotal,
    outstandingBillsTotal,
    outstandingTotal,
    advanceBalance,
    suggestedType,
    suggestedAdjust,
    suggestedRefund,
    suggestedNetPayable,
    suggestedNetRefund,
  };
}

export interface SettlePayload {
  leaseId: number;
  vacateDate: string;
  advanceAdjusted: number;
  advanceRefunded: number;
  note: string;
}

export function settleLease(
  p: SettlePayload
): { ok: boolean; error?: string; settlement?: SettlementRecord } {
  const ds = loadDataset();
  const lease = ds.leases.find((l) => l.id === p.leaseId);
  if (!lease) return { ok: false, error: "Lease not found" };
  if (lease.status !== "ACTIVE") return { ok: false, error: "Lease already settled" };

  // recompute outstanding + advance for the record (source of truth)
  const preview = getSettlementPreview(p.leaseId, p.vacateDate);
  if ("error" in preview) return { ok: false, error: preview.error };
  const outstandingTotal = preview.outstandingTotal;
  const advanceBalance = preview.advanceBalance;

  const advanceAdjusted = Math.min(Number(p.advanceAdjusted), advanceBalance, outstandingTotal);
  const advanceRefunded = Math.min(
    Number(p.advanceRefunded),
    advanceBalance - advanceAdjusted
  );
  const netPayableByTenant = Math.max(0, outstandingTotal - advanceAdjusted);
  const netRefundByOwner = advanceRefunded;
  let settlementType: "REFUND" | "ADJUST" | "BOTH" = "REFUND";
  if (advanceAdjusted > 0 && advanceRefunded > 0) settlementType = "BOTH";
  else if (advanceAdjusted > 0) settlementType = "ADJUST";

  const vacate = p.vacateDate ? new Date(p.vacateDate) : new Date();
  const tenant = ds.tenants.find((t) => t.id === lease.tenantId);
  const unit = ds.units.find((u) => u.id === lease.unitId);

  // --- post transactions ---
  // 1) advance adjusted against due (internal; no cash moves)
  if (advanceAdjusted > 0) {
    S.tenantAdjustments.set(
      lease.tenantId,
      (S.tenantAdjustments.get(lease.tenantId) ?? 0) + advanceAdjusted
    );
    ds.txns.push({
      id: S.nextTxnId++,
      inAmount: 0,
      outAmount: 0,
      transectionDate: vacate,
      note: `Advance adjusted against due — ${lease.tenantName} — vacate settlement`,
      type: "ADJUSTMENT",
      accountHeadId: null,
      accountHeadName: "ADVANCE ADJUSTMENT",
      method: "CASH",
      dataInsertedFrom: "ADVANCE ADJUSTMENT",
    });
  }
  // 2) advance refunded to tenant (cash out)
  if (advanceRefunded > 0) {
    S.tenantAdjustments.set(
      lease.tenantId,
      (S.tenantAdjustments.get(lease.tenantId) ?? 0) + advanceRefunded
    );
    ds.txns.push({
      id: S.nextTxnId++,
      inAmount: 0,
      outAmount: advanceRefunded,
      transectionDate: vacate,
      note: `Advance refunded to tenant — ${lease.tenantName} — vacate settlement`,
      type: "EXPENSE",
      accountHeadId: null,
      accountHeadName: "CLIENT ADVANCE",
      method: "CASH",
      dataInsertedFrom: "ADVANCE REFUND",
    });
  }
  // 3) tenant pays the remaining outstanding (cash in)
  if (netPayableByTenant > 0) {
    ds.txns.push({
      id: S.nextTxnId++,
      inAmount: netPayableByTenant,
      outAmount: 0,
      transectionDate: vacate,
      note: `Final settlement payment — ${lease.tenantName} — ${lease.unitName}`,
      type: "INCOME",
      accountHeadId: null,
      accountHeadName: "RENT COLLECTION",
      method: "CASH",
      dataInsertedFrom: "RENT COLLECTION",
    });
  }

  // --- mutate state: close lease, free unit, mark tenant gone if last lease ---
  lease.status = "CLOSED";
  lease.vacatedAt = vacate;
  if (lease.agreementEnd === null || lease.agreementEnd < vacate) {
    lease.agreementEnd = vacate;
  }
  if (unit) unit.status = "VACANT";
  const hasOtherActiveLease = ds.leases.some(
    (l) => l.tenantId === lease.tenantId && l.id !== lease.id && l.status === "ACTIVE"
  );
  const tenantMarkedGone = !hasOtherActiveLease;
  if (tenant && tenantMarkedGone) tenant.status = "GONE";

  // --- record the settlement ---
  const record: SettlementRecord = {
    id: S.nextSettlementId++,
    leaseId: lease.id,
    tenantId: lease.tenantId,
    unitId: lease.unitId,
    propertyName: lease.propertyName,
    unitName: lease.unitName,
    tenantName: lease.tenantName,
    vacateDate: vacate.toISOString().slice(0, 10),
    outstandingRent: preview.outstandingRentTotal,
    outstandingBills: preview.outstandingBillsTotal,
    advanceBalance,
    advanceAdjusted,
    advanceRefunded,
    netPayableByTenant,
    netRefundByOwner,
    settlementType,
    tenantMarkedGone,
    note: p.note,
    settledAt: new Date().toISOString(),
  };
  S.settlements.push(record);

  return { ok: true, settlement: record };
}

// ============================================================================
// F4 — FLEXIBLE PROPERTY EDITOR
// ----------------------------------------------------------------------------
// Properties (Building / Open Space / Rooftop / Mixed) contain Units (Shop /
// Room / Open Space / Rooftop Slot / Parking / Godown / Other). You can add,
// rename, retype, retire, or delete units at any time — even long after the
// property exists — and create standalone open spaces / rooftops that aren't
// tied to a building. Unit occupancy is derived live from active leases:
// INACTIVE (user-retired) > OCCUPIED (has an active lease) > VACANT.
// ============================================================================

export type PropertyType = "BUILDING" | "OPEN_SPACE" | "ROOFTOP" | "MIXED";
export type UnitType = "SHOP" | "ROOM" | "OPEN_SPACE" | "ROOFTOP_SLOT" | "PARKING" | "GODOWN" | "OTHER";

export interface PropertySummary {
  id: number;
  name: string;
  type: PropertyType;
  unitCount: number;
  occupied: number;
  vacant: number;
  inactive: number;
}
export interface UnitDetail {
  id: number;
  propertyId: number;
  name: string;
  type: UnitType;
  defaultRent: number;
  notes: string | null;
  status: "OCCUPIED" | "VACANT" | "INACTIVE";
  lease: { leaseId: number; tenantName: string; rent: number } | null;
}
export interface PropertyDetail {
  property: { id: number; name: string; type: PropertyType };
  units: UnitDetail[];
  occupied: number;
  vacant: number;
  inactive: number;
}

const PROPERTY_TYPES: PropertyType[] = ["BUILDING", "OPEN_SPACE", "ROOFTOP", "MIXED"];
const UNIT_TYPES: UnitType[] = ["SHOP", "ROOM", "OPEN_SPACE", "ROOFTOP_SLOT", "PARKING", "GODOWN", "OTHER"];

export function getPropertyTypes(): PropertyType[] { return [...PROPERTY_TYPES]; }
export function getUnitTypes(): UnitType[] { return [...UNIT_TYPES]; }

function unitLiveStatus(unit: Unit, ds: Dataset): "OCCUPIED" | "VACANT" | "INACTIVE" {
  if (unit.status === "INACTIVE") return "INACTIVE";
  const hasActiveLease = ds.leases.some(
    (l) => l.unitId === unit.id && l.status === "ACTIVE"
  );
  return hasActiveLease ? "OCCUPIED" : "VACANT";
}

export function getProperties(): PropertySummary[] {
  const ds = loadDataset();
  return ds.properties
    .map((p) => {
      const units = ds.units.filter((u) => u.propertyId === p.id);
      let occupied = 0, vacant = 0, inactive = 0;
      for (const u of units) {
        const s = unitLiveStatus(u, ds);
        if (s === "OCCUPIED") occupied++;
        else if (s === "VACANT") vacant++;
        else inactive++;
      }
      return {
        id: p.id, name: p.name, type: p.type as PropertyType,
        unitCount: units.length, occupied, vacant, inactive,
      };
    })
    .sort((a, b) => a.id - b.id);
}

export function getPropertyDetail(propertyId: number): PropertyDetail | null {
  const ds = loadDataset();
  const property = ds.properties.find((p) => p.id === propertyId);
  if (!property) return null;
  const units = ds.units
    .filter((u) => u.propertyId === propertyId)
    .map((u) => {
      const lease = ds.leases.find((l) => l.unitId === u.id && l.status === "ACTIVE") ?? null;
      return {
        id: u.id, propertyId: u.propertyId, name: u.name,
        type: (u.type as UnitType) || "ROOM", defaultRent: u.defaultRent,
        notes: u.notes, status: unitLiveStatus(u, ds),
        lease: lease ? { leaseId: lease.id, tenantName: lease.tenantName, rent: lease.rent } : null,
      };
    })
    .sort((a, b) => a.id - b.id);
  const occupied = units.filter((u) => u.status === "OCCUPIED").length;
  const vacant = units.filter((u) => u.status === "VACANT").length;
  const inactive = units.filter((u) => u.status === "INACTIVE").length;
  return {
    property: { id: property.id, name: property.name, type: property.type as PropertyType },
    units, occupied, vacant, inactive,
  };
}

export function addProperty(name: string, type: PropertyType): { ok: boolean; error?: string; id?: number } {
  const ds = loadDataset();
  if (!name.trim()) return { ok: false, error: "Name is required" };
  const id = S.nextPropertyId++;
  ds.properties.push({ id, name: name.trim(), type, unitCount: 0 });
  return { ok: true, id };
}

export function updateProperty(id: number, name: string, type: PropertyType): { ok: boolean; error?: string } {
  const ds = loadDataset();
  const p = ds.properties.find((x) => x.id === id);
  if (!p) return { ok: false, error: "Property not found" };
  if (!name.trim()) return { ok: false, error: "Name is required" };
  p.name = name.trim();
  p.type = type;
  return { ok: true };
}

export function addUnit(
  propertyId: number, name: string, type: UnitType, defaultRent: number, notes: string
): { ok: boolean; error?: string; id?: number } {
  const ds = loadDataset();
  const p = ds.properties.find((x) => x.id === propertyId);
  if (!p) return { ok: false, error: "Property not found" };
  if (!name.trim()) return { ok: false, error: "Unit name is required" };
  const id = S.nextUnitId++;
  ds.units.push({
    id, propertyId, name: name.trim(), type,
    defaultRent: Number(defaultRent) || 0, notes: notes || null, status: "VACANT",
  });
  return { ok: true, id };
}

export function updateUnit(
  id: number, name: string, type: UnitType, defaultRent: number, notes: string,
  status: "VACANT" | "INACTIVE"
): { ok: boolean; error?: string } {
  const ds = loadDataset();
  const u = ds.units.find((x) => x.id === id);
  if (!u) return { ok: false, error: "Unit not found" };
  if (!name.trim()) return { ok: false, error: "Unit name is required" };
  u.name = name.trim();
  u.type = type;
  u.defaultRent = Number(defaultRent) || 0;
  u.notes = notes || null;
  // INACTIVE retires a unit (hidden from occupancy). Re-activating sets VACANT.
  u.status = status === "INACTIVE" ? "INACTIVE" : "VACANT";
  return { ok: true };
}

export function deleteUnit(id: number): { ok: boolean; error?: string } {
  const ds = loadDataset();
  const u = ds.units.find((x) => x.id === id);
  if (!u) return { ok: false, error: "Unit not found" };
  const hasLease = ds.leases.some((l) => l.unitId === id);
  if (hasLease) {
    return { ok: false, error: "This unit has lease history — retire (set Inactive) instead of deleting." };
  }
  const idx = ds.units.findIndex((x) => x.id === id);
  ds.units.splice(idx, 1);
  return { ok: true };
}

// --- unit split: create a new room from an existing one ---
// Scenario: a room is made smaller and the extra space becomes a new rentable
// room. The original unit's rent is reduced (via a rent-change on its lease),
// and a new unit is created for the split-off space.
export function splitUnit(opts: {
  unitId: number;
  // rename the original unit (e.g. "Room 1" -> "Room 1A (smaller)")
  originalNewName?: string;
  // new rent for the original unit after the split
  originalNewRent?: number;
  originalNewGasBill?: number;
  originalNewServiceCharge?: number;
  originalNewOtherBill?: number;
  // the new unit created from the split
  newUnitName: string;
  newUnitType?: string;
  newUnitDefaultRent: number;
  // when the split takes effect (for the rent-change history)
  effectiveDate: string;
  reason: string;
}): { ok: boolean; error?: string; newUnitId?: number } {
  const ds = loadDataset();
  const u = ds.units.find((x) => x.id === opts.unitId);
  if (!u) return { ok: false, error: "Unit not found" };
  if (!opts.newUnitName.trim()) return { ok: false, error: "New unit name is required" };

  // 1. rename the original unit (if requested)
  if (opts.originalNewName?.trim()) {
    u.name = opts.originalNewName.trim();
  }
  // update the original unit's defaultRent
  if (opts.originalNewRent !== undefined) {
    u.defaultRent = opts.originalNewRent;
  }

  // 2. create the new unit from the split
  const newUnitId = S.nextUnitId++;
  ds.units.push({
    id: newUnitId,
    propertyId: u.propertyId,
    name: opts.newUnitName.trim(),
    type: opts.newUnitType || u.type,
    defaultRent: Number(opts.newUnitDefaultRent) || 0,
    notes: `Split from "${u.name}" on ${opts.effectiveDate}: ${opts.reason}`,
    status: "VACANT",
  } as Unit);
  // bump the property's unitCount
  const prop = ds.properties.find((p) => p.id === u.propertyId);
  if (prop) prop.unitCount = ds.units.filter((x) => x.propertyId === u.propertyId).length;

  // 3. record the rent change on the original unit's active lease
  if (opts.originalNewRent !== undefined) {
    const activeLease = ds.leases.find(
      (l) => l.unitId === opts.unitId && l.status === "ACTIVE"
    );
    if (activeLease) {
      addRentChange(
        activeLease.id,
        opts.effectiveDate,
        opts.originalNewRent,
        opts.originalNewGasBill ?? activeLease.gasBill,
        0, // moylarBill — keep existing
        opts.originalNewServiceCharge ?? activeLease.serviceCharge,
        opts.originalNewOtherBill ?? activeLease.otherBill,
        opts.reason
      );
    }
  }

  return { ok: true, newUnitId };
}

// ============================================================================
// REPORTS — re-create the legacy day-book / client-ledger / yearly reports
// ============================================================================

export interface DayBookRow {
  date: string;
  particulars: string;
  head: string;
  method: PaymentMethod;
  income: number;
  expense: number;
  balance: number;
}
export interface DayBookReport {
  fromDate: string;
  toDate: string;
  opening: number;
  // Opening balance split by where the money sits — Bank (account) vs
  // Cash-in-hand. Mirrors the legacy Day Book "Opening Balance" card.
  openingCash: number;
  openingBank: number;
  // Only real income/expense transactions (rent collection, add income, add
  // expense). Fund transfers (cash -> bank / bank -> cash) are EXCLUDED from
  // these rows and totals — they're not income or expense, just internal
  // movements between the two pots.
  rows: DayBookRow[];
  totalIncome: number;
  totalExpense: number;
  // Real income/expense movement during the period, by pot (excludes
  // transfers). cashIn + bankIn = totalIncome; cashOut + bankOut = totalExpense.
  cashIn: number;
  cashOut: number;
  bankIn: number;
  bankOut: number;
  // Internal fund transfers in the period (cash -> bank and bank -> cash).
  // These are excluded from the income/expense rows + totals above, but ARE
  // reflected in the closing cash/bank split below (because the money really
  // did move between pots).
  transferCashToBank: number;
  transferBankToCash: number;
  net: number;
  closing: number;
  // Closing balance split — opening ± the period's movement (income/expense
  // AND transfers) for each pot.
  closingCash: number;
  closingBank: number;
}

function dateOnly(d: Date | null): string | null {
  if (!d) return null;
  // Use LOCAL date components (not toISOString, which is UTC). A transaction
  // recorded on 01-Mar local midnight is stored as new Date(year, month, 1)
  // = local-midnight. On a UTC+N server, toISOString() would roll that back
  // to the previous UTC day (e.g. "2023-02-28"); reading the local year/month/
  // day keeps it as "2023-03-01".
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getDayBook(fromDate: string, toDate: string): DayBookReport {
  const ds = loadDataset();
  // Parse `from`/`to` as LOCAL midnight / 11:59pm (not UTC midnight) so they
  // line up with how transaction dates are parsed in toDate() (local midnight
  // via new Date(year, month, day)). With date-only strings, JS treats
  // new Date("2023-03-01") as UTC midnight — which, on a UTC+6 server, is 6
  // hours AHEAD of local midnight, so 1st-of-month transactions (local
  // midnight) would wrongly fall before `from` and get dumped into the
  // opening balance instead of the period rows. Appending "T00:00:00" makes
  // it local midnight and fixes the off-by-one.
  const from = fromDate ? new Date(fromDate + "T00:00:00") : new Date(0);
  const to = toDate ? new Date(toDate + "T23:59:59") : new Date(8640000000000000);

  const inRange = (d: Date | null) => d !== null && d >= from && d <= to;
  const beforeRange = (d: Date | null) => d !== null && d < from;

  const isBank = (m: PaymentMethod) => m === "BANK" || m === "MOBILE_BANK";
  const netOf = (t: Txn) => t.inAmount - t.outAmount;
  // Fund transfers (TRANSFER) and advance adjustments (ADJUSTMENT) are NOT
  // income or expense — exclude both from the Day Book rows, totals, and the
  // period movement summary. Transfers are still kept in the opening/closing
  // balance split (the money really did move between cash and bank);
  // adjustments are internal (no cash moves) so they're excluded from the
  // period movement AND from the opening (their out_amount doesn't represent
  // real cash leaving — the old report's cash-balance calc used
  // TRANSECTION_BY_RANGE_BALANCE_WITHOUT_ADVANCE_ADJUSTMENT).
  const isExcludedFromOperating = (t: Txn) => t.type === "TRANSFER" || t.type === "ADJUSTMENT";

  // --- Opening balance: sum every real txn + transfer before `from`, split
  // by method. EXCLUDES advance adjustments (internal, no cash moves), so the
  // opening matches the old report's OPENING_BALANCE. ---
  const openingTxns = ds.txns.filter(
    (t) => beforeRange(t.transectionDate) && t.type !== "ADJUSTMENT"
  );
  const openingCash = openingTxns
    .filter((t) => !isBank(t.method))
    .reduce((s, t) => s + netOf(t), 0);
  const openingBank = openingTxns
    .filter((t) => isBank(t.method))
    .reduce((s, t) => s + netOf(t), 0);
  const opening = openingCash + openingBank;

  // --- In-range transactions, sorted by date ---
  const rangeTxns = ds.txns
    .filter((t) => inRange(t.transectionDate))
    .sort((a, b) => (a.transectionDate!.getTime() - b.transectionDate!.getTime()));

  // --- Rows: only real income/expense (transfers + adjustments excluded) ---
  const operatingTxns = rangeTxns.filter((t) => !isExcludedFromOperating(t));
  const rows: DayBookRow[] = operatingTxns.map((t) => ({
    date: dateOnly(t.transectionDate)!,
    particulars: t.note ?? "",
    head: t.accountHeadName || (t.inAmount > 0 ? "Income" : "Expense"),
    method: t.method,
    income: t.inAmount,
    expense: t.outAmount,
    balance: 0,
  }));

  let running = opening;
  for (const r of rows) {
    running += r.income - r.expense;
    r.balance = running;
  }

  const totalIncome = rows.reduce((s, r) => s + r.income, 0);
  const totalExpense = rows.reduce((s, r) => s + r.expense, 0);

  // --- Real income/expense movement by pot (transfers excluded) ---
  const opCash = operatingTxns.filter((t) => !isBank(t.method));
  const opBank = operatingTxns.filter((t) => isBank(t.method));
  const cashIn = opCash.reduce((s, t) => s + t.inAmount, 0);
  const cashOut = opCash.reduce((s, t) => s + t.outAmount, 0);
  const bankIn = opBank.reduce((s, t) => s + t.inAmount, 0);
  const bankOut = opBank.reduce((s, t) => s + t.outAmount, 0);

  // --- Internal fund transfers in the period, by direction ---
  // A transfer is a FROM/TO pair: the FROM side has out_amount > 0 (money
  // leaving its pot) and the TO side has in_amount > 0 (money arriving). We
  // count only the FROM side (out > 0) to avoid double-counting each pair.
  // Direction is determined by the FROM side's method: cash out -> bank
  // (transferCashToBank); bank out -> cash (transferBankToCash).
  const transferTxns = rangeTxns.filter((t) => t.type === "TRANSFER");
  let transferCashToBank = 0; // FROM-cash (cash leaving for bank)
  let transferBankToCash = 0; // FROM-bank (bank leaving for cash)
  for (const t of transferTxns) {
    if (t.outAmount > 0) {
      if (isBank(t.method)) transferBankToCash += t.outAmount;
      else transferCashToBank += t.outAmount;
    }
  }

  // --- Closing balance split: opening +- real income/expense AND transfers ---
  // cash:  openingCash + cashIn - cashOut  - transferCashToBank + transferBankToCash
  // bank:  openingBank + bankIn - bankOut + transferCashToBank - transferBankToCash
  const closingCash = openingCash + cashIn - cashOut - transferCashToBank + transferBankToCash;
  const closingBank = openingBank + bankIn - bankOut + transferCashToBank - transferBankToCash;
  const closing = closingCash + closingBank;

  return {
    fromDate: dateOnly(from)!,
    toDate: dateOnly(to)!,
    opening,
    openingCash,
    openingBank,
    rows,
    totalIncome,
    totalExpense,
    cashIn,
    cashOut,
    bankIn,
    bankOut,
    transferCashToBank,
    transferBankToCash,
    net: totalIncome - totalExpense,
    closing,
    closingCash,
    closingBank,
  };
}

export interface YearlyMonth {
  month: string;
  rentCollected: number;
  income: number;
  expense: number;
  net: number;
}
export interface YearlyReport {
  year: string;
  months: YearlyMonth[];
  totalRentCollected: number;
  totalIncome: number;
  totalExpense: number;
  totalNet: number;
}

export function getYearlyReport(year: string): YearlyReport {
  const ds = loadDataset();
  const months: YearlyMonth[] = [];
  for (let mi = 0; mi < 12; mi++) {
    const m = MONTHS[mi];
    const rentCollected = ds.collections
      .filter((c) => c.rentYear === year && c.rentMonth === m && c.status === "DONE")
      .reduce((s, c) => s + c.rent, 0);
    const txns = ds.txns.filter(
      (t) => t.transectionDate && String(t.transectionDate.getFullYear()) === year && MONTHS[t.transectionDate.getMonth()] === m
    );
    const income = txns.reduce((s, t) => s + t.inAmount, 0);
    const expense = txns.reduce((s, t) => s + t.outAmount, 0);
    months.push({ month: m, rentCollected, income, expense, net: income - expense });
  }
  return {
    year,
    months,
    totalRentCollected: months.reduce((s, m) => s + m.rentCollected, 0),
    totalIncome: months.reduce((s, m) => s + m.income, 0),
    totalExpense: months.reduce((s, m) => s + m.expense, 0),
    totalNet: months.reduce((s, m) => s + m.net, 0),
  };
}

export interface AccountHeadRow {
  headId: number | null;
  head: string;
  type: string;
  income: number;
  expense: number;
  net: number;
  count: number;
}
export interface AccountHeadReport {
  month: string;
  year: string;
  rows: AccountHeadRow[];
  totalIncome: number;
  totalExpense: number;
  totalNet: number;
}

export function getAccountHeadReport(month: string, year: string): AccountHeadReport {
  const ds = loadDataset();
  const map = new Map<string, AccountHeadRow>();
  for (const t of ds.txns) {
    if (!t.transectionDate) continue;
    if (String(t.transectionDate.getFullYear()) !== year) continue;
    if (MONTHS[t.transectionDate.getMonth()] !== month) continue;
    const key = String(t.accountHeadId ?? "—");
    const head = t.accountHeadName || "Uncategorized";
    const ex = map.get(key) ?? {
      headId: t.accountHeadId,
      head,
      type: t.type,
      income: 0, expense: 0, net: 0, count: 0,
    };
    ex.income += t.inAmount;
    ex.expense += t.outAmount;
    ex.net += t.inAmount - t.outAmount;
    ex.count += 1;
    ex.head = head;
    map.set(key, ex);
  }
  const rows = [...map.values()].sort((a, b) => b.net - a.net);
  return {
    month, year, rows,
    totalIncome: rows.reduce((s, r) => s + r.income, 0),
    totalExpense: rows.reduce((s, r) => s + r.expense, 0),
    totalNet: rows.reduce((s, r) => s + r.net, 0),
  };
}

export interface LedgerEntry {
  date: string;
  particulars: string;
  debit: number; // tenant is charged (rent due)
  credit: number; // tenant paid (collection)
  balance: number; // running outstanding
  // For payment entries: the collection id (so the UI can delete it).
  // For rent-due entries: null (the due is derived from the lease, not a record).
  collectionId?: number | null;
  // For rent-due entries: the leaseId + month + year (so the UI can waive it).
  leaseId?: number | null;
  rentMonth?: string | null;
  rentYear?: string | null;
  waived?: boolean; // true if this month's due has been waived
}
export interface ClientLedgerStatement {
  tenant: { id: number; name: string; code: string; mobile: string | null; status: string; advanceBalance: number };
  leases: Array<{ id: number; propertyName: string; unitName: string; rent: number }>;
  asOfMonth: string;
  asOfYear: string;
  fromMonth: string;
  fromYear: string;
  openingAdvance: number;
  entries: LedgerEntry[];
  // Months whose rent due has been deleted (waived) — the rows are NOT in
  // entries[] (they're hidden). The UI shows a "restore" option for these.
  deletedMonths: Array<{ leaseId: number; month: string; year: string; unitName: string }>;
  closingOutstanding: number;
}

export function getClientLedgerStatement(
  tenantId: number,
  asOfMonth: string,
  asOfYear: string,
  fromMonth?: string,
  fromYear?: string
): ClientLedgerStatement | null {
  const ds = loadDataset();
  const tenant = ds.tenants.find((t) => t.id === tenantId);
  if (!tenant) return null;
  const leases = ds.leases.filter((l) => l.tenantId === tenantId);
  const asOfKey = keyFromYM(asOfYear, asOfMonth);

  // Default the "from" month to the tenant's FIRST COLLECTION month — the
  // actual start of their payment history. This avoids phantom dues from a
  // lease agreementStart that's set before the first real payment (e.g. the
  // agreement was signed in Jan but the tenant's first rent was February).
  // The user can override with an explicit fromMonth/fromYear.
  let fromKey: number;
  if (fromMonth && fromYear) {
    fromKey = keyFromYM(fromYear, fromMonth);
  } else {
    let earliest = asOfKey;
    for (const c of ds.collections) {
      if (c.tenantId !== tenantId) continue;
      const ck = keyFromYM(c.rentYear, c.rentMonth);
      if (ck < earliest) earliest = ck;
    }
    fromKey = earliest;
  }
  // clamp: don't go before the earliest lease start, and don't go past as-of
  const leaseStarts = leases.map((l) => dateKey(l.agreementStart)).filter((k): k is number => k !== null);
  const minLeaseStart = leaseStarts.length ? Math.min(...leaseStarts) : fromKey;
  if (fromKey < minLeaseStart) fromKey = minLeaseStart;
  if (fromKey > asOfKey) fromKey = asOfKey;

  interface Ev { date: string; particulars: string; debit: number; credit: number; collectionId?: number | null; leaseId?: number | null; rentMonth?: string | null; rentYear?: string | null; waived?: boolean; }
  const evs: Ev[] = [];

  // rent dues (one per month per lease in the window) — waived months are
  // DELETED (not shown as a row). They're returned in deletedMonths[] so the
  // UI can offer a restore. This matches the "delete payment" UX: the row
  // disappears entirely.
  const deletedMonths: Array<{ leaseId: number; month: string; year: string; unitName: string }> = [];
  for (const l of leases) {
    const startK = dateKey(l.agreementStart);
    if (startK === null) continue;
    const fromK = Math.max(startK, fromKey);
    for (let k = fromK; k <= asOfKey; k++) {
      const y = String(Math.floor(k / 12));
      const m = MONTHS[k % 12];
      // use the rent that was in effect for this month (rent-change history)
      const ri = getRentForMonth(l, m, y);
      const due = ri.rent + ri.gasBill + ri.serviceCharge + ri.otherBill;
      if (due <= 0) continue;
      if (isLeaseMonthWaived(l.id, m, y)) {
        // deleted — skip the row, track it for restoration
        deletedMonths.push({ leaseId: l.id, month: m, year: y, unitName: l.unitName });
        continue;
      }
      evs.push({ date: `${y}-${String((k % 12) + 1).padStart(2, "0")}-01`, particulars: `Rent due — ${m} ${y} — ${l.unitName}`, debit: due, credit: 0, leaseId: l.id, rentMonth: m, rentYear: y });
    }
  }
  // collections in the window (by RENT month, so they pair with the dues)
  for (const c of ds.collections.filter((c) => c.tenantId === tenantId && c.status === "DONE")) {
    const cKey = keyFromYM(c.rentYear, c.rentMonth);
    if (cKey < fromKey || cKey > asOfKey) continue;
    const d = dateOnly(c.receiveDate) ?? `${c.rentYear}-${String(MONTHS.indexOf(c.rentMonth) + 1).padStart(2, "0")}-01`;
    evs.push({ date: d, particulars: `Payment — ${c.rentMonth} ${c.rentYear} — ৳${c.rent}`, debit: 0, credit: c.rent, collectionId: c.id, leaseId: c.leaseId, rentMonth: c.rentMonth, rentYear: c.rentYear });
  }

  // Sort ASCENDING by rent month (so all January entries come before
  // February, etc.), then by date within the same rent month. This groups
  // each month's rent-due + payment together chronologically, so the manager
  // can see "jan, feb, march…" with both payment and rent for each month.
  evs.sort((a, b) => {
    const aKey = a.rentYear && a.rentMonth ? keyFromYM(a.rentYear, a.rentMonth) : 0;
    const bKey = b.rentYear && b.rentMonth ? keyFromYM(b.rentYear, b.rentMonth) : 0;
    if (aKey !== bKey) return aKey - bKey;
    // within the same rent month: rent-due (1st) before payment (receive date)
    return a.date.localeCompare(b.date);
  });

  let running = 0;
  const entries: LedgerEntry[] = evs.map((e) => {
    running += e.debit - e.credit;
    return { ...e, balance: running };
  });

  const fromMonthOut = MONTHS[fromKey % 12];
  const fromYearOut = String(Math.floor(fromKey / 12));

  return {
    tenant: {
      id: tenant.id, name: tenant.name, code: tenant.code,
      mobile: tenant.mobile, status: tenant.status,
      advanceBalance: tenantAdvanceBalance(tenantId, ds),
    },
    leases: leases.map((l) => ({ id: l.id, propertyName: l.propertyName, unitName: l.unitName, rent: l.rent })),
    asOfMonth, asOfYear,
    fromMonth: fromMonthOut,
    fromYear: fromYearOut,
    openingAdvance: tenantAdvanceBalance(tenantId, ds),
    entries,
    deletedMonths,
    closingOutstanding: running,
  };
}

export interface ClientDueRow {
  tenantId: number;
  name: string;
  code: string;
  mobile: string | null;
  status: string;
  outstandingTotal: number;
  outstandingCount: number;
  advanceBalance: number;
}
export interface ClientDueReport {
  month: string;
  year: string;
  rows: ClientDueRow[];
  totalOutstanding: number;
  totalTenants: number;
}

export function getClientDueReport(asOfMonth: string, asOfYear: string): ClientDueReport {
  const all = getTenants(asOfMonth, asOfYear);
  const rows = all
    .filter((t) => t.outstandingTotal > 0)
    .map((t) => ({
      tenantId: t.id, name: t.name, code: t.code, mobile: t.mobile,
      status: t.status, outstandingTotal: t.outstandingTotal,
      outstandingCount: t.outstandingCount, advanceBalance: t.advanceBalance,
    }))
    .sort((a, b) => b.outstandingTotal - a.outstandingTotal);
  return {
    month: asOfMonth,
    year: asOfYear,
    rows,
    totalOutstanding: rows.reduce((s, r) => s + r.outstandingTotal, 0),
    totalTenants: rows.length,
  };
}

// ============================================================================
// F9 — MULTI-TENANT SaaS CORE
// ----------------------------------------------------------------------------
// Each client is an Organization. The owner org (org_1, seeded from
// setup_company) owns the loaded dump data; other orgs are demo clients with
// no data — switching to them shows empty screens (row-level isolation
// demonstrated). Onboard new clients, edit per-org branding, manage plans.
// ============================================================================

export const OWNER_ORG_ID = "org_1";

function ensureOrganizations(): Organization[] {
  if (S.organizations) return S.organizations;
  const ds = loadDataset();
  const owner: Organization = {
    id: OWNER_ORG_ID,
    name: ds.company?.name ?? "My Organization",
    shortName: ds.company?.shortName ?? null,
    address: ds.company?.address ?? null,
    phone: ds.company?.phone ?? null,
    email: ds.company?.email ?? null,
    logo: ds.company?.logo ?? null,
    currency: "BDT",
    defaultLocale: "bn",
    plan: "ACTIVE",
    trialEndsAt: null,
    createdAt: new Date().toISOString(),
    isOwner: true,
  };
  // two demo client orgs (no data — demonstrate isolation)
  const demo1: Organization = {
    id: "org_demo_1",
    name: "Sunrise Properties",
    shortName: "Sunrise",
    address: "Chattogram",
    phone: null, email: null, logo: null,
    currency: "BDT", defaultLocale: "bn",
    plan: "TRIAL", trialEndsAt: new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10),
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    isOwner: false,
  };
  const demo2: Organization = {
    id: "org_demo_2",
    name: "City Markets Ltd",
    shortName: "CityMarkets",
    address: "Dhaka",
    phone: null, email: null, logo: null,
    currency: "BDT", defaultLocale: "en",
    plan: "TRIAL", trialEndsAt: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    isOwner: false,
  };
  S.organizations = [owner, demo1, demo2];
  S.activeOrgId = OWNER_ORG_ID;
  console.log(`[rentData] Seeded ${S.organizations.length} organizations (owner: ${owner.name}).`);
  return S.organizations;
}

export function getOrganizations(): Organization[] {
  return ensureOrganizations().slice().sort((a, b) => (a.isOwner ? -1 : 0) - (b.isOwner ? -1 : 0) || a.createdAt.localeCompare(b.createdAt));
}

export function getActiveOrg(): Organization {
  const all = ensureOrganizations();
  return all.find((o) => o.id === S.activeOrgId) ?? all[0];
}

export function setActiveOrg(id: string): { ok: boolean; error?: string } {
  const all = ensureOrganizations();
  if (!all.some((o) => o.id === id)) return { ok: false, error: "Organization not found" };
  S.activeOrgId = id;
  return { ok: true };
}

export interface CreateOrgPayload {
  name: string;
  shortName?: string;
  plan?: "TRIAL" | "ACTIVE" | "EXPIRED";
  currency?: string;
  defaultLocale?: "bn" | "en";
}
export function createOrganization(p: CreateOrgPayload): { ok: boolean; error?: string; id?: string } {
  ensureOrganizations();
  if (!p.name?.trim()) return { ok: false, error: "Name is required" };
  const id = `org_${S.nextOrgId++}`;
  const plan = p.plan ?? "TRIAL";
  const org: Organization = {
    id,
    name: p.name.trim(),
    shortName: p.shortName?.trim() || null,
    address: null, phone: null, email: null, logo: null,
    currency: p.currency ?? "BDT",
    defaultLocale: p.defaultLocale ?? "bn",
    plan,
    trialEndsAt: plan === "TRIAL" ? new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10) : null,
    createdAt: new Date().toISOString(),
    isOwner: false,
  };
  S.organizations!.push(org);
  return { ok: true, id };
}

export interface UpdateOrgPayload {
  name?: string;
  shortName?: string;
  address?: string;
  phone?: string;
  email?: string;
  currency?: string;
  defaultLocale?: "bn" | "en";
  plan?: "TRIAL" | "ACTIVE" | "EXPIRED";
}
export function updateOrganization(id: string, p: UpdateOrgPayload): { ok: boolean; error?: string } {
  const all = ensureOrganizations();
  const o = all.find((x) => x.id === id);
  if (!o) return { ok: false, error: "Organization not found" };
  if (p.name !== undefined) o.name = p.name.trim() || o.name;
  if (p.shortName !== undefined) o.shortName = p.shortName.trim() || null;
  if (p.address !== undefined) o.address = p.address || null;
  if (p.phone !== undefined) o.phone = p.phone || null;
  if (p.email !== undefined) o.email = p.email || null;
  if (p.currency !== undefined) o.currency = p.currency;
  if (p.defaultLocale !== undefined) o.defaultLocale = p.defaultLocale;
  if (p.plan !== undefined) {
    o.plan = p.plan;
    if (p.plan === "TRIAL" && !o.trialEndsAt) {
      o.trialEndsAt = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    }
    if (p.plan !== "TRIAL") o.trialEndsAt = null;
  }
  return { ok: true };
}

/** True only for the org that owns the loaded dump data. Other orgs are
 *  isolated (their data views show an empty state). */
export function activeOrgOwnsData(): boolean {
  ensureOrganizations();
  return S.activeOrgId === OWNER_ORG_ID;
}

// ============================================================================
// POINT 2 — AUTH (NextAuth credentials) + ROLE-BASED ACCESS (RBAC)
// ----------------------------------------------------------------------------
// verifyCredentials: server-side, called by the NextAuth credentials
//   provider. Compares the password against the bcrypt hash ($2y$ -> $2b$)
//   from the dump's `admin` table (or, after migrate:write, the Postgres
//   `users` table — swap this function to query Prisma in production).
// getAllowedViews: role -> the set of nav views that role may see.
// ============================================================================

export type ViewId =
  | "dashboard" | "generate" | "collect" | "expenses"
  | "vacate" | "properties" | "tenants" | "reports" | "platform";

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  orgId: string;
}

// --- managed users (owner + signups) ---------------------------------------
function ensureManagedUsers(): ManagedUser[] {
  if (S.managedUsers) return S.managedUsers;
  ensureOrganizations();
  const ownerUsername = process.env.OWNER_USERNAME || "admin";
  const ownerPassword = process.env.OWNER_PASSWORD || "admin123";
  const hash = bcrypt.hashSync(ownerPassword, 10);
  const owner: ManagedUser = {
    id: "user_owner",
    username: ownerUsername,
    passwordHash: hash,
    displayName: "Owner",
    role: "ADMIN",
    orgId: OWNER_ORG_ID,
    status: "Active",
  };
  S.managedUsers = [owner];
  console.log(`[rentData] Seeded owner user "${ownerUsername}" (org: ${OWNER_ORG_ID}).`);
  return S.managedUsers;
}

export interface RegisterPayload {
  username: string;
  password: string;
  displayName: string;
  orgName: string;
}
export function registerUser(p: RegisterPayload): { ok: boolean; error?: string; userId?: string; orgId?: string } {
  ensureManagedUsers();
  if (!p.username?.trim() || !p.password?.trim()) return { ok: false, error: "Username and password are required" };
  if (p.password.length < 6) return { ok: false, error: "Password must be at least 6 characters" };
  if (S.managedUsers!.some((u) => u.username.toLowerCase() === p.username.toLowerCase())) {
    return { ok: false, error: "Username already taken" };
  }
  // create a new org for the new user
  const orgResult = createOrganization({ name: p.orgName?.trim() || `${p.displayName}'s Properties`, plan: "TRIAL" });
  if (!orgResult.ok || !orgResult.id) return { ok: false, error: "Failed to create organization" };
  const id = `user_${S.nextManagedUserId++}`;
  const hash = bcrypt.hashSync(p.password, 10);
  const user: ManagedUser = {
    id,
    username: p.username.trim(),
    passwordHash: hash,
    displayName: p.displayName?.trim() || p.username.trim(),
    role: "ADMIN",
    orgId: orgResult.id,
    status: "Active",
  };
  S.managedUsers!.push(user);
  // set the new org's activeOrgId so the user sees their own org
  S.activeOrgId = orgResult.id;
  return { ok: true, userId: id, orgId: orgResult.id };
}

export async function verifyCredentials(
  username: string,
  password: string
): Promise<AuthenticatedUser | null> {
  const users = ensureManagedUsers();
  const u = users.find(
    (x) => x.username.toLowerCase() === username.toLowerCase() && x.status === "Active"
  );
  if (!u) return null;
  try {
    const ok = await bcrypt.compare(password, u.passwordHash);
    if (!ok) return null;
  } catch {
    return null;
  }
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role as Role, orgId: u.orgId };
}

const ROLE_VIEWS: Record<Role, ViewId[]> = {
  SUPER_ADMIN: ["dashboard", "generate", "collect", "expenses", "vacate", "properties", "tenants", "reports", "platform"],
  ADMIN: ["dashboard", "generate", "collect", "expenses", "vacate", "properties", "tenants", "reports", "platform"],
  MANAGER: ["dashboard", "generate", "collect", "expenses", "vacate", "properties", "tenants", "reports"],
  DATA_ENTRY: ["dashboard", "collect", "expenses", "tenants"],
  TENANT: ["dashboard"],
};

export function getAllowedViews(role: Role): ViewId[] {
  return ROLE_VIEWS[role] ?? ["dashboard"];
}


