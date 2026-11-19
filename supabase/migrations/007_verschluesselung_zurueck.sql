-- 007: Verschluesselung (Migration 006) rueckgaengig machen. 09.11.2026.
-- Stellt die Funktionen aus 001 bis 005 wieder her (Klartext, Server erzeugt Schluessel) und entfernt die Spalten von 006.
-- Sicherheitsgurt: bricht ab, wenn schon etwas verschluesselt wurde (dann wuerde Datenverlust drohen).

do $$
begin
  if exists (select 1 from tracker.person where daten is not null or name is null)
     or exists (select 1 from tracker.zugang where huelle is not null)
     or exists (select 1 from tracker.protokoll where detail is not null) then
    raise exception 'schon_verschluesselt: Rueckbau wuerde Daten zerstoeren';
  end if;
end $$;

drop function if exists public.tr_umstellen(text, text, text);
drop function if exists public.tr_einrichten(text, text, text, text);
drop function if exists public.tr_person_speichern(text, uuid, text, int, text);
drop function if exists public.tr_person_loeschen(text, uuid, text);
drop function if exists public.tr_import(text, jsonb);
drop function if exists public.tr_zugang_anlegen(text, text, text, text, text);
drop function if exists public.tr_zugang_aendern(text, uuid, text, text, text);
drop function if exists tracker._blob_pruefen(text);
drop function if exists tracker._token_pruefen(text);

-- Neue Spalte "adressnummer": eine frei vergebene Nummer je Person (Text, bis 40 Zeichen), durchsuchbar.
alter table tracker.person add column if not exists adressnummer text;

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
  if (p_neu or p ? 'name') and coalesce(btrim(p->>'name'), '') = '' then
    raise exception 'name_fehlt' using errcode = '22023';
  end if;
  if p ? 'status' and coalesce(p->>'status', '') not in ('offen','in_arbeit','gruen','problem') then
    raise exception 'status_ungueltig' using errcode = '22023';
  end if;
  if length(p->>'name') > 200 or length(p->>'state') > 40 or length(p->>'nummer') > 60
     or length(p->>'email') > 254 or length(p->>'adresse') > 500
     or length(p->>'zustaendig') > 100 or length(p->>'notiz') > 2000
     or length(p->>'adressnummer') > 40 then
    raise exception 'zu_lang' using errcode = '22023';
  end if;
  if p ? 'gruen_am' and nullif(p->>'gruen_am', '') is not null
     and (p->>'gruen_am') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'datum_ungueltig' using errcode = '22023';
  end if;
  if p ? 'abgehakt' and jsonb_typeof(p->'abgehakt') <> 'boolean' then
    raise exception 'abgehakt_ungueltig' using errcode = '22023';
  end if;
end $$;

create or replace function tracker._person_neu(p_von text, p jsonb)
returns tracker.person
language plpgsql security definer set search_path = ''
as $$
declare r tracker.person; st text; gd date;
begin
  perform tracker._pruefen(p, true);
  st := coalesce(p->>'status', 'offen');
  gd := nullif(p->>'gruen_am', '')::date;
  if st = 'gruen' and gd is null then gd := current_date; end if;
  if st <> 'gruen' then gd := null; end if;
  insert into tracker.person
    (name, state, nummer, email, adresse, status, gruen_am, abgehakt, zustaendig, notiz, adressnummer, erstellt_von, geaendert_von)
  values
    (btrim(p->>'name'), nullif(btrim(p->>'state'), ''), nullif(btrim(p->>'nummer'), ''),
     nullif(btrim(p->>'email'), ''), nullif(btrim(p->>'adresse'), ''), st, gd,
     coalesce((p->>'abgehakt')::boolean, false), nullif(btrim(p->>'zustaendig'), ''),
     nullif(btrim(p->>'notiz'), ''), nullif(btrim(p->>'adressnummer'), ''), p_von, p_von)
  returning * into r;
  return r;
end $$;

create or replace function public.tr_person_speichern(p_code text, p_id uuid, p_felder jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; r tracker.person; st text; gd date;
begin
  z := tracker._auth(p_code);
  if p_id is null then
    r := tracker._person_neu(z.name, p_felder);
    insert into tracker.protokoll (wer, aktion, person_name) values (z.name, 'neu', r.name);
    return to_jsonb(r);
  end if;

  select * into r from tracker.person where id = p_id for update;
  if not found then
    raise exception 'nicht_gefunden' using errcode = 'P0002';
  end if;
  perform tracker._pruefen(p_felder, false);

  st := case when p_felder ? 'status' then p_felder->>'status' else r.status end;
  gd := case when p_felder ? 'gruen_am' then nullif(p_felder->>'gruen_am', '')::date else r.gruen_am end;
  if st = 'gruen' and gd is null then gd := current_date; end if;
  if st <> 'gruen' then gd := null; end if;

  update tracker.person set
    name = case when p_felder ? 'name' then btrim(p_felder->>'name') else name end,
    state = case when p_felder ? 'state' then nullif(btrim(p_felder->>'state'), '') else state end,
    nummer = case when p_felder ? 'nummer' then nullif(btrim(p_felder->>'nummer'), '') else nummer end,
    email = case when p_felder ? 'email' then nullif(btrim(p_felder->>'email'), '') else email end,
    adresse = case when p_felder ? 'adresse' then nullif(btrim(p_felder->>'adresse'), '') else adresse end,
    zustaendig = case when p_felder ? 'zustaendig' then nullif(btrim(p_felder->>'zustaendig'), '') else zustaendig end,
    notiz = case when p_felder ? 'notiz' then nullif(btrim(p_felder->>'notiz'), '') else notiz end,
    adressnummer = case when p_felder ? 'adressnummer' then nullif(btrim(p_felder->>'adressnummer'), '') else adressnummer end,
    abgehakt = case when p_felder ? 'abgehakt' then (p_felder->>'abgehakt')::boolean else abgehakt end,
    status = st,
    gruen_am = gd,
    geaendert = now(),
    geaendert_von = z.name
  where id = p_id
  returning * into r;

  insert into tracker.protokoll (wer, aktion, person_name, felder)
  values (z.name, 'aendern', r.name, array(select jsonb_object_keys(p_felder)));
  return to_jsonb(r);
end $$;

create or replace function public.tr_einrichten(p_setup text, p_name text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare h bytea; code text;
begin
  perform pg_advisory_xact_lock(7311001);
  if exists (select 1 from tracker.zugang where rolle = 'admin') then
    raise exception 'schon_eingerichtet' using errcode = '42501';
  end if;
  select wert into h from tracker.einstellung where schluessel = 'setup_hash';
  if h is null or p_setup is null or length(btrim(p_setup)) < 16
     or extensions.digest(btrim(p_setup), 'sha256') <> h then
    raise exception 'setup_ungueltig' using errcode = '28000';
  end if;
  if coalesce(btrim(p_name), '') = '' or length(p_name) > 100 then
    raise exception 'name_fehlt' using errcode = '22023';
  end if;
  code := 'ak_' || encode(extensions.gen_random_bytes(20), 'hex');
  insert into tracker.zugang (name, rolle, code_hash)
  values (btrim(p_name), 'admin', extensions.digest(code, 'sha256'));
  delete from tracker.einstellung where schluessel = 'setup_hash';
  insert into tracker.protokoll (wer, aktion) values (btrim(p_name), 'einrichten');
  return jsonb_build_object('code', code, 'name', btrim(p_name));
end $$;

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

create or replace function public.tr_person_loeschen(p_code text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; r tracker.person;
begin
  z := tracker._auth(p_code, true);
  delete from tracker.person where id = p_id returning * into r;
  if found then
    insert into tracker.protokoll (wer, aktion, person_name) values (z.name, 'loeschen', r.name);
  end if;
  return jsonb_build_object('geloescht', found);
end $$;

-- Liste einspielen (nur Admin). Zeilen sind Objekte mit denselben Feldern wie oben.
create or replace function public.tr_import(p_code text, p_zeilen jsonb, p_doppelte_ueberspringen boolean default true)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; j jsonb; neu int := 0; uebersprungen int := 0;
begin
  z := tracker._auth(p_code, true);
  if p_zeilen is null or jsonb_typeof(p_zeilen) <> 'array' then
    raise exception 'ungueltig' using errcode = '22023';
  end if;
  if jsonb_array_length(p_zeilen) > 1000 then
    raise exception 'zu_viele_zeilen' using errcode = '22023';
  end if;
  for j in select value from jsonb_array_elements(p_zeilen) loop
    if p_doppelte_ueberspringen and jsonb_typeof(j) = 'object'
       and exists (select 1 from tracker.person where lower(name) = lower(btrim(j->>'name'))) then
      uebersprungen := uebersprungen + 1;
    else
      perform tracker._person_neu(z.name, j);
      neu := neu + 1;
    end if;
  end loop;
  insert into tracker.protokoll (wer, aktion, person_name) values (z.name, 'import', neu || ' Personen');
  return jsonb_build_object('neu', neu, 'uebersprungen', uebersprungen);
end $$;

create or replace function public.tr_zugaenge(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform tracker._auth(p_code, true);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'rolle', rolle, 'erstellt', erstellt,
      'zuletzt_gesehen', zuletzt_gesehen, 'gesperrt', gesperrt) order by erstellt)
    from tracker.zugang), '[]'::jsonb);
end $$;

create or replace function public.tr_zugang_anlegen(p_code text, p_name text, p_rolle text default 'mitarbeiter')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; code text; zid uuid;
begin
  z := tracker._auth(p_code, true);
  if coalesce(btrim(p_name), '') = '' or length(p_name) > 100 then
    raise exception 'name_fehlt' using errcode = '22023';
  end if;
  if p_rolle not in ('admin', 'mitarbeiter') then
    raise exception 'rolle_ungueltig' using errcode = '22023';
  end if;
  code := 'ak_' || encode(extensions.gen_random_bytes(20), 'hex');
  insert into tracker.zugang (name, rolle, code_hash)
  values (btrim(p_name), p_rolle, extensions.digest(code, 'sha256'))
  returning id into zid;
  insert into tracker.protokoll (wer, aktion, person_name) values (z.name, 'zugang_neu', btrim(p_name));
  return jsonb_build_object('id', zid, 'name', btrim(p_name), 'code', code);
end $$;

-- p_aktion: 'sperren' | 'entsperren' | 'neuer_code'
create or replace function public.tr_zugang_aendern(p_code text, p_id uuid, p_aktion text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; t tracker.zugang; code text;
begin
  z := tracker._auth(p_code, true);
  select * into t from tracker.zugang where id = p_id for update;
  if not found then
    raise exception 'nicht_gefunden' using errcode = 'P0002';
  end if;
  if p_aktion = 'sperren' then
    if t.id = z.id then
      raise exception 'sich_selbst_nicht' using errcode = '42501';
    end if;
    update tracker.zugang set gesperrt = true where id = t.id;
    insert into tracker.protokoll (wer, aktion, person_name) values (z.name, 'zugang_gesperrt', t.name);
    return jsonb_build_object('ok', true);
  elsif p_aktion = 'entsperren' then
    update tracker.zugang set gesperrt = false where id = t.id;
    insert into tracker.protokoll (wer, aktion, person_name) values (z.name, 'zugang_entsperrt', t.name);
    return jsonb_build_object('ok', true);
  elsif p_aktion = 'neuer_code' then
    code := 'ak_' || encode(extensions.gen_random_bytes(20), 'hex');
    update tracker.zugang set code_hash = extensions.digest(code, 'sha256'), gesperrt = false where id = t.id;
    insert into tracker.protokoll (wer, aktion, person_name) values (z.name, 'zugang_neuer_code', t.name);
    return jsonb_build_object('ok', true, 'code', code);
  end if;
  raise exception 'aktion_ungueltig' using errcode = '22023';
end $$;

create or replace function public.tr_protokoll(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform tracker._auth(p_code, true);
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.id desc)
    from (select id, zeit, wer, aktion, person_name, felder from tracker.protokoll order by id desc limit 200) x
  ), '[]'::jsonb);
end $$;

revoke all on all functions in schema tracker from public, anon, authenticated;

revoke all on function public.tr_status() from public;
revoke all on function public.tr_einrichten(text, text) from public;
revoke all on function public.tr_laden(text) from public;
revoke all on function public.tr_person_speichern(text, uuid, jsonb) from public;
revoke all on function public.tr_person_loeschen(text, uuid) from public;
revoke all on function public.tr_import(text, jsonb, boolean) from public;
revoke all on function public.tr_zugaenge(text) from public;
revoke all on function public.tr_zugang_anlegen(text, text, text) from public;
revoke all on function public.tr_zugang_aendern(text, uuid, text) from public;
revoke all on function public.tr_protokoll(text) from public;

grant execute on function public.tr_status() to anon;
grant execute on function public.tr_einrichten(text, text) to anon;
grant execute on function public.tr_laden(text) to anon;
grant execute on function public.tr_person_speichern(text, uuid, jsonb) to anon;
grant execute on function public.tr_person_loeschen(text, uuid) to anon;
grant execute on function public.tr_import(text, jsonb, boolean) to anon;
grant execute on function public.tr_zugaenge(text) to anon;
grant execute on function public.tr_zugang_anlegen(text, text, text) to anon;
grant execute on function public.tr_zugang_aendern(text, uuid, text) to anon;
grant execute on function public.tr_protokoll(text) to anon;

alter table tracker.person alter column name set not null;
alter table tracker.person drop column if exists daten;
alter table tracker.person drop column if exists version;
alter table tracker.zugang drop column if exists huelle;
alter table tracker.protokoll drop column if exists detail;
