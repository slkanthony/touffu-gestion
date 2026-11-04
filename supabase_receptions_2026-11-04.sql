-- 2026-11-04 : l'équipe (rôle 'team') peut écrire la clé 'receptions' (copie SANS PRIX des commandes à recevoir : page « Réception »).
-- À coller UNE FOIS dans Supabase → SQL Editor → Run. Ne touche à rien d'autre (les achats restent réservés à l'admin).
drop policy if exists "app_state ecriture" on public.app_state;
drop policy if exists "app_state maj" on public.app_state;
create policy "app_state ecriture" on public.app_state for insert to authenticated
  with check ((auth.jwt()->'app_metadata'->>'role') is null
    or ((auth.jwt()->'app_metadata'->>'role') = 'team' and key in ('stockM','materials','consumables','journal','meta','catalogM','clients','baskets','receptions')));
create policy "app_state maj" on public.app_state for update to authenticated
  using ((auth.jwt()->'app_metadata'->>'role') is null
    or ((auth.jwt()->'app_metadata'->>'role') = 'team' and key in ('stockM','materials','consumables','journal','meta','catalogM','clients','baskets','receptions')))
  with check ((auth.jwt()->'app_metadata'->>'role') is null
    or ((auth.jwt()->'app_metadata'->>'role') = 'team' and key in ('stockM','materials','consumables','journal','meta','catalogM','clients','baskets','receptions')));
