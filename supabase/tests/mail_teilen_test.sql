-- Dauerhafter Test: Mails teilen (erstellt bei zwei Eintraegen getrennt nach Konto, erhalten nur einmal) und Namens-Eindeutigkeit.
-- Nur erfundene Daten, endet absichtlich mit einem Fehler (RAISE) und rollt alles zurueck. Jede Zeile soll "ok" sagen.
-- Aufruf (nach allen Migrationen): npx supabase db query --linked --project-ref <ref> -f supabase/tests/mail_teilen_test.sql

do $test$
declare
  code text := 'ak_test_mail_admin_000000000001'; rep text := ''; r jsonb; a uuid; b uuid; c uuid; d uuid; e uuid; f uuid;
begin
  insert into tracker.zugang (name, rolle, code_hash) values ('zz-mailtest', 'admin', extensions.digest(code, 'sha256'));

  -- Erhaltene Mail: nur einmal
  a := (public.tr_person_speichern(code, null, '{"name":"Zz Erhalten Eins","email":"erhalten@example.invalid","mail_status":"erhalten","betonline":true}'::jsonb)->>'id')::uuid;
  begin perform public.tr_person_speichern(code, null, '{"name":"Zz Erhalten Zwei","email":"ERHALTEN@example.invalid","mail_status":"erhalten"}'::jsonb); rep := rep || 'M1a FEHLER; ';
  exception when others then rep := rep || 'M1a erhaltene Mail kein zweites Mal als erhalten (' || sqlerrm || ') ok; '; end;
  begin perform public.tr_person_speichern(code, null, '{"name":"Zz Erhalten Drei","email":"erhalten@example.invalid","mail_status":"erstellt"}'::jsonb); rep := rep || 'M1b FEHLER; ';
  exception when others then rep := rep || 'M1b erhaltene Mail auch nicht als erstellt (' || sqlerrm || ') ok; '; end;

  -- Erstellte Mail: Bet Online bei A, Stake bei B
  b := (public.tr_person_speichern(code, null, '{"name":"Zz Erstellt Eins","email":"erstellt@example.invalid","mail_status":"erstellt","betonline":true}'::jsonb)->>'id')::uuid;
  c := (public.tr_person_speichern(code, null, '{"name":"Zz Erstellt Zwei","email":"erstellt@example.invalid","mail_status":"erstellt","stake":true}'::jsonb)->>'id')::uuid;
  rep := rep || 'M2 erstellte Mail bei zwei Eintraegen, Bet Online getrennt von Stake ok; ';
  begin perform public.tr_person_speichern(code, null, '{"name":"Zz Erstellt Drei","email":"erstellt@example.invalid","mail_status":"erstellt"}'::jsonb); rep := rep || 'M3a FEHLER; ';
  exception when others then rep := rep || 'M3a dritter Eintrag abgelehnt (' || sqlerrm || ') ok; '; end;

  -- Konto doppelt belegt
  d := (public.tr_person_speichern(code, null, '{"name":"Zz Konto Eins","email":"konto@example.invalid","mail_status":"erstellt","betonline":true}'::jsonb)->>'id')::uuid;
  begin perform public.tr_person_speichern(code, null, '{"name":"Zz Konto Zwei","email":"konto@example.invalid","mail_status":"erstellt","betonline":true}'::jsonb); rep := rep || 'M4a FEHLER; ';
  exception when others then rep := rep || 'M4a Bet Online zweimal mit derselben Mail abgelehnt (' || sqlerrm || ') ok; '; end;
  e := (public.tr_person_speichern(code, null, '{"name":"Zz Konto Zwei","email":"konto@example.invalid","mail_status":"erstellt"}'::jsonb)->>'id')::uuid;
  rep := rep || 'M4b zweiter Eintrag ohne Konto ist ok; ';
  begin perform public.tr_person_speichern(code, e, '{"betonline":true}'::jsonb); rep := rep || 'M4c FEHLER; ';
  exception when others then rep := rep || 'M4c spaeter Bet Online beim zweiten Eintrag abgelehnt (' || sqlerrm || ') ok; '; end;
  r := public.tr_person_speichern(code, e, '{"stake":true}'::jsonb);
  rep := rep || 'M4d dafuer Stake beim zweiten Eintrag ok: ' || (r->>'stake') || '; ';

  -- Voll: beide Konten bei einem Eintrag
  f := (public.tr_person_speichern(code, null, '{"name":"Zz Beides","email":"beides@example.invalid","mail_status":"erstellt","betonline":true,"stake":true}'::jsonb)->>'id')::uuid;
  begin perform public.tr_person_speichern(code, null, '{"name":"Zz Beides Zwei","email":"beides@example.invalid","mail_status":"erstellt"}'::jsonb); rep := rep || 'M5 FEHLER; ';
  exception when others then rep := rep || 'M5 Mail mit beiden Konten ist voll (' || sqlerrm || ') ok; '; end;

  -- Status aendern, solange die Mail geteilt wird
  begin perform public.tr_person_speichern(code, c, '{"mail_status":"erhalten"}'::jsonb); rep := rep || 'M6 FEHLER; ';
  exception when others then rep := rep || 'M6 geteilte Mail kann nicht auf erhalten gestellt werden (' || sqlerrm || ') ok; '; end;

  -- Gmail-Schreibweisen zaehlen als gleiche Mail
  perform public.tr_person_speichern(code, null, '{"name":"Zz Gmail Eins","email":"a.b.c@gmail.com","mail_status":"erstellt","betonline":true}'::jsonb);
  begin perform public.tr_person_speichern(code, null, '{"name":"Zz Gmail Zwei","email":"abc+x@googlemail.com","mail_status":"erstellt","betonline":true}'::jsonb); rep := rep || 'M7a FEHLER; ';
  exception when others then rep := rep || 'M7a Gmail-Schreibweisen: Bet Online schon vergeben (' || sqlerrm || ') ok; '; end;
  perform public.tr_person_speichern(code, null, '{"name":"Zz Gmail Drei","email":"abc@gmail.com","mail_status":"erstellt","stake":true}'::jsonb);
  rep := rep || 'M7b Gmail-Schreibweise mit Stake geteilt ok; ';

  -- Freigeben beim Loeschen
  perform public.tr_person_loeschen(code, c);
  perform public.tr_person_speichern(code, null, '{"name":"Zz Erstellt Vier","email":"erstellt@example.invalid","mail_status":"erstellt","stake":true}'::jsonb);
  rep := rep || 'M8 nach Loeschen ist der Stake-Platz wieder frei ok; ';

  -- Namen bleiben eindeutig
  begin perform public.tr_person_speichern(code, null, '{"name":"zz  erstellt eins","email":"neu@example.invalid","mail_status":"erstellt"}'::jsonb); rep := rep || 'N1 FEHLER; ';
  exception when others then rep := rep || 'N1 gleicher Name bleibt verboten (' || sqlerrm || ') ok; '; end;

  -- Altbestand mit eindeutiger Mail bleibt frei aenderbar
  r := public.tr_person_speichern(code, a, '{"notiz":"x"}'::jsonb);
  rep := rep || 'M9 normale Aenderung an erhaltener Mail ok; ';

  raise exception 'TEST-BERICHT: %', rep;
end $test$;
