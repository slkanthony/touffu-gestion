-- 2026-11-05 (audit sécurité) : retire les droits inutiles (déjà appliqué via le connecteur Supabase).
-- Les visiteurs sans compte n'ont aucun droit ; les connectés gardent seulement lire / ajouter / modifier / supprimer (règles RLS par-dessus).
revoke all on public.app_state, public.snapshots, public.connexions from anon;
revoke truncate, references, trigger on public.app_state, public.snapshots, public.connexions from authenticated;
