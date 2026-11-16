-- Game Workspace database schema
-- Initial no-login prototype. Anonymous policies below intentionally make data
-- shared and publicly writable; replace before a public production deployment.

create table if not exists public.game_settings (
  id smallint primary key default 1 check (id = 1),
  target_url text not null default 'https://1xlite-6487.com/',
  updated_at timestamptz not null default now()
);

insert into public.game_settings (id, target_url)
values (1, 'https://1xlite-6487.com/')
on conflict (id) do nothing;

create table if not exists public.game_records (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Untitled',
  url text not null,
  recorded_at timestamptz not null default now()
);

alter table public.game_settings enable row level security;
alter table public.game_records enable row level security;

drop policy if exists "Public can read game settings" on public.game_settings;
create policy "Public can read game settings"
on public.game_settings for select to anon, authenticated using (true);

drop policy if exists "Public can update game settings" on public.game_settings;
create policy "Public can update game settings"
on public.game_settings for update to anon, authenticated using (true) with check (true);

drop policy if exists "Public can read game records" on public.game_records;
create policy "Public can read game records"
on public.game_records for select to anon, authenticated using (true);

drop policy if exists "Public can create game records" on public.game_records;
create policy "Public can create game records"
on public.game_records for insert to anon, authenticated with check (true);

drop policy if exists "Public can delete game records" on public.game_records;
create policy "Public can delete game records"
on public.game_records for delete to anon, authenticated using (true);

grant select, update on public.game_settings to anon, authenticated;
grant select, insert, delete on public.game_records to anon, authenticated;
