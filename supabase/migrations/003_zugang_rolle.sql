-- Admins koennen die Rolle eines Zugangs aendern (Admin <-> Mitarbeiter).
-- Der letzte aktive Admin kann nicht herabgestuft werden.
create or replace function public.tr_zugang_rolle(p_code text, p_id uuid, p_rolle text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; t tracker.zugang;
begin
  z := tracker._auth(p_code, true);
  if p_rolle not in ('admin', 'mitarbeiter') then
    raise exception 'rolle_ungueltig' using errcode = '22023';
  end if;
  select * into t from tracker.zugang where id = p_id for update;
  if not found then
    raise exception 'nicht_gefunden' using errcode = 'P0002';
  end if;
  if t.rolle = 'admin' and p_rolle = 'mitarbeiter'
     and not exists (select 1 from tracker.zugang where rolle = 'admin' and not gesperrt and id <> t.id) then
    raise exception 'letzter_admin' using errcode = '42501';
  end if;
  update tracker.zugang set rolle = p_rolle where id = t.id;
  insert into tracker.protokoll (wer, aktion, person_name)
  values (z.name, case when p_rolle = 'admin' then 'zugang_admin' else 'zugang_mitarbeiter' end, t.name);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.tr_zugang_rolle(text, uuid, text) from public;
grant execute on function public.tr_zugang_rolle(text, uuid, text) to anon;
