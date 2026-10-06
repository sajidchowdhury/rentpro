# RentPro Schema — Design Notes

Companion to `prisma/schema.prisma`. Explains the design decisions, the
legacy `osudlagb_home_rent` → RentPro mapping, and migration considerations.

---

## 1. Design principles

1. **Money is `Decimal @db.Decimal(20,2)` — never `Float`.**
   The legacy schema used `FLOAT(20,2)` for rent, advance, and transaction
   amounts. That is the *single biggest cause of subtle money bugs* (rounding,
   comparison). Prisma's `Decimal` maps to Postgres `numeric(20,2)` and is safe.

2. **Real foreign keys with explicit referential actions.**
   The legacy DB declared **no foreign keys at all** — only primary keys. That
   is why you have orphan rent collections, dangling ledger references, and
   "messy" data. The new schema enforces relations at the DB level.

3. **Multi-tenant isolation from day one.**
   Every business table carries `organizationId`. A future SaaS client is just
   a new `Organization` row; their data is fenced by `organizationId`. For
   extra safety in production, enable Postgres Row-Level Security (RLS) policies
   scoped to `organization_id` (optional, beyond Prisma).

4. **Status fields are enums, not free text.**
   Legacy used strings like `'Active'`, `'Gone'`, `'Pending'`, `'Done'`. New
   schema uses Postgres enums — invalid states are impossible to persist.

5. **Cached balances + immutable history.**
   `Tenant.advanceBalance`, `RentSchedule.collectedSoFar`, etc. are *caches*
   derived from immutable `AdvanceAdjustment` / `RentCollection` rows. The
   cache speeds up dashboard reads; the source-of-truth rows stay for audit.

6. **Soft deletes via status, not row deletion.**
   Units become `INACTIVE`, tenants become `GONE`, leases become `CLOSED`.
   Financial rows (transactions, collections, settlements) are **never** deleted —
   enforced by `onDelete: Restrict` on their foreign keys.

---

## 2. Legacy → New table mapping

| Legacy table | New model | New table | Notes |
|---|---|---|---|
| `setup_company` | `Organization` | `organizations` | Your business becomes one org |
| `admin` | `User` | `users` | `dypricpt_pass` (plaintext) **dropped**; only bcrypt `password` |
| `menu_list` | `Menu` | `menus` | Bangla `label` + optional English `labelEn` |
| `menu_permission` | `MenuPermission` | `menu_permissions` | Per-role instead of per-user |
| `setup_vobon` | `Property` | `properties` | `type` enum adds OPEN_SPACE/ROOFTOP/MIXED |
| `setup_unit` | `Unit` | `units` | `vobon_id` → `propertyId`; editable anytime |
| `setup_client` | `Tenant` | `tenants` | Bangla names preserved; `advanceBalance` cached |
| `assign_unit` | `Lease` | `leases` | tenant↔unit + advance + bills; `status` ACTIVE/CLOSED |
| `collect_rent` | `RentCollection` + `RentSchedule` | `rent_collections`, `rent_schedules` | Each historic collection back-fills a schedule row + a paid collection row |
| `account_transection` | `Transaction` | `transactions` | `float` → `decimal`; cheque info preserved |
| `setup_ac_head` | `AccountHead` | `account_heads` | INCOME/EXPENSE/BOTH preserved via enum |
| `setup_ladger_head` | `LedgerHead` | `ledger_heads` | Group of account heads |
| `setup_bank` | `Bank` | `banks` | Preserved |
| `setup_mobile_banking` | `MobileBank` | `mobile_banks` | Preserved |
| `webpush_member` | `PushSubscription` | `push_subscriptions` | Keys re-generated on re-subscribe |
| `setup_rent_history` | `LeaseHistory` | `lease_histories` | Archive only; new history recomputed |
| `tempTable_customer_ledger_movement` | *(derived, not migrated)* | — | Recomputed from `RentSchedule` + `RentCollection` |
| — (new) | `Role`, `RoleAssignment` | `roles`, `role_assignments` | Proper RBAC |
| — (new) | `ExpenseTemplate` | `expense_templates` | Recurring electricity/gas reminders (F3) |
| — (new) | `ExpenseRecord` | `expense_records` | Monthly expense actuals + back-fill (F3) |
| — (new) | `Settlement` | `settlements` | Vacate/final-statement wizard (F5) |
| — (new) | `AdvanceAdjustment` | `advance_adjustments` | Advance refund/adjust ledger (F6) |
| — (new) | `AuditLog` | `audit_logs` | Full change history |

---

## 3. How this schema enables the PRD features

| PRD feature | Schema support |
|---|---|
| **F1 Monthly Rent Auto-Generator** | `RentSchedule` + `@@unique([leaseId, month, year])` makes generation idempotent. `status` enum tracks DUE→PARTIAL→PAID→OVERDUE. |
| **F2 Unified Collection** | `RentCollection.scheduleId` links a payment to its due row; `collectionStatus` + `payLater` + `advanceAdjId` cover partial/pay-later/advance-adjust. |
| **F3 Recurring Expenses + Back-fill** | `ExpenseTemplate` (per-unit recurring rules) + `ExpenseRecord` with `isBackfill` flag and `@@unique([unitId, accountHeadId, month, year])` to prevent double back-fill. |
| **F4 Flexible Property Model** | `Property.type` enum (BUILDING/OPEN_SPACE/ROOFTOP/MIXED) + `Unit.type` enum; units are independent rows → add/edit/retire anytime; open space is just `Property(type=OPEN_SPACE)`. |
| **F5 Vacate & Settlement** | `Settlement` (1:1 with Lease via `@unique leaseId`) captures outstanding rent/bills, advance adjust/refund, net payable/refund. |
| **F6 Advance/Adjustment** | `AdvanceAdjustment` with `balanceBefore`/`balanceAfter` + `Tenant.advanceBalance` cache. One row per movement = full audit trail. |
| **F7 Smart Dashboard** | `RentSchedule.status='DUE'/'OVERDUE'` → "still to collect"; `ExpenseRecord` missing for a month → "electricity bill due"; `Unit.status='VACANT'` → available units. All filterable by `organizationId` + `propertyId`. |
| **F8 Lossless Migration** | Decimal money + FK validation + orphan checks; see migration script (planned `scripts/migrate.ts`). |
| **F9 Multi-Tenant SaaS** | `organizationId` on every business model + cascade rules; per-org users/roles/branding. |

---

## 4. Referential-action policy

| Child → Parent | Action | Why |
|---|---|---|
| any → `Organization` | `Cascade` | Org deletion wipes its tenant (SaaS offboarding) |
| `Unit` → `Property` | `Restrict` | Can't delete a property with units — retire units first |
| `Lease` → `Tenant` / `Unit` / `Property` | `Restrict` | Financial history must survive — never auto-delete |
| `RentCollection` → `Lease` / `Tenant` / `Unit` | `Restrict` | Collections are immutable financial records |
| `RentCollection` → `RentSchedule` | `SetNull` | A schedule may be voided but the collection stays |
| `RentCollection` → `Transaction` | `Restrict` | Can't delete the underlying ledger entry |
| `Transaction` → `Bank` / `MobileBank` | `SetNull` | Banks may be retired; txn survives |
| `Settlement` → `Lease` | `Restrict` | Settlement is the permanent record of a vacate |
| `ExpenseRecord` → `Unit` | `SetNull` | Unit may be retired; expense history survives |
| `AuditLog` → `User` | `SetNull` | User may be removed; audit survives |

---

## 5. Index strategy

- Every model has `@@index([organizationId, <common filter>])` so multi-tenant
  queries are index-only.
- `RentSchedule`: `(year, month)` for dashboard "this month"; `(status)` for
  "overdue" scans.
- `RentCollection`: `(rentYear, rentMonth)` for monthly collection reports;
  `(collectionStatus)` for "pending" lists.
- `Tenant`: unique `(organizationId, code)`; index on `mobile` for search.
- `Lease`: indexes on tenant/unit/property/status for the dashboard filters.

---

## 6. Validation & prototyping

The schema is validated against PostgreSQL (`bunx prisma format` + `prisma validate` both pass).

```bash
# Already done in this repo:
bun add -D prisma && bun add @prisma/client
bunx prisma format        # ✅ passes
bunx prisma validate      # ✅ passes (needs a DATABASE_URL in env)
```

### Recommended: prototype + production on PostgreSQL

Because the schema uses Postgres-native types (`@db.Decimal(20,2)`, `@db.Date`,
`@db.Json`), the simplest path is to **prototype on Postgres too** — e.g. a free
[Neon](https://neon.tech) / [Supabase](https://supabase.com) DB, or a local
Docker container:

```bash
# Local Postgres via Docker:
docker run --name rentpro-pg -e POSTGRES_PASSWORD=pass -p 5432:5432 -d postgres:16

echo 'DATABASE_URL="postgresql://postgres:pass@localhost:5432/rentpro?schema=public"' > .env
bunx prisma migrate dev --name init   # creates + applies the first migration
bunx prisma studio                    # browse data at http://localhost:5555
```

### SQLite caveat (not recommended for this schema)

Prisma emulates enums on SQLite, **but native-type modifiers (`@db.Decimal`,
`@db.Date`, `@db.Json`) are not supported by the SQLite connector.** To use
SQLite you would have to strip those modifiers (money then becomes `REAL`).
For financial accuracy, keep PostgreSQL for both prototyping and production.

---

## 7. Open follow-ups (post-schema)

- [ ] Seed data: default `Organization`, super-admin `User`, default `Menu`
      tree, default `AccountHead`/`LedgerHead` (rent collection, client advance,
      fund transfer, advance adjustment, due adjustment).
- [ ] Prisma middleware to inject `organizationId` from session context and to
      block cross-org reads automatically.
- [ ] `scripts/migrate.ts` — the legacy → new migration pipeline with the
      reconciliation report described in PRD §7.
- [ ] Postgres RLS policies (optional hardening) per `organization_id`.
