// Whitelist API: server status, whitelist requests, and the admin endpoints.
// No dependencies: Node's own http, fetch and crypto.

import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { base32Decode, checkCode, useCode } from "./totp.js";
import { config, checkConfig } from "./config.js";
import * as store from "./store.js";
import { getStatus } from "./status.js";
import { lookupJavaProfile } from "./mojang.js";
import { notifyNewRequest, notifyDecision, notifyTest, notifySecurity, verifyAction, ntfyEnabled } from "./notify.js";

const log = (...parts) => console.log(new Date().toISOString(), ...parts);

/* ---------- small helpers ---------- */

class HttpError extends Error {
    constructor(status, message, extra = {}) {
        super(message);
        this.status = status;
        this.extra = extra;
    }
}

// a GET answer carries a fingerprint of its content (ETag); when the page already has that exact
// answer it gets an empty 304 back instead of the same data again
function send(res, status, body, headers = {}, req = null) {
    const text = JSON.stringify(body);
    if (req?.method === "GET" && status === 200) {
        const etag = `"${crypto.createHash("sha1").update(text).digest("base64url")}"`;
        res.setHeader("ETag", etag);
        if (req.headers["if-none-match"] === etag) {
            res.writeHead(304, headers);
            return res.end();
        }
    }
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
    res.end(text);
}

function clientIp(req) {
    if (config.clientIpHeader) {
        const value = req.headers[config.clientIpHeader];
        if (value) return String(value).split(",").pop().trim();
    }
    return req.socket.remoteAddress || "unknown";
}

function hashIp(ip) {
    return crypto.createHmac("sha256", config.adminToken).update(ip).digest("base64url").slice(0, 16);
}

async function readJsonBody(req) {
    if (!String(req.headers["content-type"] || "").includes("application/json")) {
        throw new HttpError(415, "Send JSON.");
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 8 * 1024) throw new HttpError(413, "Too much data.");
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
        throw new HttpError(400, "That is not valid JSON.");
    }
}

/* fixed-window rate limits kept in memory */
const buckets = new Map();

// throws while a limit is used up, without counting this try (for the admin lockout: checked before the token)
function checkLimit(name, key, limit) {
    const bucket = buckets.get(`${name}:${key}`);
    if (bucket && bucket.resetAt > Date.now() && bucket.count >= limit) {
        const wait = Math.ceil((bucket.resetAt - Date.now()) / 1000);
        throw new HttpError(429, "Too many wrong tries, wait a while.", { retryAfter: wait });
    }
}

function rateLimit(name, key, limit, windowSeconds) {
    const id = `${name}:${key}`;
    const now = Date.now();
    let bucket = buckets.get(id);
    if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + windowSeconds * 1000 };
        buckets.set(id, bucket);
    }
    bucket.count++;
    if (bucket.count > limit) {
        const wait = Math.ceil((bucket.resetAt - now) / 1000);
        throw new HttpError(429, "Slow down a little and try again later.", { retryAfter: wait });
    }
}
setInterval(() => {
    const now = Date.now();
    for (const [id, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(id);
    for (const [id, session] of sessions) if (session.expires <= now || session.idleUntil <= now) sessions.delete(id);
}, 60_000).unref();

/* ---------- admin access ---------- */

// the networks the admin works from (ADMIN_NETWORKS); everything else gets a 403 before the token is even looked at
const adminNetworks = new net.BlockList();
for (const network of config.adminNetworks) {
    const [address, prefix] = network.split("/");
    try {
        adminNetworks.addSubnet(address, Number(prefix), net.isIPv6(address) ? "ipv6" : "ipv4");
    } catch {
        // a typo: checkConfig() names it and stops the API at startup
    }
}

function fromAdminNetwork(req) {
    if (config.adminNetworks.length === 0) return true;
    const ip = clientIp(req).replace(/^::ffff:/, "");
    const type = net.isIPv6(ip) ? "ipv6" : net.isIPv4(ip) ? "ipv4" : null;
    return Boolean(type) && adminNetworks.check(ip, type);
}

// where a login came from, in words, for the alerts and "last login"
const tailscaleNetworks = new net.BlockList();
tailscaleNetworks.addSubnet("100.64.0.0", 10, "ipv4");
tailscaleNetworks.addSubnet("fd7a:115c:a1e0::", 48, "ipv6");

function placeOf(ip) {
    const clean = ip.replace(/^::ffff:/, "");
    const type = net.isIPv6(clean) ? "ipv6" : "ipv4";
    if (net.isIP(clean) && tailscaleNetworks.check(clean, type)) return "Tailscale";
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|f[cd])/i.test(clean)) return "the home network";
    return "outside the home network";
}

// 10 wrong tokens from one address lock it out for 15 minutes; 30 from anywhere lock the login for
// everyone for 15 minutes. both are checked before the token is compared, and both send an alert
const lockout = { name: "admin-fail", limit: 10, seconds: 15 * 60 };
const lockoutAll = { name: "admin-fail-all", key: "all", limit: 30, seconds: 15 * 60 };

function checkLockouts(ip) {
    checkLimit(lockoutAll.name, lockoutAll.key, lockoutAll.limit);
    checkLimit(lockout.name, ip, lockout.limit);
}

/* counts a wrong token, and sends an alert when an address (or everyone) just got locked out */
function wrongToken(ip) {
    for (const [limit, key] of [[lockout, ip], [lockoutAll, lockoutAll.key]]) {
        try {
            rateLimit(limit.name, key, limit.limit, limit.seconds);
        } catch {
            // the limit is reached: the alert below has gone out already
        }
        if (buckets.get(`${limit.name}:${key}`)?.count === limit.limit) {
            const who = limit === lockout ? `${ip} (${placeOf(ip)})` : "several addresses";
            notifySecurity("Admin login locked", `${limit.limit} wrong admin tokens from ${who}. Logging in is blocked for 15 minutes${limit === lockout ? " from there" : " for everyone"}.`)
                .catch((error) => log("ntfy:", error.message));
        }
    }
    log("admin: wrong token from", hashIp(ip));
}

function tokenMatches(value) {
    const given = Buffer.from(String(value || ""));
    const expected = Buffer.from(config.adminToken);
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/* logins: the token is swapped once for a random session id in a cookie that scripts can't read
   (HttpOnly), that only travels over https (Secure) and only from the site itself (SameSite=Strict).
   the __Host- prefix means no other subdomain can set or replace it. sessions live in memory:
   restarting the API logs everyone out */
const sessionCookie = "__Host-mc_admin";
const sessions = new Map();

function readSessionId(req) {
    const cookies = String(req.headers.cookie || "").split(";").map((part) => part.trim());
    const found = cookies.find((part) => part.startsWith(sessionCookie + "="));
    return found ? found.slice(sessionCookie.length + 1) : "";
}

/* a login ends at its end time, or earlier after a while without using the admin (idle) */
function startSession(res, remember) {
    const id = crypto.randomBytes(32).toString("base64url");
    const lifetime = remember ? config.rememberDays * 86400 : config.sessionHours * 3600;
    const idleMs = remember ? config.rememberIdleDays * 86400_000 : config.idleMinutes * 60_000;
    sessions.set(id, { expires: Date.now() + lifetime * 1000, idleMs, idleUntil: Date.now() + idleMs });
    // without "remember" the cookie goes when the browser closes; the server forgets it after sessionHours anyway
    const maxAge = remember ? `; Max-Age=${lifetime}` : "";
    res.setHeader("Set-Cookie", `${sessionCookie}=${id}; Path=/; Secure; HttpOnly; SameSite=Strict${maxAge}`);
}

function endSession(req, res) {
    sessions.delete(readSessionId(req));
    res.setHeader("Set-Cookie", `${sessionCookie}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);
}

/* a call the page makes by itself (the 20 s refresh, ?auto=1) doesn't count as using the admin,
   so an open tab nobody looks at still logs out after the idle time */
function hasSession(req, isAuto = false) {
    const session = sessions.get(readSessionId(req));
    const now = Date.now();
    if (!session || session.expires <= now || session.idleUntil <= now) return false;
    if (!isAuto) session.idleUntil = now + session.idleMs;
    return true;
}

function activeSessions() {
    const now = Date.now();
    return [...sessions.values()].filter((session) => session.expires > now && session.idleUntil > now).length;
}

/* the admin page lives on the API itself (/admin/), so its calls are same-origin: a browser call to an
   admin route from anywhere else (the public site included) is refused. a browser always says where a
   call comes from (Origin, Sec-Fetch-Site); curl and scripts send neither and use the token instead */
function adminOrigin(req) {
    return config.adminOrigin || `https://${req.headers.host}`;
}

function fromAdminPage(req) {
    const origin = req.headers.origin;
    const site = req.headers["sec-fetch-site"];
    if (site && site !== "same-origin" && site !== "none") return false;
    return !origin || origin === adminOrigin(req);
}

/* every admin route: a session cookie, or the token as "Authorization: Bearer" (for scripts and curl).
   a change made with the cookie must come from the admin page itself (Origin), on top of SameSite */
function requireAdmin(req, isAuto = false) {
    const ip = clientIp(req);
    if (hasSession(req, isAuto)) {
        if (!fromAdminPage(req) || (req.method !== "GET" && req.headers.origin !== adminOrigin(req))) {
            throw new HttpError(403, "Changes only work from the admin page.");
        }
        return;
    }
    const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!bearer) throw new HttpError(401, "Log in first.");
    checkLockouts(ip);
    if (!tokenMatches(bearer)) {
        wrongToken(ip);
        throw new HttpError(401, "Wrong admin token.");
    }
}

function cleanNote(value) {
    return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

/* checks a name and returns how it will look in game: { edition, name, enteredName, uuid } */
async function resolvePlayer(edition, rawName) {
    if (edition !== "java" && edition !== "bedrock") throw new HttpError(400, "Pick Java or Bedrock.");
    let entered = String(rawName || "").trim();

    if (edition === "java") {
        if (!store.JAVA_NAME.test(entered)) {
            throw new HttpError(422, "Java names are 3 to 16 letters, numbers or underscores.");
        }
        let profile;
        try {
            profile = await lookupJavaProfile(entered);
        } catch (error) {
            log("mojang:", error.message);
            throw new HttpError(503, "Could not check that name with Mojang right now. Try again in a minute.");
        }
        if (!profile) throw new HttpError(422, `There is no Java account called ${entered}.`);
        return { edition, name: profile.name, enteredName: entered, uuid: profile.uuid };
    }

    if (config.floodgatePrefix && entered.startsWith(config.floodgatePrefix)) {
        entered = entered.slice(config.floodgatePrefix.length);
    }
    entered = entered.replace(/\s+/g, " ");
    if (!store.GAMERTAG.test(entered)) {
        throw new HttpError(422, "Gamertags are up to 16 letters, numbers and spaces.");
    }
    return { edition, name: store.floodgateName(entered), enteredName: entered, uuid: null };
}

function publicRequest(request) {
    return { edition: request.edition, name: request.name, status: request.status, createdAt: request.createdAt };
}

async function decide(id, approve, via) {
    const found = store.findRequest(id);
    if (!found) throw new HttpError(404, "No such request.");
    if (via === "ntfy" && found.status !== "pending") {
        return { request: found, alreadyDecided: true };
    }
    if (approve && store.findBlocked(found.edition, found.name, found.uuid)) {
        throw new HttpError(409, `${found.name} is on the blacklist: take them off it first.`);
    }
    const { request } = store.decideRequest(id, approve, via);
    log(`request ${id} ${request.status} via ${via}: ${request.name} (${request.edition})`);
    notifyDecision(request, via).catch((error) => log("ntfy:", error.message));
    return { request };
}

/* ---------- routes ---------- */

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route("GET", /^\/api\/health$/, () => ({ ok: true }));

route("GET", /^\/api\/status$/, async (req, res) => {
    rateLimit("status", clientIp(req), 120, 60);
    const status = await getStatus();
    const whitelist = store.getWhitelist();
    res.setHeader("Cache-Control", "public, max-age=10");
    return {
        ...status,
        whitelist: { enforced: whitelist.enforced },
        floodgate: { prefix: config.floodgatePrefix, replaceSpaces: config.floodgateReplaceSpaces },
    };
});

route("POST", /^\/api\/requests$/, async (req, res) => {
    const ip = clientIp(req);
    const body = await readJsonBody(req);

    // bots fill in every field, people never see this one
    if (body.website) {
        log("honeypot hit from", hashIp(ip));
        res.statusCode = 201;
        return { status: "pending", name: String(body.name || "").slice(0, 16), edition: body.edition };
    }

    // typos are fine (20 tries an hour), but at most 3 new requests an hour from one address
    rateLimit("request-try", ip, 20, 60 * 60);
    // who is asking: required, so a request is never just a name
    const note = cleanNote(body.note);
    if (note.length < 5) throw new HttpError(400, "Say who you are: who invited you, or your Discord name.");
    const player = await resolvePlayer(body.edition, body.name);

    if (store.findBlocked(player.edition, player.name, player.uuid)) {
        throw new HttpError(403, "This player can't request access to this server.", { status: "denied" });
    }
    if (store.findPlayer(player.edition, player.name, player.uuid)) {
        return { status: "approved", name: player.name, edition: player.edition, message: "You're already whitelisted." };
    }
    const previous = store.latestRequestFor(player.edition, player.name);
    if (previous?.status === "pending") {
        return { status: "pending", name: player.name, edition: player.edition, message: "Your request is already waiting." };
    }
    if (previous?.status === "denied") {
        throw new HttpError(409, "Your last request was declined. Get in touch if you think that's a mistake.", { status: "denied" });
    }
    if (store.pendingCount() >= config.maxPending) {
        throw new HttpError(503, "Too many requests are waiting right now. Try again later.");
    }
    rateLimit("request-new", ip, 3, 60 * 60);

    const request = store.addRequest({ ...player, note, ipHash: hashIp(ip) });
    log(`new request ${request.id}: ${request.name} (${request.edition})`);
    notifyNewRequest(request, store.pendingCount()).catch((error) => log("ntfy:", error.message));

    res.statusCode = 201;
    return { status: "pending", name: request.name, edition: request.edition };
});

route("GET", /^\/api\/requests\/lookup$/, async (req, res, url) => {
    rateLimit("lookup", clientIp(req), 30, 60);
    const edition = url.searchParams.get("edition");
    let name = String(url.searchParams.get("name") || "").trim();
    if (edition === "bedrock") {
        if (config.floodgatePrefix && name.startsWith(config.floodgatePrefix)) name = name.slice(config.floodgatePrefix.length);
        name = store.floodgateName(name);
    }
    if (!name || name.length > 17) throw new HttpError(400, "Give a name.");
    // a blacklisted player just reads "declined": the blacklist itself isn't shown to anyone
    if (store.findBlocked(edition, name)) return { status: "denied", name };
    if (store.isListedByName(edition, name)) return { status: "approved", name };
    const request = store.latestRequestFor(edition, name);
    return request ? publicRequest(request) : { status: "none", name };
});

/* notification buttons: signed links, so they work without the admin token */
route("POST", /^\/api\/act\/([\w-]+)\/(approve|deny)$/, async (req, res, url, [id, action]) => {
    rateLimit("act", clientIp(req), 30, 60);
    if (!verifyAction(id, action, url.searchParams.get("exp"), url.searchParams.get("sig"))) {
        throw new HttpError(403, "This link is invalid or has expired.");
    }
    const { request, alreadyDecided } = await decide(id, action === "approve", "ntfy");
    return { ok: true, status: request.status, alreadyDecided: Boolean(alreadyDecided) };
});

/* ---------- admin ---------- */

/* what the login form asks for: the token, and the authenticator code when 2FA is set up */
route("GET", /^\/api\/admin\/login$/, () => ({ code: Boolean(totpSecret) }));

route("POST", /^\/api\/admin\/login$/, async (req, res) => {
    const ip = clientIp(req);
    if (req.headers.origin !== adminOrigin(req)) throw new HttpError(403, "Log in from the admin page.");
    checkLockouts(ip);
    const body = await readJsonBody(req);
    // both are checked every time and a miss doesn't say which was wrong
    const tokenOk = tokenMatches(String(body.token || "").trim());
    const codeStep = totpSecret ? checkCode(totpSecret, String(body.code || "").trim()) : 0;
    if (!tokenOk || codeStep < 0) {
        wrongToken(ip);
        throw new HttpError(401, totpSecret ? "Wrong token or code." : "Wrong admin token.");
    }
    if (totpSecret) useCode(codeStep);
    const remember = body.remember === true;
    startSession(res, remember);
    store.recordLogin({ ip, from: placeOf(ip), remember });
    log("admin: logged in from", hashIp(ip), remember ? "(remembered)" : "");
    // an alert for every login, so one that wasn't you stands out
    notifySecurity("Admin login", `Someone logged in to the admin from ${ip} (${placeOf(ip)})${totpSecret ? " with token and code" : " with the token"}${remember ? ", remembered for 30 days" : ""}. Not you? Open the admin and press "log out everywhere".`)
        .catch((error) => log("ntfy:", error.message));
    return { ok: true };
});

route("POST", /^\/api\/admin\/logout$/, (req, res) => {
    if (!fromAdminPage(req)) throw new HttpError(403, "Log out from the admin page.");
    endSession(req, res);
    return { ok: true };
});

/* ends every login on every device, this one too */
route("POST", /^\/api\/admin\/logout-everywhere$/, (req, res) => {
    requireAdmin(req);
    const count = activeSessions();
    sessions.clear();
    endSession(req, res);
    log(`admin: logged out everywhere (${count} sessions)`);
    return { ok: true };
});

route("GET", /^\/api\/admin\/overview$/, (req, res, url) => {
    requireAdmin(req, url.searchParams.get("auto") === "1");
    const whitelist = store.getWhitelist();
    const listedUuids = new Set(whitelist.players.map((player) => player.uuid).filter(Boolean));
    const listedKeys = new Set(whitelist.players.map((player) => player.key));
    const seen = store.readSeen().map((entry) => ({
        ...entry,
        listed: listedUuids.has(entry.uuid)
            || (entry.edition === "bedrock" && listedKeys.has(store.playerKey("bedrock", entry.name))),
        blocked: Boolean(store.findBlocked(entry.edition, entry.name, entry.uuid)),
    }));
    return {
        requests: [...store.allRequests()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500),
        whitelist: { ...whitelist, defaultMessage: store.DEFAULT_MESSAGE, blockedMessage: store.BLOCKED_MESSAGE },
        // what {site} in the kick message becomes, for the preview
        siteHost: config.siteUrl.replace(/^https?:\/\//, ""),
        seen,
        activity: store.getActivity().slice(-100).reverse(),
        ntfy: ntfyEnabled(),
        // the login before this one, and how many devices are logged in now
        security: {
            previousLogin: store.getLogins().slice(-2, -1)[0] || null,
            sessions: activeSessions(),
            idleMinutes: config.idleMinutes,
            twoFactor: Boolean(totpSecret),
        },
    };
});

route("POST", /^\/api\/admin\/requests\/([\w-]+)\/(approve|deny)$/, async (req, res, url, [id, action]) => {
    requireAdmin(req);
    const { request } = await decide(id, action === "approve", "admin");
    return { request };
});

route("DELETE", /^\/api\/admin\/requests\/([\w-]+)$/, (req, res, url, [id]) => {
    requireAdmin(req);
    if (!store.deleteRequest(id)) throw new HttpError(404, "No such request.");
    return { ok: true };
});

/* add a player by hand, or straight from the "seen" list (then uuid and exact name are known) */
route("POST", /^\/api\/admin\/players$/, async (req) => {
    requireAdmin(req);
    const body = await readJsonBody(req);
    let player;
    if (body.fromSeen && /^[0-9a-f-]{36}$/i.test(body.uuid || "") && /^[.\w]{1,16}$/.test(body.name || "")) {
        player = { edition: body.edition === "bedrock" ? "bedrock" : "java", name: body.name, uuid: body.uuid.toLowerCase() };
    } else {
        player = await resolvePlayer(body.edition, body.name);
    }
    if (store.findBlocked(player.edition, player.name, player.uuid)) {
        throw new HttpError(409, `${player.name} is on the blacklist: take them off it first.`);
    }
    const added = store.addPlayer({ ...player, source: body.fromSeen ? "seen" : "admin" });
    log(`added ${added.name} (${added.edition}) by hand`);
    return { player: added };
});

route("DELETE", /^\/api\/admin\/players\/(.+)$/, (req, res, url, [key]) => {
    requireAdmin(req);
    if (!store.removePlayer(decodeURIComponent(key))) throw new HttpError(404, "Not on the whitelist.");
    log(`removed ${decodeURIComponent(key)}`);
    return { ok: true };
});

/* blacklist someone: from a request, the seen list, the whitelist, or by name */
route("POST", /^\/api\/admin\/blocked$/, async (req) => {
    requireAdmin(req);
    const body = await readJsonBody(req);
    let player;
    let source = "admin";
    const request = body.requestId ? store.findRequest(String(body.requestId)) : null;
    const listed = body.key ? store.getWhitelist().players.find((item) => item.key === body.key) : null;
    if (request) {
        player = { edition: request.edition, name: request.name, uuid: request.uuid };
        source = "request";
    } else if (listed) {
        player = { edition: listed.edition, name: listed.name, uuid: listed.uuid };
        source = "whitelist";
    } else if (body.fromSeen && /^[0-9a-f-]{36}$/i.test(body.uuid || "") && /^[.\w]{1,16}$/.test(body.name || "")) {
        player = { edition: body.edition === "bedrock" ? "bedrock" : "java", name: body.name, uuid: body.uuid.toLowerCase() };
        source = "seen";
    } else {
        player = await resolvePlayer(body.edition, body.name);
    }
    const blocked = store.blockPlayer({ ...player, reason: cleanNote(body.reason).slice(0, 100), source });
    log(`blacklisted ${blocked.name} (${blocked.edition})`);
    return { player: blocked };
});

route("DELETE", /^\/api\/admin\/blocked\/(.+)$/, (req, res, url, [key]) => {
    requireAdmin(req);
    if (!store.unblockPlayer(decodeURIComponent(key))) throw new HttpError(404, "Not on the blacklist.");
    log(`took ${decodeURIComponent(key)} off the blacklist`);
    return { ok: true };
});

route("POST", /^\/api\/admin\/test-notification$/, async (req) => {
    requireAdmin(req);
    rateLimit("ntfy-test", clientIp(req), 5, 60);
    try {
        await notifyTest();
    } catch (error) {
        log("ntfy test:", error.message);
        throw new HttpError(502, `ntfy: ${error.message}`);
    }
    return { ok: true };
});

route("PUT", /^\/api\/admin\/settings$/, async (req) => {
    requireAdmin(req);
    const body = await readJsonBody(req);
    const update = {};
    if (typeof body.enforced === "boolean") update.enforced = body.enforced;
    if (typeof body.message === "string") {
        if (body.message.length > 600) throw new HttpError(422, "Keep the kick message under 600 characters.");
        update.message = body.message.trim();
    }
    const whitelist = store.updateSettings(update);
    log(`settings: enforced=${whitelist.enforced}`);
    return { enforced: whitelist.enforced, message: whitelist.message };
});

/* ---------- server ---------- */

/* the public site may read the public routes; the admin routes only answer their own page */
function applyCors(req, res, pathname) {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin) && !pathname.startsWith("/api/admin/")) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, If-None-Match");
        res.setHeader("Access-Control-Expose-Headers", "ETag");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        res.setHeader("Access-Control-Max-Age", "600");
    }
    res.setHeader("Vary", "Origin");
}

/* ---------- the admin page ---------- */

const totpSecret = config.adminTotpSecret ? base32Decode(config.adminTotpSecret) : null;

const fileTypes = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg",
    ".ico": "image/x-icon", ".woff2": "font/woff2", ".json": "application/json",
};
// the page's own rules, as a header (a meta tag can't forbid framing): its own files, the game
// font from Google, player heads from mc-heads.net, and calls only to this API
const adminPagePolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    + "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://mc-heads.net; connect-src 'self'; "
    + "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function sendPlain(res, status, text) {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(text);
}

/* admin/index.html and admin/admin.js, and the site's styles, scripts, fonts and pictures they use.
   only those folders, only known file types, nothing outside them (no "..") */
function adminFile(relative) {
    if (relative === "" || relative === "index.html") return path.join(config.pageDir, "admin", "index.html");
    if (relative === "admin.js") return path.join(config.pageDir, "admin", "admin.js");
    if (!/^(scripts|styles|fonts|images)(\/[\w.-]+)+$/.test(relative) || relative.includes("..")) return null;
    const root = path.join(config.pageDir, "site");
    const file = path.resolve(root, relative);
    return file.startsWith(root + path.sep) ? file : null;
}

async function serveAdminPage(res, relative) {
    const file = adminFile(relative);
    const type = file && fileTypes[path.extname(file)];
    if (!type) return sendPlain(res, 404, "Not found.");
    try {
        const body = await fs.promises.readFile(file);
        res.setHeader("Content-Security-Policy", adminPagePolicy);
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cache-Control", type.startsWith("text/html") ? "no-store" : "no-cache");
        res.writeHead(200, { "Content-Type": type });
        res.end(body);
    } catch {
        sendPlain(res, 404, "Not found.");
    }
}

const server = http.createServer(async (req, res) => {
    // the API only answers with data: nothing may run it as a page, frame it or read the address it came from
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    const url = new URL(req.url, "http://localhost");
    applyCors(req, res, url.pathname);

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
    }

    // the admin page: only on the home network and the VPN; anywhere else it doesn't exist
    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
        if (req.method !== "GET" || !fromAdminNetwork(req)) return sendPlain(res, 404, "Not found.");
        if (url.pathname === "/admin") {
            res.writeHead(301, { Location: "/admin/" });
            return res.end();
        }
        return serveAdminPage(res, url.pathname.slice("/admin/".length));
    }

    try {
        // the admin only answers on the home network and the VPN (ADMIN_NETWORKS)
        if (url.pathname.startsWith("/api/admin/") && !fromAdminNetwork(req)) {
            throw new HttpError(403, "The admin only works from home or over the VPN.", { reason: "network" });
        }
        for (const { method, pattern, handler } of routes) {
            const match = url.pathname.match(pattern);
            if (match && method === req.method) {
                const body = await handler(req, res, url, match.slice(1));
                return send(res, res.statusCode || 200, body, {}, req);
            }
        }
        throw new HttpError(404, "Not found.");
    } catch (error) {
        if (error instanceof HttpError) {
            const headers = error.extra.retryAfter ? { "Retry-After": String(error.extra.retryAfter) } : {};
            const { retryAfter, ...extra } = error.extra;
            return send(res, error.status, { error: error.message, ...extra }, headers);
        }
        log("error:", error);
        return send(res, 500, { error: "Something broke on our side." });
    }
});

const problems = checkConfig();
if (problems.length) {
    for (const problem of problems) console.error("config:", problem);
    process.exit(1);
}
try {
    store.load();
} catch (error) {
    console.error("startup:", error.message);
    process.exit(1);
}

server.listen(config.port, () => {
    const whitelist = store.getWhitelist();
    log(`whitelist API on :${config.port}, ${whitelist.players.length} players, enforced=${whitelist.enforced}, ntfy=${ntfyEnabled() ? config.ntfy.topic : "off"}`);
    log(config.adminNetworks.length ? `admin only from ${config.adminNetworks.join(", ")}` : "admin from anywhere (ADMIN_NETWORKS is empty)");
});

for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => server.close(() => process.exit(0)));
}
