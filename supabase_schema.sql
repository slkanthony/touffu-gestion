-- ============================================================
-- TOUFFU GESTION — schéma Supabase
-- À coller dans : Supabase → SQL Editor → New query → Run
-- (mis à jour le 2026-09-29 pour correspondre à la configuration réelle du serveur :
--  profils lecture seule « viewer » et suivi des connexions)
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

-- 3) Suivi des connexions (Paramètres → 👥 Connexions des utilisateurs)
create table if not exists public.connexions (
  id          bigserial primary key,
  email       text not null,
  role        text,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- Sécurité : accès réservé aux utilisateurs connectés.
-- Rôle = app_metadata.role du compte (Authentication → Users) :
--   (aucun rôle) = admin · 'team' = équipe · 'viewer' = lecture seule.
-- Pour passer un compte en lecture seule :
--   update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role','viewer')
--   where lower(email) = 'adresse@exemple.fr';
-- ============================================================
alter table public.app_state  enable row level security;
alter table public.snapshots  enable row level security;
alter table public.connexions enable row level security;

-- Lecture : tout compte connecté
drop policy if exists "app_state connectés" on public.app_state;
drop policy if exists "app_state lecture" on public.app_state;
create policy "app_state lecture" on public.app_state
  for select to authenticated using (true);
drop policy if exists "snapshots connectés" on public.snapshots;
drop policy if exists "snapshots lecture" on public.snapshots;
create policy "snapshots lecture" on public.snapshots
  for select to authenticated using (true);

-- Écriture : tout compte connecté SAUF « viewer » (bloqué côté base, pas seulement à l'écran)
drop policy if exists "app_state écriture" on public.app_state;
create policy "app_state écriture" on public.app_state
  for all to authenticated
  using (coalesce(auth.jwt()->'app_metadata'->>'role', 'admin') <> 'viewer')
  with check (coalesce(auth.jwt()->'app_metadata'->>'role', 'admin') <> 'viewer');
drop policy if exists "snapshots écriture" on public.snapshots;
create policy "snapshots écriture" on public.snapshots
  for all to authenticated
  using (coalesce(auth.jwt()->'app_metadata'->>'role', 'admin') <> 'viewer')
  with check (coalesce(auth.jwt()->'app_metadata'->>'role', 'admin') <> 'viewer');

-- Connexions : chacun enregistre sa propre ligne ; seul l'admin (aucun rôle) les lit
drop policy if exists "connexions ajout" on public.connexions;
create policy "connexions ajout" on public.connexions
  for insert to authenticated
  with check (lower(email) = lower(auth.jwt()->>'email'));
drop policy if exists "connexions lecture admin" on public.connexions;
create policy "connexions lecture admin" on public.connexions
  for select to authenticated
  using (coalesce(auth.jwt()->'app_metadata'->>'role', 'admin') = 'admin');

-- ⚠️ Dans Supabase → Authentication → Sign In / Providers : désactiver « Allow new users to sign up »
--    (sinon n'importe qui peut créer un compte, et un compte sans rôle = admin).

-- 4) (Optionnel) Synchronisation temps réel entre appareils
--    Menu Supabase → Database → Publications → activer app_state.
alter publication supabase_realtime add table public.app_state;
