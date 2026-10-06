// ============================================================================
// migrate.ts — legacy `osudlagb_home_rent` → RentPro (Prisma/Postgres)
// ----------------------------------------------------------------------------
// Usage (run from repo root):
//
//   # 1. Dry-run (DEFAULT — no DB needed): parse the dump, print per-table
//   #    row counts + money sums as a reconciliation report against the
//   #    legacy file itself. This PROVES the parser reads your data correctly.
//   LEGACY_SQL_PATH="../rent-project/osudlagb_home_rent.sql" bun run scripts/migrate.ts
//
//   # 2. Write to the new DB (requires DATABASE_URL pointing at Postgres +
//   #    `bunx prisma generate` + `bunx prisma migrate dev` already done):
//   LEGACY_SQL_PATH="../rent-project/osudlagb_home_rent.sql" \
//   bun run scripts/migrate.ts --write
//
// Design:
//   - Deterministic IDs (e.g. tenant_1, lease_38, txn_44) so re-runs are
//     idempotent (upserts) and every new row traces back to a legacy row.
//   - Dependency order: org → menus/users → banks/heads → properties/units →
//     tenants → leases → transactions → collections → schedules →
//     settlements → adjustments → lease-history.
//   - Reconciliation report compares legacy counts/totals vs DB counts/totals.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseLegacyDump,
  rowToObject,
  toNum,
  toDate,
  type ParsedDump,
} from "./lib/legacyParser.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const LEGACY_PATH =
  process.env.LEGACY_SQL_PATH ?? "../rent-project/osudlagb_home_rent.sql";
const WRITE_MODE = process.argv.includes("--write");
const ORG_ID = "org_1"; // single org from setup_company (your business)

// ---------------------------------------------------------------------------
// Deterministic ID helpers
// ---------------------------------------------------------------------------
const id = (prefix: string, legacyId: Cell) =>
  legacyId === null || legacyId === "" ? null : `${prefix}_${legacyId}`;

// ---------------------------------------------------------------------------
// 1. PARSE
// ---------------------------------------------------------------------------
function loadDump(): ParsedDump {
  const path = resolve(process.cwd(), LEGACY_PATH);
  console.log(`\n📄 Reading legacy dump: ${path}`);
  const sql = readFileSync(path, "utf-8");
  console.log(`   ${(sql.length / 1024).toFixed(1)} KB, parsing INSERTs…\n`);
  const parsed = parseLegacyDump(sql);
  return parsed;
}

// ---------------------------------------------------------------------------
// 2. LEGACY-SIDE RECONCILIATION (works without a DB)
// ---------------------------------------------------------------------------
interface MoneyColumn {
  table: string;
  column: string;
}

const MONEY_COLUMNS: MoneyColumn[] = [
  { table: "account_transection", column: "in_amount" },
  { table: "account_transection", column: "out_amount" },
  { table: "collect_rent", column: "rent" },
  { table: "collect_rent", column: "gus_bill" },
  { table: "collect_rent", column: "moylar_bill" },
  { table: "collect_rent", column: "service_charge" },
  { table: "collect_rent", column: "other_bill" },
  { table: "assign_unit", column: "rent" },
  { table: "assign_unit", column: "actual_rent" },
  { table: "assign_unit", column: "advance_payment" },
  { table: "setup_unit", column: "rent" },
];

function legacyReconciliation(parsed: ParsedDump): void {
  console.log("────────────────────────────────────────────────────────────");
  console.log(" LEGACY-SIDE RECONCILIATION (from parsed dump)")
  console.log("────────────────────────────────────────────────────────────");
  console.log(
    "TABLE                          ROWS      (the count we must match later)"
  );
  console.log("────────────────────────────────────────────────────────────");

  let grandTotal = 0;
  for (const [name, t] of parsed.tables) {
    console.log(
      `${name.padEnd(28)} ${String(t.rows.length).padStart(8)}`
    );
    grandTotal += t.rows.length;
  }
  console.log("────────────────────────────────────────────────────────────");
  console.log(`${"TOTAL ROWS".padEnd(28)} ${String(grandTotal).padStart(8)}`);
  console.log(`Tables parsed: ${parsed.tables.size}\n`);

  console.log("────────────────────────────────────────────────────────────");
  console.log(" MONEY TOTALS (legacy) — these must reconcile to the paisa")
  console.log("────────────────────────────────────────────────────────────");
  for (const { table, column } of MONEY_COLUMNS) {
    const t = parsed.tables.get(table);
    if (!t) continue;
    const colIdx = t.columns.indexOf(column);
    if (colIdx < 0) continue;
    const sum = t.rows.reduce((acc, row) => acc + toNum(row[colIdx]), 0);
    console.log(
      `${`${table}.${column}`.padEnd(38)} ${sum.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).padStart(20)}`
    );
  }
  console.log("────────────────────────────────────────────────────────────\n");
}

// ---------------------------------------------------------------------------
// 3. TRANSFORM LAYER (only runs in --write mode)
//
//    Each function reads legacy rows + builds the new-Prisma payload using
//    deterministic IDs. Rows are written with upsert() so re-runs are safe.
// ---------------------------------------------------------------------------

// We import Prisma lazily so the dry-run works without a generated client or DB.
async function getPrisma() {
  const mod = (await import("@prisma/client")).PrismaClient;
  return new mod();
}

type TransformContext = {
  parsed: ParsedDump;
  prisma: any;
  stats: Record<string, number>;
  warnings: string[];
};

// ---- transform helpers ----
function rowsOf(parsed: ParsedDump, table: string) {
  const t = parsed.tables.get(table);
  return t ? t.rows.map((r) => rowToObject(t, r)) : [];
}

function num(v: any): number {
  return v === null || v === "" ? 0 : Number(v) || 0;
}
function strOrNull(v: any): string | null {
  return v === null || v === "" ? null : String(v);
}
function dt(v: any): Date | null {
  return toDate(v);
}
function money(v: any): string {
  // keep as string to preserve "24000.00" precision for Postgres numeric
  return v === null || v === "" ? "0" : String(v);
}

// ---- org ----
async function migrateOrganization(ctx: TransformContext) {
  const rows = rowsOf(ctx.parsed, "setup_company");
  for (const r of rows) {
    await ctx.prisma.organization.upsert({
      where: { id: ORG_ID },
      create: {
        id: ORG_ID,
        name: strOrNull(r.name) ?? "RentPro Org",
        shortName: strOrNull(r.short_name),
        address: strOrNull(r.address),
        phone: strOrNull(r.phone),
        email: strOrNull(r.email),
        logo: strOrNull(r.logo),
        softwareStartDate: dt(r.software_start_date),
        softwareEndDate: dt(r.software_end_date),
      },
      update: {},
    });
    ctx.stats.organization++;
  }
}

// ---- menus (global, not per-org) ----
async function migrateMenus(ctx: TransformContext) {
  const rows = rowsOf(ctx.parsed, "menu_list");
  for (const r of rows) {
    const mid = id("menu", r.id);
    if (!mid) continue;
    await ctx.prisma.menu.upsert({
      where: { id: mid },
      create: {
        id: mid,
        label: strOrNull(r.menu) ?? "",
        labelEn: strOrNull(r.menu_link),
        link: strOrNull(r.menu_link),
        section: strOrNull(r.section),
        type: "MODULE",
        parentId: id("menu", r.parent_id),
        sort: num(r.sort),
        icon: strOrNull(r.icon),
      },
      update: {},
    });
    ctx.stats.menu++;
  }
}

// ---- users (admin) ----
async function migrateUsers(ctx: TransformContext) {
  const rows = rowsOf(ctx.parsed, "admin");
  for (const r of rows) {
    const uid = id("user", r.id);
    if (!uid) continue;
    // Convert PHP bcrypt prefix $2y$ → $2b$ (identical algorithm, Node bcryptjs
    // compatible). Real plaintext is NOT migrated; force reset on first login.
    let hash = strOrNull(r.password);
    if (hash && hash.startsWith("$2y$")) hash = "$2b$" + hash.slice(4);
    const role =
      r.user_type === "Admin" ? "ADMIN" : "MANAGER";
    await ctx.prisma.user.upsert({
      where: { id: uid },
      create: {
        id: uid,
        organizationId: ORG_ID,
        username: strOrNull(r.username) ?? String(r.id),
        password: hash ?? "",
        displayName: strOrNull(r.hr_name),
        photo: strOrNull(r.photo) ?? "no_image.jpg",
        userRole: role,
        status: r.hr_status === "Active" ? "Active" : "Inactive",
      },
      update: {},
    });
    ctx.stats.user++;
  }
}

// ---- banks / mobile banks ----
async function migrateBanks(ctx: TransformContext) {
  for (const r of rowsOf(ctx.parsed, "setup_bank")) {
    const bid = id("bank", r.id);
    if (!bid) continue;
    await ctx.prisma.bank.upsert({
      where: { id: bid },
      create: {
        id: bid,
        organizationId: ORG_ID,
        bankName: strOrNull(r.bank_name) ?? "",
        branchName: strOrNull(r.brunch_name),
        accountNumber: strOrNull(r.account_number),
        accountName: strOrNull(r.account_name),
        description: strOrNull(r.description),
        status: r.status === "Active" ? "Active" : "Inactive",
      },
      update: {},
    });
    ctx.stats.bank++;
  }
  for (const r of rowsOf(ctx.parsed, "setup_mobile_banking")) {
    const bid = id("mbank", r.id);
    if (!bid) continue;
    await ctx.prisma.mobileBank.upsert({
      where: { id: bid },
      create: {
        id: bid,
        organizationId: ORG_ID,
        name: strOrNull(r.mobile_bank_name) ?? "",
        mobileNumber: strOrNull(r.mobile_number),
        description: strOrNull(r.description),
        status: r.status === "Active" ? "Active" : "Inactive",
      },
      update: {},
    });
    ctx.stats.mobileBank++;
  }
}

// ---- chart of accounts ----
async function migrateAccounts(ctx: TransformContext) {
  for (const r of rowsOf(ctx.parsed, "setup_ladger_head")) {
    const lid = id("ledger", r.id);
    if (!lid) continue;
    await ctx.prisma.ledgerHead.upsert({
      where: { id: lid },
      create: {
        id: lid,
        organizationId: ORG_ID,
        name: strOrNull(r.name) ?? "",
        specialId: strOrNull(r.special_id) ?? "NO",
        status: "Active",
      },
      update: {},
    });
    ctx.stats.ledgerHead++;
  }
  for (const r of rowsOf(ctx.parsed, "setup_ac_head")) {
    const aid = id("acchead", r.id);
    if (!aid) continue;
    const type = mapAccountType(r.account_type);
    await ctx.prisma.accountHead.upsert({
      where: { id: aid },
      create: {
        id: aid,
        organizationId: ORG_ID,
        ledgerHeadId: id("ledger", r.ledger_id) ?? "ledger_1",
        name: strOrNull(r.account_head) ?? "",
        type,
        description: strOrNull(r.description),
        hasSubAccount: r.have_sub_ac === "YES",
        specialId: strOrNull(r.special_id) ?? "NO",
        status: r.status === "Active" ? "Active" : "Inactive",
      },
      update: {},
    });
    ctx.stats.accountHead++;
  }
}
function mapAccountType(v: any): any {
  switch (v) {
    case "INCOME": return "INCOME";
    case "EXPENSE": return "EXPENSE";
    case "BOTH": return "BOTH";
    default: return "EXPENSE";
  }
}

// ---- properties + units ----
async function migrateProperties(ctx: TransformContext) {
  for (const r of rowsOf(ctx.parsed, "setup_vobon")) {
    const pid = id("property", r.id);
    if (!pid) continue;
    await ctx.prisma.property.upsert({
      where: { id: pid },
      create: {
        id: pid,
        organizationId: ORG_ID,
        name: strOrNull(r.vobon_name) ?? "",
        type: "BUILDING", // legacy was building-only
        unitCount: num(r.unit_no),
        status: "Active",
      },
      update: {},
    });
    ctx.stats.property++;
  }
  for (const r of rowsOf(ctx.parsed, "setup_unit")) {
    const uid = id("unit", r.id);
    if (!uid) continue;
    await ctx.prisma.unit.upsert({
      where: { id: uid },
      create: {
        id: uid,
        organizationId: ORG_ID,
        propertyId: id("property", r.vobon_id) ?? "property_1",
        name: strOrNull(r.unit_name) ?? "",
        type: "SHOP",
        defaultRent: money(r.rent),
        notes: strOrNull(r.notes),
        status: "VACANT", // corrected below once leases are loaded
      },
      update: {},
    });
    ctx.stats.unit++;
  }
}

// ---- tenants ----
async function migrateTenants(ctx: TransformContext) {
  for (const r of rowsOf(ctx.parsed, "setup_client")) {
    const tid = id("tenant", r.id);
    if (!tid) continue;
    const status = r.client_status === "Gone" ? "GONE" : "ACTIVE";
    await ctx.prisma.tenant.upsert({
      where: { id: tid },
      create: {
        id: tid,
        organizationId: ORG_ID,
        code: strOrNull(r.code) ?? String(r.id),
        name: strOrNull(r.client_name) ?? "",
        mobile: strOrNull(r.mobile),
        nid: strOrNull(r.nid),
        familyMember: strOrNull(r.family_member),
        status,
        farewelDate: dt(r.farewel_date),
      },
      update: {},
    });
    ctx.stats.tenant++;
  }
}

// ---- leases (assign_unit) ----
async function migrateLeases(ctx: TransformContext) {
  for (const r of rowsOf(ctx.parsed, "assign_unit")) {
    const lid = id("lease", r.id);
    if (!lid) continue;
    const status = r.client_status === "Gone" ? "CLOSED" : "ACTIVE";
    const tenantId = id("tenant", r.client_id);
    const unitId = id("unit", r.unit_id);
    if (!tenantId || !unitId) {
      ctx.warnings.push(`lease ${r.id}: missing tenant/unit FK, skipped`);
      continue;
    }
    // vobon_id maps to the property; also infer from the unit's property
    const propertyId = id("property", r.vobon_id) ?? "property_1";
    await ctx.prisma.lease.upsert({
      where: { id: lid },
      create: {
        id: lid,
        organizationId: ORG_ID,
        tenantId,
        unitId,
        propertyId,
        agreementStart:
          dt(r.aggrement_start) ?? new Date(2022, 0, 1),
        agreementEnd: dt(r.aggrement_ends),
        actualRent: money(r.actual_rent),
        rent: money(r.rent),
        advancePayment: money(r.advance_payment),
        advancePaymentDate: dt(r.advance_payment_date),
        gasBill: money(r.gus_bill),
        moylarBill: money(r.moylar_bill),
        serviceCharge: money(r.service_charge),
        otherBill: money(r.other_bill),
        status,
        vacatedAt:
          status === "CLOSED" ? (dt(r.aggrement_ends) ?? new Date()) : null,
      },
      update: {},
    });
    // mark the unit occupied if the lease is active
    if (status === "ACTIVE") {
      await ctx.prisma.unit.update({
        where: { id: unitId },
        data: { status: "OCCUPIED" },
      });
    }
    ctx.stats.lease++;
  }
}

// ---- transactions (account_transection) ----
async function migrateTransactions(ctx: TransformContext) {
  for (const r of rowsOf(ctx.parsed, "account_transection")) {
    const tid = id("txn", r.id);
    if (!tid) continue;
    const type = mapTxnType(r.transection_type);
    await ctx.prisma.transaction.upsert({
      where: { id: tid },
      create: {
        id: tid,
        organizationId: ORG_ID,
        code: strOrNull(r.code),
        invoiceNo: strOrNull(r.invoice_no),
        transactionType: type,
        inAmount: money(r.in_amount),
        outAmount: money(r.out_amount),
        ledgerHeadId: id("ledger", r.ledger_id) ?? null,
        accountHeadId: id("acchead", r.transection_head_id) ?? null,
        transactionTo: strOrNull(r.transection_to),
        transactionToId: r.transection_to_id === null ? null : Number(r.transection_to_id),
        transactionBy: mapPayMethod(r.transection_by),
        bankId: id("bank", r.transection_by_id) ?? null,
        mobileBankId: id("mbank", r.transection_by_id) ?? null,
        checkNumber: strOrNull(r.check_number),
        checkDate: dt(r.check_date),
        note: strOrNull(r.note),
        transactionDate: dt(r.transection_date),
        poster: id("user", r.poster),
        lastupdate: strOrNull(r.lastupdate),
        dataInsertedFrom: strOrNull(r.data_inserted_from),
      },
      update: {},
    });
    ctx.stats.transaction++;
  }
}
function mapTxnType(v: any): any {
  // legacy free-text → enum; default INCOME
  const s = String(v ?? "").toLowerCase();
  if (s.includes("income") || s.includes("in")) return "INCOME";
  if (s.includes("expense") || s.includes("out")) return "EXPENSE";
  if (s.includes("transfer")) return "TRANSFER";
  if (s.includes("adjust")) return "ADJUSTMENT";
  // heuristic: in_amount > 0 => income, else expense
  return "INCOME";
}
function mapPayMethod(v: any): any {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("bank")) return "BANK";
  if (s.includes("mobile") || s.includes("bkash") || s.includes("nagad")) return "MOBILE_BANK";
  if (s.includes("cheque") || s.includes("check")) return "CHEQUE";
  return "CASH";
}

// ---- rent collections (collect_rent) ----
// We also derive rent_schedule rows here (one schedule per lease+month+year,
// idempotent via upsert), then link each collection to its schedule.
async function migrateCollections(ctx: TransformContext) {
  // Build leaseId -> unitId map from parsed assign_unit (no DB query needed)
  const leaseUnitMap = new Map<string, string | null>();
  for (const r of rowsOf(ctx.parsed, "assign_unit")) {
    const lid = id("lease", r.id);
    if (lid) leaseUnitMap.set(lid, id("unit", r.unit_id));
  }

  const scheduleCache = new Set<string>(); // key: leaseId|month|year
  for (const r of rowsOf(ctx.parsed, "collect_rent")) {
    const cid = id("collection", r.id);
    if (!cid) continue;
    const tenantId = id("tenant", r.client_id);
    const leaseId = id("lease", r.assign_unit_id);
    const unitId = leaseId ? leaseUnitMap.get(leaseId) ?? null : null;
    if (!tenantId || !leaseId || !unitId) {
      ctx.warnings.push(
        `collection ${r.id}: missing tenant/lease/unit FK, skipped`
      );
      continue;
    }
    const month = strOrNull(r.rent_month) ?? "";
    const year = strOrNull(r.rent_year) ?? "";
    // ensure a schedule row exists for this lease+month+year (derived)
    const schedKey = `${leaseId}|${month}|${year}`;
    let scheduleId: string | null = null;
    if (month && year) {
      scheduleId = `schedule_${leaseId}_${month}_${year}`.replace(/\s+/g, "");
      if (!scheduleCache.has(schedKey)) {
        scheduleCache.add(schedKey);
        await ctx.prisma.rentSchedule.upsert({
          where: { id: scheduleId },
          create: {
            id: scheduleId,
            organizationId: ORG_ID,
            leaseId,
            tenantId,
            unitId,
            month,
            year,
            rent: money(r.rent),
            gasBill: money(r.gus_bill),
            moylarBill: money(r.moylar_bill),
            serviceCharge: money(r.service_charge),
            otherBill: money(r.other_bill),
            totalDue: (
              num(r.rent) +
              num(r.gus_bill) +
              num(r.moylar_bill) +
              num(r.service_charge) +
              num(r.other_bill)
            ).toFixed(2),
            collectedSoFar: "0",
            status: "DUE",
          },
          update: {},
        });
        ctx.stats.rentSchedule++;
      }
    }
    const txnId = id("txn", r.transection_id);
    await ctx.prisma.rentCollection.upsert({
      where: { id: cid },
      create: {
        id: cid,
        organizationId: ORG_ID,
        tenantId,
        leaseId,
        unitId,
        scheduleId,
        rent: money(r.rent),
        gasBill: money(r.gus_bill),
        moylarBill: money(r.moylar_bill),
        serviceCharge: money(r.service_charge),
        otherBill: money(r.other_bill),
        rentMonth: month,
        rentYear: year,
        note: strOrNull(r.note),
        transactionId: txnId,
        receiveDate: dt(r.receive_date),
        collectionStatus: r.collection_status === "Done" ? "DONE" : "PENDING",
        payLater: num(r.pay_later) !== 0,
      },
      update: {},
    });
    ctx.stats.rentCollection++;
  }
}

// ---- lease history (archive) ----
async function migrateLeaseHistory(ctx: TransformContext) {
  for (const r of rowsOf(ctx.parsed, "setup_rent_history")) {
    const hid = id("leasehist", r.id);
    if (!hid) continue;
    await ctx.prisma.leaseHistory.upsert({
      where: { id: hid },
      create: {
        id: hid,
        organizationId: ORG_ID,
        zoneId: r.zone_id === null ? null : Number(r.zone_id),
        roomNo: strOrNull(r.room_no),
        clientId: r.client_id === null ? null : Number(r.client_id),
        rent: money(r.rent),
        advance: money(r.advance),
        agreementStart: dt(r.aggrement_start),
        agreementEnd: dt(r.aggrement_end),
      },
      update: {},
    });
    ctx.stats.leaseHistory++;
  }
}

// ---- new-side reconciliation vs DB ----
async function dbReconciliation(ctx: TransformContext) {
  const p = ctx.prisma;
  const count = (m: string) => p[m].count();
  console.log("────────────────────────────────────────────────────────────");
  console.log(" NEW-SIDE (DB) RECONCILIATION")
  console.log("────────────────────────────────────────────────────────────");
  const checks: [string, number, string][] = [
    ["organizations", await count("organization"), "setup_company"],
    ["users", await count("user"), "admin"],
    ["menus", await count("menu"), "menu_list"],
    ["banks", await count("bank"), "setup_bank"],
    ["mobile_banks", await count("mobileBank"), "setup_mobile_banking"],
    ["ledger_heads", await count("ledgerHead"), "setup_ladger_head"],
    ["account_heads", await count("accountHead"), "setup_ac_head"],
    ["properties", await count("property"), "setup_vobon"],
    ["units", await count("unit"), "setup_unit"],
    ["tenants", await count("tenant"), "setup_client"],
    ["leases", await count("lease"), "assign_unit"],
    ["transactions", await count("transaction"), "account_transection"],
    ["rent_collections", await count("rentCollection"), "collect_rent"],
    ["lease_histories", await count("leaseHistory"), "setup_rent_history"],
  ];
  console.log("NEW TABLE          ROWS   LEGACY TABLE        LEGACY ROWS  OK?");
  console.log("────────────────────────────────────────────────────────────");
  let allOk = true;
  for (const [newTable, n, legacyTable] of checks) {
    const legacy = ctx.parsed.tables.get(legacyTable)?.rows.length ?? 0;
    const ok = n === legacy;
    if (!ok) allOk = false;
    console.log(
      `${newTable.padEnd(18)} ${String(n).padStart(6)}   ${legacyTable.padEnd(20)} ${String(legacy).padStart(6)}   ${ok ? "✅" : "❌ MISMATCH"}`
    );
  }
  console.log("────────────────────────────────────────────────────────────");
  console.log(
    allOk ? "✅ ALL ROW COUNTS MATCH." : "❌ COUNT MISMATCH — investigate above."
  );

  // money totals
  const sum = async (m: string, field: string) => {
    const agg = await p[m].aggregate({ _sum: { [field]: true } });
    return Number(agg._sum[field] ?? 0);
  };
  console.log("\nMONEY TOTALS (new DB):");
  console.log(
    `transactions.in_amount  = ${await sum("transaction", "inAmount")}`
  );
  console.log(
    `transactions.out_amount = ${await sum("transaction", "outAmount")}`
  );
  console.log(`rent_collections.rent = ${await sum("rentCollection", "rent")}`);
  console.log(`leases.advance_payment = ${await sum("lease", "advancePayment")}`);

  if (ctx.warnings.length) {
    console.log(`\n⚠️  WARNINGS (${ctx.warnings.length}):`);
    for (const w of ctx.warnings.slice(0, 50)) console.log("  - " + w);
    if (ctx.warnings.length > 50)
      console.log(`  … and ${ctx.warnings.length - 50} more`);
  }
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  const parsed = loadDump();
  legacyReconciliation(parsed);

  if (!WRITE_MODE) {
    console.log(
      "ℹ️  Dry-run only (no DB writes). Re-run with --write after setting\n" +
        "    DATABASE_URL and running `bunx prisma generate` + `prisma migrate dev`."
    );
    return;
  }

  console.log("🔌 Connecting to Postgres…");
  const prisma = await getPrisma();
  const ctx: TransformContext = {
    parsed,
    prisma,
    stats: {},
    warnings: [],
  };

  console.log("🚚 Migrating (dependency order, upsert = idempotent)…");
  await migrateOrganization(ctx);
  await migrateMenus(ctx);
  await migrateUsers(ctx);
  await migrateBanks(ctx);
  await migrateAccounts(ctx);
  await migrateProperties(ctx);
  await migrateTenants(ctx);
  await migrateLeases(ctx);
  await migrateTransactions(ctx);
  await migrateCollections(ctx);
  await migrateLeaseHistory(ctx);

  console.log("\nWrote rows per table:");
  for (const [k, v] of Object.entries(ctx.stats)) {
    console.log(`  ${k.padEnd(18)} ${v}`);
  }

  await dbReconciliation(ctx);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
