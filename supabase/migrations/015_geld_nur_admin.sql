-- 015: Geld nur fuer Admins, Import entfernt. 21.11.2026.
--  * Wert, Dazurechnen, Standardwert und "zaehlt ab" bekommt nur ein Admin zu sehen und zu aendern. Ein Mitarbeiter bekommt diese
--    Felder von der Datenbank gar nicht erst geliefert (tr_laden und tr_person_speichern lassen sie fuer ihn weg) und kann sie nicht setzen.
--  * Einstellungen (Standardwert, zaehlt ab) aendert nur ein Admin.
--  * Die Funktion tr_import (Liste einfuegen) wird entfernt, die Seite benutzt sie nicht mehr.

drop function if exists public.tr_import(text, jsonb, boolean);

create or replace function tracker._person_sicht(r tracker.person, p_admin boolean)
returns jsonb
language sql stable set search_path = ''
as $$
  select case when p_admin then tracker._person_json(r) else tracker._person_json(r) - 'wert' - 'zaehlt' end
$$;

create or replace function public.tr_person_speichern(p_code text, p_id uuid, p_felder jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; r tracker.person;
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
    mail_status = case when p_felder ? 'mail_status' then nullif(p_felder->>'mail_status', '') else mail_status end,
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

create or replace function public.tr_laden(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang;
begin
  z := tracker._auth(p_code);
  return jsonb_build_object(
    'ich', jsonb_build_object('id', z.id, 'name', z.name, 'rolle', z.rolle),
    'personen', coalesce((select jsonb_agg(tracker._person_sicht(p, z.rolle = 'admin') order by p.erstellt desc, p.id) from tracker.person p), '[]'::jsonb),
    'projekte', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'symbol_typ', x.symbol_typ, 'symbol', x.symbol) order by x.reihenfolge) from tracker.projekt x), '[]'::jsonb),
    'einstellungen', case when z.rolle = 'admin' then tracker._konfig() || jsonb_build_object('dateien_bytes', (select coalesce(sum(groesse), 0) from tracker.datei)) else '{}'::jsonb end,
    'stand', now());
end $$;

create or replace function public.tr_einstellungen_setzen(p_code text, p_standardwert numeric, p_zaehlt_ab text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang;
begin
  z := tracker._auth(p_code, true);
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

revoke all on all functions in schema tracker from public, anon, authenticated;
revoke all on function public.tr_person_speichern(text, uuid, jsonb) from public;
revoke all on function public.tr_laden(text) from public;
revoke all on function public.tr_einstellungen_setzen(text, numeric, text) from public;
grant execute on function public.tr_person_speichern(text, uuid, jsonb) to anon;
grant execute on function public.tr_laden(text) to anon;
grant execute on function public.tr_einstellungen_setzen(text, numeric, text) to anon;
