Fabricle Flow — Hybrid GST Invoice migration

Included migration:
  supabase/migrations/202611030001_hybrid_gst_invoices.sql

IMPORTANT
- This migration has NOT been run against your live Supabase project.
- Take a Supabase database backup before applying it.
- Apply it first in a staging/development project if available.
- Review the SQL before running it in Supabase SQL Editor.

What it does
- Adds optional HSN/SAC, default GST, cost and cost classification fields to items.
- Adds place-of-supply and GST summary fields to sales_invoices.
- Adds item/unit/HSN/tax snapshot fields to sales_invoice_lines.
- Makes sales_invoice_lines.delivery_id nullable so manual-only invoice lines are possible.
- Backfills taxable_amount from the existing amount without changing historical amount values.
- Replaces issue_sales_invoice while retaining its signature, role checks, draft-only rule,
  company-scoped numbering, duplicate invoice-number protection and delivery validation.
- Keeps historical invoices on the legacy invoice-wide tax calculation path. It deliberately
  leaves historical CGST/SGST/IGST split fields NULL because the old data does not identify
  the original tax split.

Not included yet
- Frontend hybrid invoice form and revised GST printable. The current frontend still uses
  the old delivery-level job-work charge workflow. Do not treat this migration alone as the
  completed hybrid invoice feature.

After applying, verify using:
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name IN ('items','sales_invoices','sales_invoice_lines')
  ORDER BY table_name, ordinal_position;

Also verify the function with:
  SELECT pg_get_functiondef('public.issue_sales_invoice(uuid,uuid)'::regprocedure);
