-- Dauerhafter Test: Geld nur fuer Admins, Inhaber-Schutz, Admin-Portal, Profilbild, Standardstufe, Mail-Status.
-- Nur erfundene Daten. Der Test endet absichtlich mit einem Fehler (RAISE), dadurch wird alles zurueckgerollt und nichts bleibt in der
-- Datenbank. Der Fehlertext ist der Bericht. Jede Zeile soll "ok" sagen, steht irgendwo "FEHLER", ist etwas kaputt.
-- Aufruf (nach allen Migrationen): npx supabase db query --linked --project-ref <ref> -f supabase/tests/geld_und_admin_test.sql

do $test$
declare
  c_inh text := 'ak_test_inhaber_000000000000001'; c_adm text := 'ak_test_admin_0000000000000002'; c_mit text := 'ak_test_mitarbeiter_000000003'; c_mit2 text;
  r jsonb; rep text := ''; pid uuid; pid2 uuid; ids_adm uuid; ids_mit uuid; ids_inh uuid; i uuid; n int; txt text; code text;
begin
  -- Den echten Inhaber nur innerhalb dieses Tests beiseite stellen (wird zurueckgerollt).
  update tracker.zugang set inhaber = false where inhaber;
  insert into tracker.zugang (name, rolle, code_hash, inhaber) values ('zz-inhaber', 'admin', extensions.digest(c_inh, 'sha256'), true) returning id into ids_inh;
  insert into tracker.zugang (name, rolle, code_hash) values ('zz-admin2', 'admin', extensions.digest(c_adm, 'sha256')) returning id into ids_adm;
  insert into tracker.zugang (name, rolle, code_hash) values ('zz-mitarbeiter', 'mitarbeiter', extensions.digest(c_mit, 'sha256')) returning id into ids_mit;

  -- ===== Geld nur fuer Admins =====
  r := public.tr_person_speichern(c_adm, null, '{"email":"geld@example.invalid","mail_status":"erstellt","wert":12.5,"zaehlt":true}'::jsonb);
  pid := (r->>'id')::uuid;
  rep := rep || 'G1 Admin sieht wert/zaehlt: ' || ((r ? 'wert') and (r ? 'zaehlt')) || ' ok; ';
  r := public.tr_laden(c_mit);
  txt := r::text;
  rep := rep || 'G2 Mitarbeiter tr_laden ohne "wert", "zaehlt", "standardwert", "zaehlt_ab", "gruen_am", "status_alt", "abgehakt": '
    || (position('"wert"' in txt) = 0 and position('"zaehlt"' in txt) = 0 and position('"standardwert"' in txt) = 0 and position('"zaehlt_ab"' in txt) = 0
        and position('"gruen_am"' in txt) = 0 and position('"status_alt"' in txt) = 0 and position('"abgehakt"' in txt) = 0) || ' ok; ';
  rep := rep || 'G2b Mitarbeiter sieht die Personen trotzdem: ' || (jsonb_array_length(r->'personen') > 0) || ' ok; ';
  r := public.tr_person_speichern(c_mit, pid, '{"notiz":"x"}'::jsonb);
  rep := rep || 'G3 Mitarbeiter-Antwort ohne Geld: ' || (position('"wert"' in r::text) = 0 and position('"zaehlt"' in r::text) = 0) || ' ok; ';
  begin perform public.tr_person_speichern(c_mit, pid, '{"wert":1}'::jsonb); rep := rep || 'G4a FEHLER; ';
  exception when others then rep := rep || 'G4a Mitarbeiter setzt wert abgelehnt (' || sqlerrm || ') ok; '; end;
  begin perform public.tr_person_speichern(c_mit, pid, '{"zaehlt":true}'::jsonb); rep := rep || 'G4b FEHLER; ';
  exception when others then rep := rep || 'G4b Mitarbeiter setzt zaehlt abgelehnt (' || sqlerrm || ') ok; '; end;
  begin perform public.tr_person_speichern(c_mit, null, '{"email":"m@example.invalid","mail_status":"erhalten","wert":1}'::jsonb); rep := rep || 'G4c FEHLER; ';
  exception when others then rep := rep || 'G4c Mitarbeiter legt Person mit wert an abgelehnt (' || sqlerrm || ') ok; '; end;
  begin perform public.tr_einstellungen_setzen(c_mit, 1, 'erledigt'); rep := rep || 'G5 FEHLER; ';
  exception when others then rep := rep || 'G5 Mitarbeiter Einstellungen abgelehnt (' || sqlerrm || ') ok; '; end;
  begin perform public.tr_protokoll(c_mit); rep := rep || 'G6a FEHLER; '; exception when others then rep := rep || 'G6a Mitarbeiter Protokoll abgelehnt ok; '; end;
  begin perform public.tr_zugaenge(c_mit); rep := rep || 'G6b FEHLER; '; exception when others then rep := rep || 'G6b Mitarbeiter Zugaenge abgelehnt ok; '; end;
  -- Alles, was ein Mitarbeiter sonst lesen kann, enthaelt kein Geld
  txt := public.tr_dateien(c_mit, pid)::text || public.tr_projekt_speichern(c_mit, null, 'Zz Testland', 'emoji', '⭐')::text || public.tr_laden(c_mit)::text || public.tr_status()::text;
  rep := rep || 'G7 weitere lesbare Antworten ohne Geld-Felder: ' || (position('"wert"' in txt) = 0 and position('"zaehlt"' in txt) = 0 and position('"standardwert"' in txt) = 0) || ' ok; ';
  select count(*) into n from information_schema.table_privileges where grantee in ('anon', 'authenticated') and table_schema in ('tracker', 'public');
  rep := rep || 'G8 anon/authenticated haben direkte Tabellenrechte: ' || n || ' (soll 0) ' || (case when n = 0 then 'ok' else 'FEHLER' end) || '; ';

  -- ===== Inhaber und Admin-Portal =====
  begin perform public.tr_zugang_anlegen(c_adm, 'zz-neuer-admin', 'admin'); rep := rep || 'A1 FEHLER; ';
  exception when others then rep := rep || 'A1 Nicht-Inhaber legt keinen Admin an (' || sqlerrm || ') ok; '; end;
  r := public.tr_zugang_anlegen(c_adm, 'zz-neuer-mit', 'mitarbeiter');
  c_mit2 := r->>'code';
  rep := rep || 'A2 Nicht-Inhaber legt Mitarbeiter an, sein Schluessel gilt: ' || ((public.tr_laden(c_mit2)->'ich'->>'rolle') = 'mitarbeiter') || ' ok; ';
  begin perform public.tr_zugang_rolle(c_adm, ids_mit, 'admin'); rep := rep || 'A3 FEHLER; ';
  exception when others then rep := rep || 'A3 Nicht-Inhaber aendert keine Rolle (' || sqlerrm || ') ok; '; end;
  r := public.tr_zugang_rolle(c_inh, ids_mit, 'admin');
  r := public.tr_zugang_rolle(c_inh, ids_mit, 'mitarbeiter');
  rep := rep || 'A4 Inhaber stuft hoch und herab ok; ';
  begin perform public.tr_zugang_rolle(c_adm, ids_inh, 'mitarbeiter'); rep := rep || 'A5a FEHLER; ';
  exception when others then rep := rep || 'A5a Admin kann Inhaber nicht herabstufen (' || sqlerrm || ') ok; '; end;
  begin perform public.tr_zugang_rolle(c_inh, ids_inh, 'mitarbeiter'); rep := rep || 'A5b FEHLER; ';
  exception when others then rep := rep || 'A5b Inhaber stuft sich nicht selbst herab (' || sqlerrm || ') ok; '; end;
  begin perform public.tr_zugang_aendern(c_adm, ids_inh, 'sperren'); rep := rep || 'A6a FEHLER; ';
  exception when others then rep := rep || 'A6a Admin kann Inhaber nicht sperren (' || sqlerrm || ') ok; '; end;
  begin perform public.tr_zugang_aendern(c_adm, ids_inh, 'neuer_code'); rep := rep || 'A6b FEHLER; ';
  exception when others then rep := rep || 'A6b Admin kann Inhaber-Schluessel nicht erneuern (' || sqlerrm || ') ok; '; end;
  begin perform public.tr_zugang_loeschen(c_adm, ids_inh); rep := rep || 'A6c FEHLER; ';
  exception when others then rep := rep || 'A6c Admin kann Inhaber nicht loeschen (' || sqlerrm || ') ok; '; end;
  begin perform public.tr_zugang_loeschen(c_inh, ids_inh); rep := rep || 'A6d FEHLER; ';
  exception when others then rep := rep || 'A6d Inhaber loescht sich nicht selbst (' || sqlerrm || ') ok; '; end;
  r := public.tr_zugang_aendern(c_inh, ids_inh, 'neuer_code');
  c_inh := r->>'code';
  rep := rep || 'A7 Inhaber erneuert eigenen Schluessel, der neue gilt: ' || ((public.tr_laden(c_inh)->'ich'->>'inhaber') = 'true') || ' ok; ';
  r := public.tr_zugang_rolle(c_inh, ids_mit, 'admin');
  begin perform public.tr_zugang_aendern(c_adm, ids_mit, 'sperren'); rep := rep || 'A8a FEHLER; ';
  exception when others then rep := rep || 'A8a Admin sperrt keinen anderen Admin (' || sqlerrm || ') ok; '; end;
  begin perform public.tr_zugang_loeschen(c_adm, ids_mit); rep := rep || 'A8b FEHLER; ';
  exception when others then rep := rep || 'A8b Admin loescht keinen anderen Admin (' || sqlerrm || ') ok; '; end;
  r := public.tr_zugang_rolle(c_inh, ids_mit, 'mitarbeiter');
  r := public.tr_zugang_aendern(c_adm, ids_mit, 'sperren');
  rep := rep || 'A9 Admin sperrt Mitarbeiter ok; ';
  begin perform public.tr_zugang_loeschen(c_mit2, ids_adm); rep := rep || 'A10a FEHLER; ';
  exception when others then rep := rep || 'A10a Mitarbeiter kann nichts loeschen (' || sqlerrm || ') ok; '; end;
  begin perform public.tr_zugang_loeschen(c_adm, ids_adm); rep := rep || 'A10b FEHLER; ';
  exception when others then rep := rep || 'A10b Admin loescht sich nicht selbst (' || sqlerrm || ') ok; '; end;
  r := public.tr_zugang_loeschen(c_adm, ids_mit);
  rep := rep || 'A11 Admin loescht Mitarbeiter ganz: ' || (r->>'geloescht') || ', noch da: ' || (select count(*) from tracker.zugang where id = ids_mit) || ' (soll 0) ok; ';
  begin perform public.tr_laden(c_mit); rep := rep || 'A12 FEHLER: geloeschter Zugang kommt noch rein; ';
  exception when others then rep := rep || 'A12 geloeschter Zugang kommt nicht mehr rein (' || sqlerrm || ') ok; '; end;

  -- ===== Profilbild =====
  r := public.tr_profil_avatar(c_adm, 'violett', 'data:image/jpeg;base64,/9j/4AAQ');
  rep := rep || 'P1 Profilbild gesetzt: ' || (r->>'avatar_farbe') || ' ok; ';
  rep := rep || 'P2 tr_laden zeigt es: ' || ((public.tr_laden(c_adm)->'ich'->>'avatar_farbe') = 'violett') || ' ok; ';
  begin perform public.tr_profil_avatar(c_adm, 'schwarz', null); rep := rep || 'P3a FEHLER; ';
  exception when others then rep := rep || 'P3a falsche Farbe abgelehnt (' || sqlerrm || ') ok; '; end;
  begin perform public.tr_profil_avatar(c_adm, 'blau', 'javascript:alert(1)'); rep := rep || 'P3b FEHLER; ';
  exception when others then rep := rep || 'P3b Bild ohne JPEG-Daten abgelehnt (' || sqlerrm || ') ok; '; end;
  r := public.tr_profil_avatar(c_adm, null, null);
  rep := rep || 'P4 Bild und Farbe entfernen ok; ';

  -- ===== Standardstufe und Mail-Status =====
  r := public.tr_person_speichern(c_adm, null, '{"notiz":"ohne Stufe"}'::jsonb);
  rep := rep || 'S1 neue Person startet auf: ' || (r->>'status') || ' (soll zu_erledigen) ' || (case when r->>'status' = 'zu_erledigen' then 'ok' else 'FEHLER' end) || '; ';
  begin perform public.tr_person_speichern(c_adm, null, '{"email":"ohne.status@example.invalid"}'::jsonb); rep := rep || 'S2a FEHLER; ';
  exception when others then rep := rep || 'S2a Mail ohne Status abgelehnt (' || sqlerrm || ') ok; '; end;
  r := public.tr_person_speichern(c_adm, null, '{"name":"Zz Statusperson","email":"mit.status@example.invalid","mail_status":"erhalten"}'::jsonb);
  pid2 := (r->>'id')::uuid;
  rep := rep || 'S2b Mail mit Status ok; ';
  begin perform public.tr_person_speichern(c_adm, pid2, '{"email":"andere.mail@example.invalid","mail_status":""}'::jsonb); rep := rep || 'S3a FEHLER; ';
  exception when others then rep := rep || 'S3a Mail aendern und Status leeren abgelehnt (' || sqlerrm || ') ok; '; end;
  r := public.tr_person_speichern(c_adm, pid2, '{"email":"andere.mail@example.invalid"}'::jsonb);
  rep := rep || 'S3b Mail aendern, Status bleibt: ' || (r->>'mail_status') || ' ok; ';
  r := public.tr_person_speichern(c_adm, pid2, '{"email":null}'::jsonb);
  rep := rep || 'S4 Mail entfernt, Status weg: ' || coalesce(r->>'mail_status', 'null') || ' ok; ';
  -- Altbestand mit Mail, aber ohne Status, bleibt bearbeitbar
  insert into tracker.person (name, email, erstellt_von, projekt_id) values ('zz Altbestand', 'alt@example.invalid', 'zz', (select id from tracker.projekt order by reihenfolge limit 1)) returning id into pid2;
  r := public.tr_person_speichern(c_adm, pid2, '{"notiz":"geaendert"}'::jsonb);
  rep := rep || 'S5 Altbestand ohne Mail-Status bleibt bearbeitbar ok; ';

  raise exception 'TEST-BERICHT: %', rep;
end $test$;
