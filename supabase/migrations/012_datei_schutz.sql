-- 012: Mehr Schutz bei Dateien. 19.11.2026.
--  * Nur bekannte Dateitypen (Bilder, PDF, Office, Text). Der Typ kommt aus der Endung, nicht aus der Angabe der Seite,
--    und der Anfang der Datei muss zur Endung passen (zum Beispiel muss eine .png wirklich mit dem PNG-Kennzeichen beginnen).
--  * Upload-Tempo: hoechstens 15 Dateien je Minute und Zugang.
--  * tr_laden meldet zusaetzlich, wie viele Bytes die Dateien belegen (fuer die Anzeige "x MB von 300 MB").

-- Gibt den Typ zurueck, wenn Endung und Dateianfang zusammenpassen, sonst Fehler.
create or replace function tracker._datei_pruefen(p_name text, p_bin bytea)
returns text
language plpgsql immutable set search_path = ''
as $$
declare ext text; kopf bytea;
begin
  ext := lower(substring(p_name from '\.([A-Za-z0-9]{1,5})$'));
  if ext is null then
    raise exception 'datei_typ_nicht_erlaubt' using errcode = '22023';
  end if;
  kopf := substring(p_bin from 1 for 12);
  if ext in ('jpg', 'jpeg') then
    if substring(kopf from 1 for 3) <> '\xffd8ff'::bytea then raise exception 'datei_inhalt_passt_nicht' using errcode = '22023'; end if;
    return 'image/jpeg';
  elsif ext = 'png' then
    if substring(kopf from 1 for 4) <> '\x89504e47'::bytea then raise exception 'datei_inhalt_passt_nicht' using errcode = '22023'; end if;
    return 'image/png';
  elsif ext = 'gif' then
    if substring(kopf from 1 for 4) <> '\x47494638'::bytea then raise exception 'datei_inhalt_passt_nicht' using errcode = '22023'; end if;
    return 'image/gif';
  elsif ext = 'webp' then
    if substring(kopf from 1 for 4) <> '\x52494646'::bytea or substring(kopf from 9 for 4) <> '\x57454250'::bytea then
      raise exception 'datei_inhalt_passt_nicht' using errcode = '22023';
    end if;
    return 'image/webp';
  elsif ext in ('heic', 'heif') then
    if substring(kopf from 5 for 4) <> '\x66747970'::bytea then raise exception 'datei_inhalt_passt_nicht' using errcode = '22023'; end if;
    return 'image/heic';
  elsif ext = 'pdf' then
    if substring(kopf from 1 for 4) <> '\x25504446'::bytea then raise exception 'datei_inhalt_passt_nicht' using errcode = '22023'; end if;
    return 'application/pdf';
  elsif ext in ('docx', 'xlsx', 'pptx', 'zip') then
    if substring(kopf from 1 for 4) <> '\x504b0304'::bytea then raise exception 'datei_inhalt_passt_nicht' using errcode = '22023'; end if;
    return 'application/octet-stream';
  elsif ext in ('doc', 'xls', 'ppt') then
    if substring(kopf from 1 for 4) <> '\xd0cf11e0'::bytea then raise exception 'datei_inhalt_passt_nicht' using errcode = '22023'; end if;
    return 'application/octet-stream';
  elsif ext in ('txt', 'csv') then
    if position('\x00'::bytea in p_bin) > 0 then raise exception 'datei_inhalt_passt_nicht' using errcode = '22023'; end if;
    return 'text/plain';
  end if;
  raise exception 'datei_typ_nicht_erlaubt' using errcode = '22023';
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
  if (select count(*) from tracker.datei where zugang_id = z.id and erstellt > now() - interval '1 minute') >= 15 then
    raise exception 'zu_schnell' using errcode = '22023';
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
  n := left(btrim(regexp_replace(coalesce(p_name, ''), '[\\/:*?"<>|[:cntrl:]]', '_', 'g')), 200);
  if n = '' then n := 'Datei'; end if;
  t := tracker._datei_pruefen(n, bin);
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
    'einstellungen', tracker._konfig() || jsonb_build_object('dateien_bytes', (select coalesce(sum(groesse), 0) from tracker.datei)),
    'stand', now());
end $$;

revoke all on all functions in schema tracker from public, anon, authenticated;
revoke all on function public.tr_datei_neu(text, uuid, text, text, text, text) from public;
revoke all on function public.tr_laden(text) from public;
grant execute on function public.tr_datei_neu(text, uuid, text, text, text, text) to anon;
grant execute on function public.tr_laden(text) to anon;
