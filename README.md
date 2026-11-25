# DS Network: server site + whitelist

A small site for the Minecraft server: it shows whether the network and each server are up, and lets people ask to be whitelisted. You approve from an admin page or straight from the ntfy notification, and the player can join right away.

|            |                                                                    |
| ---------- | ------------------------------------------------------------------ |
| **Site**   | vanilla HTML, CSS and JavaScript on GitHub Pages: the contact site's layout in pixel fonts (Monocraft + Pixelify Sans), plus a title-screen-style block panorama turning behind the title, a hotbar of player heads, multiplayer-screen signal bars, an XP bar, splash text and advancement toasts |
| **API**    | one small Node container, no dependencies, runs next to the servers |
| **Plugin** | a tiny Velocity plugin that enforces the whitelist at the proxy     |
| **Alerts** | ntfy, with Approve / Deny buttons in the notification               |

## How it fits together

```
 browser ──https──▶ GitHub Pages (site/)
    │
    └──https──▶ reverse proxy ──▶ whitelist-api ──ping──▶ velocity, survival, anarchy...
                                     │   ▲
                       whitelist.txt │   │ seen.tsv
                                     ▼   │
                          plugins/ds-whitelist/  ◀── DS Whitelist plugin (in Velocity)
```

**Why at the proxy:** the Fabric servers run in offline mode behind Velocity, so a vanilla `/whitelist add` there stores the wrong UUID. Everyone also lands in limbo first, and limbo has no whitelist. The plugin checks every login at Velocity, before anyone reaches a server.

**Matching:**
- Java players are matched by UUID. The API looks the name up with Mojang, so renames don't matter.
- Bedrock players are matched by their Floodgate name, e.g. `.Moss_Golem`. Java names can't contain a dot, so nobody on Java can pose as a Bedrock name.
- A Bedrock account linked to a Java account counts as that Java account.

## Folders

| folder               | what it is                                                       |
| -------------------- | ---------------------------------------------------------------- |
| `site/`              | the public page (`index.html`) and the admin page (`admin.html`) |
| `api/`               | the whitelist API (Dockerfile included)                          |
| `velocity-plugin/`   | source of the DS Whitelist plugin (Gradle)                       |
| `dist/`              | a ready-built `ds-whitelist-1.0.0.jar`                           |
| `server/`            | your `docker-compose.yml` with the API added, and `.env.example` |
| `.github/workflows/` | deploys `site/` to Pages, builds the plugin                      |

## Setup

### 1. Folders on the server

The API and the itzg images all run as uid 1000:

```bash
sudo mkdir -p /data/minecraft/whitelist /data/minecraft/velocity/plugins/ds-whitelist
sudo chown -R 1000:1000 /data/minecraft/whitelist /data/minecraft/velocity/plugins/ds-whitelist
```

### 2. The plugin

Copy the jar into Velocity's plugins folder:

```bash
cp dist/ds-whitelist-1.0.0.jar /data/minecraft/velocity/plugins/
```

`dist/` was compiled against Velocity's API as it reads in the Velocity source, not against the published API jar. That should be equivalent, but to build it yourself, use the **Build plugin** workflow (the jar is under the run's *Artifacts*) or run:

```bash
docker run --rm -v "$PWD/velocity-plugin":/p -w /p gradle:jdk21 gradle build --no-daemon
# → velocity-plugin/build/libs/ds-whitelist-1.0.0.jar
```

### 3. The API

Clone this repo next to your `docker-compose.yml` as `mc-site/`, or change `build:` to wherever it lives. Then:

- Add the `whitelist-api` service and the `internal` network entry from `server/docker-compose.yml` to your compose file. Nothing else in that file was changed. The API joins your existing `Internal` network (Nginx Proxy Manager, Ntfy), so start that stack first.
- Add the new lines from `server/.env.example` to your `.env`.
- Create the token with `openssl rand -hex 32`.

```bash
docker compose up -d --build whitelist-api
docker compose restart velocity     # loads the plugin
docker compose logs whitelist-api velocity | grep -i whitelist
```

Velocity should log `Whitelist loaded: 0 players, NOT enforced (everyone can join)`. Nothing changes for players yet.

### 4. HTTPS for the API (Nginx Proxy Manager)

The API sits on your `Internal` network, so Nginx Proxy Manager can reach it by name. No host port is opened. In NPM, add a **Proxy Host**:

| field                 | value                                          |
| --------------------- | ---------------------------------------------- |
| Domain                | `mc-api.errornoslash.be`                       |
| Scheme / Forward host | `http` / `Whitelist-API`                       |
| Forward port          | `8080`                                         |
| SSL                   | request a Let's Encrypt cert, **Force SSL** on |

NPM already passes the visitor's address in `X-Real-IP`, which is what `CLIENT_IP_HEADER` reads, so the rate limits work per visitor. If Cloudflare sits in front of NPM, change it to `cf-connecting-ip`.

### 5. The site

1. Edit `site/scripts/config.js`: the API address, the server addresses players type in, and the splash texts. Player heads come from mc-heads.net; set `headsUrl: ""` to turn them off and show plain pixel heads instead.
2. Push to GitHub. Under **Settings → Pages**, set *Source* to **GitHub Actions**, then set the custom domain `join.errornoslash.be`. Add a DNS `CNAME` record pointing `join` at `errornoslash.github.io`. (`mc.errornoslash.be` stays the Minecraft server address.)
3. That domain must match `WHITELIST_SITE_URL`, or the browser blocks the API calls (CORS).

### 6. Turn it on safely

Open `https://join.errornoslash.be/admin.html` and paste the admin token.

1. **Add yourself** with the add form.
2. **Seen, not listed** shows everyone who has joined since the plugin went in. Let the regulars log in once, then use **add all**, or add them one by one.
3. Click **OFF** to switch it **ON**. It warns you if anyone who has played isn't listed yet. Anyone online who isn't listed gets kicked with the kick message.

You can switch it back off from the same button at any time.

## ntfy: "approval needed" on your phone

Every new request sends a **high-priority** push to your own ntfy (the `Ntfy` container). The API reaches it straight over the `Internal` network at `http://Ntfy`. It looks like this:

> **Approval needed: whitelist request**
> .Creeper_Fan_22 (Bedrock) wants to join. Gamertag: Creeper Fan 22. "friend of Notch". 3 requests are waiting for approval.
> [ Approve ] [ Deny ] [ Admin page ]

| button         | does                                                                 |
| -------------- | -------------------------------------------------------------------- |
| **Approve**    | whitelists them immediately (a signed link, valid 7 days, works once) |
| **Deny**       | denies the request                                                   |
| **Admin page** | opens `admin.html`                                                   |

Tapping a button sends a short confirmation push. The buttons call `https://mc-api.errornoslash.be` from your phone, so step 4 must be done first.

### Set it up

1. **A user and token for the API.** This is only needed if your ntfy has `auth-file` / `auth-default-access: deny-all` in `Ntfy/config.yml`. Skip it if anyone may publish.

   ```bash
   docker exec -it Ntfy ntfy user add mc-whitelist                 # asks for a password (unused, but required)
   docker exec -it Ntfy ntfy access mc-whitelist mc-whitelist write-only
   docker exec -it Ntfy ntfy token add mc-whitelist                # prints tk_...  → NTFY_TOKEN in .env
   docker exec -it Ntfy ntfy access YOUR_USER mc-whitelist read-only   # so your phone may subscribe
   ```

2. **In `.env`:** set `NTFY_TOPIC=mc-whitelist` and `NTFY_TOKEN=tk_...`. If your ntfy lives somewhere other than `https://ntfy.errornoslash.be`, set `NTFY_PUBLIC_URL` too. It lets the Approve / Deny buttons work in the ntfy web app as well as the phone app.

3. **On your phone:** in the ntfy app, add your server (`https://ntfy.errornoslash.be`), log in as your own user, and subscribe to `mc-whitelist`.

4. **Test it:** on the admin page, press **test** next to "ntfy on". A push should arrive within seconds. If it doesn't, the admin page shows why:

   | message                         | fix                                                                 |
   | ------------------------------- | ------------------------------------------------------------------- |
   | `can't reach http://Ntfy (ENOTFOUND)` | the API isn't on the `Internal` network: check `networks:` in compose |
   | `ntfy refused the message (HTTP 401/403)` | wrong `NTFY_TOKEN`, or its user lacks write access to the topic |
   | `ntfy is off`                   | `NTFY_TOPIC` is empty                                               |

## Admin page

| part                | what you can do                                                         |
| ------------------- | ----------------------------------------------------------------------- |
| waiting             | approve or deny, with their note                                        |
| whitelist           | add a Java name or Bedrock gamertag by hand, remove someone (kicks them if online) |
| seen, not listed    | everyone who logged in recently and isn't listed, one-click add         |
| kick message        | MiniMessage text; `{name}` = their name, `{site}` = this site           |
| decided             | revoke an approval, approve a denied request, or **forget** one so they can ask again |

## The panorama

`site/scripts/panorama.js` builds a small block world, made up entirely in the browser with no images or downloads. It has hills, water, sand, oak trees, snow and clouds. The script renders a full 360° view once by tracing a ray per pixel through the blocks, then slides it sideways with CSS, like the game's menu. Dark mode is night, with a square moon and stars. Light mode is day, drawn like a pencil sketch. The world pauses when the server is down, stays still for people who turn off motion in their system settings, and stops when scrolled out of view.

To change the look, edit the constants at the top of the file: `PIXEL` (block chunkiness), `TURN_SECONDS`, `STRENGTH` (how dark or light it goes) and the world `seed` in `buildWorld`.

## Request rules

- Java names are checked with Mojang, so typos are caught.
- Bedrock gamertags are converted to the Floodgate name, and the form shows players what that name will be.
- The limit is 3 new requests an hour per address and 20 attempts an hour. A hidden field catches simple bots.
- A denied player can't ask again until you **forget** their request.

## API

| method   | path                                    | who    |
| -------- | --------------------------------------- | ------ |
| `GET`    | `/api/status`                           | anyone |
| `POST`   | `/api/requests` `{edition, name, note}` | anyone |
| `GET`    | `/api/requests/lookup?edition=&name=`   | anyone |
| `POST`   | `/api/act/:id/approve\|deny?exp=&sig=`  | signed ntfy link |
| `GET`    | `/api/admin/overview`                   | token  |
| `POST`   | `/api/admin/requests/:id/approve\|deny` | token  |
| `DELETE` | `/api/admin/requests/:id`               | token  |
| `POST`   | `/api/admin/players` `{edition, name}`  | token  |
| `DELETE` | `/api/admin/players/:key`               | token  |
| `PUT`    | `/api/admin/settings` `{enforced, message}` | token |

Data lives in `/data/minecraft/whitelist/` (`requests.json`, `whitelist.json`). Back it up with the worlds.

## Settings (API environment)

| variable                    | default           | meaning                                              |
| --------------------------- | ----------------- | ---------------------------------------------------- |
| `ADMIN_TOKEN`               | required          | admin password; also signs the ntfy buttons          |
| `SITE_URL`                  | required          | the site, used for CORS, the kick message and ntfy   |
| `ALLOWED_ORIGINS`           | required          | comma list of origins allowed to call the API        |
| `PUBLIC_API_URL`            |                   | the API's https address, for the ntfy buttons        |
| `CLIENT_IP_HEADER`          |                   | header holding the visitor's IP                      |
| `STATUS_SERVERS`            | `DS Network=velocity:25565` | `name=host:port, ...`; first one is the proxy |
| `STATUS_CACHE_SECONDS`      | `15`              | how often servers are pinged at most                 |
| `STATUS_SHOW_PLAYERS`       | `true`            | show online player names                             |
| `FLOODGATE_PREFIX`          | `.`               | must match Floodgate's `username-prefix`             |
| `FLOODGATE_REPLACE_SPACES`  | `true`            | must match Floodgate's `replace-spaces`              |
| `MAX_PENDING`               | `100`             | stop taking requests above this many waiting         |
| `NTFY_URL`                  | `https://ntfy.sh` | your ntfy; in this setup `http://Ntfy`               |
| `NTFY_TOPIC` / `NTFY_TOKEN` |                   | topic and access token (or `NTFY_USERNAME` / `NTFY_PASSWORD`) |
| `NTFY_PRIORITY`             | `3`               | 1 to 5; compose sets `4` so requests buzz            |

## Try it locally

```bash
cd api
ADMIN_TOKEN=$(openssl rand -hex 32) ALLOWED_ORIGINS=http://localhost:5500 \
SITE_URL=http://localhost:5500 DATA_DIR=./tmp/data PLUGIN_DIR=./tmp/plugin \
STATUS_SERVERS="DS Network=your.server:25565" PORT=8080 npm start

cd ../site && python3 -m http.server 5500
# open http://localhost:5500/?api=http://localhost:8080
```

The `?api=` override only works on localhost.

## Safety notes

- The plugin keeps the last good list if `whitelist.txt` is ever unreadable. If the file is missing (API never started), it lets everyone in, as before, and logs a warning.
- The admin token is only sent in a header and is never put in a link. "Remember on this device" keeps it in that browser's local storage. Leave it unticked on shared machines.
- Changing `ADMIN_TOKEN` also invalidates every ntfy button that has already been sent.

## Credits

- [Monocraft](https://github.com/IdreesInc/Monocraft) by Idrees Hassan: a free monospaced font in the style of the game's text, SIL Open Font License 1.1 (`site/fonts/Monocraft-OFL.txt`). It is bundled in `site/fonts/`, limited to the characters the site uses.
- [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans) by Stefie Justprince, SIL Open Font License 1.1, loaded from Google Fonts.
- Player heads by [mc-heads.net](https://mc-heads.net) (can be turned off in `config.js`).
