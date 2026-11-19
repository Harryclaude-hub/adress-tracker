-- 009: Neue Stufen statt Offen / In Arbeit / Gruen / Problem. 18.11.2026.
-- Leer (kein Auftrag), Zu erledigen, Erledigt, Veraltet. Alle werden nur von Hand gesetzt, nichts automatisch.
-- Bestehende Personen: Offen, In Arbeit und Problem werden Zu erledigen, Gruen wird Erledigt.
-- Die alte Stufe steht je Person in der Spalte status_alt (zum Zurueckrechnen). gruen_am wird nicht mehr benutzt, bleibt aber in der Tabelle.

alter table tracker.person add column if not exists status_alt text;
update tracker.person set status_alt = status where status_alt is null;

alter table tracker.person drop constraint if exists person_status_check;
update tracker.person
   set status = case status when 'gruen' then 'erledigt' else 'zu_erledigen' end
 where status in ('offen', 'in_arbeit', 'problem', 'gruen');
alter table tracker.person alter column status set default 'leer';
alter table tracker.person add constraint person_status_check check (status in ('leer', 'zu_erledigen', 'erledigt', 'veraltet'));

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
  if p ? 'status' and coalesce(p->>'status', '') not in ('leer','zu_erledigen','erledigt','veraltet') then
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

create or replace function tracker._person_neu(p_von text, p jsonb)
returns tracker.person
language plpgsql security definer set search_path = ''
as $$
declare r tracker.person;
begin
  perform tracker._pruefen(p, true);
  insert into tracker.person
    (name, state, nummer, email, adresse, status, abgehakt, zustaendig, notiz, adressnummer, erstellt_von, geaendert_von)
  values
    (coalesce(btrim(p->>'name'), ''), nullif(btrim(p->>'state'), ''), nullif(btrim(p->>'nummer'), ''),
     nullif(btrim(p->>'email'), ''), nullif(btrim(p->>'adresse'), ''), coalesce(p->>'status', 'leer'),
     coalesce((p->>'abgehakt')::boolean, false), nullif(btrim(p->>'zustaendig'), ''),
     nullif(btrim(p->>'notiz'), ''), nullif(btrim(p->>'adressnummer'), ''), p_von, p_von)
  returning * into r;
  if not tracker._hat_inhalt(r) then
    raise exception 'leer' using errcode = '22023';
  end if;
  return r;
end $$;

create or replace function public.tr_person_speichern(p_code text, p_id uuid, p_felder jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; r tracker.person;
begin
  z := tracker._auth(p_code);
  if p_id is null then
    r := tracker._person_neu(z.name, p_felder);
    insert into tracker.protokoll (wer, aktion, person_name) values (z.name, 'neu', tracker._anzeige(r));
    return to_jsonb(r);
  end if;

  select * into r from tracker.person where id = p_id for update;
  if not found then
    raise exception 'nicht_gefunden' using errcode = 'P0002';
  end if;
  perform tracker._pruefen(p_felder, false);

  update tracker.person set
    name = case when p_felder ? 'name' then coalesce(btrim(p_felder->>'name'), '') else name end,
    state = case when p_felder ? 'state' then nullif(btrim(p_felder->>'state'), '') else state end,
    nummer = case when p_felder ? 'nummer' then nullif(btrim(p_felder->>'nummer'), '') else nummer end,
    email = case when p_felder ? 'email' then nullif(btrim(p_felder->>'email'), '') else email end,
    adresse = case when p_felder ? 'adresse' then nullif(btrim(p_felder->>'adresse'), '') else adresse end,
    zustaendig = case when p_felder ? 'zustaendig' then nullif(btrim(p_felder->>'zustaendig'), '') else zustaendig end,
    notiz = case when p_felder ? 'notiz' then nullif(btrim(p_felder->>'notiz'), '') else notiz end,
    adressnummer = case when p_felder ? 'adressnummer' then nullif(btrim(p_felder->>'adressnummer'), '') else adressnummer end,
    abgehakt = case when p_felder ? 'abgehakt' then (p_felder->>'abgehakt')::boolean else abgehakt end,
    status = case when p_felder ? 'status' then p_felder->>'status' else status end,
    geaendert = now(),
    geaendert_von = z.name
  where id = p_id
  returning * into r;

  if not tracker._hat_inhalt(r) then
    raise exception 'leer' using errcode = '22023';
  end if;

  insert into tracker.protokoll (wer, aktion, person_name, felder)
  values (z.name, 'aendern', tracker._anzeige(r), array(select jsonb_object_keys(p_felder)));
  return to_jsonb(r);
end $$;

revoke all on all functions in schema tracker from public, anon, authenticated;
revoke all on function public.tr_person_speichern(text, uuid, jsonb) from public;
grant execute on function public.tr_person_speichern(text, uuid, jsonb) to anon;
