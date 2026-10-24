# Fabricle Flow

Fresh starter repository for the Fabricle Flow multi-tenant knitting inventory application.

## Initial scope

- Multi-company tenant model and memberships
- Catalog: items, units, parties, locations, lots
- BOMs and production orders
- Goods receipts and deliveries
- Append-oriented stock ledger
- Payment tracking: customer receipts, supplier payments, advances, partial payments and allocations
- Audit events and tenant-scoped row-level security
- Full accounting intentionally optional

## Important status

This is a starter scaffold. The SQL migration has **not** been applied to any Supabase project and has not yet been validated against a live database. Review it in a fresh development project before applying it to production. Do not add service-role secrets to the repository.

## Setup

1. Install Node.js 20+.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and set the Supabase project URL and publishable/anon key.
4. Run `npm run dev`.
5. Review `supabase/migrations/202610240001_initial_schema.sql` before applying it with the Supabase CLI.

## GitHub

Suggested repository: `https://github.com/karthikgj/fabricle-flow`

## Supabase

Target project ref: `pkttqfpyuxrpzjtcednu`

No remote writes have been made by this scaffold.
