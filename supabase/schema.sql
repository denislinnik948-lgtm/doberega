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
