// ============================================================================
// migrate-tenant-data.js — Comprehensive tenant data migration per user spec.
// ----------------------------------------------------------------------------
// A. All active tenants: lease start Feb 2023, payments from March 2023
// B. 0028 (ইম্রান খান): rent 25K, 20K cash + 5K advance, paid till Apr 2026
//    0027 (রফিকুল আলম): rent 20K, 15K cash + 5K advance, paid till Oct 2026
// C. 0029 (দিলিপ): paid till Aug 2026
// D. 0030, 0031, 0033, 0041, 0042: paid till Oct 2026
// E. 0032 (রবি দেবনাত): paid till Sep 2026
// F. Delete 0038, 0040
// ============================================================================
const fs = require("node:fs");

const BACKUP_PATH = "/home/z/my-project/upload/rentpro-backup-2026-11-21.json";
const OUT_PATH = "/home/z/my-project/upload/rentpro-backup-migrated.json";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function ymKey(y, m) { return y * 12 + MONTHS.indexOf(m); }
function monthFromKey(k) { return MONTHS[k % 12]; }
function yearFromKey(k) { return Math.floor(k / 12); }

// Per-tenant config: code -> { rent, paidTillMonth, paidTillYear, advanceDeduct, advanceDeposit }
// advanceDeduct = amount deducted from advance each month (0 = no advance)
// advanceDeposit = the initial advance deposit (must cover all deductions)
const TENANT_CONFIG = {
  "0027": { rent: 20000, paidTillMonth: "October", paidTillYear: 2026, advanceDeduct: 5000, advanceDeposit: 250000 },
  "0028": { rent: 25000, paidTillMonth: "April",   paidTillYear: 2026, advanceDeduct: 5000, advanceDeposit: 200000 },
  "0029": { rent: 4000,  paidTillMonth: "August",  paidTillYear: 2026, advanceDeduct: 0,    advanceDeposit: 0 },
  "0030": { rent: 13000, paidTillMonth: "October", paidTillYear: 2026, advanceDeduct: 0,    advanceDeposit: 0 },
  "0031": { rent: 6000,  paidTillMonth: "October", paidTillYear: 2026, advanceDeduct: 0,    advanceDeposit: 0 },
  "0032": { rent: 4000,  paidTillMonth: "September", paidTillYear: 2026, advanceDeduct: 0, advanceDeposit: 0 },
  "0033": { rent: 6000,  paidTillMonth: "October", paidTillYear: 2026, advanceDeduct: 0,    advanceDeposit: 0 },
  "0041": { rent: 5000,  paidTillMonth: "October", paidTillYear: 2026, advanceDeduct: 0,    advanceDeposit: 0 },
  "0042": { rent: 3500,  paidTillMonth: "October", paidTillYear: 2026, advanceDeduct: 0,    advanceDeposit: 50000 },
};
const DELETE_CODES = ["0038", "0040"];
const START_K = ymKey(2023, "February"); // Feb 2023

const data = JSON.parse(fs.readFileSync(BACKUP_PATH, "utf-8"));
const ds = data.dataset;
const st = data.store;

let collId = st.nextCollectionId;
let txnId = st.nextTxnId;

// --- F. Delete tenants 0038 and 0040 ---
for (const code of DELETE_CODES) {
  const t = ds.tenants.find((x) => x.code === code);
  if (!t) { console.log(`  [skip] tenant ${code} not found`); continue; }
  // remove their collections + transactions
  const oldDates = new Set(ds.collections.filter(c=>c.tenantId===t.id).map(c=>c.receiveDate).filter(Boolean));
  ds.collections = ds.collections.filter((c) => c.tenantId !== t.id);
  ds.txns = ds.txns.filter((t2) => {
    if (t2.dataInsertedFrom !== "RENT COLLECTION") return true;
    if (t2.transectionDate && oldDates.has(t2.transectionDate)) return false;
    return true;
  });
  ds.leases = ds.leases.filter((l) => l.tenantId !== t.id);
  ds.tenants = ds.tenants.filter((x) => x.id !== t.id);
  st.tenantAdjustments = (st.tenantAdjustments || []).filter(([tid]) => tid !== t.id);
  st.waivedMonths = (st.waivedMonths || []).filter((w) => {
    const lid = Number(w.split("|")[0]);
    return !ds.leases.some((l) => l.id === lid && l.tenantId === t.id);
  });
  console.log(`  [delete] tenant ${code} (${t.name})`);
}

// --- A-E. Rebuild all remaining ACTIVE tenants ---
// For tenants NOT in TENANT_CONFIG, keep their existing rent and default
// paid-till to October 2026.
const activeTenants = ds.tenants.filter((t) => t.status === "ACTIVE");
console.log(`\nRebuilding ${activeTenants.length} active tenants...`);

for (const tenant of activeTenants) {
  const cfg = TENANT_CONFIG[tenant.code];
  const leases = ds.leases.filter((l) => l.tenantId === tenant.id);
  if (leases.length === 0) { console.log(`  [skip] ${tenant.code} no lease`); continue; }
  const lease = leases[0];

  // determine rent + paid-till + advance
  const rent = cfg?.rent ?? lease.rent;
  const paidTillMonth = cfg?.paidTillMonth ?? "October";
  const paidTillYear = cfg?.paidTillYear ?? 2026;
  const advanceDeduct = cfg?.advanceDeduct ?? 0;
  const advanceDeposit = cfg?.advanceDeposit ?? lease.advance ?? 0;
  const paidTillK = ymKey(paidTillYear, paidTillMonth);

  // set lease window: Feb 2023 → far future (keep active)
  lease.agreementStart = "2023-02-01T00:00:00.000Z";
  lease.agreementEnd = "2028-12-31T00:00:00.000Z";
  lease.rent = rent;
  lease.gasBill = 0;
  lease.moylarBill = 0;
  lease.serviceCharge = 0;
  lease.otherBill = 0;
  lease.advance = advanceDeposit;
  lease.status = "ACTIVE";
  lease.originalRent = undefined;
  lease.originalGasBill = undefined;
  lease.originalMoylarBill = undefined;
  lease.originalServiceCharge = undefined;
  lease.originalOtherBill = undefined;

  // remove old rent-change history for this lease
  st.leaseRentChanges = (st.leaseRentChanges || []).filter(([lid]) => lid !== lease.id);
  // remove old waived months for this lease
  st.waivedMonths = (st.waivedMonths || []).filter((w) => Number(w.split("|")[0]) !== lease.id);
  // remove old collections for this lease
  const oldCols = ds.collections.filter((c) => c.leaseId === lease.id);
  const oldDates = new Set(oldCols.map((c) => c.receiveDate).filter(Boolean));
  ds.collections = ds.collections.filter((c) => c.leaseId !== lease.id);
  // remove old RENT COLLECTION txns matching those dates
  ds.txns = ds.txns.filter((t) => {
    if (t.dataInsertedFrom !== "RENT COLLECTION") return true;
    if (t.transectionDate && oldDates.has(t.transectionDate)) return false;
    return true;
  });

  // create new collections: Feb 2023 → paidTillMonth
  let count = 0;
  let totalAdvanceUsed = 0;
  for (let k = START_K; k <= paidTillK; k++) {
    const m = monthFromKey(k);
    const y = yearFromKey(k);
    // receive date = 15th of the month AFTER the rent month
    let rcvK = k + 1;
    const rcvY = Math.floor(rcvK / 12);
    const rcvM = rcvK % 12;
    const receiveDate = `${rcvY}-${String(rcvM + 1).padStart(2, "0")}-15T00:00:00.000Z`;

    const coll = {
      id: collId++,
      leaseId: lease.id,
      tenantId: tenant.id,
      rent: rent,
      gasBill: 0,
      moylarBill: 0,
      serviceCharge: 0,
      otherBill: 0,
      rentMonth: m,
      rentYear: String(y),
      receiveDate,
      status: "DONE",
      advanceAdjusted: 0,
    };
    if (advanceDeduct > 0) {
      coll.advanceAdjusted = advanceDeduct;
      totalAdvanceUsed += advanceDeduct;
    }
    ds.collections.push(coll);
    count++;

    // income transaction: cash portion (rent - advanceDeduct)
    const cashIn = advanceDeduct > 0 ? rent - advanceDeduct : rent;
    ds.txns.push({
      id: txnId++,
      inAmount: cashIn,
      outAmount: 0,
      transectionDate: receiveDate,
      note: `Rent collection — ${tenant.name} — ${m} ${y}`,
      type: "INCOME",
      accountHeadId: 1,
      accountHeadName: "RENT COLLECTION",
      method: "CASH",
      dataInsertedFrom: "RENT COLLECTION",
    });
  }

  // set tenant adjustments (cumulative advance deductions)
  st.tenantAdjustments = (st.tenantAdjustments || []).filter(([tid]) => tid !== tenant.id);
  if (totalAdvanceUsed > 0) {
    st.tenantAdjustments.push([tenant.id, totalAdvanceUsed]);
  }

  const remainingAdvance = advanceDeposit - totalAdvanceUsed;
  console.log(`  ${tenant.code} ${tenant.name}: rent ${rent}, ${count} months (Feb 2023 → ${paidTillMonth} ${paidTillYear}), advance: ${advanceDeposit} - ${totalAdvanceUsed} = ${remainingAdvance}`);
}

// update ID counters
st.nextCollectionId = collId;
st.nextTxnId = txnId;

// --- Write output ---
fs.writeFileSync(OUT_PATH, JSON.stringify(data, null, 0));
console.log(`\n✓ Written: ${OUT_PATH}`);
console.log(`  file size: ${fs.statSync(OUT_PATH).size} bytes`);
console.log(`  tenants: ${ds.tenants.length}, leases: ${ds.leases.length}, collections: ${ds.collections.length}, txns: ${ds.txns.length}`);
