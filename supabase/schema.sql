-- ════════════════════════════════════════════════════════════════
--  Raumplan – Datenbank für Supabase
--  Einmal komplett im Supabase "SQL Editor" ausführen (Run).
-- ════════════════════════════════════════════════════════════════

-- Tabellen ------------------------------------------------------------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb
);
insert into public.settings (id, data) values (1, '{"schoolName":"Unsere Schule","publicView":true}')
  on conflict (id) do nothing;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  typ text default 'Klassenraum',
  bereich text default 'gemeinsam',
  kapazitaet int default 25,
  notnutzung boolean default false,
  sort int default 0
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bereich text default 'NMS',
  stammraum uuid references public.rooms(id) on delete set null,
  schueler int default 0
);

-- Regelmäßiger Wochenplan
create table if not exists public.schedule (
  id uuid primary key default gen_random_uuid(),
  day int not null check (day between 1 and 7),
  period int not null,
  room_id uuid not null references public.rooms(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  note text default ''
);
create index if not exists schedule_slot on public.schedule (day, period);

-- Änderungen für ein bestimmtes Datum (frei / belegt) + Protokoll
create table if not exists public.changes (
  id uuid primary key default gen_random_uuid(),
  datum date not null,
  period int not null,
  room_id uuid references public.rooms(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  art text not null check (art in ('frei','belegt','info')),
  note text default '',
  text text default '',
  created_by uuid default auth.uid(),
  created_at timestamptz default now()
);
create index if not exists changes_datum on public.changes (datum);

-- Benutzer & Rollen: master | editor | viewer | pending
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  role text not null default 'pending' check (role in ('master','editor','viewer','pending')),
  created_at timestamptz default now()
);

-- Neue Registrierung -> Profil. Die ALLERERSTE Person wird automatisch Master.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', new.email),
          case when exists (select 1 from public.profiles) then 'pending' else 'master' end);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Hilfsfunktionen für Rechte ------------------------------------------
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'anon');
$$;
create or replace function public.public_view() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (data->>'publicView')::boolean from public.settings where id = 1), false);
$$;
create or replace function public.can_read() returns boolean
language sql stable as $$
  select public.my_role() in ('master','editor','viewer') or public.public_view();
$$;
create or replace function public.can_edit() returns boolean
language sql stable as $$ select public.my_role() in ('master','editor'); $$;
create or replace function public.is_master() returns boolean
language sql stable as $$ select public.my_role() = 'master'; $$;

-- Zugriffsregeln (Row Level Security) ---------------------------------
alter table public.settings enable row level security;
alter table public.rooms    enable row level security;
alter table public.groups   enable row level security;
alter table public.schedule enable row level security;
alter table public.changes  enable row level security;
alter table public.profiles enable row level security;

drop policy if exists "settings lesen" on public.settings;
create policy "settings lesen" on public.settings for select using (true);
drop policy if exists "settings master" on public.settings;
create policy "settings master" on public.settings for all using (public.is_master()) with check (public.is_master());

-- Räume, Klassen, Wochenplan: lesen alle Berechtigten, ändern nur Master
do $$ declare t text; begin
  foreach t in array array['rooms','groups','schedule'] loop
    execute format('drop policy if exists "%1$s lesen" on public.%1$s', t);
    execute format('create policy "%1$s lesen" on public.%1$s for select using (public.can_read())', t);
    execute format('drop policy if exists "%1$s master" on public.%1$s', t);
    execute format('create policy "%1$s master" on public.%1$s for all using (public.is_master()) with check (public.is_master())', t);
  end loop;
end $$;
-- Bearbeiter dürfen dauerhafte Planänderungen per Satz ("jeden Donnerstag …") machen
drop policy if exists "schedule editor" on public.schedule;
create policy "schedule editor" on public.schedule for all using (public.can_edit()) with check (public.can_edit());

-- Änderungen: lesen alle Berechtigten, eintragen Master + Bearbeiter,
-- löschen Master (alle) bzw. Bearbeiter (nur eigene)
drop policy if exists "changes lesen" on public.changes;
create policy "changes lesen" on public.changes for select using (public.can_read());
drop policy if exists "changes eintragen" on public.changes;
create policy "changes eintragen" on public.changes for insert with check (public.can_edit());
drop policy if exists "changes loeschen" on public.changes;
create policy "changes loeschen" on public.changes for delete
  using (public.is_master() or (public.can_edit() and created_by = auth.uid()));

-- Profile: jeder sieht sein eigenes, Master sieht und ändert alle
drop policy if exists "profil selbst" on public.profiles;
create policy "profil selbst" on public.profiles for select using (id = auth.uid() or public.is_master());
drop policy if exists "profil master" on public.profiles;
create policy "profil master" on public.profiles for update using (public.is_master()) with check (public.is_master());
drop policy if exists "profil master loeschen" on public.profiles;
create policy "profil master loeschen" on public.profiles for delete using (public.is_master());

-- Live-Updates einschalten --------------------------------------------
do $$ declare t text; begin
  foreach t in array array['settings','rooms','groups','schedule','changes','profiles'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
