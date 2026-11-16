-- Game Workspace: authenticated per-user schema
create table if not exists public.game_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  target_url text not null default 'https://1xlite-6487.com/en/games/solitaire',
  updated_at timestamptz not null default now()
);

create table if not exists public.game_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled',
  url text not null,
  recorded_at timestamptz not null default now()
);

create index if not exists game_records_user_recorded_idx
  on public.game_records (user_id, recorded_at desc);

alter table public.game_settings enable row level security;
alter table public.game_records enable row level security;

create policy "Users can read their own settings"
on public.game_settings for select to authenticated
using ((select auth.uid()) = user_id);
create policy "Users can insert their own settings"
on public.game_settings for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "Users can update their own settings"
on public.game_settings for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can read their own records"
on public.game_records for select to authenticated
using ((select auth.uid()) = user_id);
create policy "Users can insert their own records"
on public.game_records for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "Users can delete their own records"
on public.game_records for delete to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.game_settings from anon;
revoke all on public.game_records from anon;
grant select, insert, update on public.game_settings to authenticated;
grant select, insert, delete on public.game_records to authenticated;

-- Mouse recordings are stored as event streams, not as saved website URLs.
create table if not exists public.game_mouse_recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  duration_ms bigint not null default 0 check (duration_ms >= 0),
  event_count integer not null default 0 check (event_count >= 0),
  events jsonb not null default '[]'::jsonb,
  recorded_at timestamptz not null default now(),
  constraint game_mouse_recordings_events_array check (jsonb_typeof(events) = 'array')
);

create index if not exists game_mouse_recordings_user_recorded_idx
  on public.game_mouse_recordings (user_id, recorded_at desc);

alter table public.game_mouse_recordings enable row level security;
create policy "Users can read their own mouse recordings"
on public.game_mouse_recordings for select to authenticated
using ((select auth.uid()) = user_id);
create policy "Users can insert their own mouse recordings"
on public.game_mouse_recordings for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "Users can delete their own mouse recordings"
on public.game_mouse_recordings for delete to authenticated
using ((select auth.uid()) = user_id);
revoke all on public.game_mouse_recordings from anon;
grant select, insert, delete on public.game_mouse_recordings to authenticated;
