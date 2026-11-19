-- 010: Fuenfte Stufe "Test". 18.11.2026.
-- Stufen jetzt: leer, zu_erledigen, erledigt, veraltet, test. Bestehende Personen bleiben unveraendert.

alter table tracker.person drop constraint if exists person_status_check;
alter table tracker.person add constraint person_status_check check (status in ('leer', 'zu_erledigen', 'erledigt', 'veraltet', 'test'));

create or replace function tracker._pruefen(p jsonb, p_neu boolean)
returns void
language plpgsql set search_path = ''
as $$
declare k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'ungueltig' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('name','state','nummer','email','adresse','status','gruen_am','abgehakt','zustaendig','notiz','adressnummer') then
      raise exception 'unbekanntes_feld' using errcode = '22023';
    end if;
  end loop;
  if p ? 'status' and coalesce(p->>'status', '') not in ('leer','zu_erledigen','erledigt','veraltet','test') then
    raise exception 'status_ungueltig' using errcode = '22023';
  end if;
  if length(p->>'name') > 200 or length(p->>'state') > 40 or length(p->>'nummer') > 60
     or length(p->>'email') > 254 or length(p->>'adresse') > 500
     or length(p->>'zustaendig') > 100 or length(p->>'notiz') > 2000
     or length(p->>'adressnummer') > 40 then
    raise exception 'zu_lang' using errcode = '22023';
  end if;
  if p ? 'abgehakt' and jsonb_typeof(p->'abgehakt') <> 'boolean' then
    raise exception 'abgehakt_ungueltig' using errcode = '22023';
  end if;
end $$;

revoke all on all functions in schema tracker from public, anon, authenticated;
