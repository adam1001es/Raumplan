# 🏫 Raumplan: Live-Raummonitoring für NMS, PTS, Volksschule und Hort

Eine Web-App, mit der die Direktion die Räume der Schule live im Blick hat. Berechtigte Personen tragen Änderungen in einfachen Sätzen ein, etwa „2a Do 3. EH frei“, und die Lehrkräfte sehen jederzeit, welcher Raum frei ist.

| Seite | Für wen | Was |
|---|---|---|
| `index.html` – **Übersicht** | alle Lehrkräfte (nur ansehen) | **Animiertes 3D-Schulgebäude**: freie Räume leuchten grün, Stockwerke einzeln ansehbar, Tag abspielen; dazu „Wo ist welche Klasse“ |
| `aendern.html` – **Ändern** | Direktion, Hort- und VS-Leitung, Bearbeiter | Chat-Eingabe wie in WhatsApp (auch per Sprache), Schnellformular, Rückgängig |
| `direktion.html` – **Direktion** | nur Master | **Live 3D** mit Tipps (Raum antippen → ändern), Wochenraster, Auslastung (Heatmap), Einstellungen, Zugänge |

## Beispielsätze

```
Klasse 2a ist am Donnerstag in der 3. Einheit frei
2a Do 3-4 in R12
Werkraum morgen 5. EH frei
Aula Fr 6 belegt (Elternabend)
2b heute ganztags frei (Wandertag)
Hort A jeden Mittwoch ab der 7. im Turnsaal     ← dauerhaft im Stundenplan (mit Rückfrage)
Was ist jetzt frei?   ·   Was ist Do 3 frei?   ·   Wo ist 3b Fr 2?
rückgängig
```

---

## Einrichtung (einmalig, am Laptop, ca. 20 Minuten)

### 1. Ausprobieren (Demo-Modus)
Solange in `js/config.js` nichts eingetragen ist, läuft die App mit Beispieldaten nur im eigenen Browser. Damit kann man alles gefahrlos testen.

### 2. GitHub Pages einschalten (die Webseite)
1. Im Repo auf **Settings → Pages** gehen.
2. Bei *Source* **Deploy from a branch** wählen, dann *Branch* **main** und Ordner **/ (root)**, und speichern.
3. Nach 1–2 Minuten ist die App erreichbar unter `https://adam1001es.github.io/raumplan/`.

> Kostenlos geht GitHub Pages nur, wenn das Repo **öffentlich** ist (Settings → General → Danger Zone → Change visibility). Der Code ist dann sichtbar, die Schuldaten aber nicht, denn die liegen geschützt in Supabase.

### 3. Supabase anlegen (Datenbank und Logins, kostenlos)
1. Auf <https://supabase.com> ein Konto anlegen und auf **New project** klicken. Als Region **Central EU (Frankfurt)** wählen und ein Datenbank-Passwort vergeben (gut aufheben).
2. Links **SQL Editor** öffnen, auf **New query** klicken, den gesamten Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen und **Run** drücken.
3. Unter **Authentication → URL Configuration** bei *Site URL* `https://adam1001es.github.io/raumplan/` eintragen.
4. Unter **Project Settings → API** die **Project URL** und den **anon public** Schlüssel kopieren.
5. Beide Werte in [`js/config.js`](js/config.js) eintragen und speichern (auf GitHub direkt über den Stift ✏️ bearbeitbar).

### 4. Als Master registrieren
1. `…/direktion.html` öffnen, auf **Registrieren** tippen und E-Mail und Passwort eingeben. **Die erste Person wird automatisch Master.**
2. Bestätigungs-E-Mail anklicken und anmelden.
3. Unter **Einstellungen** auf **Beispieldaten laden** tippen oder gleich die echten Räume, Klassen und Einheiten anlegen.
4. Bei jedem Raum **Gebäude, Stock und Größe** eintragen, damit das 3D-Gebäude so aussieht wie Ihre Schule.
5. **Stundenplan schnell füllen** setzt jede Klasse in ihren Stammraum. Danach unter **Woche → Regulärer Stundenplan** Turnsaal, Werkraum usw. antippen.

### 5. Kolleginnen und Kollegen einladen
- **Lehrkräfte**: Link zu `index.html` schicken. Ist „Lehrer-Übersicht ohne Anmeldung“ eingeschaltet, brauchen sie kein Konto.
- **Bearbeiter** (Hort, VS …): Link zu `aendern.html` schicken. Sie registrieren sich, und Sie stellen die Rolle unter **Einstellungen → Zugänge** auf „Bearbeiten“.
- Am Handy über „Teilen → Zum Home-Bildschirm“ als App-Symbol ablegen.

## Rollen

| Rolle | Ansehen | Änderungen eintragen | Stundenplan, Räume, Klassen, Zugänge |
|---|---|---|---|
| Master (Direktion) | ✅ | ✅ (alle löschen) | ✅ |
| Bearbeiten | ✅ | ✅ (eigene löschen) | dauerhafte Änderungen per Satz |
| Nur ansehen | ✅ | – | – |
| Wartet auf Freigabe | – | – | – |

## Technik
Statische Seiten (HTML/JS, kein Build, 3D mit three.js lokal eingebunden) auf GitHub Pages, dazu Supabase (PostgreSQL mit Row Level Security, Auth und Realtime) für Live-Updates. Lizenzfrei nutzbar für die Schule.
