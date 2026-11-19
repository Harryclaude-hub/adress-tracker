-- Eigenes Profil: Jeder angemeldete Zugang kann seinen Anzeigenamen aendern.
-- Namen sind eindeutig (ohne Gross/Kleinschreibung), damit "geaendert von" klar bleibt.
create unique index if not exists zugang_name_eindeutig on tracker.zugang (lower(btrim(name)));

create or replace function public.tr_profil_aendern(p_code text, p_name text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; n text;
begin
  z := tracker._auth(p_code);
  n := btrim(coalesce(p_name, ''));
  if n = '' or length(n) > 100 then
    raise exception 'name_fehlt' using errcode = '22023';
  end if;
  if exists (select 1 from tracker.zugang where lower(btrim(name)) = lower(n) and id <> z.id) then
    raise exception 'name_vergeben' using errcode = '23505';
  end if;
  if n <> z.name then
    update tracker.zugang set name = n where id = z.id;
    update tracker.person set erstellt_von = n where erstellt_von = z.name;
    update tracker.person set geaendert_von = n where geaendert_von = z.name;
    insert into tracker.protokoll (wer, aktion, person_name) values (n, 'profil', z.name || ' -> ' || n);
  end if;
  return jsonb_build_object('name', n);
end $$;

revoke all on function public.tr_profil_aendern(text, text) from public;
grant execute on function public.tr_profil_aendern(text, text) to anon;
