# RentPro — Legacy Migration Scripts

Lossless migration from the legacy `osudlagb_home_rent` (PHP/MySQL, phpMyAdmin
SQL dump) into the new RentPro Prisma/Postgres schema.

## Files

```
scripts/
├── migrate.ts            # entrypoint: parse → transform (upsert) → reconcile
└── lib/
    └── legacyParser.ts    # pure SQL-dump parser (no MySQL server needed)
```

## How it works

1. **Parse** `osudlagb_home_rent.sql` with a hand-written state machine that
   respects quoted strings, backslash escapes, doubled quotes, `NULL`, and
   Bangla (utf8mb4) text. **No MySQL server required** — just read the file.
2. **Transform** each legacy row into the new Prisma model using
   **deterministic IDs** (`tenant_1`, `lease_38`, `txn_44`, …) so:
   - re-runs are idempotent (every write is an `upsert`),
   - every new row traces back to a legacy row,
   - foreign keys are wired via the same ID scheme.
3. **Reconcile** — print a row-count + money-sum report comparing the legacy
   dump vs the new DB. Anything that doesn't match is flagged `❌ MISMATCH`.

## Legacy → new table mapping

| Legacy | New model | New table |
|---|---|---|
| `setup_company` | `Organization` | `organizations` |
| `admin` | `User` | `users` (passwords re-hashed `$2y$`→`$2b$`; plaintext `dypricpt_pass` **dropped**) |
| `menu_list` | `Menu` | `menus` |
| `menu_permission` | `MenuPermission` | `menu_permissions` |
| `setup_vobon` | `Property` | `properties` |
| `setup_unit` | `Unit` | `units` |
| `setup_client` | `Tenant` | `tenants` |
| `setup_bank` | `Bank` | `banks` |
| `setup_mobile_banking` | `MobileBank` | `mobile_banks` |
| `setup_ladger_head` | `LedgerHead` | `ledger_heads` |
| `setup_ac_head` | `AccountHead` | `account_heads` |
| `assign_unit` | `Lease` | `leases` |
| `account_transection` | `Transaction` | `transactions` |
| `collect_rent` | `RentCollection` + derived `RentSchedule` | `rent_collections`, `rent_schedules` |
| `setup_rent_history` | `LeaseHistory` | `lease_histories` |
| `tempTable_customer_ledger_movement` | *(derived — recomputed; not migrated)* | — |
| `webpush_member` | *(not migrated — keys re-subscribed on first login)* | — |

`RentSchedule` rows are **derived** during migration: one per
`(lease, month, year)` encountered in `collect_rent`. Each collection is then
linked back to its schedule via `scheduleId`.

## Run

### Step 1 — Dry run (no DB needed; validates the parser)

```bash
LEGACY_SQL_PATH="/path/to/osudlagb_home_rent.sql" \
  bun run scripts/migrate.ts
```

This parses the dump and prints per-table row counts + money totals. It
**proves the parser reads your real data correctly** before anything is
written. Expected output (against the real dump):

```
TABLE                          ROWS
account_transection              1817
admin                               2
assign_unit                        42
collect_rent                     1496
... (16 tables)
TOTAL ROWS                       3651

MONEY TOTALS (legacy)
account_transection.in_amount    18,086,066.75
account_transection.out_amount   18,649,248.09
collect_rent.rent                13,852,500.00
assign_unit.advance_payment         220,000.00
...
```

### Step 2 — Write to Postgres (the real migration)

```bash
# one-time setup
echo 'DATABASE_URL="postgresql://user:pass@host:5432/rentpro?schema=public"' > .env
bunx prisma generate
bunx prisma migrate dev --name init

# run the migration (idempotent — safe to re-run)
LEGACY_SQL_PATH="/path/to/osudlagb_home_rent.sql" \
  bun run scripts/migrate.ts --write
```

The `--write` run prints both the legacy-side totals **and** a new-DB
reconciliation table:

```
NEW TABLE          ROWS   LEGACY TABLE        LEGACY ROWS  OK?
organizations         1   setup_company                 1   ✅
users                 2   admin                         2   ✅
tenants              40   setup_client                 40   ✅
leases               42   assign_unit                  42   ✅
transactions       1817   account_transection        1817   ✅
rent_collections  1496   collect_rent               1496   ✅
...
✅ ALL ROW COUNTS MATCH.

MONEY TOTALS (new DB):
transactions.in_amount  = 18086066.75
transactions.out_amount = 18649248.09
rent_collections.rent   = 13852500.00
leases.advance_payment  = 220000.00
```

## Safety

- **Idempotent** — every write is an `upsert` keyed on a deterministic ID, so
  re-running never creates duplicates. Fix a transform bug and re-run freely.
- **Non-destructive** — the legacy dump is read-only; the old PHP system is
  untouched. Keep it running read-only for a full month after cutover.
- **No data is silently dropped** — any row that can't be wired (e.g. a
  collection missing its tenant FK) is logged under `WARNINGS` and skipped,
  never silently inserted with a dangling reference.
- **Passwords** — PHP bcrypt hashes (`$2y$`) are converted to Node-compatible
  (`$2b$`) so existing logins keep working. The insecure plaintext
  `dypricpt_pass` column is **not** migrated.

## Post-migration checklist

- [ ] Reconciliation report shows `✅ ALL ROW COUNTS MATCH.`
- [ ] Money totals (in/out/rent/advance) match the legacy report to the paisa.
- [ ] No (or only expected) `WARNINGS`.
- [ ] Spot-check 5–10 tenants + their collections in `prisma studio`.
- [ ] Run the legacy PHP system read-only for one full month, then retire it.
