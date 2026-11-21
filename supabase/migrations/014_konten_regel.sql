-- 014: Konten-Regel nur noch bei erhaltener Mail. 21.11.2026.
--  * Mail erstellt (oder noch ohne Status): Stake und Bet Online gehen in jeder Reihenfolge.
--  * Mail erhalten: Ist Bet Online schon gesetzt, darf Stake nicht mehr dazukommen. Stake zuerst, dann Bet Online geht weiter.
--    Massgeblich ist der Mail-Status nach der Aenderung (er kann im selben Schritt mitgeaendert werden).

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
  return tracker._person_json(r);
end $$;

revoke all on all functions in schema tracker from public, anon, authenticated;
revoke all on function public.tr_person_speichern(text, uuid, jsonb) from public;
grant execute on function public.tr_person_speichern(text, uuid, jsonb) to anon;
