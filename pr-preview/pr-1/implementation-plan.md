# Umsetzungsplan: jellyfin-watchback

## Ziel

Persönliche Jahresrückblicke für Jellyfin mit kontinuierlicher Aktivitätsaufzeichnung, unveränderlichen Jahresberichten, acht Sprachen und automatisierten Tests.

## Umsetzung

1. [x] Solution mit Produktions- und xUnit-Testprojekt, festgelegten .NET-/Node-Versionen, Analyzern und Lockfiles anlegen.
2. [x] Plugin-ID, API, Dienstregistrierung und Datenverzeichnis `<DataPath>/jellyfin-watchback/` einrichten.
3. [x] Wiedergabeereignisse beobachten und vorhandene Jellyfin-Aktivität beim Start und stündlich einlesen.
4. [x] Benutzerbezogene Beobachtungen, Metadaten und gemessene Wiedergabeabschnitte atomar speichern.
5. [x] Jahresaggregation, Kalenderfenster und wiederanlaufsichere Veröffentlichung implementieren.
6. [x] Authentifizierte persönliche API und Administrator-Einstellungen mit Datumsvalidierung bereitstellen.
7. [x] Rückblick in die native Jellyfin-Navigation einbinden; Einstellungen dauerhaft sichtbar anzeigen.
8. [x] Beschriftungen anhand der aktiven Jellyfin-Benutzersprache in acht Sprachen laden.
9. [x] Monats- und Kreisdiagramme, Sehgewohnheiten, Streaks und Vorjahresvergleich anzeigen.
10. [x] GitHub-Pages-Demo mit Beispieldaten bereitstellen.
11. [x] Backend-, UI-, Browser- und echte Jellyfin-E2E-Tests sowie Dokumentationsprüfungen einrichten.
12. [x] PR-, E2E-, Release-, Nightly-, Pages-, CodeQL- und Renovate-Workflows sowie CodeRabbit konfigurieren.

## Verhalten und Abnahme

- Aktivitätsaufzeichnung läuft immer; nur die Rückblick-Anzeige ist standardmäßig deaktiviert.
- Standard-Anzeigezeitraum: 15.12.–15.01. einschließlich Enddatum.
- Pro Benutzer wird am ersten Tag um 00:00 Serverzeit ein Bericht für den vorausgehenden Jahreszeitraum erzeugt und im nächsten Jahr ersetzt.
- Nach Ende des Anzeigezeitraums verschwindet nur der Tab; der Bericht bleibt gespeichert.
- Veröffentlichte Berichte werden nicht nachträglich verändert.
- Gemessene und rekonstruierte Wiedergabe bleiben unterscheidbar.
- Jeder Benutzer erhält ausschließlich Zugriff auf seinen eigenen Bericht.
- Build, Backend- und UI-Tests, responsive Browserprüfungen, E2E und Workflow-Validierung müssen erfolgreich sein.

## GitHub-Einrichtung

GitHub-Apps, Secrets, Pages und Branch-Regeln werden im Repository eingerichtet. Die konkrete Checkliste steht in [repository-setup.md](repository-setup.md).
