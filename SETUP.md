# Local setup & testing (Docker + Postgres + migration + auth)

This guide gets RentPro running locally with a real Postgres, loads your
legacy data into it (with a reconciliation report), and lets you log in.

> The app UI also runs without Postgres (in-memory, seeded from the dump),
> so you can preview without steps 1–3. Steps 1–3 are for testing the
> **production migration** against a real database.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (you have this ✓)
- [Bun](https://bun.sh/) (`curl -fsSL https://bun.sh/install | bash`)
- Your legacy `osudlagb_home_rent.sql` dump somewhere on disk

## 1. Start Postgres

```bash
docker compose up -d            # starts postgres on localhost:5432
docker compose ps               # confirm it's healthy
```

## 2. Configure environment

```bash
cp .env.example .env
# edit .env:
#   LEGACY_SQL_PATH=/absolute/path/to/osudlagb_home_rent.sql
#   NEXTAUTH_SECRET=<openssl rand -base64 32>
```

## 3. Install deps + create the schema + load your data

```bash
bun install
bun run db:migrate              # prisma generate + migrate dev (creates all tables)
bun run migrate:write           # runs scripts/migrate.ts --write
```

`migrate:write` reads your legacy dump, transforms every row into the new
RentPro schema using deterministic IDs, and prints a **reconciliation
report** comparing legacy vs new (row counts + money totals) — every
table should show ✅.

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
```

Inspect the loaded data:

```bash
bun run db:studio               # Prisma Studio at http://localhost:5555
```

## 4. Run the app

```bash
bun run dev                     # http://localhost:3000
```

Log in (point 2 — NextAuth + role-based access):

| Username | Password       | Role  | Sees |
|---|---|---|---|
| `E1013`  | `101010Sajid`  | Admin | all 9 screens |
| `E0001`  | `101010Sajid`  | Admin | all 9 screens |
| `staff`  | `101010Sajid`  | Data Entry | dashboard + collect + expenses + tenants only |

> Passwords are verified against bcrypt hashes (the legacy `$2y$` PHP hashes
> are converted to Node-compatible `$2b$`). In the prototype the users come
> from the dump's `admin` table; after `migrate:write` they live in the
> Postgres `users` table (ready for the production swap to Prisma-based auth).

## 5. Multi-tenant (F9)

The header has an **org switcher**. The owner org (your business, "RENT") has
all the data. Switch to a demo client org (e.g. "Sunrise Properties") → the
data screens show an **empty-org state** (row-level isolation). Onboard new
client orgs from **Platform** (প্ল্যাটফর্ম).

## Commands

| Command | What it does |
|---|---|
| `docker compose up -d` | start Postgres |
| `docker compose down` | stop Postgres (keep data) |
| `docker compose down -v` | stop + **wipe** the database |
| `bun run db:migrate` | prisma generate + migrate dev |
| `bun run migrate:write` | load legacy dump → Postgres + reconciliation |
| `bun run migrate:dry` | parse + print reconciliation (no DB writes) |
| `bun run db:studio` | Prisma Studio browser |
| `bun run dev` | Next.js app on :3000 |
| `bun run lint` | ESLint |

## Notes / production swap

- The app's data layer (`src/lib/rentData.ts`) currently reads the dump
  **in-memory** (so it runs even before you run the migration). After
  `migrate:write`, the same data also lives in Postgres. Swapping the data
  layer to Prisma queries against Postgres is a one-file change per query
  (the function signatures stay the same, so the UI doesn't change) — that's
  the final production step.
- The migration is **idempotent** (every write is an upsert keyed on a
  deterministic ID), so you can re-run it freely after fixing issues.
- The legacy DB is **read-only** throughout — keep it running read-only for
  a month after cutover as a backup.
