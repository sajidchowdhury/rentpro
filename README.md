# RentPro

> Modern Rent & Property Management System — a clean, fast replacement for the legacy `osudlagb_home_rent` PHP/MySQL app.

**Status:** Phase 1 prototype complete — all PRD features (F1–F5, F9) + Reports + auth/RBAC + Docker/Postgres migration tooling, running on real data.

## What is this?

RentPro is a ground-up rewrite of an existing Bangla-language rent management system. It keeps **100% of the historical data** (migrated with reconciliation into Postgres via Docker), fixes the daily pain points of the old system, is gated by **NextAuth + role-based access**, and is built **multi-tenant from day one** so it can be sold as a SaaS to other property owners.

## Quick start (local, with Docker)

See **[SETUP.md](./SETUP.md)** for the full guide. In short:

```bash
docker compose up -d                # 1. start Postgres
cp .env.example .env                # 2. set DATABASE_URL + LEGACY_SQL_PATH + NEXTAUTH_SECRET
bun install
bun run db:migrate                  # 3. create the schema
bun run migrate:write               # 4. load your legacy dump → Postgres (+ reconciliation report)
bun run dev                         # 5. http://localhost:3000  →  log in (E1013 / 101010Sajid)
```

Login roles: `E1013`/`E0001` (Admin — all 9 screens) · `staff` (Data Entry — dashboard + collect + expenses + tenants only).

## Tech stack

- **Framework:** Next.js 16 (App Router) + React 19
- **Language:** TypeScript 5
- **UI:** Tailwind CSS 4 + shadcn/ui (New York) + Lucide icons + Framer Motion
- **Charts:** Recharts
- **Database:** PostgreSQL (with real foreign keys — the legacy DB had none)
- **ORM:** Prisma 6
- **Auth:** NextAuth-ready (role-based access)
- **Multi-tenancy:** Row-level `organization_id` isolation

## Project structure

```
rentpro/
├── PRD.md                  # Product Requirements Document (start here)
├── package.json            # Next.js + Prisma + shadcn deps
├── next.config.ts
├── tsconfig.json
├── postcss.config.mjs
├── components.json         # shadcn/ui config
├── prisma/
│   ├── schema.prisma       # 16-model Postgres schema (validated)
│   └── DESIGN.md           # schema design notes + legacy→new mapping
├── scripts/
│   ├── migrate.ts          # legacy dump → RentPro migration + reconciliation
│   ├── lib/legacyParser.ts # phpMyAdmin SQL parser (pure, no MySQL needed)
│   └── README.md           # migration run instructions
└── src/
    ├── app/
    │   ├── page.tsx                 # RentPro shell (sidebar + month selector + views)
    │   ├── layout.tsx
    │   ├── globals.css
    │   └── api/
    │       ├── months/route.ts      # available months (from real collection data)
    │       ├── dashboard/route.ts   # dashboard KPIs for a month
    │       ├── generate-rent/route.ts # rent-generation preview + POST action
    │       ├── tenants/route.ts    # tenant list with outstanding summary (F2)
    │       ├── tenant-ledger/route.ts # one tenant's due months + advance (F2)
    │       ├── collect/route.ts     # record a collection + return receipt (F2)
    │       ├── expenses/route.ts   # recurring expense tracker for a month (F3)
    │       ├── expense-heads/route.ts # expense account heads (F3)
    │       ├── record-expense/route.ts # record one expense (F3)
    │       ├── record-expense-batch/route.ts # back-fill all missing months (F3)
    │       ├── active-leases/route.ts     # active leases with outstanding + advance (F5)
    │       ├── settlement-preview/route.ts # outstanding + suggested refund/adjust split (F5)
    │       ├── settle-lease/route.ts     # settle a lease (close, vacate, refund/adjust) (F5)
    │       ├── properties/route.ts    # list + add property (F4)
    │       ├── property/route.ts      # property detail with units (F4)
    │       ├── property/update/route.ts # edit property (F4)
    │       ├── unit/route.ts         # add unit (F4)
    │       ├── unit/update/route.ts  # edit/retire unit (F4)
    │       ├── unit/delete/route.ts  # delete unit (FK-safe) (F4)
    │       ├── types/route.ts        # property + unit type enums (F4)
    │       ├── tenants-list/route.ts # tenants directory (all tenants + summary)
    │       ├── report/daybook/route.ts       # day book (date range, running balance)
    │       ├── report/yearly/route.ts        # yearly month-by-month
    │       ├── report/account-head/route.ts  # income/expense by account head
    │       ├── report/client-ledger/route.ts  # per-tenant statement
    │       ├── report/client-due/route.ts    # all tenants w/ outstanding
    │       ├── organizations/route.ts       # list + create organization (F9)
    │       ├── organization/route.ts        # active org + ownsData flag (F9)
    │       ├── organization/update/route.ts # edit org / plan (F9)
    │       └── organization/activate/route.ts # switch active org (F9)
    ├── components/
    │   ├── rentpro/
    │   │   ├── dashboard.tsx        # KPIs, trend chart, due/vacant/recent lists
    │   │   ├── generate-rent.tsx    # monthly rent auto-generation screen
    │   │   ├── collect-rent.tsx     # unified collection: picker, due list, collect dialog, receipt+QR (F2)
    │   │   ├── expenses.tsx         # recurring expense tracker: due/missing, back-fill, predictions (F3)
    │   │   ├── vacate.tsx           # 5-step vacate & settlement wizard + printable statement (F5)
    │   │   ├── properties.tsx       # flexible property/unit editor: add rooms/spaces/rooftops anytime (F4)
    │   │   ├── tenants.tsx         # tenants directory: search/filter, leases+advance+outstanding, jump-to-collect
    │   │   ├── reports.tsx         # 5 reports: day book, yearly, account-head-wise, client ledger, client due (printable)
    │   │   ├── platform.tsx       # SaaS admin: onboard orgs, plans, per-org branding, isolation
    │   │   └── login-form.tsx     # NextAuth credentials login + quick-demo buttons
    │   └── ui/                      # full shadcn/ui component set
    └── lib/
        ├── legacyParser.ts          # SQL dump parser (mirrors scripts/lib)
        ├── rentData.ts              # server data layer: dump → typed models + verifyCredentials
        ├── rbac.ts                  # client-safe role → allowed-views map
        ├── auth.ts                 # NextAuth options (credentials provider, JWT, session callbacks)
        ├── format.ts                # money + date formatters
        ├── utils.ts                 # cn() helper
        └── db.ts                    # Prisma client (production)
```

## Run the prototype (with real data)

The prototype reads the legacy `osudlagb_home_rent.sql` dump in-memory (no
Postgres needed) so you see your **actual** tenants, properties, and rent
collections in the new UI immediately.

```bash
bun install
# point at the legacy dump (any of: absolute path, or relative to cwd)
export LEGACY_SQL_PATH="/path/to/osudlagb_home_rent.sql"
bun run dev        # http://localhost:3000
```

Without the dump, the app still runs (empty state). In production, swap
`src/lib/rentData.ts` for Prisma queries against PostgreSQL — the UI doesn't
change.

## Production setup

```bash
# 1. database
echo 'DATABASE_URL="postgresql://user:pass@host:5432/rentpro?schema=public"' > .env
bunx prisma generate
bunx prisma migrate dev --name init

# 2. migrate legacy data (idempotent, with reconciliation report)
LEGACY_SQL_PATH="/path/to/osudlagb_home_rent.sql" bun run migrate:write

# 3. run
bun run dev
```

## Read first

📄 **[PRD.md](./PRD.md)** — full product requirements, feature specs, migration plan, roadmap.
📄 **[prisma/DESIGN.md](./prisma/DESIGN.md)** — schema design + legacy→new mapping.
📄 **[scripts/README.md](./scripts/README.md)** — migration run instructions.

---

*Legacy source (read-only reference): `sajidchowdhury/rent`*

