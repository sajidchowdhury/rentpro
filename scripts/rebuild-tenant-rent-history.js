// ============================================================================
// rebuild-tenant-rent-history.js
// ----------------------------------------------------------------------------
// A one-off utility that rewrites a single tenant's entire rent history inside
// a RentPro backup JSON file. Used to correct a tenant whose lease/rent/
// collection data had drifted (e.g. a room-split rent change that wasn't
// recorded cleanly, leaving phantom dues or mismatched rent-vs-received).
//
// It does NOT touch any other tenant's data — only the tenant + lease you
// specify. The output is a NEW backup file you restore via Platform →
// Backup & Restore.
//
// Usage:
//   node scripts/rebuild-tenant-rent-history.js <input-backup.json> <output-backup.json>
//
// Then edit the CONFIG block below to match the tenant you're fixing.
//
// Worked example (the Sajid / 0013 case this was written for):
//   - Tenant code 0013, lease id 50
//   - Lease window: Feb 2023 → Oct 2026
//   - Rent: 5000 for Feb 2023 → Sep 2024, then 3000 from Oct 2024 → Oct 2026
//   - Rent change effective 2024-10-01 (originalRent = 5000 captured)
//   - All rent received (DONE), receive date = 20th of the PREVIOUS month
//   - No waived months, no pending collections, no tenant adjustments
// ============================================================================

const fs = require("node:fs");

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// ─── CONFIG: edit this block for the tenant you're fixing ──────────────────
const CONFIG = {
  tenantCode: "0013",
  leaseId: 50,
  // lease window (inclusive). Months outside this range are not generated.
  startMonth: "February", startYear: 2023,
  endMonth: "October",   endYear: 2026,
  // rent-change boundary: months on/after this use NEW rent; before it, OLD rent.
  // Set changeMonth/changeYear to null for a single-rent tenant (no change).
  changeMonth: "October", changeYear: 2024,
  oldRent: 5000,
  newRent: 3000,
  // bills (kept at 0 in this example; adjust if needed)
  gasBill: 0, moylarBill: 0, serviceCharge: 0, otherBill: 0,
  // receive date = the 20th of the PREVIOUS month (e.g. Feb rent received Jan 20)
  receiveDay: 20,
  reason: "Room split — portion rent reduced from 5000 to 3000",
};
// ─── end CONFIG ────────────────────────────────────────────────────────────

function monthIndex(name) { return MONTHS.indexOf(name); }
function ymKey(year, monthName) { return year * 12 + monthIndex(monthName); }

function rebuild(inputPath, outputPath) {
  const data = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
  const ds = data.dataset;
  const st = data.store;

  // --- find the tenant + lease ---
  const tenant = ds.tenants.find((t) => t.code === CONFIG.tenantCode);
  if (!tenant) { console.error(`Tenant code ${CONFIG.tenantCode} not found!`); process.exit(1); }
  const lease = ds.leases.find((l) => l.id === CONFIG.leaseId && l.tenantId === tenant.id);
  if (!lease) { console.error(`Lease ${CONFIG.leaseId} for tenant ${CONFIG.tenantCode} not found!`); process.exit(1); }
  console.log(`Found: ${tenant.name} (code ${tenant.code}, id ${tenant.id}), lease ${lease.id}`);

  const startK = ymKey(CONFIG.startYear, CONFIG.startMonth);
  const endK = ymKey(CONFIG.endYear, CONFIG.endMonth);
  const changeK = CONFIG.changeMonth ? ymKey(CONFIG.changeYear, CONFIG.changeMonth) : null;

  // --- 1. Configure the lease ---
  lease.agreementStart = `${CONFIG.startYear}-${String(monthIndex(CONFIG.startMonth) + 1).padStart(2, "0")}-01T00:00:00.000Z`;
  lease.agreementEnd = `${CONFIG.endYear}-${String(monthIndex(CONFIG.endMonth) + 1).padStart(2, "0")}-${String(new Date(CONFIG.endYear, monthIndex(CONFIG.endMonth) + 1, 0).getDate()).padStart(2, "0")}T00:00:00.000Z`;
  const currentRent = (changeK !== null) ? CONFIG.newRent : CONFIG.oldRent;
  lease.rent = currentRent;
  lease.gasBill = CONFIG.gasBill;
  lease.moylarBill = CONFIG.moylarBill;
  lease.serviceCharge = CONFIG.serviceCharge;
  lease.otherBill = CONFIG.otherBill;
  lease.status = "ACTIVE";
  // capture the pre-change rent so getRentForMonth returns the correct
  // historical rent for months before the rent change took effect
  lease.originalRent = CONFIG.oldRent;
  lease.originalGasBill = CONFIG.gasBill;
  lease.originalMoylarBill = CONFIG.moylarBill;
  lease.originalServiceCharge = CONFIG.serviceCharge;
  lease.originalOtherBill = CONFIG.otherBill;
  console.log(`Lease set: start ${CONFIG.startMonth} ${CONFIG.startYear}, end ${CONFIG.endMonth} ${CONFIG.endYear}, current rent ${currentRent}, originalRent ${CONFIG.oldRent}`);

  // --- 2. Record the rent change (if any) ---
  if (changeK !== null) {
    const rentChange = {
      effectiveDate: `${CONFIG.changeYear}-${String(monthIndex(CONFIG.changeMonth) + 1).padStart(2, "0")}-01`,
      rent: CONFIG.newRent,
      gasBill: CONFIG.gasBill,
      moylarBill: CONFIG.moylarBill,
      serviceCharge: CONFIG.serviceCharge,
      otherBill: CONFIG.otherBill,
      reason: CONFIG.reason,
      recordedAt: `${CONFIG.changeYear}-${String(monthIndex(CONFIG.changeMonth) + 1).padStart(2, "0")}-01T00:00:00.000Z`,
    };
    st.leaseRentChanges = (st.leaseRentChanges || []).filter(([lid]) => lid !== lease.id);
    st.leaseRentChanges.push([lease.id, [rentChange]]);
    console.log(`Rent change recorded: ${CONFIG.oldRent} → ${CONFIG.newRent} effective ${CONFIG.changeMonth} ${CONFIG.changeYear}`);
  }

  // --- 3. Remove ALL existing collections for this lease ---
  const oldCollections = ds.collections.filter((c) => c.leaseId === lease.id);
  const oldReceiveDates = new Set(oldCollections.map((c) => c.receiveDate).filter(Boolean));
  ds.collections = ds.collections.filter((c) => c.leaseId !== lease.id);
  console.log(`Removed ${oldCollections.length} old collections for lease ${lease.id}`);

  // --- 4. Remove old RENT COLLECTION transactions matching the old receive
  //        dates (legacy txns are aggregated daily, so match by date) ---
  const removedTxns = [];
  ds.txns = ds.txns.filter((t) => {
    if (t.dataInsertedFrom !== "RENT COLLECTION") return true;
    if (t.transectionDate && oldReceiveDates.has(t.transectionDate)) { removedTxns.push(t); return false; }
    return true;
  });
  console.log(`Removed ${removedTxns.length} old RENT COLLECTION transactions matching old receive dates`);

  // --- 5. Remove ALL waived months for this lease ---
  const waivedBefore = (st.waivedMonths || []).length;
  st.waivedMonths = (st.waivedMonths || []).filter((w) => Number(w.split("|")[0]) !== lease.id);
  console.log(`Removed ${waivedBefore - st.waivedMonths.length} waived months for lease ${lease.id}`);

  // --- 6. Remove tenant adjustments for this tenant ---
  st.tenantAdjustments = (st.tenantAdjustments || []).filter(([tid]) => tid !== tenant.id);

  // --- 7. Create new collections + income transactions ---
  let collId = st.nextCollectionId;
  let txnId = st.nextTxnId;
  let createdCollections = 0, createdTxns = 0;
  let oldCount = 0, newCount = 0;

  for (let year = CONFIG.startYear; year <= CONFIG.endYear; year++) {
    for (let mi = 0; mi < 12; mi++) {
      const k = year * 12 + mi;
      if (k < startK || k > endK) continue;
      const monthName = MONTHS[mi];
      const rent = (changeK !== null && k >= changeK) ? CONFIG.newRent : CONFIG.oldRent;
      if (rent === CONFIG.oldRent) oldCount++; else newCount++;

      // receive date = the configured day of the PREVIOUS month
      let rcvMonth = mi - 1, rcvYear = year;
      if (rcvMonth < 0) { rcvMonth = 11; rcvYear = year - 1; }
      const receiveDate = `${rcvYear}-${String(rcvMonth + 1).padStart(2, "0")}-${String(CONFIG.receiveDay).padStart(2, "0")}T00:00:00.000Z`;

      ds.collections.push({
        id: collId++, leaseId: lease.id, tenantId: tenant.id,
        rent, gasBill: CONFIG.gasBill, moylarBill: CONFIG.moylarBill,
        serviceCharge: CONFIG.serviceCharge, otherBill: CONFIG.otherBill,
        rentMonth: monthName, rentYear: String(year),
        receiveDate, status: "DONE",
      });
      createdCollections++;

      ds.txns.push({
        id: txnId++, inAmount: rent, outAmount: 0,
        transectionDate: receiveDate,
        note: `Rent collection — ${tenant.name} — ${monthName} ${year}`,
        type: "INCOME", accountHeadId: 1, accountHeadName: "RENT COLLECTION",
        method: "CASH", dataInsertedFrom: "RENT COLLECTION",
      });
      createdTxns++;
    }
  }

  st.nextCollectionId = collId;
  st.nextTxnId = txnId;
  console.log(`Created ${createdCollections} collections + ${createdTxns} income transactions`);
  console.log(`  (${oldCount} months at ${CONFIG.oldRent} + ${newCount} months at ${CONFIG.newRent})`);

  // --- 8. Write the modified backup ---
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 0));
  console.log(`\n✓ Written modified backup to: ${outputPath}`);
  console.log(`  file size: ${fs.statSync(outputPath).size} bytes`);
}

// --- CLI entry point ---
const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/rebuild-tenant-rent-history.js <input-backup.json> <output-backup.json>");
  console.error("\nThen edit the CONFIG block at the top of this script for the tenant you're fixing.");
  process.exit(1);
}
rebuild(inputPath, outputPath);
