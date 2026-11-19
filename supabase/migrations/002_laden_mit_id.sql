-- tr_laden liefert zusaetzlich die eigene Zugangs-ID, damit die Seite beim Erneuern des eigenen Schluessels
-- den gespeicherten Schluessel mitwechseln kann.
create or replace function public.tr_laden(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang;
begin
  z := tracker._auth(p_code);
  return jsonb_build_object(
    'ich', jsonb_build_object('id', z.id, 'name', z.name, 'rolle', z.rolle),
    'personen', coalesce((select jsonb_agg(to_jsonb(p) order by p.erstellt desc, p.id) from tracker.person p), '[]'::jsonb),
    'stand', now());
end $$;
