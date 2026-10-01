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

-- Lecture : l'admin et l'équipe lisent tout. Le profil VISITE (viewer) n'a AUCUN accès direct : ni app_state, ni snapshots
-- (sauvegardes complètes). Il lit via la fonction app_state_safe() = mêmes données SANS clients/journal et sans le nom
-- des clients sur les ventes (données personnelles : jamais envoyées au navigateur d'un visiteur).
drop policy if exists "app_state connectés" on public.app_state;
drop policy if exists "app_state lecture" on public.app_state;
create policy "app_state lecture" on public.app_state
  for select to authenticated using (coalesce(auth.jwt()->'app_metadata'->>'role', 'admin') <> 'viewer');
drop policy if exists "snapshots connectés" on public.snapshots;
drop policy if exists "snapshots lecture" on public.snapshots;
create policy "snapshots lecture" on public.snapshots
  for select to authenticated using (coalesce(auth.jwt()->'app_metadata'->>'role', 'admin') <> 'viewer');

create or replace function public.app_state_safe()
returns table(key text, data jsonb)
language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role', 'admin') <> 'viewer' then
    return query select a.key, a.data from public.app_state a;
  else
    return query
      select a.key,
        case when a.key = 'sales' and jsonb_typeof(a.data) = 'array'
             then (select coalesce(jsonb_agg(e - 'customerName'), '[]'::jsonb) from jsonb_array_elements(a.data) e)
             else a.data end
      from public.app_state a
      where a.key not in ('clients', 'journal', 'baskets');
  end if;
end $fn$;
revoke all on function public.app_state_safe() from public, anon;
grant execute on function public.app_state_safe() to authenticated;

-- Écriture app_state : admin (aucun rôle) = tout ; équipe ('team') = stock + fiches prix
-- (l'appli ne laisse l'équipe modifier QUE lien / réf. / notes fournisseur des fiches prix) ;
-- viewer = rien. (Noms des règles = ceux du serveur réel.)
drop policy if exists "app_state écriture" on public.app_state;
drop policy if exists "app_state ecriture" on public.app_state;
drop policy if exists "app_state maj" on public.app_state;
drop policy if exists "app_state suppr" on public.app_state;
create policy "app_state ecriture" on public.app_state for insert to authenticated
  with check ((auth.jwt()->'app_metadata'->>'role') is null
    or ((auth.jwt()->'app_metadata'->>'role') = 'team' and key in ('stockM','materials','consumables','journal','meta','catalogM','clients')));
create policy "app_state maj" on public.app_state for update to authenticated
  using ((auth.jwt()->'app_metadata'->>'role') is null
    or ((auth.jwt()->'app_metadata'->>'role') = 'team' and key in ('stockM','materials','consumables','journal','meta','catalogM','clients')))
  with check ((auth.jwt()->'app_metadata'->>'role') is null
    or ((auth.jwt()->'app_metadata'->>'role') = 'team' and key in ('stockM','materials','consumables','journal','meta','catalogM','clients')));
create policy "app_state suppr" on public.app_state for delete to authenticated
  using ((auth.jwt()->'app_metadata'->>'role') is null);
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
