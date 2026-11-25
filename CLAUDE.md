# Adress-Tracker: Regeln fuer Claude

**Die Daten in der Datenbank sind privat. Claude liest sie nicht.**

- Die Daten liegen im Klartext in der Datenbank (die Verschluesselung wurde zurueckgenommen, siehe README). Das ist eine
  Verhaltensregel, keine technische Sperre.
- Kein `select` auf `tracker.person`, `tracker.protokoll`, `tracker.zugang`, `tracker.datei`, keine Ausgabe von Zeilen, kein Export,
  kein Dump. Erlaubt sind Schema-Aenderungen, Funktionen und Zaehlungen ohne Inhalte.
- Probelaeufe nur mit erfundenen Testdaten in `begin; ... rollback;` und mit Ausgaben, die keine echten Zeilen enthalten.
- Nie einen echten Zugangsschluessel (`ak_...`) ausgeben oder in eine Datei schreiben. Nie `service_role` benutzen.
- Aenderungen an der Datenbank nur nach Karams Wort, vorher ein Probelauf.
- Dieses Repo ist oeffentlich. Nie Schluessel, Daten, E-Mail-Adressen oder Namen echter Personen in Dateien oder Commit-Texte schreiben.
  Commits nur mit der GitHub-noreply-Adresse (`git config user.email` in diesem Ordner ist so gesetzt).

Aufbau: Eine Seite ohne Build (`index.html`, `app.js`, `stil.css`), Daten im Supabase-Projekt "Adress-Tracker"
(`rsthdilxubmefulnthgc`). Zugriff nur ueber `public.tr_*` Funktionen (`supabase/migrations`, 001 bis 005 gelten,
006 ist durch 007 zurueckgenommen, 008 Name optional, 009 und 010 Stufen von Hand, 011 Dateien je Person, Wert und Einstellungen, 012 Dateischutz, 013 Projekte, Eindeutigkeit, Konten, 014 Konten-Regel nur bei erhaltener Mail, 015 Geld nur fuer Admins, Import entfernt, 016 Admin-Portal, Profilbild, Standardstufe, Mail-Status Pflicht, 017 Mails teilen).
- Nach jeder Aenderung an Funktionen, die Personendaten liefern: `supabase/tests/geld_und_admin_test.sql` laufen lassen (Probelauf mit erfundenen Daten,
  endet absichtlich mit einem Fehler und rollt alles zurueck). Jede Zeile muss `ok` sagen. Er beweist, dass ein Mitarbeiter kein Geld bekommt.
- Nach jeder Aenderung an Personen- oder Mail-Regeln auch `supabase/tests/mail_teilen_test.sql` laufen lassen (gleiche Art wie der Geld-Test).
