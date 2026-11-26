// Whitelist API: server status, whitelist requests, and the admin endpoints.
// No dependencies: Node's own http, fetch and crypto.

import http from "node:http";
import crypto from "node:crypto";
import { config, checkConfig } from "./config.js";
import * as store from "./store.js";
import { getStatus } from "./status.js";
import { lookupJavaProfile } from "./mojang.js";
import { notifyNewRequest, notifyDecision, notifyTest, verifyAction, ntfyEnabled } from "./notify.js";

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
}, 60_000).unref();

function requireAdmin(req) {
    const ip = clientIp(req);
    const given = Buffer.from(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
    const expected = Buffer.from(config.adminToken);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
        rateLimit("admin-fail", ip, 10, 15 * 60);
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
    const player = await resolvePlayer(body.edition, body.name);

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

    const request = store.addRequest({ ...player, note: cleanNote(body.note), ipHash: hashIp(ip) });
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

route("GET", /^\/api\/admin\/overview$/, (req) => {
    requireAdmin(req);
    const whitelist = store.getWhitelist();
    const listedUuids = new Set(whitelist.players.map((player) => player.uuid).filter(Boolean));
    const listedKeys = new Set(whitelist.players.map((player) => player.key));
    const seen = store.readSeen().map((entry) => ({
        ...entry,
        listed: listedUuids.has(entry.uuid)
            || (entry.edition === "bedrock" && listedKeys.has(store.playerKey("bedrock", entry.name))),
    }));
    return {
        requests: [...store.allRequests()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500),
        whitelist: { ...whitelist, defaultMessage: store.DEFAULT_MESSAGE },
        seen,
        activity: store.getActivity().slice(-100).reverse(),
        ntfy: ntfyEnabled(),
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

function applyCors(req, res) {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, If-None-Match");
        res.setHeader("Access-Control-Expose-Headers", "ETag");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        res.setHeader("Access-Control-Max-Age", "600");
    }
    res.setHeader("Vary", "Origin");
}

const server = http.createServer(async (req, res) => {
    // the API only answers with data: nothing may run it as a page, frame it or read the address it came from
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    applyCors(req, res);

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
    }

    const url = new URL(req.url, "http://localhost");
    try {
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
});

for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => server.close(() => process.exit(0)));
}
