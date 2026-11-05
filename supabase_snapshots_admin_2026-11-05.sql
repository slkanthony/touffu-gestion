-- 2026-11-05 (audit sécurité) : les sauvegardes quotidiennes (table snapshots) contiennent TOUT, achats et pointage bancaire compris.
-- Jusqu'ici l'équipe pouvait les lire (et donc contourner l'interdiction de lire les achats). Désormais : admin (aucun rôle) seulement.
drop policy if exists "snapshots lecture" on public.snapshots;
drop policy if exists "snapshots ecriture" on public.snapshots;
drop policy if exists "snapshots écriture" on public.snapshots;
drop policy if exists "snapshots maj" on public.snapshots;
drop policy if exists "snapshots suppr" on public.snapshots;
drop policy if exists "snapshots admin" on public.snapshots;
create policy "snapshots admin" on public.snapshots
  for all to authenticated
  using (coalesce(auth.jwt()->'app_metadata'->>'role', 'admin') = 'admin')
  with check (coalesce(auth.jwt()->'app_metadata'->>'role', 'admin') = 'admin');
