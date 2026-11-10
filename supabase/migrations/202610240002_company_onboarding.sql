
-- Fabricle Flow: secure, retry-safe company onboarding.
-- Apply after 202610240001_initial_schema.sql.

alter table public.companies
  add column if not exists country text not null default 'India',
  add column if not exists phone text,
  add column if not exists legal_name text;

-- Internal idempotency records. Clients cannot read or write this table directly.
create table public.company_onboarding_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_key uuid not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, request_key)
);

alter table public.company_onboarding_requests enable row level security;
revoke all on public.company_onboarding_requests from anon, authenticated;

create or replace function public.create_company_for_current_user(
  p_display_name text,
  p_company_name text,
  p_country text default 'India',
  p_currency char(3) default 'INR',
  p_phone text default null,
  p_legal_name text default null,
  p_request_key uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_company_id uuid;
  v_company_name text;
  v_display_name text;
  v_country text;
  v_currency text;
  v_slug text;
begin
  v_user_id := (select auth.uid());

  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if p_request_key is null then
    raise exception 'A request key is required';
  end if;

  -- Serialize requests using the same user/key pair.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_user_id::text || ':' || p_request_key::text, 0
    )
  );

  -- Return the result if this exact request already succeeded.
  select r.company_id
    into v_company_id
  from public.company_onboarding_requests r
  where r.user_id = v_user_id
    and r.request_key = p_request_key;

  if v_company_id is not null then
    return v_company_id;
  end if;

  v_display_name := nullif(pg_catalog.btrim(p_display_name), '');
  v_company_name := nullif(pg_catalog.btrim(p_company_name), '');
  v_country := nullif(pg_catalog.btrim(p_country), '');
  v_currency := pg_catalog.btrim(p_currency::text);

  if v_display_name is null then
    raise exception 'Full name is required';
  end if;

  if pg_catalog.length(v_display_name) > 150 then
    raise exception 'Full name is too long';
  end if;

  if v_company_name is null then
    raise exception 'Organisation name is required';
  end if;

  if pg_catalog.length(v_company_name) > 150 then
    raise exception 'Organisation name is too long';
  end if;

  if v_country is null or pg_catalog.length(v_country) > 100 then
    raise exception 'A valid country is required';
  end if;

  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter uppercase code';
  end if;

  insert into public.profiles (id, display_name)
  values (v_user_id, v_display_name)
  on conflict (id) do update
    set display_name = excluded.display_name,
        updated_at = now();

  v_slug := trim(both '-' from
  pg_catalog.regexp_replace(
    pg_catalog.lower(v_company_name), '[^a-z0-9]+', '-', 'g'
  )
);

  if v_slug = '' then
    v_slug := 'company';
  end if;

  v_slug := pg_catalog.left(v_slug, 90) || '-' ||
    pg_catalog.replace(gen_random_uuid()::text, '-', '');

  insert into public.companies (
    name, legal_name, slug, country, phone, base_currency
  )
  values (
    v_company_name,
    nullif(pg_catalog.btrim(p_legal_name), ''),
    v_slug,
    v_country,
    nullif(pg_catalog.btrim(p_phone), ''),
    v_currency
  )
  returning id into v_company_id;

  insert into public.company_members (
    company_id, user_id, role, is_active
  )
  values (
    v_company_id, v_user_id, 'owner', true
  );

  insert into public.company_onboarding_requests (
    user_id, request_key, company_id
  )
  values (
    v_user_id, p_request_key, v_company_id
  );

  return v_company_id;
end;
$$;

revoke all on function public.create_company_for_current_user(
  text, text, text, character, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.create_company_for_current_user(
  text, text, text, character, text, text, uuid
) to authenticated;
