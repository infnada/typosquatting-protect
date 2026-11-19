# Firmen-Rollout per Gruppenrichtlinie (Chrome und Edge)

Diese Anleitung beschreibt, wie du die Erweiterung selbst hostest, per GPO auf
allen Rechnern installierst und eine Firmen-Whitelist zentral pflegst.

Die Firmen-Whitelist liegt ausschließlich in der GPO. Eine neue Domain ist dort
eine neue Zeile; die Erweiterung muss dafür nicht neu verteilt werden.

## Voraussetzungen

- Rechner in einer Active-Directory-Domäne. Chrome und Edge installieren
  selbst gehostete Erweiterungen unter Windows nur auf verwalteten Geräten.
- Chrome bzw. Edge ab Version 153.
- Ein interner Webserver, den alle Rechner erreichen (HTTPS empfohlen).
- Die offiziellen Richtlinienvorlagen von
  [Chrome](https://chromeenterprise.google/browser/download/) und
  [Edge](https://www.microsoft.com/edge/business/download) im zentralen
  Richtlinienspeicher.
- [Node.js](https://nodejs.org/) auf deinem Arbeitsrechner, um die Dateien zu
  erzeugen.

## Einmalige Einrichtung

### 1. Dateien erzeugen

Im Projektordner, mit der Adresse des Ordners auf eurem Webserver:

```bash
node scripts/enterprise.js --url https://intranet.example.com/extensions --key key.pem
```

Beim ersten Aufruf wird `key.pem` neu erstellt. Diese Datei legt die
Extension-ID fest und wird für jedes spätere Update gebraucht. Bewahre sie
sicher auf und gib sie nicht weiter; sie gehört nicht ins Repository.

Danach liegt in `dist/enterprise`:

| Datei / Ordner | Zweck |
| --- | --- |
| `domain-whitelist-protector/` | Die Erweiterung, bereit zum Packen |
| `update.xml` | Update-Beschreibung für den Webserver |
| `PolicyDefinitions/` | GPO-Vorlagen (`.admx`, `.adml` in Deutsch und Englisch) |
| `gpo-values.txt` | Extension-ID und die Werte, die du in die GPO einträgst |
| `Sync-DwpPolicy.ps1` | Überträgt den Ordner „Global“ nach Chrome und Edge (siehe unten) |

### 2. Erweiterung packen

1. In Chrome `chrome://extensions` öffnen (in Edge `edge://extensions`) und
   den Entwicklermodus einschalten.
2. „Erweiterung packen“ wählen.
3. Stammverzeichnis: `dist/enterprise/domain-whitelist-protector`
4. Datei mit privatem Schlüssel: deine `key.pem`

Das Ergebnis ist `dist/enterprise/domain-whitelist-protector.crx`. Dasselbe
Paket funktioniert in Chrome und Edge.

Alternativ per Kommandozeile:

```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --pack-extension=C:\pfad\dist\enterprise\domain-whitelist-protector --pack-extension-key=C:\pfad\key.pem
```

### 3. Auf den Webserver legen

Lade `domain-whitelist-protector.crx` und `update.xml` in den Ordner, den du
bei `--url` angegeben hast. Beide Adressen stehen in `gpo-values.txt`.

Bei IIS muss für die Endung `.crx` ein MIME-Typ eingetragen sein
(`application/x-chrome-extension`), sonst liefert der Server die Datei nicht
aus.

### 4. GPO-Vorlagen einspielen

Kopiere den Inhalt von `dist/enterprise/PolicyDefinitions` in den zentralen
Richtlinienspeicher:

```
\\<domäne>\SYSVOL\<domäne>\Policies\PolicyDefinitions\
```

Die `.admx`-Datei kommt direkt in diesen Ordner, die `.adml`-Dateien in die
Unterordner `de-DE` und `en-US`.

### 5. Erweiterung per GPO installieren

In der Gruppenrichtlinienverwaltung eine GPO anlegen oder öffnen und unter
*Computerkonfiguration → Richtlinien → Administrative Vorlagen* die
Richtlinie `ExtensionInstallForcelist` aktivieren:

- Chrome: *Google → Google Chrome → Erweiterungen*
- Edge: *Microsoft Edge → Erweiterungen*

Trage dort den Wert aus `gpo-values.txt` ein. Er hat die Form:

```
<Extension-ID>;https://intranet.example.com/extensions/update.xml
```

### 6. Firmen-Whitelist eintragen

In derselben GPO unter *Computerkonfiguration → Richtlinien → Administrative
Vorlagen → Domain Whitelist Protector* gibt es je einen Ordner für
**Google Chrome** und **Microsoft Edge** mit denselben Einstellungen.

1. „Firmen-Whitelist“ öffnen und auf **Aktiviert** stellen.
2. **Anzeigen…** klicken.
3. Eine Domain pro Zeile eintragen, zum Beispiel:

   ```
   *.sharepoint.com
   *.office.com
   intranet.example.com
   ```

Ein Eintrag mit `*.` gilt für die Domain und alle Subdomains. Vollständige
Adressen wie `https://firma.sharepoint.com/sites/team` werden auf die Domain
gekürzt.

Chrome und Edge lesen ihre Richtlinien aus getrennten Bereichen. Wenn ihr
beide Browser nutzt, trage die Liste in beiden Ordnern ein, oder nutze den
Ordner „Global“.

### Einmal konfigurieren für beide Browser: der Ordner „Global“

Neben **Google Chrome** und **Microsoft Edge** gibt es unter *Domain Whitelist
Protector* den Ordner **Global** mit denselben Einstellungen. Kein Browser
liest diesen Ordner. Er dient als einzige Stelle, an der du die Erweiterung
pflegst; das Skript `Sync-DwpPolicy.ps1` überträgt die Werte danach in die
Ordner für Chrome und Edge derselben GPO.

1. Alle Einstellungen der Erweiterung nur unter **Global** setzen
   (Whitelist, Maildomains, Hinweistext usw.). Die Zwangsinstallation
   (`ExtensionInstallForcelist`) bleibt wie bisher unter Chrome und Edge.
2. Auf einem Rechner mit Gruppenrichtlinienverwaltung (zum Beispiel dem
   Domänencontroller) in PowerShell als Administrator erst einen Probelauf
   machen. `-WhatIf` zeigt nur an, was passieren würde:

   ```powershell
   .\Sync-DwpPolicy.ps1 -GpoName "<Name der GPO>" -ExtensionId <Extension-ID> -WhatIf
   ```

3. Denselben Befehl ohne `-WhatIf` ausführen.

Das Skript ersetzt jedes Mal **alle** Einstellungen der Erweiterung in den
Ordnern Google Chrome und Microsoft Edge durch die Werte aus Global. Was dort
von Hand eingetragen wurde, geht dabei verloren; andere Einstellungen der GPO
bleiben unverändert. Ist Global leer, bricht das Skript ab, statt alles zu
löschen.

| Parameter | Bedeutung |
| --- | --- |
| `-GpoName` | Anzeigename der GPO |
| `-ExtensionId` | Extension-ID aus `gpo-values.txt` |
| `-Scope` | `User` (Standard) für Einstellungen unter Benutzerkonfiguration, `Computer` für Computerkonfiguration |
| `-AllowEmpty` | Erlaubt einen leeren Ordner Global und entfernt dann alle Einstellungen der Erweiterung für Chrome und Edge |
| `-WhatIf` | Probelauf ohne Änderungen |

Vor dem ersten echten Lauf empfiehlt sich eine Sicherung der GPO, zum Beispiel
`Backup-GPO -Name "<Name der GPO>" -Path C:\GPO-Backup`.

Startet PowerShell das Skript wegen der Ausführungsrichtlinie nicht, hilft
für diesen Aufruf `powershell -ExecutionPolicy Bypass -File
.\Sync-DwpPolicy.ps1 …`.

Der Ordner Global hängt nicht von der Extension-ID ab. Ändert sich die ID,
bleiben die Einstellungen dort erhalten; nach dem Einspielen der neuen Vorlage
genügt ein Lauf des Skripts mit der neuen ID.

## Rollout an eine Opt-in-Gruppe

Soll die Erweiterung zunächst nur bei ausgewählten Personen oder Rechnern
landen, wird die GPO per Sicherheitsfilterung auf eine AD-Gruppe beschränkt.
Die Einstellungen der Erweiterung gibt es sowohl unter der Computer- als auch
unter der Benutzerkonfiguration.

| | Benutzergruppe | Computergruppe |
| --- | --- | --- |
| Mitglieder der Gruppe | Benutzerkonten | Computerkonten |
| Einstellungen setzen unter | Benutzerkonfiguration | Computerkonfiguration |
| GPO verknüpfen mit | OU der Benutzer (oder Domäne) | OU der Computer (oder Domäne) |
| Wirkt nach | Ab- und Anmelden | Neustart des Rechners |

Alle Einstellungen einer GPO gehören in denselben Zweig: die
Zwangsinstallation (`ExtensionInstallForcelist`), die Firmen-Whitelist und
alles Weitere.

Sicherheitsfilterung der GPO (Registerkarte *Bereich*):

1. Unter *Sicherheitsfilterung* „Authentifizierte Benutzer“ entfernen und die
   Opt-in-Gruppe hinzufügen.
2. Auf der Registerkarte *Delegierung* „Authentifizierte Benutzer“ wieder
   hinzufügen, aber nur mit der Berechtigung **Lesen**. Ohne dieses Leserecht
   wird eine benutzerbezogene GPO nicht angewendet.

Verlässt jemand die Gruppe, entfernt Windows die Richtlinienwerte beim
nächsten Anwenden wieder, und der Browser deinstalliert die Erweiterung.

## Alle Einstellungen

| Einstellung | Wirkung |
| --- | --- |
| Firmen-Whitelist | Domains, die für alle immer erlaubt sind |
| Benutzer dürfen eigene Domains erlauben | Deaktiviert: nur die Firmen-Whitelist gilt. Andere Seiten lassen sich nach der Warnung weiterhin öffnen, aber nicht dauerhaft erlauben |
| Bestätigungsseite für nicht erlaubte Domains erzwingen | Aktiviert: Benutzer können die Vorabprüfung nicht abschalten |
| Warnleiste auf nicht erlaubten Seiten erzwingen | Deaktiviert: Die rote Leiste erscheint nie. Bestätigungsseite und Warnung bei Anmeldung bleiben aktiv |
| Höhe der Warnleiste | Schmal (eine kleine Zeile, Standard) oder Normal |
| Länderprüfung erzwingen | Schaltet die Länderabfrage fest ein oder aus |
| Abfragedienst für die Länderprüfung | Legt den Dienst fest: ipwho.is oder geojs.io (beide verschlüsselt, Auflösung über Google Public DNS) oder ip-api.com (unverschlüsselt). Vor gewerblicher Nutzung die Nutzungsbedingungen des Dienstes prüfen |
| Firmen-Maildomains (Warnung bei Anmeldung) | Adressen dieser Domains lösen auf nicht erlaubten Seiten eine rote Warnung am Eingabefeld aus |
| Hinweistext auf der Bestätigungsseite | Frei wählbarer Text für die Benutzer, z. B. „Im Zweifel IT-Helpdesk anrufen: Durchwahl 123“ |
| Blockierte Länder | Zweistellige Ländercodes (z. B. `RU`), die immer blockiert sind |

Nicht konfigurierte Einstellungen bleiben in der Hand der Benutzer.

Das Ausblenden der Warnleiste betrifft nur die Leiste selbst. Ob ein Benutzer
sie für eine Website schließt oder sie per Richtlinie abgeschaltet ist: Die
Bestätigungsseite mit ihren Ähnlichkeitswarnungen und die Warnung bei Eingabe
der Firmen-Anmeldung bleiben aktiv.

## Warnung bei Eingabe der Firmen-Anmeldung

Die Erweiterung kann warnen, sobald jemand eine Firmen-E-Mail-Adresse in ein
Feld auf einer nicht freigegebenen Seite eingibt: Das Feld und die
Passwortfelder der Seite werden rot markiert, und ein Hinweis erscheint direkt
neben dem Feld. Die Prüfung findet nur im Browser statt.

Dafür genügt eine Einstellung in der GPO, im selben Ordner wie die
Firmen-Whitelist:

1. „Firmen-Maildomains (Warnung bei Anmeldung)“ öffnen und auf **Aktiviert**
   stellen.
2. **Anzeigen…** klicken und die Maildomains eintragen, eine pro Zeile, ohne
   `@`:

   ```
   example.com
   ```

Danach löst jede Adresse aus, die auf `@example.com` endet (auch
`@mail.example.com`). Wie bei der Whitelist gilt: für Chrome und Edge jeweils
eintragen. Auf freigegebenen Seiten erscheint keine Warnung.

### Optional: weitere Kennungen pro Benutzer

Soll zusätzlich der reine Anmeldename auslösen, kann er pro Benutzer über die
Richtlinie `protectedLogins` mitgegeben werden. Das geht nur über die
Gruppenrichtlinien-Einstellungen (*Benutzerkonfiguration → Einstellungen →
Windows-Einstellungen → Registrierung*), weil nur dort Variablen aufgelöst
werden:

| Feld | Wert |
| --- | --- |
| Struktur | `HKEY_CURRENT_USER` |
| Schlüsselpfad | der Richtlinienpfad aus `gpo-values.txt` (ohne `HKLM\`), ergänzt um `\protectedLogins` |
| Name | `1` |
| Werttyp | `REG_SZ` |
| Wertdaten | `%LogonUser%` |

## Im Alltag

### Domain hinzufügen oder entfernen

1. GPO öffnen → *Domain Whitelist Protector* → „Firmen-Whitelist“ →
   **Anzeigen…**
2. Zeile ergänzen oder löschen, mit OK bestätigen.
3. Wenn du den Ordner Global nutzt: danach `Sync-DwpPolicy.ps1` ausführen.

Die Rechner übernehmen die Änderung beim nächsten Richtlinien-Refresh
(standardmäßig etwa alle 90 Minuten, sofort mit `gpupdate /force`). Ein
Neustart des Browsers ist nicht nötig.

### Prüfen, ob die Richtlinie ankommt

`chrome://policy` bzw. `edge://policy` öffnen. Die Einstellungen stehen dort
unter dem Namen der Erweiterung. Im Popup der Erweiterung erscheinen die
Firmen-Domains unter „Von Ihrer Organisation verwaltet“.

### Neue Version der Erweiterung verteilen

1. Versionsnummer in `src/manifest.json` erhöhen.
2. Schritt 1 und 2 mit **derselben** `key.pem` wiederholen.
3. Die neue `.crx` und `update.xml` auf den Webserver legen.

Die Browser holen das Update innerhalb einiger Stunden selbst. Die GPO und die
Whitelist bleiben unverändert.

## Späterer Wechsel in einen Store

Chrome Web Store und Edge Add-ons vergeben eine eigene Extension-ID. Bei einem
Wechsel:

1. Vorlagen für die neue ID erzeugen:
   `node scripts/enterprise.js --url <egal> --id <neue ID>` und nur den Ordner
   `PolicyDefinitions` verwenden.
2. In der GPO die neue ID bei `ExtensionInstallForcelist` eintragen und die
   Firmen-Whitelist unter den neuen Vorlagen erneut eintragen.

Eigene Einträge der Benutzer hängen an der alten ID und müssen bei Bedarf über
Export/Import im Popup übertragen werden.
