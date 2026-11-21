-- 016: Admin-Portal (Inhaber-Schutz, Zugang loeschen), Profilbild und Farbe, Standardstufe, Mail-Status Pflicht. 21.11.2026.
--  * Inhaber: Der erste Admin (hier der einzige) ist Inhaber. Er kann von niemandem herabgestuft, gesperrt, geloescht oder mit neuem Schluessel
--    versehen werden. Nur der Inhaber macht jemanden zum Admin oder stuft einen Admin herab. Andere Admins verwalten nur Mitarbeiter.
--  * Zugang loeschen: ganz aus dem System, nicht nur sperren (Inhaber und man selbst ausgenommen).
--  * Profilbild und Farbe je Zugang (Foto als kleines JPEG, oder eine Farbe fuer die Initialen).
--  * Neue Personen starten auf der Stufe "Zu erledigen". Wer eine Mail einträgt, muss den Mail-Status angeben (auch am Server).

-- ---------------------------------------------------------------- Spalten
alter table tracker.zugang add column if not exists inhaber boolean not null default false;
alter table tracker.zugang add column if not exists avatar_farbe text check (avatar_farbe is null or avatar_farbe in ('blau', 'tuerkis', 'gruen', 'orange', 'rot', 'pink', 'violett', 'grau'));
alter table tracker.zugang add column if not exists avatar_bild text check (avatar_bild is null or (length(avatar_bild) <= 40000 and avatar_bild ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$'));
create unique index if not exists zugang_ein_inhaber on tracker.zugang (inhaber) where inhaber;
update tracker.zugang set inhaber = true
 where id = (select id from tracker.zugang where rolle = 'admin' order by erstellt, id limit 1)
   and not exists (select 1 from tracker.zugang where inhaber);

alter table tracker.person alter column status set default 'zu_erledigen';

-- ---------------------------------------------------------------- Personen
create or replace function tracker._person_neu(p_von text, p jsonb)
returns tracker.person
language plpgsql security definer set search_path = ''
as $$
declare r tracker.person;
begin
  perform tracker._pruefen(p, true);
  -- Wer eine E-Mail einträgt, muss auch den Mail-Status angeben (erhalten oder erstellt).
  if nullif(btrim(p->>'email'), '') is not null and nullif(p->>'mail_status', '') is null then
    raise exception 'mail_status_fehlt' using errcode = '22023';
  end if;
  insert into tracker.person
    (name, state, nummer, email, adresse, status, zaehlt, zustaendig, notiz, adressnummer, wert,
     projekt_id, mail_status, betonline, stake, erstellt_von, geaendert_von)
  values
    (coalesce(btrim(p->>'name'), ''), nullif(btrim(p->>'state'), ''), nullif(btrim(p->>'nummer'), ''),
     nullif(btrim(p->>'email'), ''), nullif(btrim(p->>'adresse'), ''), coalesce(p->>'status', 'zu_erledigen'),
     coalesce((p->>'zaehlt')::boolean, false), nullif(btrim(p->>'zustaendig'), ''),
     nullif(btrim(p->>'notiz'), ''), nullif(btrim(p->>'adressnummer'), ''),
     case when jsonb_typeof(p->'wert') = 'number' then round((p->>'wert')::numeric, 2) end,
     coalesce(nullif(p->>'projekt', ''), (select id from tracker.projekt order by reihenfolge limit 1)),
     case when nullif(btrim(p->>'email'), '') is null then null else nullif(p->>'mail_status', '') end,
     coalesce((p->>'betonline')::boolean, false), coalesce((p->>'stake')::boolean, false), p_von, p_von)
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
declare z tracker.zugang; r tracker.person; neue_mail text; neuer_status text;
begin
  z := tracker._auth(p_code);
  -- Wert und Dazurechnen (alles Geldtechnische) darf nur ein Admin aendern.
  if z.rolle <> 'admin' and jsonb_typeof(p_felder) = 'object' and (p_felder ? 'wert' or p_felder ? 'zaehlt') then
    raise exception 'nur_admin' using errcode = '42501';
  end if;
  if p_id is null then
    r := tracker._person_neu(z.name, p_felder);
    insert into tracker.protokoll (wer, aktion, person_name) values (z.name, 'neu', tracker._anzeige(r));
    return tracker._person_sicht(r, z.rolle = 'admin');
  end if;

  select * into r from tracker.person where id = p_id for update;
  if not found then
    raise exception 'nicht_gefunden' using errcode = 'P0002';
  end if;
  perform tracker._pruefen(p_felder, false);

  -- Mail und Mail-Status: Wer die Mail neu setzt oder aendert, muss den Status angeben. Ohne Mail gibt es keinen Status.
  neue_mail := case when p_felder ? 'email' then nullif(btrim(p_felder->>'email'), '') else r.email end;
  neuer_status := case when p_felder ? 'mail_status' then nullif(p_felder->>'mail_status', '') else r.mail_status end;
  if neue_mail is not null and neuer_status is null and neue_mail is distinct from r.email then
    raise exception 'mail_status_fehlt' using errcode = '22023';
  end if;

  -- Nur bei einer erhaltenen Mail: Ist Bet Online schon gesetzt, darf Stake nicht neu dazukommen.
  -- Bei einer selbst erstellten Mail (oder ohne Mail-Status) gilt keine Reihenfolge.
  if p_felder ? 'stake' and coalesce((p_felder->>'stake')::boolean, false) and not r.stake and r.betonline
     and coalesce(case when p_felder ? 'mail_status' then nullif(p_felder->>'mail_status', '') else r.mail_status end, '') = 'erhalten' then
    raise exception 'stake_gesperrt' using errcode = '22023';
  end if;

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
    projekt_id = case when p_felder ? 'projekt' then p_felder->>'projekt' else projekt_id end,
    mail_status = case when neue_mail is null then null else neuer_status end,
    betonline = case when p_felder ? 'betonline' then (p_felder->>'betonline')::boolean else betonline end,
    stake = case when p_felder ? 'stake' then (p_felder->>'stake')::boolean else stake end,
    geaendert = now(),
    geaendert_von = z.name
  where id = p_id
  returning * into r;

  if not tracker._hat_inhalt(r) then
    raise exception 'leer' using errcode = '22023';
  end if;

  insert into tracker.protokoll (wer, aktion, person_name, felder)
  values (z.name, 'aendern', tracker._anzeige(r), array(select jsonb_object_keys(p_felder)));
  return tracker._person_sicht(r, z.rolle = 'admin');
end $$;

-- ---------------------------------------------------------------- Laden, Einrichtung
create or replace function public.tr_laden(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang;
begin
  z := tracker._auth(p_code);
  return jsonb_build_object(
    'ich', jsonb_build_object('id', z.id, 'name', z.name, 'rolle', z.rolle, 'inhaber', z.inhaber, 'avatar_farbe', z.avatar_farbe, 'avatar_bild', z.avatar_bild),
    'personen', coalesce((select jsonb_agg(tracker._person_sicht(p, z.rolle = 'admin') order by p.erstellt desc, p.id) from tracker.person p), '[]'::jsonb),
    'projekte', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'symbol_typ', x.symbol_typ, 'symbol', x.symbol) order by x.reihenfolge) from tracker.projekt x), '[]'::jsonb),
    'einstellungen', case when z.rolle = 'admin' then tracker._konfig() || jsonb_build_object('dateien_bytes', (select coalesce(sum(groesse), 0) from tracker.datei)) else '{}'::jsonb end,
    'stand', now());
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
  insert into tracker.zugang (name, rolle, code_hash, inhaber)
  values (btrim(p_name), 'admin', extensions.digest(code, 'sha256'), true);
  delete from tracker.einstellung where schluessel = 'setup_hash';
  insert into tracker.protokoll (wer, aktion) values (btrim(p_name), 'einrichten');
  return jsonb_build_object('code', code, 'name', btrim(p_name));
end $$;

-- ---------------------------------------------------------------- Admin-Portal
create or replace function public.tr_zugang_rolle(p_code text, p_id uuid, p_rolle text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; t tracker.zugang;
begin
  z := tracker._auth(p_code, true);
  if not z.inhaber then
    raise exception 'nur_inhaber' using errcode = '42501';
  end if;
  if p_rolle not in ('admin', 'mitarbeiter') then
    raise exception 'rolle_ungueltig' using errcode = '22023';
  end if;
  select * into t from tracker.zugang where id = p_id for update;
  if not found then
    raise exception 'nicht_gefunden' using errcode = 'P0002';
  end if;
  if t.inhaber then
    raise exception 'inhaber_geschuetzt' using errcode = '42501';
  end if;
  update tracker.zugang set rolle = p_rolle where id = t.id;
  insert into tracker.protokoll (wer, aktion, person_name)
  values (z.name, case when p_rolle = 'admin' then 'zugang_admin' else 'zugang_mitarbeiter' end, t.name);
  return jsonb_build_object('ok', true);
end $$;

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
  -- Der Inhaber ist geschuetzt (nur er selbst darf seinen Schluessel erneuern).
  if t.inhaber and not (t.id = z.id and p_aktion = 'neuer_code') then
    raise exception 'inhaber_geschuetzt' using errcode = '42501';
  end if;
  -- Andere Admins fasst nur der Inhaber an (ausser man erneuert den eigenen Schluessel).
  if t.rolle = 'admin' and not z.inhaber and t.id <> z.id then
    raise exception 'nur_inhaber' using errcode = '42501';
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
  if p_rolle = 'admin' and not z.inhaber then
    raise exception 'nur_inhaber' using errcode = '42501';
  end if;
  code := 'ak_' || encode(extensions.gen_random_bytes(20), 'hex');
  insert into tracker.zugang (name, rolle, code_hash)
  values (btrim(p_name), p_rolle, extensions.digest(code, 'sha256'))
  returning id into zid;
  insert into tracker.protokoll (wer, aktion, person_name) values (z.name, 'zugang_neu', btrim(p_name));
  return jsonb_build_object('id', zid, 'name', btrim(p_name), 'code', code);
end $$;

-- Zugang ganz aus dem System loeschen (nicht nur sperren). Nicht den Inhaber, nicht sich selbst, andere Admins nur der Inhaber.
-- Die Eintraege, die der Zugang angelegt hat, bleiben (sie tragen nur seinen Namen als Text).
create or replace function public.tr_zugang_loeschen(p_code text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; t tracker.zugang;
begin
  z := tracker._auth(p_code, true);
  select * into t from tracker.zugang where id = p_id for update;
  if not found then
    return jsonb_build_object('geloescht', false);
  end if;
  if t.id = z.id then
    raise exception 'sich_selbst_nicht' using errcode = '42501';
  end if;
  if t.inhaber then
    raise exception 'inhaber_geschuetzt' using errcode = '42501';
  end if;
  if t.rolle = 'admin' and not z.inhaber then
    raise exception 'nur_inhaber' using errcode = '42501';
  end if;
  delete from tracker.zugang where id = t.id;
  insert into tracker.protokoll (wer, aktion, person_name) values (z.name, 'zugang_geloescht', t.name);
  return jsonb_build_object('geloescht', true);
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
      'zuletzt_gesehen', zuletzt_gesehen, 'gesperrt', gesperrt, 'inhaber', inhaber,
      'avatar_farbe', avatar_farbe, 'avatar_bild', avatar_bild) order by erstellt)
    from tracker.zugang), '[]'::jsonb);
end $$;

-- Profilbild und Farbe: jeder Zugang aendert nur sein eigenes.
create or replace function public.tr_profil_avatar(p_code text, p_farbe text, p_bild text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang;
begin
  z := tracker._auth(p_code);
  if p_farbe is not null and p_farbe not in ('blau', 'tuerkis', 'gruen', 'orange', 'rot', 'pink', 'violett', 'grau') then
    raise exception 'avatar_ungueltig' using errcode = '22023';
  end if;
  if p_bild is not null and (length(p_bild) > 40000 or p_bild !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$') then
    raise exception 'avatar_ungueltig' using errcode = '22023';
  end if;
  update tracker.zugang set avatar_farbe = p_farbe, avatar_bild = p_bild where id = z.id;
  return jsonb_build_object('avatar_farbe', p_farbe, 'avatar_bild', p_bild);
end $$;

revoke all on all functions in schema tracker from public, anon, authenticated;
revoke all on function public.tr_person_speichern(text, uuid, jsonb) from public;
revoke all on function public.tr_laden(text) from public;
revoke all on function public.tr_einrichten(text, text) from public;
revoke all on function public.tr_zugang_rolle(text, uuid, text) from public;
revoke all on function public.tr_zugang_aendern(text, uuid, text) from public;
revoke all on function public.tr_zugang_anlegen(text, text, text) from public;
revoke all on function public.tr_zugang_loeschen(text, uuid) from public;
revoke all on function public.tr_zugaenge(text) from public;
revoke all on function public.tr_profil_avatar(text, text, text) from public;
grant execute on function public.tr_person_speichern(text, uuid, jsonb) to anon;
grant execute on function public.tr_laden(text) to anon;
grant execute on function public.tr_einrichten(text, text) to anon;
grant execute on function public.tr_zugang_rolle(text, uuid, text) to anon;
grant execute on function public.tr_zugang_aendern(text, uuid, text) to anon;
grant execute on function public.tr_zugang_anlegen(text, text, text) to anon;
grant execute on function public.tr_zugang_loeschen(text, uuid) to anon;
grant execute on function public.tr_zugaenge(text) to anon;
grant execute on function public.tr_profil_avatar(text, text, text) to anon;
