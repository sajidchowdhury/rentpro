# Product Requirements Document (PRD)
# Modern Rent & Property Management System — "RentPro"

**Version:** 1.0
**Author:** Z.ai Code (Product & Engineering)
**Date:** 2026-10-05
**Status:** Draft for Review
**Replaces:** Legacy `osudlagb_home_rent` PHP/MySQL system (sajidchowdhury/rent)

---

## 0. Executive Summary

You are running a **legacy PHP/MySQL rent management system** (`osudlagb_home_rent`) that holds your **real, critical business data** (≈3 properties, 37 units, 44 tenants, 1,560 rent collections, 1,880 transactions). The data is valuable; the software is holding you back.

This PRD defines a **modern replacement** — a fast, easy, web-based application (working name **"RentPro"**) that:

1. **Solves your daily pain points** — messy monthly rent, forgotten/late expenses, inflexible buildings, broken tenant move-out, no live summaries.
2. **Migrates 100% of your existing data** with reconciliation and validation.
3. **Is built multi-tenant from day one** so you can later sell it to other property owners as a SaaS product.

The new system will be built on **Next.js 16 + TypeScript + Prisma + PostgreSQL**, with a clean Bangla/English UI, role-based access, and a dashboard that tells you exactly *what to collect and what to pay — this month.*

---

## 1. Background & Problem Statement

### 1.1 What's wrong today

| # | Pain point you described | Impact |
|---|---|---|
| P1 | Creating rent each month is messy; "previous" vs "recent" collection are confusing | Wastes time, errors, double entry |
| P2 | Monthly recurring expenses (electricity, gas) get forgotten; sometimes a month is missed and 2 months are paid at once | Lost bills, inaccurate profit, surprise dues |
| P3 | Rent is tied only to **Buildings**. You also rent **empty/open spaces** and **rooftops**, and add new rooms to existing buildings — no way to model or edit this | Properties outgrow the system |
| P4 | When a tenant leaves, they either pay outstanding due, **or you refund their advance**, **or you adjust advance against due** — no system handles this; no proper "vacate room" action | Rooms stuck as occupied, money miscalculated |
| P5 | No summary of "how much rent still to collect this month" or "which months' electricity bill is due" | You fly blind until report time |
| P6 | All historical data is real and critical | Migration must be lossless |
| P7 | You want to eventually sell this to multiple clients | Needs multi-tenancy, not a single-tenant script |

### 1.2 Why a rewrite (not a patch)

The legacy code is conventional PHP with **no foreign keys, no data validation, plaintext password backups, and a rigid "building-only" data model**. Patching it would take longer than rebuilding on a modern stack — and would still leave you with a system you can't sell.

---

## 2. Goals & Non-Goals

### 2.1 Goals
- **G1** Cut the time to run monthly rent collection from "an afternoon" to **under 10 minutes**.
- **G2** Never silently miss a recurring expense (electricity/gas/service) again — the system **reminds and back-fills**.
- **G3** Model **any** property type: building, open/empty space, rooftop, mixed — and edit/add rooms at any time.
- **G4** A one-screen **"Vacate Tenant" wizard** that settles all dues, advance refund/adjustment, and frees the room.
- **G5** A live dashboard that answers *"what to collect and what to pay, this month"* at a glance.
- **G6** **Zero data loss** migration with row-count + financial-total reconciliation.
- **G7** **Multi-tenant SaaS-ready** architecture (org-level isolation) from v1.

### 2.2 Non-Goals (Phase 1)
- Native mobile apps (a responsive PWA is enough for now).
- Online payment gateway / tenant self-service portal (Phase 3).
- Full double-entry accounting / GST-VAT compliance.
- AI features.

---

## 3. Users & Roles

| Role | What they can do |
|---|---|
| **Super Admin (you)** | Everything + manage other users + organization settings + billing |
| **Manager / Staff** | Create properties/units, tenants, collect rent, record expenses, run reports |
| **Data Entry (limited)** | Only rent collection + expense entry (no deletes, no reports export) |
| **(Phase 3) Tenant** | View their own ledger, download receipts |
| **(SaaS) Platform Owner** | Manage multiple client organizations, subscription status |

Access is enforced via **role-based menu permissions** (migrated & expanded from the legacy `menu_permission` table).

---

## 4. Pain Point → Solution Map

| Pain | Feature(s) that solve it |
|---|---|
| P1 messy monthly rent | **F1 Monthly Rent Auto-Generator** + **F2 Unified Collection Screen** |
| P2 forgotten/late expenses | **F3 Recurring Expense Engine with Reminders & Back-fill** |
| P3 inflexible buildings | **F4 Flexible Property Model** (Property → Unit, any type) |
| P4 broken move-out | **F5 Vacate & Settlement Wizard** + **F6 Advance/Adjustment Engine** |
| P5 no summary | **F7 Smart Dashboard** |
| P6 data critical | **F8 Lossless Migration Pipeline** |
| P7 sell to many clients | **F9 Multi-Tenant SaaS Core** |

---

## 5. Feature Specifications

### F1 — Monthly Rent Auto-Generator
- One button: **"Generate [Month Year] Rent"**.
- System auto-creates a **rent due row** for every *active* lease (tenant ↔ unit) for the selected month, pulling rent + recurring utility lines from the lease.
- Preview screen lists: tenant, unit, rent, gas, service charge, advance balance.
- You can **exclude/include** individual rows before confirming (e.g., a tenant who already left).
- Handles **back-month generation**: if you forgot March, generate March in April — it flags them as "overdue", not "current".
- Idempotent: re-running the same month will **not** create duplicates.

### F2 — Unified Rent Collection Screen (replaces the "messy" two screens)
- Single page. Pick a tenant → see **all outstanding months in one list**, oldest first.
- Each row: month, rent, bills, status (Due / Partial / Paid).
- Collect with: **Full**, **Partial** (with carried-forward due), **Advance Adjustment** (pull from tenant's advance balance), **Pay-Later**.
- Auto-creates the underlying ledger transaction (`account_transection` equivalent) — no double entry.
- Generates **money receipt + invoice** (PDF, Bangla/English) with QR code (re-using the existing QR feature).
- "Previous rent" and "recent rent" are now just **sorted rows in the same list** — the confusing split disappears.

### F3 — Recurring Expense Engine (Electricity / Gas / Service)
- **Expense Templates** per unit/property: e.g., "Shop L-1 S-1 → Electricity, monthly".
- Dashboard card: **"3 electricity bills not yet recorded for March"** with a one-click "Record now" action.
- **Back-fill friendly:** if you missed January and pay Jan+Feb electricity in February, you record **two expense rows** (one per month) — the system accepts this and shows "Jan + Feb paid in Feb".
- Optional **amount prediction** from last 3 months average to speed entry.
- Recurring reminder rules: "If electricity for unit X not recorded by the 10th of next month → highlight red."

### F4 — Flexible Property Model
New hierarchy (replaces "vobon → unit" with something far more flexible):

```
Organization (tenant-org)
└── Property  (type: Building | Open Space | Rooftop | Mixed)
    └── Unit  (type: Shop | Room | Open Space | Rooftop Slot | Parking | Godown)
        └── Lease  (tenant ↔ unit, with dates, rent, advance, bills)
```

- **Property types:** Building, Open/Empty Space, Rooftop, Mixed.
- **Unit types:** Shop, Room, Open Space, Rooftop Slot, Parking, Godown, Other.
- You can **add / rename / split / merge / deactivate** units at any time — even after the property exists.
- An **empty space not tied to any building** is just a `Property(type=Open Space)` with units inside it.
- **Vacancy tracking:** every unit has a status — `Occupied / Vacant / Inactive`.
- Editing a building to add a new room is a normal "Add Unit" action — no special flow.

> This directly solves "no way to edit the building / add new room / maintain empty space."

### F5 — Vacate & Settlement Wizard
A guided 5-step flow when a tenant leaves:

1. **Confirm tenant + unit + vacate date.**
2. **Outstanding rent:** system lists all unpaid months up to vacate date (computed from rent schedule). Shows total.
3. **Outstanding utility bills:** lists unpaid electricity/gas/service for that unit up to vacate date.
4. **Advance handling:** shows the tenant's advance balance; choose **Refund** (money out) or **Adjust against due** (reduces what they owe) or **Both** (adjust part, refund part).
5. **Final settlement statement:** a printable PDF showing — total due − advance adjustment = net payable by tenant (or net refund by you). On confirm:
   - A settlement transaction is posted.
   - Unit status → `Vacant`.
   - Lease status → `Closed`.
   - Tenant status → `Gone` (history preserved; re-rent the unit to a new tenant anytime).

> This solves "no proper way to empty a room" + "advance refund / adjust on leave."

### F6 — Advance & Adjustment Engine
- Every tenant has a live **Advance Balance** (migrated from `assign_unit.advance_payment`).
- **Adjust advance against rent due** during collection (F2).
- **Refund advance** during vacate (F5).
- **Carry-forward previous due** automatically into next month's outstanding list.
- Full **adjustment history** per tenant (audit trail).

### F7 — Smart Dashboard (the "what to collect / what to pay" view)
Top of the dashboard answers, **for the current month**:

- **Rent collection:** Total to collect · Collected · **Still pending (count + amount)** · list of tenants who haven't paid.
- **Overdue:** tenants who haven't paid for ≥ N months (red), with a "Send reminder" / "Call" action (re-uses QR call feature).
- **Expenses due:** "Electricity bill not recorded for: Shop L-1 S-1 (March), Shop L-1 S-2 (March)…" — clickable to record now.
- **Vacant units:** count + list (re-rent opportunity).
- **Agreement expirations** in next 30/60/90 days.
- **Cash flow:** income vs expense this month (chart).
- **Bank & mobile balances** (current cash positions).

All cards are **filterable by property** (e.g., "show me only Mohipal Market").

### F8 — Lossless Migration Pipeline (100% data accuracy)
See **Section 7 (Data Migration Plan)**. This is treated as a first-class feature, not an afterthought.

### F9 — Multi-Tenant SaaS Core
- Every table carries an `organization_id` (your business = one org; each future client = its own org).
- **Row-level isolation:** a user in Org A can **never** see Org B's data (enforced in the data layer + Prisma middleware, not just UI).
- Per-org: branding (logo, name), users, settings, currency, Bangla/English toggle.
- Per-org subscription hooks (status, trial end, plan) — billing integration is Phase 3.
- Legacy single-tenant data → migrated into a brand-new `organization_id = <your org>`.

### F10 — Modern Reports (Bangla + English, exportable)
All legacy reports rebuilt cleaner:
- Day Book, Client Ledger, Client Due, Bank Statement, Special Statement, Account-Head-Wise, Yearly Report.
- Filters: date range, property, tenant, account head.
- Export: **PDF** (printable, with your logo & footer) and **Excel**.
- Bangla number formatting preserved (your existing `bangla-convert.php` logic).

---

## 6. New Data Model (high-level)

> Full schema is designed in **Prisma** with **real foreign keys** (legacy had none — a key cause of past data issues).

**Core master**
- `organization` (multi-tenant root)
- `user`, `role`, `user_role`, `menu_permission` (RBAC)
- `property` (type: building/open_space/rooftop/mixed)
- `unit` (type: shop/room/space/rooftop/parking/godown; status: occupied/vacant/inactive)
- `tenant` (Bangla name, mobile, NID, status)
- `bank`, `mobile_bank`
- `account_head`, `ledger_head` (chart of accounts)

**Transactions**
- `lease` (tenant ↔ unit; rent, advance, agreement dates, status) — replaces `assign_unit`
- `rent_schedule` (auto-generated monthly due per lease) — *new, enables F1 & dashboards*
- `rent_collection` (payment against schedule rows; partial, advance_adj_id, pay_later) — replaces `collect_rent`
- `expense_template` (recurring electricity/gas per unit) — *new, enables F3*
- `expense_record` (actual monthly expense per unit, supports back-fill) — *new, enables F3*
- `transaction` (double-entry ledger; in/out, head, to/by) — replaces `account_transection`
- `settlement` (move-out final statement) — *new, enables F5*
- `audit_log` (every create/update/delete with user + IP + timestamp)

**Migration mapping** is in Section 7.

---

## 7. Data Migration Plan (100% accuracy — your #1 priority)

### 7.1 Strategy
1. **Read-only** export from legacy MySQL (`osudlagb_home_rent.sql`).
2. Run an **automated migration script** (Node/Prisma) that maps each legacy table to the new schema.
3. **Reconciliation report** comparing legacy vs new for every table:
   - Row counts must match.
   - Financial sums (`SUM(in_amount)`, `SUM(out_amount)`, `SUM(rent)`, `SUM(advance_payment)`) must reconcile to the paisa.
4. **Manual sign-off** on the reconciliation report before go-live.
5. Legacy DB kept **read-only** for 6 months as backup.

### 7.2 Table mapping (legacy → new)

| Legacy table | New table(s) | Notes |
|---|---|---|
| `setup_company` | `organization` (+ branding) | Becomes your org |
| `setup_vobon` | `property` (type=Building) | "মহিপাল মার্কেট" etc. kept verbatim |
| `setup_unit` | `unit` | `vobon_id` → `property_id`; unit_name + rent preserved |
| `setup_client` | `tenant` | Bangla names, mobile, NID, status Active/Gone preserved |
| `assign_unit` | `lease` | `advance_payment` → tenant advance balance; agreement dates preserved |
| `collect_rent` | `rent_schedule` + `rent_collection` | Each historic collection back-fills a schedule row + a paid collection row |
| `account_transection` | `transaction` | in/out, head, cheque info, dates preserved |
| `setup_ac_head` | `account_head` | INCOME/EXPENSE/BOTH preserved |
| `setup_ladger_head` | `ledger_head` | Preserved |
| `setup_bank` / `setup_mobile_banking` | `bank` / `mobile_bank` | Preserved |
| `admin` | `user` | Passwords re-hashed; `dypricpt_pass` **dropped** (security) |
| `menu_list` / `menu_permission` | `menu` / `menu_permission` | Re-mapped to new RBAC |
| `setup_rent_history` | `lease_history` (archive) | Preserved as-is |
| `tempTable_customer_ledger_movement` | recomputed from new data | Not migrated (it's a derived temp table) |
| `webpush_member` | `push_subscription` | Re-subscribe on first login (keys change) |

### 7.3 Validation guarantees
- **Row-count parity** per table.
- **Financial total parity** (sum of rent collected, sum of advances, sum of income, sum of expense) — must match legacy to 2 decimal places.
- **Orphan check:** no collection without a tenant/lease; no transaction without a head — orphans are reported (not silently dropped).
- **Dry-run mode:** migration can be run repeatedly into a staging DB until the report is green.

---

## 8. Technology Stack

### 8.1 Recommended (production target)

| Layer | Choice | Why |
|---|---|---|
| **Framework** | Next.js 16 (App Router) | Modern, fast, full-stack in one codebase, great DX |
| **Language** | TypeScript 5 | Type safety = fewer data bugs (critical for financial data) |
| **UI** | Tailwind CSS 4 + shadcn/ui | Clean, responsive, accessible, fast to build |
| **Database** | **PostgreSQL** | Real foreign keys, JSONB for flexible property/unit metadata, row-level security for multi-tenancy, rock-solid for financial data |
| **ORM** | Prisma | Type-safe queries, migrations, easy legacy→new mapping |
| **Auth** | NextAuth.js (Auth.js) | Role-based access, session management, future social login |
| **Multi-tenancy** | Row-level `organization_id` + Prisma middleware | Enforced isolation; easy to add per-org DBs later if needed |
| **Charts** | Recharts + NVD3 (kept where useful) | Dashboard visuals |
| **PDF/Excel** | `@react-pdf/renderer`, `exceljs` | Receipts, invoices, reports |
| **QR codes** | `qrcode` lib | Re-uses your existing client-call QR feature |
| **i18n / Bangla** | `next-intl` + Bangla number formatting | Bangla + English UI, preserved Bangla data |
| **Real-time (later)** | socket.io mini-service | Live rent-collection notifications |
| **Hosting** | Vercel (frontend) + managed Postgres (Neon/Supabase/AWS) | Easy start, scales for SaaS |

### 8.2 Why move off MySQL? (your call — both are possible)
- Legacy DB has **no foreign keys** — that's *why* you have orphan/messy data today.
- PostgreSQL gives **constraints, JSONB (for flexible property metadata), and row-level security** (perfect for multi-tenant SaaS).
- Prisma makes the DB swappable, so we **can start on SQLite** for the demo/prototype and **switch to Postgres** for production without rewriting code.

### 8.3 Build environment note
In this sandbox, I'll prototype on the provided **Next.js 16 + Prisma (SQLite)** stack to show you the real UI/UX fast. The schema will be **Postgres-compatible** so the switch is a one-line connection change. No data model rewrites needed.

---

## 9. User Experience Principles

- **Mobile-first, responsive** — you should be able to collect rent from your phone.
- **Sticky footer**, clean cards, Bangla typography (Poppins/Montserrat — already in your login resources).
- **One primary action per screen** — "Generate rent", "Collect", "Record expense", "Vacate".
- **Color status:** green = paid/done, red = overdue/due, grey = vacant/inactive.
- **Never lose data without confirmation** — soft-deletes everywhere, full audit log.
- **Bangla-first UI** with an English toggle (your staff data stays Bangla).

---

## 10. Phased Roadmap

| Phase | Scope | Outcome |
|---|---|---|
| **Phase 1 — MVP (4–6 weeks)** | F4 property model, F1 rent auto-gen, F2 unified collection, F7 dashboard, F8 core reports, F8 migration. Run **alongside** legacy DB (read-only) until you trust it. | You stop using the old PHP system |
| **Phase 2 — Lifecycle (3–4 weeks)** | F3 recurring expenses + reminders, F5 vacate wizard, F6 advance/adjustment engine. | Monthly ops become painless |
| **Phase 3 — SaaS (4–6 weeks)** | F9 multi-tenant org onboarding, subscription hooks, per-org branding, full report suite, tenant self-service portal. | Ready to sell to other clients |
| **Phase 4 — Growth** | PWA install, online payments (bKash/Nagad/Rocket), SMS/WhatsApp reminders, AI expense categorization. | Scale the business |

---

## 11. Success Metrics

| Metric | Today (legacy) | Target |
|---|---|---|
| Time to run monthly rent collection | "an afternoon" | **< 10 minutes** |
| Forgotten expense months per year | several | **0** (dashboard enforces) |
| Time to vacate a tenant + settle | error-prone, manual | **< 5 minutes**, printable statement |
| Data loss on migration | risk | **0 rows lost**, reconciled to the paisa |
| Time to onboard a new SaaS client | impossible | **< 1 day** |

---

## 12. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Migration data loss | Dry-run pipeline + reconciliation report + 6-month read-only legacy backup |
| Multi-tenant data leak | Row-level `org_id` enforced in data layer + Prisma middleware + automated isolation tests |
| Bangla rendering | Preserve `utf8mb4` data; test Bangla typography in all screens |
| Breaking your workflow mid-month | Run new system **parallel** to legacy for 1 full month; cutover on a month boundary |
| Security (legacy had plaintext passwords) | Re-hash passwords; drop `dypricpt_pass`; rotate DB creds; remove `dbconfig.json` from git |

---

## 13. Out of Scope (Phase 1)

- Native iOS/Android apps (PWA covers it).
- Online tenant payment gateway.
- Full double-entry accounting / audit-ready financials.
- AI/ML features.
- Bulk SMS provider integration (Phase 4).

---

## 14. Open Questions for You

1. **Hosting preference:** Vercel + managed Postgres (recommended) vs. your own cPanel/VPS? (affects SaaS scaling)
2. **Currency:** Bangladeshi Taka only, or multi-currency for SaaS clients abroad?
3. **Language:** Bangla-first UI with English toggle — confirmed?
4. **Existing logins:** keep the same usernames (E1013, E0001) or start fresh?
5. **Online payments:** do you want bKash/Nagad collection in Phase 1 or Phase 4?
6. **Tenant portal:** needed in Phase 3 (view own ledger / download receipt) — yes?

---

## 15. Next Step

Once you approve this PRD, I will:
1. Design the full **Prisma schema** (Postgres-compatible) reflecting Section 6.
2. Build the **migration script + reconciliation report** against your real `osudlagb_home_rent.sql` so you see your actual data in the new UI early.
3. Prototype **Phase 1 screens** (Dashboard, Property/Unit model, Rent Auto-Gen, Unified Collection) in the Next.js sandbox so you can click through before any production deploy.

---

*End of PRD v1.0 — please review and flag anything missing or any changed priority.*
