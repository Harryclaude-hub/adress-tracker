-- 011: Dateien je Person, Wert je Person und gemeinsame Einstellungen. 19.11.2026.
--  * tracker.datei: Fotos und Dateien an einer Person (in der Datenbank, nur ueber die Funktionen unten erreichbar).
--  * person.wert: Betrag in Euro je Person. leer (null) = es gilt der Standardwert.
--  * tracker.konfig: Standardwert (Start 40) und "zaehlt ab" (Start: Uebernommen = interner Schluessel 'veraltet'). Fuer alle gleich.
--  * person.zaehlt: "Dazurechnen" ersetzt "Abgehakt". Nur angehakte Personen bekommen ihren Wert, und nur ab der eingestellten Stufe.
--    Alle bestehenden Personen starten NICHT angehakt. Die alte Spalte abgehakt bleibt ungenutzt in der Tabelle.
-- Grenzen: 5 MB je Datei, 20 Dateien je Person, 300 MB insgesamt (Free-Tarif der Datenbank hat 500 MB).

-- ---------------------------------------------------------------- Tabellen
alter table tracker.person add column if not exists zaehlt boolean not null default false;
alter table tracker.person add column if not exists wert numeric(10,2) check (wert is null or (wert >= 0 and wert <= 100000));

create table if not exists tracker.konfig (
  schluessel text primary key,
  wert text not null
);
alter table tracker.konfig enable row level security;
insert into tracker.konfig (schluessel, wert) values ('standardwert', '40'), ('zaehlt_ab', 'veraltet')
  on conflict (schluessel) do nothing;

create table if not exists tracker.datei (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references tracker.person(id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  typ text not null check (length(typ) <= 100),
  groesse integer not null check (groesse > 0 and groesse <= 5242880),
  daten bytea not null,
  vorschau text check (vorschau is null or (length(vorschau) <= 40000 and vorschau ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$')),
  erstellt timestamptz not null default now(),
  erstellt_von text,
  zugang_id uuid
);
create index if not exists datei_person_idx on tracker.datei (person_id);
alter table tracker.datei enable row level security;

-- ---------------------------------------------------------------- Helfer
create or replace function tracker._konfig()
returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'standardwert', coalesce((select wert::numeric from tracker.konfig where schluessel = 'standardwert'), 40),
    'zaehlt_ab', coalesce((select wert from tracker.konfig where schluessel = 'zaehlt_ab'), 'veraltet'))
$$;

-- Eine Person als JSON, mit Anzahl der Dateien, ohne interne Altspalten.
create or replace function tracker._person_json(r tracker.person)
returns jsonb
language sql stable set search_path = ''
as $$
  select (to_jsonb(r) - 'status_alt' - 'gruen_am' - 'abgehakt')
         || jsonb_build_object('dateien', (select count(*)::int from tracker.datei d where d.person_id = r.id))
$$;

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
    if k not in ('name','state','nummer','email','adresse','status','gruen_am','abgehakt','zustaendig','notiz','adressnummer','wert','zaehlt') then
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
  if p ? 'zaehlt' and jsonb_typeof(p->'zaehlt') <> 'boolean' then
    raise exception 'zaehlt_ungueltig' using errcode = '22023';
  end if;
  if p ? 'wert' and jsonb_typeof(p->'wert') <> 'null' then
    if jsonb_typeof(p->'wert') <> 'number' then
      raise exception 'wert_ungueltig' using errcode = '22023';
    end if;
    if (p->>'wert')::numeric < 0 or (p->>'wert')::numeric > 100000 then
      raise exception 'wert_ungueltig' using errcode = '22023';
    end if;
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
    (name, state, nummer, email, adresse, status, zaehlt, zustaendig, notiz, adressnummer, wert, erstellt_von, geaendert_von)
  values
    (coalesce(btrim(p->>'name'), ''), nullif(btrim(p->>'state'), ''), nullif(btrim(p->>'nummer'), ''),
     nullif(btrim(p->>'email'), ''), nullif(btrim(p->>'adresse'), ''), coalesce(p->>'status', 'leer'),
     coalesce((p->>'zaehlt')::boolean, false), nullif(btrim(p->>'zustaendig'), ''),
     nullif(btrim(p->>'notiz'), ''), nullif(btrim(p->>'adressnummer'), ''),
     case when jsonb_typeof(p->'wert') = 'number' then round((p->>'wert')::numeric, 2) end, p_von, p_von)
  returning * into r;
  if not tracker._hat_inhalt(r) then
    raise exception 'leer' using errcode = '22023';
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------- Personen
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
    return tracker._person_json(r);
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
    wert = case when p_felder ? 'wert' then (case when jsonb_typeof(p_felder->'wert') = 'number' then round((p_felder->>'wert')::numeric, 2) end) else wert end,
    zaehlt = case when p_felder ? 'zaehlt' then (p_felder->>'zaehlt')::boolean else zaehlt end,
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
  return tracker._person_json(r);
end $$;

create or replace function public.tr_laden(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang;
begin
  z := tracker._auth(p_code);
  return jsonb_build_object(
    'ich', jsonb_build_object('id', z.id, 'name', z.name, 'rolle', z.rolle),
    'personen', coalesce((select jsonb_agg(tracker._person_json(p) order by p.erstellt desc, p.id) from tracker.person p), '[]'::jsonb),
    'einstellungen', tracker._konfig(),
    'stand', now());
end $$;

-- ---------------------------------------------------------------- Einstellungen (fuer alle gleich, jeder darf aendern)
create or replace function public.tr_einstellungen_setzen(p_code text, p_standardwert numeric, p_zaehlt_ab text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang;
begin
  z := tracker._auth(p_code);
  if p_standardwert is null or p_standardwert < 0 or p_standardwert > 100000 then
    raise exception 'wert_ungueltig' using errcode = '22023';
  end if;
  if p_zaehlt_ab is null or p_zaehlt_ab not in ('zu_erledigen', 'erledigt', 'veraltet') then
    raise exception 'zaehlt_ab_ungueltig' using errcode = '22023';
  end if;
  insert into tracker.konfig (schluessel, wert) values ('standardwert', round(p_standardwert, 2)::text), ('zaehlt_ab', p_zaehlt_ab)
    on conflict (schluessel) do update set wert = excluded.wert;
  insert into tracker.protokoll (wer, aktion, felder) values (z.name, 'einstellung', array['standardwert', 'zaehlt_ab']);
  return tracker._konfig();
end $$;

-- ---------------------------------------------------------------- Dateien
create or replace function public.tr_dateien(p_code text, p_person uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform tracker._auth(p_code);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'typ', d.typ, 'groesse', d.groesse,
                                        'vorschau', d.vorschau, 'erstellt', d.erstellt, 'erstellt_von', d.erstellt_von)
                     order by d.erstellt, d.id)
    from tracker.datei d where d.person_id = p_person), '[]'::jsonb);
end $$;

create or replace function public.tr_datei_neu(p_code text, p_person uuid, p_name text, p_typ text, p_daten text, p_vorschau text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; r tracker.person; bin bytea; n text; t text; did uuid; summe bigint;
begin
  z := tracker._auth(p_code);
  if p_daten is null or length(p_daten) = 0 or length(p_daten) > 7200000 then
    raise exception 'datei_zu_gross' using errcode = '22023';
  end if;
  begin
    bin := decode(p_daten, 'base64');
  exception when others then
    raise exception 'datei_ungueltig' using errcode = '22023';
  end;
  if octet_length(bin) = 0 then
    raise exception 'datei_ungueltig' using errcode = '22023';
  end if;
  if octet_length(bin) > 5242880 then
    raise exception 'datei_zu_gross' using errcode = '22023';
  end if;
  select * into r from tracker.person where id = p_person for update;
  if not found then
    raise exception 'nicht_gefunden' using errcode = 'P0002';
  end if;
  if (select count(*) from tracker.datei where person_id = p_person) >= 20 then
    raise exception 'zu_viele_dateien' using errcode = '22023';
  end if;
  select coalesce(sum(groesse), 0) into summe from tracker.datei;
  if summe + octet_length(bin) > 314572800 then
    raise exception 'speicher_voll' using errcode = '22023';
  end if;
  n := left(btrim(regexp_replace(coalesce(p_name, ''), '[\\/:*?"<>|[:cntrl:]]', '_', 'g')), 200);
  if n = '' then n := 'Datei'; end if;
  t := lower(btrim(coalesce(p_typ, '')));
  if length(t) > 100 or t !~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$' then
    t := 'application/octet-stream';
  end if;
  if p_vorschau is not null and (length(p_vorschau) > 40000 or p_vorschau !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$') then
    p_vorschau := null;
  end if;
  insert into tracker.datei (person_id, name, typ, groesse, daten, vorschau, erstellt_von, zugang_id)
  values (p_person, n, t, octet_length(bin), bin, p_vorschau, z.name, z.id)
  returning id into did;
  insert into tracker.protokoll (wer, aktion, person_name) values (z.name, 'datei_neu', tracker._anzeige(r));
  return jsonb_build_object('id', did, 'name', n, 'typ', t, 'groesse', octet_length(bin), 'vorschau', p_vorschau,
                            'erstellt', now(), 'erstellt_von', z.name);
end $$;

create or replace function public.tr_datei_holen(p_code text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare d tracker.datei;
begin
  perform tracker._auth(p_code);
  select * into d from tracker.datei where id = p_id;
  if not found then
    raise exception 'nicht_gefunden' using errcode = 'P0002';
  end if;
  return jsonb_build_object('name', d.name, 'typ', d.typ, 'daten', encode(d.daten, 'base64'));
end $$;

-- Loeschen darf, wer die Datei hochgeladen hat, oder ein Admin.
create or replace function public.tr_datei_loeschen(p_code text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; d tracker.datei; r tracker.person;
begin
  z := tracker._auth(p_code);
  select * into d from tracker.datei where id = p_id;
  if not found then
    return jsonb_build_object('geloescht', false);
  end if;
  if z.rolle <> 'admin' and d.zugang_id is distinct from z.id then
    raise exception 'nur_admin' using errcode = '42501';
  end if;
  delete from tracker.datei where id = p_id;
  select * into r from tracker.person where id = d.person_id;
  insert into tracker.protokoll (wer, aktion, person_name) values (z.name, 'datei_weg', tracker._anzeige(r));
  return jsonb_build_object('geloescht', true);
end $$;

-- ---------------------------------------------------------------- Rechte
revoke all on all functions in schema tracker from public, anon, authenticated;
revoke all on function public.tr_person_speichern(text, uuid, jsonb) from public;
revoke all on function public.tr_laden(text) from public;
revoke all on function public.tr_einstellungen_setzen(text, numeric, text) from public;
revoke all on function public.tr_dateien(text, uuid) from public;
revoke all on function public.tr_datei_neu(text, uuid, text, text, text, text) from public;
revoke all on function public.tr_datei_holen(text, uuid) from public;
revoke all on function public.tr_datei_loeschen(text, uuid) from public;
grant execute on function public.tr_person_speichern(text, uuid, jsonb) to anon;
grant execute on function public.tr_laden(text) to anon;
grant execute on function public.tr_einstellungen_setzen(text, numeric, text) to anon;
grant execute on function public.tr_dateien(text, uuid) to anon;
grant execute on function public.tr_datei_neu(text, uuid, text, text, text, text) to anon;
grant execute on function public.tr_datei_holen(text, uuid) to anon;
grant execute on function public.tr_datei_loeschen(text, uuid) to anon;
