# RentPro

> Modern Rent & Property Management System — a clean, fast replacement for the legacy `osudlagb_home_rent` PHP/MySQL app.

**Status:** Planning — PRD v1.0 drafted.

## What is this?

RentPro is a ground-up rewrite of an existing Bangla-language rent management system. It keeps **100% of the historical data** (migrated with reconciliation), fixes the daily pain points of the old system, and is built **multi-tenant from day one** so it can later be sold as a SaaS to other property owners.

## Tech stack (planned)

- **Framework:** Next.js 16 (App Router) + React
- **Language:** TypeScript 5
- **UI:** Tailwind CSS 4 + shadcn/ui
- **Database:** PostgreSQL (with real foreign keys — the legacy DB had none)
- **ORM:** Prisma
- **Auth:** NextAuth.js (role-based access)
- **Multi-tenancy:** Row-level `organization_id` isolation

## What problem does it solve?

- Messy monthly rent creation & confusing previous-vs-recent collection screens
- Forgotten / late recurring expenses (electricity, gas)
- Inflexible "building-only" property model (no open spaces, rooftops, room edits)
- No proper tenant move-out / advance refund / adjustment flow
- No live "what to collect / what to pay this month" dashboard
- No path to multi-client SaaS

## Project structure (planned)

```
rentpro/
├── PRD.md            # Product Requirements Document (start here)
├── prisma/           # schema.prisma + migrations
├── src/              # Next.js app (app router, components, api)
├── scripts/         # migration pipeline from legacy DB
└── docs/             # design notes, migration reconciliation reports
```

## Read first

📄 **[PRD.md](./PRD.md)** — full product requirements, feature specs, data migration plan, and phased roadmap.

---

*Legacy source (read-only reference): `sajidchowdhury/rent`*
