-- Doberega cloud saves: one row of progress per player.
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.

create table if not exists public.saves (
  user_id uuid primary key references auth.users (id) on delete cascade,
  progress jsonb not null,
  updated_at timestamptz not null default now()
);

-- Row-level security: a player can only ever see and change their own save.
alter table public.saves enable row level security;

drop policy if exists "read own save" on public.saves;
create policy "read own save" on public.saves
  for select using (auth.uid() = user_id);

drop policy if exists "insert own save" on public.saves;
create policy "insert own save" on public.saves
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own save" on public.saves;
create policy "update own save" on public.saves
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Trophies on show to every angler. Anyone (even signed out) can look;
-- each player can only add, change or remove their own.
create table if not exists public.trophies (
  user_id uuid not null references auth.users (id) on delete cascade,
  trophy_id text not null,
  -- The player's nickname at the time; empty shows as "Angler". Never the email.
  player text not null default '',
  species text not null,
  weight real not null check (weight > 0 and weight < 100),
  spot text,
  bait text,
  caught_at timestamptz not null default now(),
  primary key (user_id, trophy_id)
);

create index if not exists trophies_caught_at_idx on public.trophies (caught_at desc);

alter table public.trophies enable row level security;

drop policy if exists "anyone reads trophies" on public.trophies;
create policy "anyone reads trophies" on public.trophies
  for select using (true);

drop policy if exists "insert own trophies" on public.trophies;
create policy "insert own trophies" on public.trophies
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own trophies" on public.trophies;
create policy "update own trophies" on public.trophies
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own trophies" on public.trophies;
create policy "delete own trophies" on public.trophies
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Usage stats for the stats page (stats/index.html).
-- The game logs anonymous events: a page open, pressing Fish, the first catch,
-- creating an account. Anyone may add an event; nobody can read the rows
-- directly. Totals come only from dashboard_stats(), and only for admins.

create table if not exists public.events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- A random id kept in the visitor's browser, and one per page open.
  visitor text not null check (char_length(visitor) between 8 and 64),
  session text not null check (char_length(session) between 8 and 64),
  type text not null check (type in ('visit', 'fish', 'catch', 'signup')),
  source text check (char_length(source) <= 80),
  device text check (device in ('mobile', 'tablet', 'desktop')),
  -- Opened from a home-screen icon rather than a browser tab.
  app boolean not null default false,
  lang text check (char_length(lang) <= 8)
);

create index if not exists events_created_at_idx on public.events (created_at);
create index if not exists events_type_visitor_idx on public.events (type, visitor);

alter table public.events enable row level security;

drop policy if exists "anyone logs events" on public.events;
create policy "anyone logs events" on public.events
  for insert to anon, authenticated with check (true);

-- Who may open the stats page. Add yourself once after signing up:
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'YOUR EMAIL';
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;

-- Everything the stats page shows, for the last `period_days` days (accounts: all time too).
drop function if exists public.dashboard_stats(int);
create or replace function public.dashboard_stats(period_days int default 30)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  since timestamptz := date_trunc('day', now()) - (greatest(period_days, 1) - 1) * interval '1 day';
  result json;
begin
  if not exists (select 1 from public.admins where user_id = auth.uid()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select json_build_object(
    'days', period_days,
    'period', json_build_object(
      'visitors', (select count(distinct visitor) from events where type = 'visit' and created_at >= since),
      'visits', (select count(*) from events where type = 'visit' and created_at >= since),
      'fishers', (select count(distinct visitor) from events where type = 'fish' and created_at >= since),
      'catchers', (select count(distinct visitor) from events where type = 'catch' and created_at >= since),
      'signups', (select count(*) from auth.users where created_at >= since),
      'appVisitors', (select count(distinct visitor) from events where type = 'visit' and app and created_at >= since),
      'returning', (select count(*) from (
        select visitor from events where type = 'visit' and created_at >= since
        group by visitor having count(distinct created_at::date) > 1) r)
    ),
    'allTime', json_build_object(
      'visitors', (select count(distinct visitor) from events where type = 'visit'),
      'users', (select count(*) from auth.users),
      'active7', (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
      'saves', (select count(*) from saves),
      'fishCaught', (select coalesce(sum(case when progress->>'caught' ~ '^\d+$' then (progress->>'caught')::bigint end), 0) from saves),
      'trophies', (select count(*) from trophies)
    ),
    'daily', (select coalesce(json_agg(d order by d.day), '[]'::json) from (
      select g.day::date as day,
        (select count(distinct visitor) from events e where e.type = 'visit' and e.created_at >= g.day and e.created_at < g.day + interval '1 day') as visitors,
        (select count(distinct visitor) from events e where e.type = 'catch' and e.created_at >= g.day and e.created_at < g.day + interval '1 day') as catchers,
        (select count(*) from auth.users u where u.created_at >= g.day and u.created_at < g.day + interval '1 day') as signups
      from generate_series(since, date_trunc('day', now()), interval '1 day') as g(day)
    ) d),
    'sources', (select coalesce(json_agg(s), '[]'::json) from (
      select coalesce(nullif(source, ''), 'direct') as name, count(distinct visitor) as visitors
      from events where type = 'visit' and created_at >= since
      group by 1 order by 2 desc limit 8
    ) s),
    'devices', (select coalesce(json_agg(x), '[]'::json) from (
      select coalesce(device, 'unknown') as name, count(distinct visitor) as visitors
      from events where type = 'visit' and created_at >= since
      group by 1 order by 2 desc
    ) x),
    -- Newest accounts: nickname, or the email half hidden.
    'recentUsers', (select coalesce(json_agg(r), '[]'::json) from (
      select coalesce(nullif(raw_user_meta_data->>'nickname', ''),
                      left(split_part(email, '@', 1), 2) || '***@' || split_part(email, '@', 2)) as name,
             created_at, last_sign_in_at
      from auth.users order by created_at desc limit 10
    ) r)
  ) into result;
  return result;
end;
$$;

revoke all on function public.dashboard_stats(int) from public, anon;
grant execute on function public.dashboard_stats(int) to authenticated;
