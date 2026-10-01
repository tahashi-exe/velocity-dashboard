-- Velocity v2 backend — schema from TECHNICAL.md §2, plus:
--   runs.slug           the id the static app already uses (slug(name) + '-' + kind), so
--                       localStorage RSVPs and existing links survive the migration
--   profiles.prefs      same shape as the old `velocity_prefs` localStorage object
--   profiles.terms_*    which Terms/Privacy version the user accepted, stamped server-side
--   rsvp_log            append-only history of every RSVP change
--   run_counts()        anonymous going/interested totals — never who
--   delete_my_account() self-service erasure (Account → Delete account)
--
-- Access model: the browser uses the publishable key as `anon` (guest) or
-- `authenticated` (signed in). Runs are read-only to both; only the Telegram bot
-- (secret key, server-side) and the dashboard write them. Users read and write
-- only their own profile and RSVPs.

-- ---------- catalogue ----------

create table public.categories (
  key   text primary key,
  label text not null
);

create table public.category_types (
  category_key           text not null references public.categories (key),
  type_key               text not null,
  label                  text not null,
  is_training_equivalent boolean not null default false, -- drives the red pin, TECHNICAL.md §4
  sort_order             smallint not null default 0,
  primary key (category_key, type_key)
);

create type public.run_kind as enum ('recurring', 'one_off');
create type public.rsvp_status as enum ('going', 'interested', 'not_interested', 'not_going');

create table public.runs (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  category_key  text not null default 'running',
  type_key      text not null,
  kind          public.run_kind not null,
  name          text not null,
  location_name text not null default '',
  lat           double precision not null,
  lng           double precision not null,
  freebies      boolean not null default false,
  cost          text check (cost in ('free', 'paid')), -- null = unknown, never "free"
  price         text not null default '',
  day_of_week   text check (day_of_week in ('sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday')),
  event_date    date,
  time          time not null,
  register_link text not null default '',
  photos        text[] not null default '{}' check (cardinality(photos) <= 3),
  notes         text not null default '',
  details       jsonb not null default '{}', -- category-specific, e.g. {"surface": "beach"}
  last_updated  date,
  created_at    timestamptz not null default now(),
  foreign key (category_key, type_key) references public.category_types (category_key, type_key),
  check (
    (kind = 'recurring' and day_of_week is not null and event_date is null) or
    (kind = 'one_off' and event_date is not null and day_of_week is null)
  ),
  -- price only ever accompanies a paid run (CLAUDE.md "cost / price")
  check (cost is not distinct from 'paid' or price = '')
);

-- ---------- accounts ----------

create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  display_name      text check (char_length(display_name) <= 60),
  avatar_url        text,
  prefs             jsonb not null default '{}',
  terms_version     text,
  terms_accepted_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.rsvps (
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  run_id     uuid not null references public.runs (id) on delete cascade,
  status     public.rsvp_status not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, run_id)
);
create index rsvps_run_id_idx on public.rsvps (run_id);

create table public.rsvp_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  run_id     uuid not null references public.runs (id) on delete cascade,
  status     public.rsvp_status, -- null = RSVP cleared
  changed_at timestamptz not null default now()
);
create index rsvp_log_user_id_idx on public.rsvp_log (user_id);
create index rsvp_log_run_id_idx on public.rsvp_log (run_id);

-- ---------- triggers ----------

-- Every new sign-up gets a profile, pre-filled from Google where available.
-- Email-code sign-ups arrive with no name; the app asks for one.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), 60),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The client only ever sets terms_version; the acceptance time is stamped here
-- so it can't be backdated or edited independently.
create function public.profiles_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.terms_version is distinct from old.terms_version then
    new.terms_accepted_at := case when new.terms_version is null then null else now() end;
  else
    new.terms_accepted_at := old.terms_accepted_at;
  end if;
  return new;
end;
$$;

create trigger profiles_before_update
  before update on public.profiles
  for each row execute function public.profiles_before_update();

create function public.rsvps_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger rsvps_before_update
  before update on public.rsvps
  for each row execute function public.rsvps_before_update();

-- Records every RSVP change. Security definer because users can't write
-- rsvp_log themselves.
create function public.log_rsvp_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- A delete cascading from account (or run) deletion arrives after the
    -- parent row is already gone. Logging it would write fresh history for a
    -- user who is being erased (and fail the foreign key), so skip it.
    if not exists (select 1 from public.profiles where id = old.user_id)
       or not exists (select 1 from public.runs where id = old.run_id) then
      return old;
    end if;
    insert into public.rsvp_log (user_id, run_id, status) values (old.user_id, old.run_id, null);
    return old;
  end if;

  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  insert into public.rsvp_log (user_id, run_id, status) values (new.user_id, new.run_id, new.status);
  return new;
end;
$$;

create trigger rsvps_log_change
  after insert or update or delete on public.rsvps
  for each row execute function public.log_rsvp_change();

-- ---------- functions callable from the app ----------

-- Anonymous totals for the "8 going · 5 interested" line. Exposes counts only.
create function public.run_counts()
returns table (run_id uuid, going integer, interested integer)
language sql
stable
security definer
set search_path = ''
as $$
  select r.run_id,
         (count(*) filter (where r.status = 'going'))::integer,
         (count(*) filter (where r.status = 'interested'))::integer
  from public.rsvps r
  group by r.run_id;
$$;

-- Account → Delete account. Cascades to profile, RSVPs and RSVP history.
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  delete from auth.users where id = uid;
end;
$$;

-- Functions are executable by PUBLIC by default, and Supabase also grants the
-- API roles execute on new functions. Trigger functions must not be callable
-- over the API at all; the two RPCs are granted to exactly who needs them.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.profiles_before_update() from public, anon, authenticated;
revoke execute on function public.rsvps_before_update() from public, anon, authenticated;
revoke execute on function public.log_rsvp_change() from public, anon, authenticated;
revoke execute on function public.run_counts() from public;
grant execute on function public.run_counts() to anon, authenticated;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- row-level security ----------

alter table public.categories enable row level security;
alter table public.category_types enable row level security;
alter table public.runs enable row level security;
alter table public.profiles enable row level security;
alter table public.rsvps enable row level security;
alter table public.rsvp_log enable row level security; -- no policies: dashboard/secret key only

create policy "Categories are public" on public.categories
  for select to anon, authenticated using (true);
create policy "Category types are public" on public.category_types
  for select to anon, authenticated using (true);
create policy "Runs are public" on public.runs
  for select to anon, authenticated using (true);

create policy "Users read their own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "Users update their own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "Users read their own RSVPs" on public.rsvps
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users add their own RSVPs" on public.rsvps
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users change their own RSVPs" on public.rsvps
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "Users clear their own RSVPs" on public.rsvps
  for delete to authenticated using (user_id = (select auth.uid()));

-- Belt and braces on top of RLS: the browser roles hold no write privilege on
-- the catalogue, can't create or delete profiles directly (the trigger and
-- delete_my_account() do that), and can't touch the history at all.
revoke insert, update, delete, truncate on public.categories, public.category_types, public.runs from anon, authenticated;
revoke insert, delete, truncate on public.profiles from anon, authenticated;
revoke all on public.profiles, public.rsvps from anon;
revoke all on public.rsvp_log from anon, authenticated;

-- ---------- reference data ----------

insert into public.categories (key, label) values ('running', 'Running');

insert into public.category_types (category_key, type_key, label, is_training_equivalent, sort_order) values
  ('running', 'social',   'Social',          false, 1),
  ('running', 'tempo',    'Tempo',           false, 2),
  ('running', 'training', 'Training',        true,  3),
  ('running', 'long_run', 'Long run',        false, 4),
  ('running', 'pyramid',  'Pyramid session', false, 5);
