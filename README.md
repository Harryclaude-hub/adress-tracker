# Adress-Tracker

Gemeinsame Liste fuer Personen mit State, Nummer, E-Mail, zugeteilter Adresse und Adressnummer. Stufen von Hand (Leer, Zu erledigen,
Erledigt, Uebernommen, Test), Dateien und Fotos je Person, ein Wert in Euro je Person (Standard einstellbar) mit "Dazurechnen" und eine
Uebersicht, was schon angekommen ist. Startbildschirm mit Projekten (USA, Bangladesch, Finnland, weitere selbst anlegen mit Flagge, Emoji oder Foto), der Gewinn ist ueber alle
Projekte gemeinsam. Kein Name und keine Mail darf in der ganzen Datenbank doppelt
vorkommen, aehnliche Namen werden blau gezeigt. Mail-Status (erhalten, erstellt) und Konten (Bet Online, Stake).
Alles Geldtechnische (Wert, Gewinn, Uebersicht, PDF-Export) sieht nur ein Admin, ein Mitarbeiter sieht nur Personen und Konten.
Admin-Portal: Zugaenge anlegen, sperren und loeschen, Rollen vergeben. Der Inhaber (erster Admin) ist geschuetzt. Jeder kann Profilbild und Farbe waehlen.
Der Test `supabase/tests/geld_und_admin_test.sql` prueft Geld-Sichtbarkeit und Admin-Regeln mit erfundenen Daten.
Eine Seite (`index.html`), keine Build-Schritte, Daten in einem eigenen Supabase-Projekt.

Dieses Repo enthaelt nur Code und Migrationen, keine Daten.

## Zugang

- Keine Konten mit E-Mail und Passwort. Jede Person bekommt vom Admin einen eigenen, zufaelligen Zugangsschluessel
  (am besten als Link `...#k=SCHLUESSEL`, er wird nach dem Oeffnen aus der Adresszeile entfernt).
- Der Admin sieht unter "Zugaenge", wer Zugang hat, wann zuletzt online, kann sperren und Schluessel erneuern.
- Rollen: Admin (alles, Import, Loeschen, Zugaenge, Protokoll, CSV) und Mitarbeiter (sehen, anlegen, bearbeiten).
- Schluessel stehen nur als SHA-256 in der Datenbank und werden einmal angezeigt.

## Sicherheit

- Tabellen liegen im Schema `tracker`, das die API nicht freigibt. RLS an, keine Policies.
- Zugriff nur ueber die Funktionen `public.tr_*`, jede prueft den Zugangsschluessel (`supabase/migrations`).
  Die Sicherheit haengt an den zufaelligen 160-Bit-Schluesseln, nicht an geheimem Code.
- Der Projektschluessel in `app.js` ist der oeffentliche (publishable) Schluessel, kein Geheimnis.
- Die Seite hat eine strenge Content-Security-Policy (nur Verbindung zum eigenen Supabase-Projekt).
- Hochgeladene Dateien werden nie im Browser ausgefuehrt: nur jpeg, png, webp und gif werden als Bild gezeigt, alles andere
  wird nur heruntergeladen. Grenzen: 5 MB je Datei, 20 je Person, 300 MB insgesamt.

## Erste Einrichtung

Beim ersten Oeffnen verlangt die Seite einen einmaligen Einrichtungs-Schluessel und erzeugt den Admin-Zugang.
Der Einrichtungs-Schluessel steht nirgends im Repo.

## Hinweis: Verschluesselung

Eine Ende-zu-Ende-Verschluesselung (Migration 006) war gebaut und kurz live, wurde aber zurueckgenommen, bevor ein Eintrag
umgewandelt wurde (Migration 007). Die Datei `krypto.js` gehoert nicht mehr zu diesem Repo. Daten liegen im Klartext in der Datenbank.
