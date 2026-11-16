-- 2026-11-16 (audit A1, chantier 4 étape 1) — DÉJÀ APPLIQUÉ via le connecteur Supabase. Gardé ici pour mémoire.
-- Numéro de version par clé de app_state + enregistrement « tout ou rien » qui refuse d'écraser une version plus récente.
-- Ajout seul : aucune donnée modifiée ; un ancien navigateur (enregistrement direct) continue de fonctionner et fait avancer le numéro.

alter table public.app_state add column if not exists rev bigint not null default 1;

-- Le numéro avance tout seul à chaque écriture, d'où qu'elle vienne (le client ne peut pas le choisir).
create or replace function public.app_state_bump_rev() returns trigger language plpgsql as $fn$
begin
  if tg_op = 'UPDATE' then new.rev := old.rev + 1; else new.rev := 1; end if;
  return new;
end $fn$;
drop trigger if exists app_state_rev on public.app_state;
create trigger app_state_rev before insert or update on public.app_state for each row execute function public.app_state_bump_rev();

-- Enregistre plusieurs clés d'un coup : p_items = [{ "key": "...", "data": ..., "rev": n | null }]
--   rev = numéro que le navigateur avait chargé (0 = « cette clé n'existait pas ») ; null = pas de contrôle (copies dérivées : journalAdmin, v_…).
-- Si UNE clé a changé entre-temps → RIEN n'est écrit : { ok:false, conflicts:[clés] }.
-- Sinon tout est écrit dans la même transaction : { ok:true, revs:{clé:numéro}, denied:[clés refusées par les droits] }.
-- SECURITY INVOKER : les règles RLS du profil s'appliquent normalement.
create or replace function public.app_state_put_many(p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $fn$
declare it jsonb; k text; r bigint; cur bigint; conflicts text[] := '{}'; denied text[] := '{}'; revs jsonb := '{}'::jsonb;
begin
  for it in select * from jsonb_array_elements(p_items) loop
    k := it->>'key';
    if it->'rev' is null or jsonb_typeof(it->'rev') = 'null' then continue; end if;
    cur := null;
    select a.rev into cur from public.app_state a where a.key = k for update;
    if cur is not null and cur <> (it->>'rev')::bigint then conflicts := conflicts || k; end if;
  end loop;
  if coalesce(array_length(conflicts, 1), 0) > 0 then
    return jsonb_build_object('ok', false, 'conflicts', to_jsonb(conflicts));
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    k := it->>'key';
    begin
      insert into public.app_state(key, data, updated_at) values (k, it->'data', now())
        on conflict (key) do update set data = excluded.data, updated_at = now()
        returning rev into r;
      revs := revs || jsonb_build_object(k, r);
    exception when insufficient_privilege then denied := denied || k;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'revs', revs, 'denied', to_jsonb(denied));
end $fn$;
revoke all on function public.app_state_put_many(jsonb) from public, anon;
grant execute on function public.app_state_put_many(jsonb) to authenticated;
