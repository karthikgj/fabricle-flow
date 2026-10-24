-- Fabricle Flow initial schema (review before applying).
-- This migration is intended for the NEW, EMPTY Supabase project only.
-- It is not applied remotely by creating this file.

create extension if not exists pgcrypto;

create type public.member_role as enum ('owner', 'admin', 'manager', 'operator', 'viewer');
create type public.document_status as enum ('draft', 'posted', 'cancelled');
create type public.payment_direction as enum ('receipt', 'payment');
create type public.payment_method as enum ('cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other');

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  base_currency char(3) not null default 'INR',
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'viewer',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  precision_digits smallint not null default 3 check (precision_digits between 0 and 6),
  created_at timestamptz not null default now(),
  unique (company_id, code), unique (company_id, id)
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sku text not null,
  name text not null,
  item_type text not null check (item_type in ('yarn','material','work_in_progress','finished_good','other')),
  unit_id uuid not null,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  unique (company_id, sku), unique (company_id, id),
  foreign key (company_id, unit_id) references public.units(company_id, id)
);

create table public.parties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  party_code text not null,
  name text not null,
  party_type text not null check (party_type in ('customer','supplier','both','other')),
  phone text,
  email text,
  tax_id text,
  address jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, party_code), unique (company_id, id)
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, code), unique (company_id, id)
);

create table public.lots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id uuid not null,
  lot_code text not null,
  supplier_lot_code text,
  received_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique (company_id, lot_code), unique (company_id, id),
  foreign key (company_id, item_id) references public.items(company_id, id)
);

create table public.boms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  output_item_id uuid not null,
  output_quantity numeric(18,6) not null default 1 check (output_quantity > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, code), unique (company_id, id),
  foreign key (company_id, output_item_id) references public.items(company_id, id)
);

create table public.bom_components (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bom_id uuid not null,
  item_id uuid not null,
  quantity numeric(18,6) not null check (quantity > 0),
  wastage_percent numeric(7,4) not null default 0 check (wastage_percent between 0 and 100),
  created_at timestamptz not null default now(),
  foreign key (company_id, bom_id) references public.boms(company_id, id) on delete cascade,
  foreign key (company_id, item_id) references public.items(company_id, id)
);

create table public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  document_no text not null,
  supplier_id uuid not null,
  status public.document_status not null default 'draft',
  receipt_date date not null default current_date,
  notes text,
  created_by uuid references auth.users(id),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, document_no), unique (company_id, id),
  foreign key (company_id, supplier_id) references public.parties(company_id, id)
);

create table public.goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  receipt_id uuid not null,
  item_id uuid not null,
  location_id uuid not null,
  lot_id uuid,
  quantity numeric(18,6) not null check (quantity > 0),
  unit_cost numeric(18,4) check (unit_cost is null or unit_cost >= 0),
  created_at timestamptz not null default now(),
  foreign key (company_id, receipt_id) references public.goods_receipts(company_id, id) on delete cascade,
  foreign key (company_id, item_id) references public.items(company_id, id),
  foreign key (company_id, location_id) references public.locations(company_id, id),
  foreign key (company_id, lot_id) references public.lots(company_id, id)
);

create table public.production_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_no text not null,
  bom_id uuid not null,
  output_item_id uuid not null,
  planned_quantity numeric(18,6) not null check (planned_quantity > 0),
  produced_quantity numeric(18,6) not null default 0 check (produced_quantity >= 0),
  status public.document_status not null default 'draft',
  planned_start date,
  completed_at timestamptz,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (company_id, order_no), unique (company_id, id),
  foreign key (company_id, bom_id) references public.boms(company_id, id),
  foreign key (company_id, output_item_id) references public.items(company_id, id)
);

create table public.production_consumption_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  production_order_id uuid not null,
  item_id uuid not null,
  location_id uuid not null,
  lot_id uuid,
  quantity numeric(18,6) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  foreign key (company_id, production_order_id) references public.production_orders(company_id, id) on delete cascade,
  foreign key (company_id, item_id) references public.items(company_id, id),
  foreign key (company_id, location_id) references public.locations(company_id, id),
  foreign key (company_id, lot_id) references public.lots(company_id, id)
);

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  document_no text not null,
  customer_id uuid not null,
  status public.document_status not null default 'draft',
  delivery_date date not null default current_date,
  notes text,
  created_by uuid references auth.users(id),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, document_no), unique (company_id, id),
  foreign key (company_id, customer_id) references public.parties(company_id, id)
);

create table public.delivery_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  delivery_id uuid not null,
  item_id uuid not null,
  location_id uuid not null,
  lot_id uuid,
  quantity numeric(18,6) not null check (quantity > 0),
  unit_price numeric(18,4) check (unit_price is null or unit_price >= 0),
  created_at timestamptz not null default now(),
  foreign key (company_id, delivery_id) references public.deliveries(company_id, id) on delete cascade,
  foreign key (company_id, item_id) references public.items(company_id, id),
  foreign key (company_id, location_id) references public.locations(company_id, id),
  foreign key (company_id, lot_id) references public.lots(company_id, id)
);

create table public.stock_ledger (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id uuid not null,
  location_id uuid not null,
  lot_id uuid,
  quantity_delta numeric(18,6) not null check (quantity_delta <> 0),
  source_type text not null,
  source_id uuid not null,
  idempotency_key text not null,
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (company_id, idempotency_key),
  foreign key (company_id, item_id) references public.items(company_id, id),
  foreign key (company_id, location_id) references public.locations(company_id, id),
  foreign key (company_id, lot_id) references public.lots(company_id, id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  payment_no text not null,
  direction public.payment_direction not null,
  party_id uuid not null,
  payment_date date not null default current_date,
  amount numeric(18,2) not null check (amount > 0),
  currency char(3) not null default 'INR',
  method public.payment_method not null,
  reference_no text,
  status public.document_status not null default 'draft',
  notes text,
  created_by uuid references auth.users(id),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, payment_no), unique (company_id, id),
  foreign key (company_id, party_id) references public.parties(company_id, id)
);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  payment_id uuid not null,
  target_type text not null check (target_type in ('sales_invoice','purchase_invoice','delivery','goods_receipt','opening_balance','other')),
  target_id uuid not null,
  amount numeric(18,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  foreign key (company_id, payment_id) references public.payments(company_id, id) on delete cascade
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  request_id text,
  created_at timestamptz not null default now()
);

create index idx_company_members_user on public.company_members(user_id, is_active);
create index idx_items_company_name on public.items(company_id, name);
create index idx_parties_company_name on public.parties(company_id, name);
create index idx_stock_ledger_company_item_time on public.stock_ledger(company_id, item_id, occurred_at desc);
create index idx_stock_ledger_source on public.stock_ledger(company_id, source_type, source_id);
create index idx_payments_party_date on public.payments(company_id, party_id, payment_date desc);
create index idx_payment_allocations_payment on public.payment_allocations(company_id, payment_id);
create index idx_audit_logs_company_time on public.audit_logs(company_id, created_at desc);

create or replace function public.is_company_member(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.company_members cm
    where cm.company_id = target_company_id
      and cm.user_id = (select auth.uid())
      and cm.is_active = true
  );
$$;

revoke all on function public.is_company_member(uuid) from public;
grant execute on function public.is_company_member(uuid) to authenticated;

-- Enable tenant-scoped RLS on all company-owned business tables.
do $$
declare t text;
begin
  foreach t in array array[
    'companies','company_members','units','items','parties','locations','lots','boms','bom_components',
    'goods_receipts','goods_receipt_lines','production_orders','production_consumption_lines','deliveries',
    'delivery_lines','stock_ledger','payments','payment_allocations','audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Membership visibility: users see their own memberships; company rows are visible to members.
create policy "members read own memberships" on public.company_members
  for select to authenticated using (user_id = (select auth.uid()));
create policy "members read company memberships" on public.company_members
  for select to authenticated using (public.is_company_member(company_id));
create policy "company members read company" on public.companies
  for select to authenticated using (public.is_company_member(id));

-- Basic tenant-scoped policies. Privileged writes should be performed through validated application
-- workflows/RPCs; additional role-aware write policies are required before production use.
do $$
declare t text;
begin
  foreach t in array array[
    'units','items','parties','locations','lots','boms','bom_components','goods_receipts',
    'goods_receipt_lines','production_orders','production_consumption_lines','deliveries',
    'delivery_lines','stock_ledger','payments','payment_allocations'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_company_member(company_id))', t || '_tenant_select', t);
  end loop;
end $$;

create policy "audit logs tenant read" on public.audit_logs
  for select to authenticated using (company_id is not null and public.is_company_member(company_id));

-- Deliberately no broad client-side write policies yet. Add role-aware policies and posting RPCs
-- after reviewing the business rules. This avoids accidental unvalidated stock/payment posting.
