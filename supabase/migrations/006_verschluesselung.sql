-- 006: Ende-zu-Ende-Verschluesselung.
--
-- Ab jetzt verlassen Personendaten den Browser nur noch verschluesselt (AES-GCM, krypto.js).
-- Der Server speichert je Person einen undurchsichtigen Text ("daten") und kann ihn nicht lesen.
-- Den Zugangsschluessel kennt der Server nie: er bekommt nur einen abgeleiteten Anmelde-Wert (auth),
-- und je Zugang den Datenschluessel in verpackter Form ("huelle"), die nur der Zugangsschluessel oeffnet.
--
-- Klartext-Spalten (name, email, ...) bleiben in dieser Migration noch stehen, damit bestehende Eintraege
-- vom Browser des Admins umgewandelt werden koennen. Sie werden erst in 007 geleert, nachdem das geklappt hat.

-- ---------------------------------------------------------------- Spalten
alter table tracker.zugang   add column if not exists huelle text;
alter table tracker.person   add column if not exists daten text;
alter table tracker.person   add column if not exists version int not null default 1;
alter table tracker.person   alter column name drop not null;
alter table tracker.protokoll add column if not exists detail text;

-- ---------------------------------------------------------------- alte Funktionen mit Klartext entfernen
drop function if exists public.tr_person_speichern(text, uuid, jsonb);
drop function if exists public.tr_person_loeschen(text, uuid);
drop function if exists public.tr_import(text, jsonb, boolean);
drop function if exists public.tr_zugang_anlegen(text, text, text);
drop function if exists public.tr_zugang_aendern(text, uuid, text);
drop function if exists public.tr_einrichten(text, text);
drop function if exists tracker._person_neu(text, jsonb);
drop function if exists tracker._pruefen(jsonb, boolean);

-- ---------------------------------------------------------------- Pruefhelfer
create or replace function tracker._blob_pruefen(b text)
returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if b is null or length(b) < 20 or length(b) > 40000 or b !~ '^v1\.[A-Za-z0-9_-]+$' then
    raise exception 'ungueltig' using errcode = '22023';
  end if;
end $$;

create or replace function tracker._token_pruefen(t text)
returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if t is null or t !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'ungueltig' using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------- Laden
create or replace function public.tr_laden(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; hat_dk boolean;
begin
  z := tracker._auth(p_code);
  hat_dk := exists (select 1 from tracker.zugang where huelle is not null);
  return jsonb_build_object(
    'ich', jsonb_build_object('id', z.id, 'name', z.name, 'rolle', z.rolle),
    'huelle', z.huelle,
    'personen', case
      when hat_dk and z.huelle is null then '[]'::jsonb
      else coalesce((
        select jsonb_agg(
          case when p.daten is null then to_jsonb(p) - 'daten'
               else jsonb_build_object('id', p.id, 'daten', p.daten, 'version', p.version,
                      'erstellt', p.erstellt, 'erstellt_von', p.erstellt_von,
                      'geaendert', p.geaendert, 'geaendert_von', p.geaendert_von) end
          order by p.erstellt desc, p.id)
        from tracker.person p), '[]'::jsonb)
      end,
    'stand', now());
end $$;

-- ---------------------------------------------------------------- Umstellung (einmalig, durch den Admin)
-- Der Admin meldet sich mit seinem alten Schluessel an, erzeugt im Browser einen neuen Schluessel und den
-- Datenschluessel und schickt nur den neuen Anmelde-Wert und die Huelle. Danach gilt der alte Schluessel nicht mehr.
create or replace function public.tr_umstellen(p_alt_code text, p_neu_auth text, p_huelle text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang;
begin
  perform pg_advisory_xact_lock(7311002);
  z := tracker._auth(p_alt_code, true);
  if exists (select 1 from tracker.zugang where huelle is not null) then
    raise exception 'schon_umgestellt' using errcode = '42501';
  end if;
  perform tracker._token_pruefen(p_neu_auth);
  perform tracker._blob_pruefen(p_huelle);
  update tracker.zugang
     set code_hash = extensions.digest(p_neu_auth, 'sha256'), huelle = p_huelle
   where id = z.id;
  insert into tracker.protokoll (wer, aktion) values (z.name, 'verschluesselt');
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- Erste Einrichtung (neu)
create or replace function public.tr_einrichten(p_setup text, p_name text, p_auth text, p_huelle text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare h bytea;
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
  perform tracker._token_pruefen(p_auth);
  perform tracker._blob_pruefen(p_huelle);
  insert into tracker.zugang (name, rolle, code_hash, huelle)
  values (btrim(p_name), 'admin', extensions.digest(p_auth, 'sha256'), p_huelle);
  delete from tracker.einstellung where schluessel = 'setup_hash';
  insert into tracker.protokoll (wer, aktion) values (btrim(p_name), 'einrichten');
  return jsonb_build_object('name', btrim(p_name));
end $$;

-- ---------------------------------------------------------------- Personen (nur noch verschluesselt)
-- p_id null = neue Person. Sonst ersetzt die Funktion den Inhalt, aber nur wenn p_version noch stimmt
-- (sonst 'konflikt': jemand anderes war schneller). p_log ist ein verschluesselter Protokolltext.
create or replace function public.tr_person_speichern(p_code text, p_id uuid, p_daten text, p_version int, p_log text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; r tracker.person;
begin
  z := tracker._auth(p_code);
  perform tracker._blob_pruefen(p_daten);
  if p_log is not null then perform tracker._blob_pruefen(p_log); end if;
  if p_id is null then
    insert into tracker.person (daten, erstellt_von, geaendert_von)
    values (p_daten, z.name, z.name) returning * into r;
    insert into tracker.protokoll (wer, aktion, detail) values (z.name, 'neu', p_log);
  else
    update tracker.person
       set daten = p_daten, version = version + 1, geaendert = now(), geaendert_von = z.name
     where id = p_id and version = p_version
    returning * into r;
    if not found then
      if exists (select 1 from tracker.person where id = p_id) then
        raise exception 'konflikt';
      end if;
      raise exception 'nicht_gefunden' using errcode = 'P0002';
    end if;
    insert into tracker.protokoll (wer, aktion, detail) values (z.name, 'aendern', p_log);
  end if;
  return jsonb_build_object('id', r.id, 'version', r.version, 'erstellt', r.erstellt,
    'erstellt_von', r.erstellt_von, 'geaendert', r.geaendert, 'geaendert_von', r.geaendert_von);
end $$;

create or replace function public.tr_person_loeschen(p_code text, p_id uuid, p_log text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; gefunden boolean;
begin
  z := tracker._auth(p_code, true);
  if p_log is not null then perform tracker._blob_pruefen(p_log); end if;
  delete from tracker.person where id = p_id;
  gefunden := found;
  if gefunden then
    insert into tracker.protokoll (wer, aktion, detail) values (z.name, 'loeschen', p_log);
  end if;
  return jsonb_build_object('geloescht', gefunden);
end $$;

-- Liste einspielen (nur Admin): jede Zeile ist schon im Browser verschluesselt (Text). Doppelte prueft der Browser.
create or replace function public.tr_import(p_code text, p_zeilen jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; j jsonb; neu int := 0;
begin
  z := tracker._auth(p_code, true);
  if p_zeilen is null or jsonb_typeof(p_zeilen) <> 'array' then
    raise exception 'ungueltig' using errcode = '22023';
  end if;
  if jsonb_array_length(p_zeilen) > 1000 then
    raise exception 'zu_viele_zeilen' using errcode = '22023';
  end if;
  for j in select value from jsonb_array_elements(p_zeilen) loop
    if jsonb_typeof(j) <> 'string' then
      raise exception 'ungueltig' using errcode = '22023';
    end if;
    perform tracker._blob_pruefen(j #>> '{}');
    insert into tracker.person (daten, erstellt_von, geaendert_von) values (j #>> '{}', z.name, z.name);
    neu := neu + 1;
  end loop;
  insert into tracker.protokoll (wer, aktion, person_name) values (z.name, 'import', neu || ' Personen');
  return jsonb_build_object('neu', neu);
end $$;

-- ---------------------------------------------------------------- Zugaenge (nur Admin)
create or replace function public.tr_zugaenge(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform tracker._auth(p_code, true);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'rolle', rolle, 'erstellt', erstellt,
      'zuletzt_gesehen', zuletzt_gesehen, 'gesperrt', gesperrt,
      'hat_schluessel', huelle is not null) order by erstellt)
    from tracker.zugang), '[]'::jsonb);
end $$;

-- Der Browser des Admins erzeugt den neuen Schluessel, leitet auth ab und verpackt den Datenschluessel.
create or replace function public.tr_zugang_anlegen(p_code text, p_name text, p_rolle text, p_auth text, p_huelle text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; zid uuid;
begin
  z := tracker._auth(p_code, true);
  if coalesce(btrim(p_name), '') = '' or length(p_name) > 100 then
    raise exception 'name_fehlt' using errcode = '22023';
  end if;
  if p_rolle not in ('admin', 'mitarbeiter') then
    raise exception 'rolle_ungueltig' using errcode = '22023';
  end if;
  perform tracker._token_pruefen(p_auth);
  perform tracker._blob_pruefen(p_huelle);
  insert into tracker.zugang (name, rolle, code_hash, huelle)
  values (btrim(p_name), p_rolle, extensions.digest(p_auth, 'sha256'), p_huelle)
  returning id into zid;
  insert into tracker.protokoll (wer, aktion, person_name) values (z.name, 'zugang_neu', btrim(p_name));
  return jsonb_build_object('id', zid, 'name', btrim(p_name));
end $$;

-- p_aktion: 'sperren' | 'entsperren' | 'neuer_code' (dann mit p_auth und p_huelle)
create or replace function public.tr_zugang_aendern(p_code text, p_id uuid, p_aktion text,
  p_auth text default null, p_huelle text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; t tracker.zugang;
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
    perform tracker._token_pruefen(p_auth);
    perform tracker._blob_pruefen(p_huelle);
    update tracker.zugang
       set code_hash = extensions.digest(p_auth, 'sha256'), huelle = p_huelle, gesperrt = false
     where id = t.id;
    insert into tracker.protokoll (wer, aktion, person_name) values (z.name, 'zugang_neuer_code', t.name);
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'aktion_ungueltig' using errcode = '22023';
end $$;

-- Protokoll: Namen von Personen stehen nur noch verschluesselt im Feld "detail".
create or replace function public.tr_protokoll(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform tracker._auth(p_code, true);
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.id desc)
    from (select id, zeit, wer, aktion, person_name, felder, detail from tracker.protokoll order by id desc limit 200) x
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- Rechte
revoke all on all functions in schema tracker from public, anon, authenticated;

revoke all on function public.tr_umstellen(text, text, text) from public;
revoke all on function public.tr_einrichten(text, text, text, text) from public;
revoke all on function public.tr_laden(text) from public;
revoke all on function public.tr_person_speichern(text, uuid, text, int, text) from public;
revoke all on function public.tr_person_loeschen(text, uuid, text) from public;
revoke all on function public.tr_import(text, jsonb) from public;
revoke all on function public.tr_zugaenge(text) from public;
revoke all on function public.tr_zugang_anlegen(text, text, text, text, text) from public;
revoke all on function public.tr_zugang_aendern(text, uuid, text, text, text) from public;
revoke all on function public.tr_protokoll(text) from public;

grant execute on function public.tr_umstellen(text, text, text) to anon;
grant execute on function public.tr_einrichten(text, text, text, text) to anon;
grant execute on function public.tr_laden(text) to anon;
grant execute on function public.tr_person_speichern(text, uuid, text, int, text) to anon;
grant execute on function public.tr_person_loeschen(text, uuid, text) to anon;
grant execute on function public.tr_import(text, jsonb) to anon;
grant execute on function public.tr_zugaenge(text) to anon;
grant execute on function public.tr_zugang_anlegen(text, text, text, text, text) to anon;
grant execute on function public.tr_zugang_aendern(text, uuid, text, text, text) to anon;
grant execute on function public.tr_protokoll(text) to anon;
