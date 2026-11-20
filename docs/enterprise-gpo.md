# Firmen-Rollout per Gruppenrichtlinie (Chrome und Edge)

Diese Anleitung beschreibt den kompletten Weg: vom Download des Projekts über
das Erzeugen und Prüfen der Dateien, den Webserver und die AD-Gruppe bis zur
GPO, die die Erweiterung installiert und die Firmen-Whitelist verteilt.

Die Firmen-Whitelist liegt ausschließlich in der GPO. Eine neue Domain ist dort
eine neue Zeile; die Erweiterung muss dafür nicht neu verteilt werden.

In den Beispielen stehen Platzhalter, die du durch eure Werte ersetzt:

| Platzhalter | Bedeutung |
| --- | --- |
| `C:\Rollout` | Arbeitsordner auf dem Admin-PC |
| `https://intranet.example.com/extensions` | Adresse des Ordners auf eurem Webserver |
| `<domäne>` | Name eurer AD-Domäne |
| `<Extension-ID>` | Die ID der Erweiterung aus `gpo-values.txt` |
| `<Name der GPO>` | Name der Gruppenrichtlinie für die Erweiterung |
| `<Name der Gruppe>` | Name der AD-Gruppe, die die Erweiterung bekommt |

## Inhalt

1. [Überblick](#überblick)
2. [Teil 1: Admin-PC vorbereiten](#teil-1-admin-pc-vorbereiten)
3. [Teil 2: Rollout-Dateien erzeugen](#teil-2-rollout-dateien-erzeugen)
4. [Teil 3: Webserver einrichten (IIS)](#teil-3-webserver-einrichten-iis)
5. [Teil 4: Richtlinienvorlagen einspielen](#teil-4-richtlinienvorlagen-einspielen)
6. [Teil 5: AD-Gruppe anlegen](#teil-5-ad-gruppe-anlegen)
7. [Teil 6: GPO anlegen](#teil-6-gpo-anlegen)
8. [Teil 7: Domains whitelisten](#teil-7-domains-whitelisten)
9. [Teil 8: Einmal konfigurieren für beide Browser](#teil-8-einmal-konfigurieren-für-beide-browser)
10. [Teil 9: Beim Testbenutzer prüfen](#teil-9-beim-testbenutzer-prüfen)
11. [Fehlersuche](#fehlersuche)
12. [Im Alltag](#im-alltag)
13. [Alle Einstellungen](#alle-einstellungen)
14. [Warnung bei Eingabe der Firmen-Anmeldung](#warnung-bei-eingabe-der-firmen-anmeldung)
15. [Die Skripte im Überblick](#die-skripte-im-überblick)

## Überblick

| Wo | Was passiert dort | Was wird gebraucht |
| --- | --- | --- |
| Admin-PC | Dateien erzeugen, packen, prüfen | Node.js, Chrome |
| Webserver (z. B. IIS) | liefert Erweiterung und Updates aus | nur die fertigen Dateien |
| Domänencontroller bzw. Rechner mit Gruppenrichtlinienverwaltung | Vorlagen, AD-Gruppe, GPO, optional `Sync-DwpPolicy.ps1` | Gruppenrichtlinienverwaltung |
| Rechner der Benutzer | Chrome und Edge installieren die Erweiterung selbst | nichts |

**Node.js wird nur auf dem Admin-PC gebraucht**, nicht auf dem Webserver und
nicht auf dem Domänencontroller.

## Voraussetzungen

- Rechner in einer Active-Directory-Domäne. Chrome und Edge installieren
  selbst gehostete Erweiterungen unter Windows nur auf verwalteten Geräten.
- Chrome bzw. Edge ab Version 153.
- Ein interner Webserver, den alle Rechner per HTTPS erreichen.
- Rechte zum Bearbeiten von GPOs und AD-Gruppen.

## Teil 1: Admin-PC vorbereiten

### Node.js installieren

In PowerShell:

```powershell
winget install OpenJS.NodeJS.LTS
```

Ohne `winget` (zum Beispiel auf älteren Windows-Server-Versionen) den
Windows-Installer (LTS) von [nodejs.org](https://nodejs.org/) verwenden.

Danach **PowerShell schließen und neu öffnen** und prüfen:

```powershell
node --version
```

### Projekt herunterladen und entpacken

1. [github.com/Jake-double-one/typosquatting-protect](https://github.com/Jake-double-one/typosquatting-protect)
   öffnen.
2. Auf **Code → Download ZIP** klicken.
3. Die ZIP-Datei entpacken. Darin liegt ein Ordner
   `typosquatting-protect-main`.
4. Dessen **Inhalt** nach `C:\Rollout` kopieren, sodass dort direkt die
   Ordner `scripts`, `src`, `docs` usw. liegen.

Ein kurzer Pfad ohne Leerzeichen und Klammern erspart Ärger mit
Anführungszeichen. Alle Befehle in Teil 2 werden in diesem Ordner ausgeführt:

```powershell
cd C:\Rollout
```

## Teil 2: Rollout-Dateien erzeugen

### Der Schlüssel `key.pem` (optional vorhanden)

Die Datei `key.pem` ist der private Schlüssel, mit dem die Erweiterung
signiert wird. **Aus ihm ergibt sich die Extension-ID**, die an mehreren
Stellen stehen muss: in der GPO, in `update.xml`, in der Vorlage und in der
gepackten Erweiterung.

- **Es gibt schon eine `key.pem`** aus einem früheren Rollout: nach
  `C:\Rollout` legen (oder unten ihren Pfad angeben). Die ID bleibt gleich,
  die GPO muss nicht angepasst werden.
- **Es gibt noch keine:** Das Skript legt beim ersten Aufruf eine neue an.

`key.pem` sicher aufbewahren (zum Beispiel in einem Passwort-Tresor) und nicht
weitergeben. Sie gehört weder ins Repository noch auf den Webserver. Ohne sie
lassen sich keine Updates mehr ausliefern, und ein neuer Schlüssel ergibt eine
neue ID (siehe [Neue Extension-ID](#neue-extension-id)).

### `scripts/enterprise.js` ausführen

```powershell
node scripts/enterprise.js --url https://intranet.example.com/extensions --key key.pem
```

| Parameter | Bedeutung |
| --- | --- |
| `--url` | Adresse des Ordners auf dem Webserver, in dem später `update.xml` und die `.crx` liegen. Sie wird in die Erweiterung eingebaut und muss exakt stimmen. |
| `--key` | Pfad zur `key.pem`. Existiert die Datei nicht, wird sie neu erstellt. |
| `--id` | Statt `--key`: nur die Vorlagen für eine bekannte ID erzeugen (zum Beispiel bei einem Wechsel in einen Store). |

Danach liegt in `C:\Rollout\dist\enterprise`:

| Datei / Ordner | Zweck |
| --- | --- |
| `domain-whitelist-protector\` | Die Erweiterung, bereit zum Packen |
| `update.xml` | Update-Beschreibung für den Webserver |
| `PolicyDefinitions\` | GPO-Vorlagen (`.admx`, `.adml` in Deutsch und Englisch) |
| `gpo-values.txt` | Extension-ID und die Werte, die du in die GPO einträgst |
| `Sync-DwpPolicy.ps1` | Überträgt den Ordner „Global“ nach Chrome und Edge ([Teil 8](#teil-8-einmal-konfigurieren-für-beide-browser)) |

### Erweiterung packen

**Chrome vorher vollständig schließen**, auch im Infobereich neben der Uhr.
Sonst gibt Chrome den Befehl an das laufende Fenster weiter, und es passiert
nichts.

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --pack-extension="C:\Rollout\dist\enterprise\domain-whitelist-protector" --pack-extension-key="C:\Rollout\key.pem"
```

Ergebnis: `C:\Rollout\dist\enterprise\domain-whitelist-protector.crx`.
Dasselbe Paket funktioniert in Chrome und Edge.

Liegt danach zusätzlich eine Datei `domain-whitelist-protector.pem` im Ordner,
wurde **ohne** den Schlüssel gepackt. Diese Datei löschen und den Befehl
erneut ausführen.

Packen über die Oberfläche (`chrome://extensions` → Entwicklermodus →
„Erweiterung packen“) geht auch. Dann aber unbedingt im Feld „Datei mit
privatem Schlüssel“ die `key.pem` auswählen. Bleibt das Feld leer, erzeugt
Chrome einen neuen Schlüssel, die Erweiterung bekommt eine andere ID, und die
Browser verwerfen sie ohne sichtbare Fehlermeldung.

### Mit `scripts/check-ids.js` prüfen

Das Skript liest die Extension-ID aus allen Dateien und vergleicht sie:

```powershell
node scripts/check-ids.js
```

Ohne Parameter prüft es `key.pem` im aktuellen Ordner und die Dateien in
`dist\enterprise`. Die Ausgabe muss mit **„All IDs match“** enden, zum
Beispiel:

```
key.pem      abcdefghijklmnopabcdefghijklmnop
CRX          abcdefghijklmnopabcdefghijklmnop
update.xml   abcdefghijklmnopabcdefghijklmnop
ADMX         abcdefghijklmnopabcdefghijklmnop

All IDs match: abcdefghijklmnopabcdefghijklmnop
```

Bei **„MISMATCH“** passen die Dateien nicht zusammen. Meist wurde mit einem
anderen Schlüssel gepackt: neu packen wie oben beschrieben.

Einzelne Dateien lassen sich auch gezielt prüfen, etwa bereits verteilte
Kopien oder gegen die ID aus der GPO:

```powershell
node scripts/check-ids.js --key key.pem --crx <Pfad>\domain-whitelist-protector.crx --update-xml <Pfad>\update.xml --admx <Pfad>\DomainWhitelistProtector.admx --id <Extension-ID>
```

| Parameter | Datei |
| --- | --- |
| `--key` | der Schlüssel (Standard: `key.pem` im aktuellen Ordner) |
| `--crx` | die gepackte Erweiterung |
| `--update-xml` | die Update-Beschreibung |
| `--admx` | die GPO-Vorlage `DomainWhitelistProtector.admx` |
| `--id` | eine ID zum Vergleich, zum Beispiel aus `chrome://policy` |

Netzwerkpfade wie `\\server\freigabe$\…` kann eine als Administrator
gestartete PowerShell oft nicht lesen. Dann die Dateien vorher per Explorer in
einen lokalen Ordner kopieren.

## Teil 3: Webserver einrichten (IIS)

1. Einen Ordner für die Dateien anlegen, zum Beispiel
   `C:\inetpub\wwwroot\extensions`.
2. `domain-whitelist-protector.crx` und `update.xml` aus
   `C:\Rollout\dist\enterprise` dort hineinkopieren.
3. Dafür sorgen, dass der Ordner genau unter der Adresse erreichbar ist, die
   bei `--url` angegeben wurde. Im IIS-Manager zeigt die Site
   (*Grundeinstellungen → Physischer Pfad*) oder ein virtuelles Verzeichnis
   (*Rechtsklick auf die Site → Virtuelles Verzeichnis hinzufügen*) auf den
   Ordner. Unterordner gehören mit in die Adresse.
4. **Authentifizierung** (Site bzw. Verzeichnis auswählen → *Authentifizierung*):
   „Anonyme Authentifizierung“ aktiviert, „Windows-Authentifizierung“
   deaktiviert. Die Browser laden die Dateien im Hintergrund ohne
   Anmeldedialog. Die Dateien sind nicht geheim; wer die Erweiterung bekommt,
   regelt die GPO.
5. **NTFS-Rechte** auf den Ordner: `IUSR` mit „Lesen, Ausführen“ und „Lesen“.
   Beim Hinzufügen unter *Pfade…* den Webserver selbst wählen, nicht die
   Domäne. Steht die anonyme Authentifizierung auf „Identität des
   Anwendungspools“, stattdessen `IIS AppPool\<Name des Pools>` berechtigen.
6. **MIME-Typ** (Site → *MIME-Typen* → *Hinzufügen*): Dateinamenerweiterung
   `.crx`, MIME-Typ `application/x-chrome-extension`. Ohne diesen Eintrag
   liefert IIS die Datei nicht aus.

Prüfen im Browser:

| Adresse | Erwartet |
| --- | --- |
| `https://intranet.example.com/extensions/update.xml` | XML-Text wird angezeigt |
| `https://intranet.example.com/extensions/domain-whitelist-protector.crx` | Download startet |
| `https://intranet.example.com/extensions/` | 403 ist normal, weil das Auflisten von Ordnern aus ist |

Ein 404 bei `update.xml` heißt fast immer, dass die Adresse nicht zum Ordner
passt. Die Adresse steht an drei Stellen und muss überall gleich sein: in der
GPO, in `update.xml` (als Link zur `.crx`) und in der gepackten Erweiterung.
Entweder den Webserver an die erzeugten Dateien anpassen oder mit der
richtigen `--url` neu erzeugen und neu packen.

## Teil 4: Richtlinienvorlagen einspielen

Alle Vorlagen kommen in den zentralen Richtlinienspeicher:

```
\\<domäne>\SYSVOL\<domäne>\Policies\PolicyDefinitions\
```

`.admx`-Dateien kommen direkt in diesen Ordner, `.adml`-Dateien in die
Unterordner `de-DE` und `en-US`. Gibt es den Ordner `PolicyDefinitions` noch
nicht, lege ihn an und kopiere den Inhalt von `C:\Windows\PolicyDefinitions`
des Domänencontrollers mit hinein, sonst fehlen die Windows-eigenen Vorlagen.

### Microsoft Edge

1. [microsoft.com/edge/business/download](https://www.microsoft.com/edge/business/download)
   öffnen, Kanal **Stable**, aktuelle Version und **Windows 64-Bit** wählen
   und auf **„Richtliniendateien herunterladen“** klicken.
2. `MicrosoftEdgePolicyTemplates.cab` öffnen, die enthaltene `.zip`
   herausziehen und entpacken.
3. Aus `windows\admx\` kopieren: `msedge.admx` sowie `de-DE\msedge.adml` und
   `en-US\msedge.adml`. `msedgeupdate.admx` wird nicht gebraucht.

### Google Chrome

1. Die Chrome-Richtlinienvorlagen herunterladen:
   [policy_templates.zip](https://dl.google.com/dl/edgedl/chrome/policy/policy_templates.zip)
   (auf [chromeenterprise.google](https://chromeenterprise.google/browser/download/)
   unter „Chrome-Richtlinienvorlagen“). Nicht das Paket „Google Update“
   nehmen: Darin fehlt `chrome.admx`.
2. Aus `windows\admx\` kopieren: `chrome.admx` **und** `google.admx` sowie die
   zugehörigen `.adml` aus `de-DE` und `en-US`.

Beim Aktualisieren der Chrome-Vorlage landen Richtlinien, die Chrome nicht
mehr kennt, im Ordner *Google → Google Chrome → Entfernte Richtlinien*.
Dort gesetzte Werte wirken nicht mehr und erscheinen in `chrome://policy` als
Fehler. Sie sollten durch ihre aktuellen Nachfolger ersetzt werden; der
Hilfetext der alten Richtlinie nennt meist den neuen Namen.

### Domain Whitelist Protector

Den Inhalt von `C:\Rollout\dist\enterprise\PolicyDefinitions` kopieren:
`DomainWhitelistProtector.admx` direkt, die beiden `.adml` in `de-DE` bzw.
`en-US`.

Die Vorlage enthält die Extension-ID in den Registry-Pfaden für Chrome und
Edge. Ändert sich die ID, muss sie neu kopiert werden (siehe
[Neue Extension-ID](#neue-extension-id)).

Danach die Gruppenrichtlinienverwaltung neu öffnen.

## Teil 5: AD-Gruppe anlegen

Die Erweiterung wird an die Mitglieder einer AD-Gruppe verteilt. So lässt sie
sich zunächst mit wenigen Personen testen und später schrittweise ausweiten.

1. In „Active Directory-Benutzer und -Computer“ eine Gruppe `<Name der Gruppe>`
   anlegen:
   - Gruppentyp: **Sicherheitsgruppe** (eine Verteilergruppe funktioniert
     nicht für die Sicherheitsfilterung)
   - Bereich: Global
2. Die Testbenutzer als Mitglieder aufnehmen.

In welcher OU die Gruppe selbst liegt, spielt keine Rolle.

Diese Anleitung verteilt an **Benutzer**. Soll die Erweiterung stattdessen an
bestimmte Rechner gehen, gelten dieselben Schritte mit diesen Abweichungen:

| | Benutzergruppe | Computergruppe |
| --- | --- | --- |
| Mitglieder der Gruppe | Benutzerkonten | Computerkonten |
| Einstellungen setzen unter | Benutzerkonfiguration | Computerkonfiguration |
| GPO verknüpfen mit | OU der Benutzer | OU der Computer |
| Wirkt nach | Ab- und Anmelden | Neustart des Rechners |
| Parameter für `Sync-DwpPolicy.ps1` | `-Scope User` (Standard) | `-Scope Computer` |

## Teil 6: GPO anlegen

### Anlegen und verknüpfen

1. In der Gruppenrichtlinienverwaltung unter *Gruppenrichtlinienobjekte* eine
   neue GPO `<Name der GPO>` anlegen.
2. Die GPO mit der **OU verknüpfen, in der die Benutzerkonten liegen**
   (Rechtsklick auf die OU → *Vorhandenes Gruppenrichtlinienobjekt
   verknüpfen…*). Liegen die Benutzer in mehreren OUs, die gemeinsame
   übergeordnete OU oder die Domäne nehmen; die Sicherheitsfilterung sorgt
   trotzdem dafür, dass nur die Gruppe die GPO bekommt.

Eine GPO wirkt nur auf Konten, die selbst in der verknüpften OU (oder
darunter) liegen. Eine Verknüpfung mit der OU, in der die **Gruppe** liegt,
bewirkt nichts.

Wo ein Konto liegt, zeigt `gpresult /r /scope user` ganz oben bei `CN=…` oder
„Active Directory-Benutzer und -Computer“ in den Eigenschaften des Kontos auf
der Registerkarte *Objekt*. Ist an einer OU die Vererbung deaktiviert (blaues
Ausrufezeichen), die GPO direkt mit der Unter-OU verknüpfen.

### Auf die Gruppe beschränken

1. GPO auswählen → Registerkarte *Bereich* → *Sicherheitsfilterung*:
   „Authentifizierte Benutzer“ entfernen und `<Name der Gruppe>` hinzufügen.
2. Registerkarte *Delegierung*: „Authentifizierte Benutzer“ wieder hinzufügen,
   aber nur mit der Berechtigung **Lesen**. Ohne dieses Leserecht wird eine
   benutzerbezogene GPO nicht angewendet.
3. Registerkarte *Details*: „GPO-Status“ muss „Aktiviert“ sein (nicht
   „Benutzerkonfigurationseinstellungen deaktiviert“).

### Erweiterung installieren lassen

GPO bearbeiten → *Benutzerkonfiguration → Richtlinien → Administrative
Vorlagen*:

- Chrome: *Google → Google Chrome → Erweiterungen*
- Edge: *Microsoft Edge → Erweiterungen*

Dort jeweils die Richtlinie `ExtensionInstallForcelist` öffnen. Der deutsche
Anzeigename hängt von der Version der Vorlage ab und lautet sinngemäß „Liste
der zwangsinstallierten Apps und Erweiterungen“; der technische Name steht im
Hilfetext. **Aktiviert** → *Anzeigen…* → die Zeile aus `gpo-values.txt`
eintragen. Sie hat die Form:

```
<Extension-ID>;https://intranet.example.com/extensions/update.xml
```

### Einstellungen der Erweiterung

Unter *Benutzerkonfiguration → Richtlinien → Administrative Vorlagen* gibt es
den Ordner **Domain Whitelist Protector** mit drei Unterordnern:

| Ordner | Wird gelesen von |
| --- | --- |
| **Global** | keinem Browser; wird per Skript nach Chrome und Edge kopiert ([Teil 8](#teil-8-einmal-konfigurieren-für-beide-browser)) |
| **Google Chrome** | Chrome |
| **Microsoft Edge** | Edge |

Chrome und Edge lesen ihre Richtlinien aus getrennten Bereichen. Entweder
trägst du die Einstellungen in beiden Browser-Ordnern ein, oder du pflegst sie
nur unter **Global** und überträgst sie mit dem Skript. Für mehr als ein, zwei
Einstellungen ist Global deutlich bequemer.

Mindestens empfohlen:

- **Firmen-Whitelist**: siehe [Teil 7](#teil-7-domains-whitelisten)
- **Firmen-Maildomains (Warnung bei Anmeldung)**: siehe
  [Warnung bei Eingabe der Firmen-Anmeldung](#warnung-bei-eingabe-der-firmen-anmeldung)

Alle weiteren Einstellungen stehen unter [Alle Einstellungen](#alle-einstellungen).

Alle Einstellungen einer GPO gehören in denselben Zweig. Bei einer
Benutzergruppe also alles unter *Benutzerkonfiguration*: Zwangsinstallation,
Whitelist und der Rest.

## Teil 7: Domains whitelisten

### Firmen-Whitelist per GPO

GPO bearbeiten → *Benutzerkonfiguration → Richtlinien → Administrative
Vorlagen → Domain Whitelist Protector → Global* (oder direkt *Google Chrome*
und *Microsoft Edge*):

1. „Firmen-Whitelist“ öffnen und auf **Aktiviert** stellen.
2. **Anzeigen…** klicken.
3. Eine Domain pro Zeile eintragen, zum Beispiel:

   ```
   *.sharepoint.com
   *.office.com
   *.microsoftonline.com
   intranet.example.com
   ```

4. Mit OK bestätigen.
5. Bei Nutzung von Global: `Sync-DwpPolicy.ps1` ausführen ([Teil 8](#teil-8-einmal-konfigurieren-für-beide-browser)).

So werden Einträge ausgewertet:

| Eintrag | Erlaubt | Nicht erlaubt |
| --- | --- | --- |
| `example.com` | nur `example.com` | `www.example.com`, `shop.example.com` |
| `*.example.com` | `example.com` und alle Subdomains wie `www.example.com` | `evilexample.com`, `example.com.evil.net` |
| `https://www.example.com/start` | wird auf `www.example.com` gekürzt | |

Für die meisten Seiten ist `*.domain` die richtige Wahl, weil sie häufig unter
`www.` oder weiteren Subdomains laufen. Groß- und Kleinschreibung spielt keine
Rolle.

**Weiterleitungen:** Jede Station einer Weiterleitung wird geprüft, bevor sie
aufgerufen wird. Läuft ein Link über einen Weiterleitungsdienst, erscheint die
Bestätigungsseite für diesen Dienst, bevor das eigentliche Ziel geprüft wird.
Weiterleitungsdienste, die ihr bewusst nutzt, gehören deshalb auf die
Firmen-Whitelist, zum Beispiel:

```
*.safelinks.protection.outlook.com
```

(Outlook Safe Links). Ebenso die Anmeldedienste, über die eure Anmeldungen
laufen (bei Microsoft 365 etwa `*.microsoftonline.com`). Danach wird das
eigentliche Ziel wie jede andere Seite geprüft.

Die Rechner übernehmen Änderungen beim nächsten Richtlinien-Refresh
(standardmäßig etwa alle 90 Minuten, sofort mit `gpupdate /force`). Die
Erweiterung muss dafür nicht neu verteilt und der Browser nicht neu gestartet
werden.

Im Popup der Erweiterung erscheinen diese Einträge mit dem Kennzeichen
**VERWALTET**. Benutzer sehen sie, können sie aber nicht entfernen.

Einstellungen, die per Richtlinie festgelegt sind (zum Beispiel
Vorabprüfung, Warnleiste, Höhe der Leiste oder Abfragedienst), blendet das
Popup dagegen ganz aus, weil Benutzer sie ohnehin nicht ändern können.

Domains, die einer Domain der Whitelist zum Verwechseln ähnlich sehen, zum
Beispiel `sharepoint-login.com` oder `micros0ft.com`, lösen auf der
Bestätigungsseite eine zusätzliche Warnung aus. Deshalb lohnt es sich, die
echten Firmen-Domains vollständig einzutragen.

### Eigene Einträge der Benutzer

Solange „Benutzer dürfen eigene Domains erlauben“ nicht deaktiviert ist,
können Benutzer zusätzlich eigene Domains freigeben:

- auf der Bestätigungsseite mit **„Freigeben und fortfahren“** (nur diese
  Domain) oder **„\*.domain freigeben und fortfahren“** (mit Subdomains),
- im Popup der Erweiterung im Kasten **„Aktuelle Seite“** mit **„Nur … freigeben“**
  oder **„\*.domain freigeben“**, oder über das Eingabefeld.

Die rote Warnleiste auf der Seite bietet bewusst keine Freigabe an. Sie liegt
im Inhalt der besuchten Seite, und eine Webseite könnte sonst sich selbst
freigeben. Freigeben geht nur in den Seiten der Erweiterung selbst.

Domains, die nach einer Fälschung aussehen (Zeichen aus anderen Alphabeten,
Ähnlichkeit zu einer Domain der Whitelist), lassen sich auf der
Bestätigungsseite und im Kasten „Aktuelle Seite“ nicht freigeben. Über das
Eingabefeld geht es nur nach ausdrücklicher Bestätigung, ebenso beim Import.

Wird die Einstellung **deaktiviert**, gilt nur noch die Firmen-Whitelist.
Andere Seiten lassen sich nach der Warnung weiterhin öffnen, aber nicht
dauerhaft freigeben.

## Teil 8: Einmal konfigurieren für beide Browser

Der Ordner **Global** enthält dieselben Einstellungen wie die Ordner für
Chrome und Edge, wird aber von keinem Browser gelesen. Er ist die einzige
Stelle, an der du die Erweiterung pflegst. Das Skript `Sync-DwpPolicy.ps1`
überträgt die Werte danach in die Ordner für Chrome und Edge derselben GPO.

Das Skript liegt nach Teil 2 in `dist\enterprise`. Es läuft auf dem
Domänencontroller oder einem Rechner mit Gruppenrichtlinienverwaltung (es
braucht das PowerShell-Modul `GroupPolicy`), Node.js ist dafür nicht nötig.

1. Alle Einstellungen der Erweiterung nur unter **Global** setzen (Whitelist,
   Maildomains, Hinweistext usw.). Die Zwangsinstallation
   (`ExtensionInstallForcelist`) bleibt wie in Teil 6 unter Chrome und Edge.
2. Vor dem ersten Lauf die GPO sichern (der Zielordner muss existieren):

   ```powershell
   Backup-GPO -Name "<Name der GPO>" -Path C:\GPO-Backup
   ```

3. Probelauf in PowerShell als Administrator. `-WhatIf` zeigt nur an, was
   passieren würde:

   ```powershell
   .\Sync-DwpPolicy.ps1 -GpoName "<Name der GPO>" -ExtensionId <Extension-ID> -WhatIf
   ```

4. Denselben Befehl ohne `-WhatIf` ausführen.
5. In der Gruppenrichtlinienverwaltung auf der Registerkarte *Einstellungen*
   der GPO prüfen, dass die Werte nun auch unter Google Chrome und Microsoft
   Edge stehen.

| Parameter | Bedeutung |
| --- | --- |
| `-GpoName` | Anzeigename der GPO |
| `-ExtensionId` | Extension-ID aus `gpo-values.txt` |
| `-Scope` | `User` (Standard) für Einstellungen unter Benutzerkonfiguration, `Computer` für Computerkonfiguration |
| `-AllowEmpty` | Erlaubt einen leeren Ordner Global und entfernt dann alle Einstellungen der Erweiterung für Chrome und Edge |
| `-WhatIf` | Probelauf ohne Änderungen |

Zu beachten:

- Das Skript ersetzt jedes Mal **alle** Einstellungen der Erweiterung in den
  Ordnern Google Chrome und Microsoft Edge durch die Werte aus Global. Was
  dort von Hand eingetragen wurde, geht verloren. Andere Einstellungen der
  GPO, auch die Zwangsinstallation, bleiben unverändert.
- Ist Global leer, bricht das Skript ab, statt alles zu löschen. Ein
  Tippfehler im GPO-Namen oder ein falscher `-Scope` räumt also nichts ab.
- Nach jeder Änderung unter Global das Skript erneut ausführen.
- Der Ordner Global hängt nicht von der Extension-ID ab. Ändert sich die ID,
  bleiben die Einstellungen dort erhalten.

Startet PowerShell das Skript wegen der Ausführungsrichtlinie nicht, hilft für
diesen Aufruf:

```powershell
powershell -ExecutionPolicy Bypass -File .\Sync-DwpPolicy.ps1 -GpoName "<Name der GPO>" -ExtensionId <Extension-ID> -WhatIf
```

## Teil 9: Beim Testbenutzer prüfen

1. Der Testbenutzer **meldet sich ab und wieder an**. Eine neue
   Gruppenmitgliedschaft wird nur bei der Anmeldung eingelesen;
   `gpupdate /force` allein reicht dafür nicht.
2. Prüfen, ob die Gruppe ankommt:

   ```powershell
   whoami /groups | findstr /i "<Name der Gruppe>"
   ```

3. Prüfen, ob die GPO angewendet wird:

   ```powershell
   gpresult /r /scope user
   ```

   Die GPO muss unter „Angewendete Gruppenrichtlinienobjekte“ stehen.
4. Chrome vollständig schließen (auch im Infobereich) und neu öffnen.
5. `chrome://policy` bzw. `edge://policy` → **Richtlinien neu laden**:
   `ExtensionInstallForcelist` muss mit Status **Gültig** erscheinen.
6. `chrome://extensions` bzw. `edge://extensions`: Nach einigen Sekunden bis
   wenigen Minuten erscheint „Domain Whitelist Protector“ mit dem Symbol für
   „von deiner Organisation installiert“. Wer nicht warten will, schaltet den
   Entwicklermodus ein und klickt auf **Aktualisieren**.
7. Sobald die Erweiterung installiert ist, zeigt `chrome://policy` weiter
   unten einen eigenen Abschnitt mit ihren Einstellungen (Whitelist,
   Maildomains). Vorher fehlt er; das ist normal.
8. Funktion testen: eine Seite außerhalb der Whitelist öffnen (die
   Bestätigungsseite muss erscheinen) und eine Seite der Whitelist öffnen
   (lädt ohne Nachfrage).

## Fehlersuche

| Symptom | Ursache | Lösung |
| --- | --- | --- |
| `node` wird nicht gefunden | Node.js fehlt oder PowerShell wurde nach der Installation nicht neu geöffnet | Teil 1 |
| `gpresult` zeigt die AD-Gruppe nicht | Mitgliedschaft noch nicht im Anmeldetoken | Ab- und anmelden; Gruppe muss eine Sicherheitsgruppe sein; bei mehreren Domänencontrollern etwas warten |
| Gruppe da, GPO fehlt komplett | GPO nicht mit der OU der Benutzer verknüpft oder Vererbung an der OU deaktiviert | Mit der OU verknüpfen, in der das Benutzerkonto liegt |
| GPO unter „herausgefiltert“ mit **Leer** | Einstellungen stehen unter Computerkonfiguration | Unter Benutzerkonfiguration setzen |
| GPO unter „herausgefiltert“ mit **Verweigert (Sicherheit)** | Rechte fehlen | Delegierung: Authentifizierte Benutzer **Lesen**, Gruppe über die Sicherheitsfilterung |
| `ExtensionInstallForcelist` fehlt in `chrome://policy` | Nur für Edge gesetzt oder im falschen Zweig | Unter *Google Chrome → Erweiterungen* im richtigen Zweig setzen |
| Richtlinie gültig, Erweiterung erscheint nicht | CRX mit anderem Schlüssel gepackt | `node scripts/check-ids.js`, mit der richtigen `key.pem` neu packen |
| Richtlinie gültig, Erweiterung erscheint nicht | Dateien nicht erreichbar | `update.xml` und `.crx` im Browser aufrufen (Teil 3) |
| 403 beim Aufruf der Dateien | Anonymer Zugriff fehlt | Anonyme Authentifizierung, NTFS-Leserecht für `IUSR` |
| 404 bei `update.xml` | Adresse passt nicht zum Ordner | Ordner, virtuelles Verzeichnis oder `--url` angleichen |
| 404 bei `.crx` | MIME-Typ fehlt oder Dateiname weicht ab | MIME-Typ `.crx` eintragen, Datei `domain-whitelist-protector.crx` nennen |
| Einstellungen der Erweiterung fehlen in `chrome://policy` | Erweiterung noch nicht installiert, oder bei Global das Skript nicht ausgeführt | Erst die Installation klären bzw. `Sync-DwpPolicy.ps1` ausführen |
| Ordner „Domain Whitelist Protector“ fehlt in der Gruppenrichtlinienverwaltung | Vorlage nicht im zentralen Speicher | Teil 4, danach die Konsole neu öffnen |
| `Sync-DwpPolicy.ps1` meldet „Nothing is configured in the folder 'Global'“ | Falscher GPO-Name, falscher `-Scope` oder Global noch leer | Name und Zweig prüfen |

Hilft nichts davon, verrät das Chrome-Protokoll den Grund. Chrome vollständig
schließen und so starten:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --enable-logging --v=1
```

Eine Minute warten, dann:

```powershell
Select-String -Path "$env:LOCALAPPDATA\Google\Chrome\User Data\chrome_debug.log" -Pattern "ExtensionDownloader|crx" | Select-Object -Last 30
```

## Im Alltag

### Domain hinzufügen oder entfernen

1. GPO bearbeiten → *Domain Whitelist Protector* → **Global** (bzw. Google
   Chrome und Microsoft Edge) → „Firmen-Whitelist“ → **Anzeigen…**
2. Zeile ergänzen oder löschen, mit OK bestätigen.
3. Bei Nutzung von Global: `Sync-DwpPolicy.ps1` ausführen.

### Personen aufnehmen oder entfernen

- **Aufnehmen:** in die AD-Gruppe aufnehmen; nach dem nächsten Ab- und
  Anmelden wird die Erweiterung installiert.
- **Entfernen:** aus der Gruppe nehmen; beim nächsten Anwenden der Richtlinien
  entfernt Windows die Werte, und der Browser deinstalliert die Erweiterung.
- **Für alle:** unter *Sicherheitsfilterung* wieder „Authentifizierte
  Benutzer“ eintragen.

### Neue Version der Erweiterung verteilen

1. Die neue Version von GitHub herunterladen und nach `C:\Rollout` entpacken
   (`key.pem` dabei nicht löschen), oder selbst die Versionsnummer in
   `src/manifest.json` erhöhen.
2. Mit **derselben** `key.pem` und **derselben** `--url` erzeugen, packen und
   prüfen:

   ```powershell
   node scripts/enterprise.js --url https://intranet.example.com/extensions --key key.pem
   ```

   ```powershell
   & "C:\Program Files\Google\Chrome\Application\chrome.exe" --pack-extension="C:\Rollout\dist\enterprise\domain-whitelist-protector" --pack-extension-key="C:\Rollout\key.pem"
   ```

   ```powershell
   node scripts/check-ids.js
   ```

3. Die neue `.crx` und `update.xml` auf den Webserver kopieren.
4. Die Vorlagen aus `PolicyDefinitions` erneut in den zentralen Speicher
   kopieren, falls die neue Version Einstellungen ergänzt. Bei Nutzung von
   Global danach `Sync-DwpPolicy.ps1` ausführen.

Die Browser holen das Update innerhalb einiger Stunden selbst. Die GPO und die
Whitelist bleiben unverändert.

### Neue Extension-ID

Geht `key.pem` verloren oder wird bewusst ein neuer Schlüssel erzeugt, entsteht
eine neue ID. Weil die ID in den Registry-Pfaden der Vorlage für Chrome und
Edge steckt, ist die Reihenfolge wichtig:

1. Solange noch die alte Vorlage im zentralen Speicher liegt: in der GPO unter
   *Domain Whitelist Protector* bei **Google Chrome** und **Microsoft Edge**
   alle Einstellungen auf **„Nicht konfiguriert“** stellen. Ohne Global die
   Werte vorher notieren; Einstellungen unter Global bleiben einfach erhalten.
2. Neu erzeugen, packen und prüfen (Teil 2), Dateien auf den Webserver
   kopieren (Teil 3) und die neue Vorlage in den zentralen Speicher kopieren
   (Teil 4).
3. Die Gruppenrichtlinienverwaltung neu öffnen und die Zeile der
   Zwangsinstallation durch die neue aus `gpo-values.txt` ersetzen.
4. Mit Global: `Sync-DwpPolicy.ps1` mit der neuen ID ausführen. Ohne Global:
   die notierten Werte wieder eintragen.

Eigene Einträge der Benutzer hängen an der alten ID und gehen dabei verloren,
sofern sie nicht vorher über Export/Import im Popup gesichert werden.

### Späterer Wechsel in einen Store

Chrome Web Store und Edge Add-ons vergeben eine eigene Extension-ID. Vorlagen
für diese ID lassen sich ohne Schlüssel erzeugen:

```powershell
node scripts/enterprise.js --url https://intranet.example.com/extensions --id <neue ID>
```

Davon wird nur der Ordner `PolicyDefinitions` (und `Sync-DwpPolicy.ps1`)
gebraucht. Ansonsten wie unter [Neue Extension-ID](#neue-extension-id)
vorgehen; in der Zwangsinstallation steht dann die Store-ID ohne eigene
Update-Adresse.

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
| Blockierte Länder | Zweistellige Ländercodes (z. B. `RU`). Domains aus diesen Ländern lassen sich auf der Bestätigungsseite weder öffnen noch freigeben. Domains auf einer Whitelist werden nicht geprüft; ist der Abfragedienst nicht erreichbar, lässt sich die Seite trotzdem öffnen |

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
Sie reagiert nur auf echte Eingaben des Benutzers (Tippen, Einfügen, Autofill
des Browsers). Was eine Seite selbst in ein Feld schreibt, wird nicht geprüft,
sonst könnte sie über die Markierung herausfinden, welche Adressen geschützt
sind.

Dafür genügt eine Einstellung im selben Ordner wie die Firmen-Whitelist:

1. „Firmen-Maildomains (Warnung bei Anmeldung)“ öffnen und auf **Aktiviert**
   stellen.
2. **Anzeigen…** klicken und die Maildomains eintragen, eine pro Zeile, ohne
   `@`:

   ```
   example.com
   example.org
   ```

3. Bei Nutzung von Global: `Sync-DwpPolicy.ps1` ausführen.

Danach löst jede Adresse aus, die auf `@example.com` endet (auch
`@mail.example.com`). Auf freigegebenen Seiten erscheint keine Warnung.

### Optional: weitere Kennungen pro Benutzer

Soll zusätzlich der reine Anmeldename auslösen, kann er pro Benutzer über die
Richtlinie `protectedLogins` mitgegeben werden. Das geht nur über die
Gruppenrichtlinien-Einstellungen (*Benutzerkonfiguration → Einstellungen →
Windows-Einstellungen → Registrierung*), weil nur dort Variablen aufgelöst
werden:

| Feld | Wert |
| --- | --- |
| Struktur | `HKEY_CURRENT_USER` |
| Schlüsselpfad | ein Richtlinienpfad aus `gpo-values.txt` (Chrome bzw. Edge), ergänzt um `\protectedLogins` |
| Name | `1` |
| Werttyp | `REG_SZ` |
| Wertdaten | `%LogonUser%` |

Diese Einträge überträgt `Sync-DwpPolicy.ps1` nicht; sie werden für Chrome und
Edge jeweils einzeln angelegt.

## Die Skripte im Überblick

| Skript | Läuft auf | Zweck |
| --- | --- | --- |
| `scripts/enterprise.js` | Admin-PC (Node.js) | Erzeugt alles für den Rollout: die Erweiterung mit eingebauter Update-Adresse, `update.xml`, die GPO-Vorlagen, `gpo-values.txt` und eine Kopie von `Sync-DwpPolicy.ps1`. Legt bei Bedarf `key.pem` an. |
| `scripts/check-ids.js` | Admin-PC (Node.js) | Prüft, dass `key.pem`, `.crx`, `update.xml` und Vorlage dieselbe Extension-ID haben. Endet bei Abweichungen mit einem Fehler. |
| `scripts/Sync-DwpPolicy.ps1` | Rechner mit Gruppenrichtlinienverwaltung | Kopiert die Einstellungen aus dem Ordner Global nach Chrome und Edge derselben GPO. |
| `scripts/build.js` | Admin-PC (Node.js) | Baut die entpackten Versionen und ZIP-Dateien für die lokale Installation und die Tests; für den Firmen-Rollout nicht nötig. |
