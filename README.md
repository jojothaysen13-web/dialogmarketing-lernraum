# Dialogmarketing Lernraum

Lokale Lernplattform für die Ausbildung Kaufmann/Kauffrau für Dialogmarketing.
Aufbau und Erscheinungsbild orientieren sich am Moodle-4.x-Theme Boost
(kein Moodle-Logo, kein Moodle als Seitentitel).

## Start

Die Seite läuft offline. Am einfachsten einen kleinen lokalen Server im
Projektordner starten, damit `localStorage` und relative Pfade zuverlässig sind:

```bash
python3 -m http.server 8080
```

Dann im Browser `http://localhost:8080` öffnen.

## Inhalt

- **Dashboard** mit Zeitleiste, Monatskalender und Kurskacheln (Lernfelder)
  inklusive Fortschrittsbalken
- **Kursseiten** je Lernfeld: Überblick, Lernkarten, Quiz, Termine des Kurses
- **Navigation:** Startseite, Dashboard, Meine Kurse, Kalender, plus
  Kursindex sowie „Fehler wiederholen“ und „Prüfungstraining“
- **Klausurenplaner:** Termine anlegen, bearbeiten, löschen (Titel, Datum,
  optionale Uhrzeit, Lernfeld, Art, Notiz), gespeichert in `localStorage`
- Lernplan-Vorschlag bei Klausuren (ab 14 Tagen vorher täglich das Quiz)
- Export der Termine als `.ics`
- Der Planer startet **leer** („Trage deine erste Klausur ein“) – es sind
  keine Klausurdaten vorbelegt
- Tests im Stil eines Moodle-Tests (Frage für Frage, Testnavigation,
  Überprüfungsseite mit Rückmeldung)

Lernfelder: LF5 Beschwerdemanagement und Zahlungsverkehr, LF6 Markt und
Preisbildung, LF8 Kaufvertragsstörungen, LF9 Projektmanagement.
Fragen und Karten stammen aus den vorhandenen Lernzetteln und Selbsttests.

## Lizenz

GPLv3, siehe `LICENSE` und `NOTICE`. Bootstrap 4.6.2 liegt lokal unter
`vendor/` (MIT).
