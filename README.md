### DockerDonkey — Webinterface für Docker auf Ubuntu

DockerDonkey ist ein schlankes Webinterface zum Verwalten von Docker auf Ubuntu. Es bietet:

- Container anzeigen/starten/stoppen/restarten/löschen
- Images anzeigen und per Name/Tag pullen (z. B. `nginx:latest`)
- Live-Logs je Container ansehen (Tail)
- Datei-Upload via Drag & Drop (mehrere Dateien, bis 100 MB pro Datei) auf den Server
- Git-Status (ahead/behind) und per Klick `git pull` ausführen, um das Projekt zu aktualisieren
- Moderne, klare UI (TailwindCSS CDN), responsive

#### Voraussetzungen
- Node.js 18+ (empfohlen 20+)
- Docker & Docker-Daemon laufend
- Zugriff auf Docker-Socket: Standard ist `/var/run/docker.sock`
  - Hinweis: Für den Zugriff muss der Prozess ausreichende Rechte besitzen (z. B. Nutzer in `docker`-Gruppe: `sudo usermod -aG docker $USER` und neu einloggen)

#### Installation
```
# Projekt klonen
git clone <REPO_URL>
cd DockerDonkey

# Abhängigkeiten installieren
npm install

# Konfiguration anpassen
cp .env.example .env
# Werte in .env prüfen/anpassen

# Build
npm run build

# Start
npm start
# Server läuft dann standardmäßig auf http://0.0.0.0:8080
```

Für Entwicklung (Watch-Build in `dist`):
```
npm run dev
```
Öffnen Sie währenddessen die gebaute `dist/index.js` mit einem Node-Prozess in einer zweiten Shell oder starten Sie einmalig `npm start` in parallelem Terminal.

#### Konfiguration (.env)
Verfügbare Variablen:
- `PORT=8080` — Port für HTTP-Server
- `HOST=0.0.0.0` — Host/Bind-Adresse
- `DOCKER_SOCK=/var/run/docker.sock` — Pfad zum Docker-Socket
- `UPLOAD_DIR=uploads` — Zielverzeichnis für Uploads (wird automatisch erstellt)
- `CORS_ORIGIN=http://localhost:3000,http://127.0.0.1:3000` — Kommaseparierte Liste erlaubter Origins; leer/nicht gesetzt erlaubt alle (nur für interne Nutzung empfohlen)

#### Sicherheitshinweise
- Der Zugriff auf den Docker-Socket verleiht volle Kontrolle über Docker – schützen Sie den Server (Firewall, Reverse Proxy, Authentifizierung).
- Aktivieren Sie CORS nur für vertrauenswürdige Origins.
- Uploads: Standardmäßig bis 100 MB pro Datei, ohne Virenscan. Für produktive Umgebungen ggf. zusätzliche Prüfung/Quarantäne integrieren.
- Git-Pull führt `git fetch/pull` im Projekt-Root aus. Stellen Sie sicher, dass keine ungewollten lokalen Änderungen überschrieben werden.

#### API-Übersicht (Kurz)
- `GET /api/docker/containers?all=0|1` — Container-Liste
- `POST /api/docker/containers/:id/start|stop|restart` — Control
- `DELETE /api/docker/containers/:id` — Container entfernen (force)
- `GET /api/docker/containers/:id/logs?tail=200` — Logs als Text
- `GET /api/docker/images` — Images
- `POST /api/docker/images/pull` — Body `{ image: "repo:tag" }`
- `POST /api/files/upload` — Multipart `files[]`
- `GET /api/git/status` — Git-Status inkl. ahead/behind
- `POST /api/git/pull` — Pull auf aktuellem Branch

#### Frontend (UI)
- Erreichbar unter `/` (statische Dateien in `public/`), gesteuert über `public/app.js`.
- Drag & Drop: Dateien in die Zone ziehen oder klicken, Upload nach `/api/files/upload`.
- Git-Status zeigt Branch/Upstream und bietet bei `behind > 0` einen Pull-Button.

#### Deployment-Hinweise (Ubuntu, systemd)
Beispiel-Service-Datei `/etc/systemd/system/dockerdonkey.service`:
```
[Unit]
Description=DockerDonkey
After=network.target docker.service
Requires=docker.service

[Service]
WorkingDirectory=/opt/DockerDonkey
EnvironmentFile=/opt/DockerDonkey/.env
ExecStart=/usr/bin/node -r dotenv/config dist/index.js
Restart=always
User=www-data
Group=docker

[Install]
WantedBy=multi-user.target
```
Danach:
```
sudo systemctl daemon-reload
sudo systemctl enable dockerdonkey --now
```

#### Richtlinien (Guidelines)
- Code-Stil: TypeScript, Express-Konventionen, schlanke Controller; Async/Await mit zentralem Error-Handler.
- Sicherheit: Keine unvalidierten Daten an Docker-API weiterreichen; nur notwendige Felder akzeptieren; Logging ohne sensible Daten.
- UX: Schnelle, klare Aktionen; Status/Fehler visuell klar; responsive Layout; keine Blocker ohne Feedback.
- Beiträge (Contribution):
  - Branch-Strategie: `main` stabil; Feature-Branches per PR.
  - Commits: Klar benennen, klein halten; Bezug zu Issue.
  - Lint/Format: Projektstil beibehalten, Prettier/ESLint optional ergänzen.

#### Lizenz
Projektspezifische Lizenz hier ergänzen (z. B. MIT).
