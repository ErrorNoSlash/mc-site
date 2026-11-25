<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.svg">
    <img src="assets/banner-light.svg" alt="DS Network: the word ONLINE in pixel letters over a blocky Minecraft-style landscape, with a hotbar of player heads below" width="100%">
  </picture>
</p>

<p align="center">
  <b>The front door of the DS Network Minecraft server: live status, and a way to ask for the whitelist.</b><br>
  Live at <a href="https://join.errornoslash.be">join.errornoslash.be</a> · play at <code>mc.errornoslash.be</code>
</p>

|            |                                                                                   |
| ---------- | --------------------------------------------------------------------------------- |
| **Stack**  | vanilla HTML, CSS and JavaScript · a Node API with no dependencies · a small Velocity plugin |
| **Build**  | none for the site; GitHub Actions builds and signs the plugin                     |
| **Pages**  | the status and request page, and an admin page                                    |
| **Hosted** | GitHub Pages for the site, Docker next to the Minecraft servers for the API       |

---

## Pages

| page         | what it is                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------- |
| `index.html` | a huge ONLINE / OFFLINE over a turning block world, every server's status, who's online, and the request form |
| `admin.html` | approve or deny requests, manage the whitelist, switch it on and off, edit the kick message |

## Features

### 🎨 Look

- **Brutalist grid** — the same sheet of bordered rows as the contact site
- **Pixel fonts** — Monocraft (in the style of the game's text) for everything small, Pixelify Sans for the big words
- **Huge status word** — ONLINE, OFFLINE (hollow letters) or UNKNOWN, spread across the row, with two sliced echoes on top
- **Light and dark** — follows the system theme: day in light mode, night in dark mode

### ⛏️ Minecraft touches

- **Title-screen panorama** — a block world made up in the browser (hills, water, oak trees, snow, clouds, a square sun or moon), rendered once and turned slowly behind the title. It stops when the server is down.
- **Splash text** — a tilted, pulsing line next to the title; click it for another
- **Hotbar** — the heads of the players who are online, with the item tooltip showing their name
- **Signal bars** — the five connection bars from the multiplayer screen, next to every server
- **XP bar** — how full the network is, with the player count as the level
- **Advancement toast** — "Advancement Made!" when a request goes through or gets approved
- **In-game prompts** — `/list`, `/ping`, `/whitelist add <you>`, `/op dias`

### 🔐 Whitelist

- **Checked at the proxy** — the Fabric servers sit behind Velocity in offline mode and everyone lands in limbo first, so the plugin checks every login at Velocity
- **Java by UUID** — names are checked with Mojang, so typos are caught and renames don't matter
- **Bedrock by Floodgate name** — the form shows players what their name will be (`.Moss_Golem`), and Java names can't contain a dot, so they can't pose as one
- **Seen players** — everyone who joins is noted, so the regulars can be added in one click before switching it on
- **Safe switch** — off until you turn it on, a warning before anyone gets locked out, and removed players are kicked
- **Spam limits** — 3 new requests an hour per address, a hidden field for bots, and denied players can't simply ask again

### 🔔 ntfy

- **"Approval needed"** — a high-priority push to your own ntfy for every request, with the note and how many are waiting
- **Approve / Deny buttons** — straight from the notification, through signed links that work once and expire after 7 days
- **Test button** — on the admin page, and it says exactly what's wrong if a push can't be sent

### 🛡️ Security

- **Pinned actions** — every GitHub Action is fixed to a full commit SHA, and each workflow gets only the permissions it needs
- **Signed plugin builds** — every jar comes with a build-provenance attestation you can verify
- **Dependabot** — a weekly pull request when an action, the Node image or a plugin dependency has a new release
- **Locked-down container** — Node 26 LTS, an unprivileged user, a read-only filesystem, no Linux capabilities
- **Admin token** — only ever sent in a header, compared in constant time, with rate-limited wrong guesses

## How it fits together

```
 browser ──https──▶ GitHub Pages (site/)
    │
    └──https──▶ Nginx Proxy Manager ──▶ whitelist-api ──ping──▶ velocity, survival, anarchy…
                                          │   ▲     └──────▶ Ntfy ──▶ your phone
                            whitelist.txt │   │ seen.tsv
                                          ▼   │
                               plugins/ds-whitelist/  ◀── DS Whitelist plugin (in Velocity)
```

## Setup

### 1. Folders on the server

The API and the itzg images all run as uid 1000:

```bash
sudo mkdir -p /data/minecraft/whitelist /data/minecraft/velocity/plugins/ds-whitelist
sudo chown -R 1000:1000 /data/minecraft/whitelist /data/minecraft/velocity/plugins/ds-whitelist
```

### 2. The plugin

Download it from **Actions → Build plugin → the latest green run → Artifacts → ds-whitelist**, then copy the jar to the server:

```bash
cp ds-whitelist-1.0.0.jar /data/minecraft/velocity/plugins/
gh attestation verify ds-whitelist-1.0.0.jar -R ErrorNoSlash/mc-site   # optional: proves it was built here
```

It needs Velocity 4 on Java 25, which `itzg/mc-proxy:java25` with the latest Velocity has. To build it yourself:

```bash
docker run --rm -v "$PWD/velocity-plugin":/p -w /p gradle:9.9.2-jdk25 gradle build --no-daemon
```

### 3. The API

Clone this repo next to your Minecraft `docker-compose.yml` as `mc-site/`. Copy the `whitelist-api` service and the `internal` network from [`server/docker-compose.yml`](server/docker-compose.yml) into your compose file, and the lines from [`server/.env.example`](server/.env.example) into your `.env`. Create the admin token with `openssl rand -hex 32`.

```bash
docker compose up -d --build whitelist-api
docker compose restart velocity
docker compose logs whitelist-api velocity | grep -i whitelist
```

Velocity should log `Whitelist loaded: 0 players, NOT enforced (everyone can join)`. Nothing changes for players yet.

### 4. HTTPS for the API

In Nginx Proxy Manager, add a **Proxy Host**:

| field                 | value                                         |
| --------------------- | --------------------------------------------- |
| Domain                | `mc-api.errornoslash.be`                      |
| Scheme / Forward host | `http` / `Whitelist-API`                      |
| Forward port          | `8080`                                        |
| SSL                   | a Let's Encrypt certificate, **Force SSL** on |

NPM passes the visitor's address in `X-Real-IP`, so the rate limits work per visitor. Behind Cloudflare's proxy, set `CLIENT_IP_HEADER` to `cf-connecting-ip`.

### 5. ntfy

```bash
docker exec -it Ntfy ntfy user add mc-whitelist
docker exec -it Ntfy ntfy access mc-whitelist mc-whitelist write-only
docker exec -it Ntfy ntfy token add mc-whitelist                     # tk_…  → NTFY_TOKEN in .env
docker exec -it Ntfy ntfy access YOUR_USER mc-whitelist read-only    # so your phone may subscribe
```

Subscribe to `mc-whitelist` in the ntfy app, then press **test** on the admin page.

<details>
<summary>If the test push doesn't arrive</summary>

| the admin page says                       | fix                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `can't reach http://Ntfy (ENOTFOUND)`     | the API isn't on the `Internal` network: check `networks:` in compose |
| `ntfy refused the message (HTTP 401/403)` | wrong `NTFY_TOKEN`, or its user can't write to the topic             |
| `ntfy is off`                             | `NTFY_TOPIC` is empty                                                |

</details>

### 6. Turn it on

Open [`join.errornoslash.be/admin.html`](https://join.errornoslash.be/admin.html) and paste the admin token. Then:

1. Add yourself.
2. Let the regulars join once, then press **add all** under *seen, not listed*.
3. Switch **OFF** to **ON**.

## Deploy

The site is served with GitHub Pages, built by [`.github/workflows/pages.yml`](.github/workflows/pages.yml):

1. In **Settings → Pages**, set the source to **GitHub Actions**, and the custom domain to `join.errornoslash.be`
2. Add a DNS record pointing `join` (CNAME, **DNS only**) at `errornoslash.github.io`, and `mc-api` (A, DNS only) at the server
3. Push to `main`, and it deploys

## Customize

| to change                 | edit                                                                  |
| ------------------------- | --------------------------------------------------------------------- |
| the addresses             | `site/scripts/config.js` (API, Java and Bedrock addresses)            |
| the splash texts          | the `splashes` list in `site/scripts/config.js`                       |
| the player heads          | `headsUrl` in `site/scripts/config.js` (`""` for plain pixel heads)   |
| the panorama              | the constants at the top of `site/scripts/panorama.js`                |
| the colours               | the CSS variables at the top of `site/styles/style.css`               |
| the servers shown         | `STATUS_SERVERS` in the compose file                                  |
| the kick message          | the admin page (MiniMessage; `{name}` and `{site}` are filled in)     |

<details>
<summary>Admin page</summary>

| part             | what you can do                                                                    |
| ---------------- | ---------------------------------------------------------------------------------- |
| waiting          | approve or deny, with their note                                                   |
| whitelist        | add a Java name or Bedrock gamertag by hand, remove someone (kicks them if online) |
| seen, not listed | everyone who logged in and isn't listed, one-click add                             |
| kick message     | what people who aren't listed see                                                  |
| decided          | revoke an approval, approve a denied request, or **forget** one so they can ask again |

</details>

<details>
<summary>API</summary>

| method   | path                                        | who              |
| -------- | ------------------------------------------- | ---------------- |
| `GET`    | `/api/status`                               | anyone           |
| `POST`   | `/api/requests` `{edition, name, note}`     | anyone           |
| `GET`    | `/api/requests/lookup?edition=&name=`       | anyone           |
| `POST`   | `/api/act/:id/approve\|deny?exp=&sig=`      | signed ntfy link |
| `GET`    | `/api/admin/overview`                       | token            |
| `POST`   | `/api/admin/requests/:id/approve\|deny`     | token            |
| `DELETE` | `/api/admin/requests/:id`                   | token            |
| `POST`   | `/api/admin/players` `{edition, name}`      | token            |
| `DELETE` | `/api/admin/players/:key`                   | token            |
| `PUT`    | `/api/admin/settings` `{enforced, message}` | token            |
| `POST`   | `/api/admin/test-notification`             | token            |

Data lives in `/data/minecraft/whitelist/` (`requests.json`, `whitelist.json`). Back it up with the worlds.

</details>

<details>
<summary>API settings (environment)</summary>

| variable                    | default                     | meaning                                              |
| --------------------------- | --------------------------- | ---------------------------------------------------- |
| `ADMIN_TOKEN`               | required                    | the admin password; also signs the ntfy buttons      |
| `SITE_URL`                  | required                    | the site, for CORS, the kick message and ntfy        |
| `ALLOWED_ORIGINS`           | required                    | origins allowed to call the API, comma separated     |
| `PUBLIC_API_URL`            |                             | the API's https address, for the ntfy buttons        |
| `CLIENT_IP_HEADER`          |                             | the header holding the visitor's address             |
| `STATUS_SERVERS`            | `DS Network=velocity:25565` | `name=host:port, …`; the first is the proxy          |
| `STATUS_CACHE_SECONDS`      | `15`                        | how often the servers are pinged at most             |
| `STATUS_SHOW_PLAYERS`       | `true`                      | show online player names                             |
| `FLOODGATE_PREFIX`          | `.`                         | must match Floodgate's `username-prefix`             |
| `FLOODGATE_REPLACE_SPACES`  | `true`                      | must match Floodgate's `replace-spaces`              |
| `MAX_PENDING`               | `100`                       | stop taking requests above this many waiting         |
| `NTFY_URL`                  | `https://ntfy.sh`           | your ntfy; here `http://Ntfy`                        |
| `NTFY_TOPIC` / `NTFY_TOKEN` |                             | the topic and access token                           |
| `NTFY_PRIORITY`             | `3`                         | 1 to 5; compose sets `4` so requests buzz            |

</details>

<details>
<summary>Run locally</summary>

```bash
cd api
ADMIN_TOKEN=$(openssl rand -hex 32) ALLOWED_ORIGINS=http://localhost:5500 \
SITE_URL=http://localhost:5500 DATA_DIR=./tmp/data PLUGIN_DIR=./tmp/plugin \
STATUS_SERVERS="DS Network=mc.errornoslash.be:25565" PORT=8080 npm start

cd ../site && python3 -m http.server 5500
```

Then visit `http://localhost:5500/?api=http://localhost:8080`. The `?api=` override only works on localhost.

</details>

## Structure

<details>
<summary>Show the file tree</summary>

```
.
├── assets/
│   ├── banner-dark.svg      # banner at the top of this README (dark theme)
│   └── banner-light.svg     # … and light theme
├── site/                    # GitHub Pages
│   ├── index.html           # status + request form
│   ├── admin.html           # the admin page
│   ├── fonts/               # Monocraft (SIL OFL), cut down to the characters used
│   ├── images/favicon.svg
│   ├── styles/style.css     # colours, layout, the Minecraft touches
│   └── scripts/
│       ├── config.js        # addresses, splash texts, player heads
│       ├── common.js        # API calls, pixel icons, heads, splash
│       ├── status.js        # status word, server list, hotbar, XP bar
│       ├── request.js       # request form + advancement toast
│       ├── panorama.js      # the turning block world
│       └── admin.js         # the admin page
├── api/                     # the whitelist API (Node 26, no dependencies)
│   ├── Dockerfile
│   └── src/
│       ├── server.js        # routes, rate limits, admin
│       ├── store.js         # requests, whitelist, writes whitelist.txt
│       ├── status.js        # Minecraft server list ping
│       ├── mojang.js        # Java name → UUID
│       ├── notify.js        # ntfy pushes + signed buttons
│       └── config.js        # settings from the environment
├── velocity-plugin/         # the DS Whitelist plugin (Velocity 4, Java 25)
│   └── src/main/java/be/errornoslash/dswhitelist/
│       ├── DsWhitelistPlugin.java   # login check, reload, kicks
│       ├── Whitelist.java           # reads whitelist.txt
│       └── SeenLog.java             # writes seen.tsv
├── server/
│   ├── docker-compose.yml   # your Minecraft compose with the API added
│   └── .env.example
└── .github/
    ├── workflows/pages.yml  # deploy site/ to Pages
    ├── workflows/plugin.yml # build + sign the plugin
    └── dependabot.yml       # weekly update pull requests
```

</details>

## Credits

- [Monocraft](https://github.com/IdreesInc/Monocraft) by Idrees Hassan, SIL Open Font License 1.1 ([`site/fonts/Monocraft-OFL.txt`](site/fonts/Monocraft-OFL.txt))
- [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans) by Stefie Justprince, SIL Open Font License 1.1
- Player heads by [mc-heads.net](https://mc-heads.net)
- Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.

---

<p align="center">
  <code>©Dias Stas</code> · <a href="https://contact.errornoslash.be">Contact</a> · <a href="https://hello.errornoslash.be">Website</a> · <a href="https://blog.errornoslash.be">Blog</a> · <a href="https://github.com/ErrorNoSlash">GitHub</a> · <a href="https://gitlab.com/ErrorN0Slash/">GitLab</a> · <a href="https://mastodon.social/@slashy">Mastodon</a>
</p>
