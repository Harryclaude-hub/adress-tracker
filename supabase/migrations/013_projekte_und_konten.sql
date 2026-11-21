-- 013: Projekte (Laender), Eindeutigkeit ueber alle Projekte, Mail-Status und Konten (Bet Online, Stake). 21.11.2026.
--  * tracker.projekt: USA, Bangladesch, Finnland (weitere legt man in der Seite an, mit Flagge, Emoji oder Foto). Alle bisherigen Personen kommen in USA.
--  * Kein Name und keine Mail darf in der ganzen Datenbank doppelt vorkommen, egal in welchem Projekt.
--    Namen zaehlen als gleich, wenn sie nach Gross/Klein, Akzenten, Satzzeichen und Reihenfolge der Woerter gleich sind.
--    Mails zaehlen als gleich nach Gross/Klein, ohne '+Zusatz', bei Gmail auch ohne Punkte.
--    Geprueft wird nur, wenn Name oder Mail neu gesetzt oder geaendert wird (so bleibt ein Altbestand bearbeitbar).
--  * person.mail_status: erhalten oder erstellt (leer = noch offen).
--  * person.betonline / person.stake: Konto bei Bet Online oder Stake mit dieser Mail.
--    Regel: Ist Bet Online schon gesetzt, darf Stake nicht mehr dazukommen. Stake zuerst, dann Bet Online ist erlaubt.

-- ---------------------------------------------------------------- Tabellen
create table if not exists tracker.projekt (
  id text primary key check (id ~ '^[a-z0-9_]{2,30}$'),
  name text not null check (length(btrim(name)) between 1 and 40),
  symbol_typ text not null check (symbol_typ in ('flagge', 'emoji', 'bild')),
  symbol text not null check (length(symbol) between 1 and 40000),
  reihenfolge integer not null
);
create unique index if not exists projekt_name_eindeutig on tracker.projekt (lower(btrim(name)));
alter table tracker.projekt enable row level security;
insert into tracker.projekt (id, name, symbol_typ, symbol, reihenfolge) values
  ('usa', 'USA', 'flagge', 'us', 1), ('bangladesch', 'Bangladesch', 'flagge', 'bd', 2), ('finnland', 'Finnland', 'flagge', 'fi', 3)
  on conflict (id) do nothing;

alter table tracker.person add column if not exists projekt_id text references tracker.projekt(id);
update tracker.person set projekt_id = 'usa' where projekt_id is null;
alter table tracker.person alter column projekt_id set not null;
create index if not exists person_projekt_idx on tracker.person (projekt_id);

alter table tracker.person add column if not exists mail_status text check (mail_status in ('erhalten', 'erstellt'));
alter table tracker.person add column if not exists betonline boolean not null default false;
alter table tracker.person add column if not exists stake boolean not null default false;

-- ---------------------------------------------------------------- Eindeutigkeit
-- Klein, ohne Akzente (auch bei grossen Umlauten, die lower() allein nicht kleinschreibt), ss statt Eszett.
create or replace function tracker._ascii(p text)
returns text
language sql immutable set search_path = ''
as $$
  select lower(translate(replace(replace(coalesce(p, ''), 'ß', 'ss'), 'ẞ', 'ss'), 'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÑñÇçÝýÿŠšŽžČčĆćŃńŚśŹźŻżĘęĄąŐőŰűĞğŞşØøŁłĐđıİ', 'aaaaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuunnccyyysszzccccnnsszzzzeeaaoouuggssoollddii'))
$$;

create or replace function tracker._name_schluessel(p text)
returns text
language sql immutable set search_path = ''
as $$
  select coalesce((
    select string_agg(t, ' ' order by t)
    from unnest(string_to_array(btrim(regexp_replace(
           tracker._ascii(p),
           '[^a-z0-9]+', ' ', 'g')), ' ')) t
    where t <> ''), '')
$$;

create or replace function tracker._mail_schluessel(p text)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when x.m = '' then ''
    when x.d in ('gmail.com', 'googlemail.com') then replace(x.l, '.', '') || '@gmail.com'
    else x.l || '@' || x.d end
  from (select y.m, split_part(split_part(y.m, '@', 1), '+', 1) as l, split_part(y.m, '@', 2) as d
          from (select lower(btrim(coalesce(p, ''))) as m) y) x
$$;

create or replace function tracker._eindeutig()
returns trigger
language plpgsql set search_path = ''
as $$
declare m text; k text;
begin
  perform pg_advisory_xact_lock(7311002);
  m := tracker._mail_schluessel(new.email);
  if m <> '' and (tg_op = 'INSERT' or m is distinct from tracker._mail_schluessel(old.email)) then
    if exists (select 1 from tracker.person p where p.id <> new.id and tracker._mail_schluessel(p.email) = m) then
      raise exception 'mail_doppelt' using errcode = '23505';
    end if;
  end if;
  k := tracker._name_schluessel(new.name);
  if k <> '' and (tg_op = 'INSERT' or k is distinct from tracker._name_schluessel(old.name)) then
    if exists (select 1 from tracker.person p where p.id <> new.id and tracker._name_schluessel(p.name) = k) then
      raise exception 'name_doppelt' using errcode = '23505';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists person_eindeutig on tracker.person;
create trigger person_eindeutig before insert or update of name, email on tracker.person
  for each row execute function tracker._eindeutig();

-- ---------------------------------------------------------------- Pruefung und Anlegen
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
    if k not in ('name','state','nummer','email','adresse','status','gruen_am','abgehakt','zustaendig','notiz','adressnummer','wert','zaehlt',
                 'projekt','mail_status','betonline','stake') then
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
  if p ? 'betonline' and jsonb_typeof(p->'betonline') <> 'boolean' then
    raise exception 'konto_ungueltig' using errcode = '22023';
  end if;
  if p ? 'stake' and jsonb_typeof(p->'stake') <> 'boolean' then
    raise exception 'konto_ungueltig' using errcode = '22023';
  end if;
  if p ? 'mail_status' and jsonb_typeof(p->'mail_status') <> 'null' and coalesce(p->>'mail_status', '') not in ('', 'erhalten', 'erstellt') then
    raise exception 'mail_status_ungueltig' using errcode = '22023';
  end if;
  if p ? 'projekt' and not exists (select 1 from tracker.projekt where id = p->>'projekt') then
    raise exception 'projekt_ungueltig' using errcode = '22023';
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
    (name, state, nummer, email, adresse, status, zaehlt, zustaendig, notiz, adressnummer, wert,
     projekt_id, mail_status, betonline, stake, erstellt_von, geaendert_von)
  values
    (coalesce(btrim(p->>'name'), ''), nullif(btrim(p->>'state'), ''), nullif(btrim(p->>'nummer'), ''),
     nullif(btrim(p->>'email'), ''), nullif(btrim(p->>'adresse'), ''), coalesce(p->>'status', 'leer'),
     coalesce((p->>'zaehlt')::boolean, false), nullif(btrim(p->>'zustaendig'), ''),
     nullif(btrim(p->>'notiz'), ''), nullif(btrim(p->>'adressnummer'), ''),
     case when jsonb_typeof(p->'wert') = 'number' then round((p->>'wert')::numeric, 2) end,
     coalesce(nullif(p->>'projekt', ''), (select id from tracker.projekt order by reihenfolge limit 1)), nullif(p->>'mail_status', ''),
     coalesce((p->>'betonline')::boolean, false), coalesce((p->>'stake')::boolean, false), p_von, p_von)
  returning * into r;
  if not tracker._hat_inhalt(r) then
    raise exception 'leer' using errcode = '22023';
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------- Personen speichern
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

  -- Ist Bet Online schon gesetzt, darf Stake nicht neu dazukommen.
  if p_felder ? 'stake' and coalesce((p_felder->>'stake')::boolean, false) and not r.stake and r.betonline then
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

-- ---------------------------------------------------------------- Import: Doppelte werden uebersprungen oder brechen ab
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
    begin
      perform tracker._person_neu(z.name, j);
      neu := neu + 1;
    exception when others then
      if p_doppelte_ueberspringen and sqlerrm in ('name_doppelt', 'mail_doppelt') then
        uebersprungen := uebersprungen + 1;
      else
        raise;
      end if;
    end;
  end loop;
  insert into tracker.protokoll (wer, aktion, person_name) values (z.name, 'import', neu || ' Personen');
  return jsonb_build_object('neu', neu, 'uebersprungen', uebersprungen);
end $$;

-- ---------------------------------------------------------------- Laden mit Projekten
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
    'projekte', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'symbol_typ', x.symbol_typ, 'symbol', x.symbol) order by x.reihenfolge) from tracker.projekt x), '[]'::jsonb),
    'einstellungen', tracker._konfig() || jsonb_build_object('dateien_bytes', (select coalesce(sum(groesse), 0) from tracker.datei)),
    'stand', now());
end $$;

-- ---------------------------------------------------------------- Projekte anlegen, aendern, leere loeschen
create or replace function public.tr_projekt_speichern(p_code text, p_id text, p_name text, p_typ text, p_symbol text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; n text; pid text; basis text; i int := 1; r tracker.projekt;
begin
  z := tracker._auth(p_code);
  n := btrim(coalesce(p_name, ''));
  if n = '' or length(n) > 40 then
    raise exception 'projekt_name_fehlt' using errcode = '22023';
  end if;
  if p_typ is null or p_typ not in ('flagge', 'emoji', 'bild') or p_symbol is null or length(p_symbol) = 0
     or (p_typ = 'flagge' and p_symbol !~ '^[a-z]{2}$')
     or (p_typ = 'emoji' and (length(p_symbol) > 16 or p_symbol ~ '[A-Za-z0-9<>&"'']'))
     or (p_typ = 'bild' and (length(p_symbol) > 40000 or p_symbol !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$')) then
    raise exception 'symbol_ungueltig' using errcode = '22023';
  end if;
  if exists (select 1 from tracker.projekt where lower(btrim(name)) = lower(n) and id is distinct from p_id) then
    raise exception 'projekt_name_vergeben' using errcode = '23505';
  end if;
  if p_id is null then
    if (select count(*) from tracker.projekt) >= 30 then
      raise exception 'zu_viele_projekte' using errcode = '22023';
    end if;
    basis := left(trim(both '_' from regexp_replace(tracker._ascii(n), '[^a-z0-9]+', '_', 'g')), 20);
    if length(basis) < 2 then basis := 'projekt'; end if;
    pid := basis;
    while exists (select 1 from tracker.projekt where id = pid) loop
      i := i + 1; pid := left(basis, 17) || '_' || i;
    end loop;
    insert into tracker.projekt (id, name, symbol_typ, symbol, reihenfolge)
    values (pid, n, p_typ, p_symbol, coalesce((select max(reihenfolge) from tracker.projekt), 0) + 1)
    returning * into r;
    insert into tracker.protokoll (wer, aktion, person_name) values (z.name, 'projekt_neu', n);
  else
    update tracker.projekt set name = n, symbol_typ = p_typ, symbol = p_symbol where id = p_id returning * into r;
    if not found then
      raise exception 'nicht_gefunden' using errcode = 'P0002';
    end if;
    insert into tracker.protokoll (wer, aktion, person_name) values (z.name, 'projekt_aendern', n);
  end if;
  return jsonb_build_object('id', r.id, 'name', r.name, 'symbol_typ', r.symbol_typ, 'symbol', r.symbol);
end $$;

-- Nur Admin, nur wenn keine Person mehr im Projekt ist, und nie das letzte Projekt.
create or replace function public.tr_projekt_loeschen(p_code text, p_id text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare z tracker.zugang; n text;
begin
  z := tracker._auth(p_code, true);
  if exists (select 1 from tracker.person where projekt_id = p_id) then
    raise exception 'projekt_nicht_leer' using errcode = '22023';
  end if;
  if (select count(*) from tracker.projekt) <= 1 then
    raise exception 'letztes_projekt' using errcode = '22023';
  end if;
  delete from tracker.projekt where id = p_id returning name into n;
  if found then
    insert into tracker.protokoll (wer, aktion, person_name) values (z.name, 'projekt_weg', n);
  end if;
  return jsonb_build_object('geloescht', found);
end $$;

-- ---------------------------------------------------------------- Rechte
revoke all on all functions in schema tracker from public, anon, authenticated;
revoke all on function public.tr_person_speichern(text, uuid, jsonb) from public;
revoke all on function public.tr_import(text, jsonb, boolean) from public;
revoke all on function public.tr_laden(text) from public;
grant execute on function public.tr_person_speichern(text, uuid, jsonb) to anon;
grant execute on function public.tr_import(text, jsonb, boolean) to anon;
revoke all on function public.tr_projekt_speichern(text, text, text, text, text) from public;
revoke all on function public.tr_projekt_loeschen(text, text) from public;
grant execute on function public.tr_laden(text) to anon;
grant execute on function public.tr_projekt_speichern(text, text, text, text, text) to anon;
grant execute on function public.tr_projekt_loeschen(text, text) to anon;
