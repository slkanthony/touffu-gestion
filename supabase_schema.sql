-- ============================================================
-- TOUFFU GESTION — schéma Supabase
-- À coller dans : Supabase → SQL Editor → New query → Run
-- ============================================================

-- 1) État de l'application (un enregistrement par "domaine" de données)
create table if not exists public.app_state (
  key         text primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- 2) Instantanés quotidiens restaurables
create table if not exists public.snapshots (
  day         date primary key,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- Sécurité : accès réservé aux utilisateurs connectés
-- (tu crées ton compte à l'étape 4 du guide)
-- ============================================================
alter table public.app_state enable row level security;
alter table public.snapshots enable row level security;

drop policy if exists "app_state connectés" on public.app_state;
create policy "app_state connectés" on public.app_state
  for all to authenticated using (true) with check (true);

drop policy if exists "snapshots connectés" on public.snapshots;
create policy "snapshots connectés" on public.snapshots
  for all to authenticated using (true) with check (true);

-- 3) (Optionnel) Synchronisation temps réel entre appareils
--    Menu Supabase → Database → Publications → activer app_state.
alter publication supabase_realtime add table public.app_state;
