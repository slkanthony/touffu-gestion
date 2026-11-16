-- 2026-11-16 (audit sécurité, chantier 2) — DÉJÀ APPLIQUÉ via le connecteur Supabase. Gardé ici pour mémoire.
-- 1) Coffre du journal : la clé 'journalAdmin' (copies « Annuler » des achats et du pointage bancaire) est réservée à l'admin.
--    L'équipe ne la lit pas (et ne l'écrit pas : elle n'est pas dans sa liste d'écriture) ; le profil visite ne la reçoit pas.
-- 2) Rôle admin explicite, ÉTAPE 1 : les règles d'écriture acceptent maintenant le rôle 'admin' EN PLUS de « aucun rôle ».
--    (Étape 2, plus tard, une fois le compte d'Antho marqué 'admin' : ne plus accepter « aucun rôle ».)

drop policy if exists "app_state lecture" on public.app_state;
create policy "app_state lecture" on public.app_state
  for select to authenticated using (
    coalesce(auth.jwt()->'app_metadata'->>'role', 'admin') = 'admin'
    or (coalesce(auth.jwt()->'app_metadata'->>'role', 'admin') = 'team' and key not in ('purchases', 'bank', 'journalAdmin')));

create or replace function public.app_state_safe()
returns table(key text, data jsonb)
language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role', 'admin') = 'admin' then
    return query select a.key, a.data from public.app_state a;
  elsif (auth.jwt()->'app_metadata'->>'role') = 'team' then
    return query select a.key, a.data from public.app_state a where a.key not in ('purchases', 'bank', 'journalAdmin');
  else
    return query
      select a.key,
        case when a.key = 'sales' and jsonb_typeof(a.data) = 'array'
             then (select coalesce(jsonb_agg(e - 'customerName'), '[]'::jsonb) from jsonb_array_elements(a.data) e)
             else a.data end
      from public.app_state a
      where a.key not in ('clients', 'journal', 'journalAdmin', 'baskets', 'purchases', 'receptions', 'bank');
  end if;
end $fn$;
revoke all on function public.app_state_safe() from public, anon;
grant execute on function public.app_state_safe() to authenticated;

drop policy if exists "app_state ecriture" on public.app_state;
drop policy if exists "app_state maj" on public.app_state;
drop policy if exists "app_state suppr" on public.app_state;
create policy "app_state ecriture" on public.app_state for insert to authenticated
  with check (coalesce(auth.jwt()->'app_metadata'->>'role', 'admin') = 'admin'
    or ((auth.jwt()->'app_metadata'->>'role') = 'team' and key in ('stockM','materials','consumables','journal','meta','catalogM','clients','baskets','receptions')));
create policy "app_state maj" on public.app_state for update to authenticated
  using (coalesce(auth.jwt()->'app_metadata'->>'role', 'admin') = 'admin'
    or ((auth.jwt()->'app_metadata'->>'role') = 'team' and key in ('stockM','materials','consumables','journal','meta','catalogM','clients','baskets','receptions')))
  with check (coalesce(auth.jwt()->'app_metadata'->>'role', 'admin') = 'admin'
    or ((auth.jwt()->'app_metadata'->>'role') = 'team' and key in ('stockM','materials','consumables','journal','meta','catalogM','clients','baskets','receptions')));
create policy "app_state suppr" on public.app_state for delete to authenticated
  using (coalesce(auth.jwt()->'app_metadata'->>'role', 'admin') = 'admin');

drop policy if exists "connexions lecture admin" on public.connexions;
create policy "connexions lecture admin" on public.connexions
  for select to authenticated
  using (coalesce(auth.jwt()->'app_metadata'->>'role', 'admin') = 'admin');
