// Requests, the whitelist and the history of changes live in small JSON files in DATA_DIR.
// After every change the whitelist is also written to EXPORT_DIR/whitelist.txt for the Velocity plugin.
// Files other programs write (the plugin's seen.tsv, mc-backup's archived.txt) are only read, and
// treated as untrusted: size-capped, and any line that doesn't look right is skipped.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";

const requestsFile = () => path.join(config.dataDir, "requests.json");
const whitelistFile = () => path.join(config.dataDir, "whitelist.json");
const activityFile = () => path.join(config.dataDir, "activity.json");
const loginsFile = () => path.join(config.dataDir, "logins.json");
const exportFile = () => path.join(config.exportDir, "whitelist.txt");

export const DEFAULT_MESSAGE =
    "<red>You're not on the whitelist yet.</red><newline><newline>"
    + "<gray>Request access at</gray> <white>{site}</white>";

// the history keeps the newest changes only, the login list the last few logins
const ACTIVITY_LIMIT = 300;
const LOGINS_LIMIT = 10;
// files from other programs bigger than this are not read at all
const SEEN_MAX_BYTES = 5 * 1024 * 1024;
const ARCHIVED_MAX_BYTES = 64 * 1024;

let requests = [];
let whitelist = { enforced: false, message: "", players: [] };
let activity = [];
let logins = [];
let lastExportTime = 0;

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") return fallback;
        throw new Error(`could not read ${file}: ${error.message}`);
    }
}

function writeAtomic(file, text, mtimeMs) {
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, text);
    if (mtimeMs) fs.utimesSync(temporary, mtimeMs / 1000, mtimeMs / 1000);
    fs.renameSync(temporary, file);
}

export function load() {
    for (const directory of [config.dataDir, config.exportDir]) {
        fs.mkdirSync(directory, { recursive: true });
        try {
            fs.accessSync(directory, fs.constants.W_OK);
        } catch {
            throw new Error(`${directory} is not writable by uid ${process.getuid?.()}; run: sudo chown -R 1000:1000 <the host folder>`);
        }
    }
    requests = readJson(requestsFile(), { requests: [] }).requests || [];
    const stored = readJson(whitelistFile(), {});
    whitelist = {
        enforced: Boolean(stored.enforced),
        message: typeof stored.message === "string" ? stored.message : "",
        players: Array.isArray(stored.players) ? stored.players : [],
    };
    activity = readJson(activityFile(), null)?.activity || seedActivity();
    logins = readJson(loginsFile(), { logins: [] }).logins || [];
    exportWhitelist();
}

function saveRequests() {
    writeAtomic(requestsFile(), JSON.stringify({ version: 1, requests }, null, 2));
}

function saveWhitelist() {
    writeAtomic(whitelistFile(), JSON.stringify({ version: 1, ...whitelist }, null, 2));
    exportWhitelist();
}

/* ---------- history ---------- */

/* one change: who, what and when (newest last) */
function record(action, details) {
    activity.push({ at: new Date().toISOString(), action, ...details });
    if (activity.length > ACTIVITY_LIMIT) activity = activity.slice(-ACTIVITY_LIMIT);
    writeAtomic(activityFile(), JSON.stringify({ version: 1, activity }, null, 2));
}

/* before the history existed: rebuild what the requests and the whitelist still tell */
function seedActivity() {
    const events = [];
    for (const player of whitelist.players) {
        if (!String(player.source || "").startsWith("request")) {
            events.push({ at: player.addedAt, action: "added", edition: player.edition, name: player.name, source: player.source });
        }
    }
    for (const request of requests) {
        events.push({ at: request.createdAt, action: "requested", edition: request.edition, name: request.name, requestId: request.id });
        if (request.decidedAt) {
            events.push({ at: request.decidedAt, action: request.status, edition: request.edition, name: request.name, via: request.decidedVia, requestId: request.id });
        }
    }
    return events.filter((event) => event.at).sort((a, b) => a.at.localeCompare(b.at)).slice(-ACTIVITY_LIMIT);
}

export function getActivity() {
    return activity;
}

/* the file the plugin reads; tabs separate columns, so none may appear inside a value */
function exportWhitelist() {
    const clean = (text) => String(text).replace(/[\t\r]/g, " ").replace(/\n/g, "<newline>");
    const site = config.siteUrl.replace(/^https?:\/\//, "") || "our website";
    const message = (whitelist.message || DEFAULT_MESSAGE).replaceAll("{site}", site);

    const lines = [
        "# written by the whitelist API, do not edit: change it on the admin page",
        `enabled\t${whitelist.enforced}`,
        `message\t${clean(message)}`,
        ...whitelist.players.map((player) => player.edition === "java"
            ? `java\t${player.uuid}\t${clean(player.name)}`
            : `bedrock\t${player.uuid || "-"}\t${clean(player.name)}`),
    ];
    // the plugin notices changes by modification time, so every export gets a strictly newer one
    lastExportTime = Math.max(Date.now(), lastExportTime + 1000);
    writeAtomic(exportFile(), lines.join("\n") + "\n", lastExportTime);
}

/* ---------- names ---------- */

export const JAVA_NAME = /^[A-Za-z0-9_]{3,16}$/;
export const GAMERTAG = /^[A-Za-z0-9 _]{1,16}$/;

/* the name Floodgate gives a Bedrock player: prefix + gamertag, cut to 16 characters */
export function floodgateName(gamertag) {
    const prefix = config.floodgatePrefix;
    let name = prefix + gamertag.slice(0, Math.max(0, 16 - prefix.length));
    if (config.floodgateReplaceSpaces) name = name.replaceAll(" ", "_");
    return name;
}

export function playerKey(edition, name, uuid) {
    return edition === "java" ? `java:${uuid}` : `bedrock:${name.toLowerCase()}`;
}

/* ---------- requests ---------- */

export function allRequests() {
    return requests;
}

export function findRequest(id) {
    return requests.find((request) => request.id === id);
}

/* the newest request for this player, matched by the name as stored */
export function latestRequestFor(edition, name) {
    const lower = name.toLowerCase();
    return requests
        .filter((request) => request.edition === edition && request.name.toLowerCase() === lower)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function pendingCount() {
    return requests.filter((request) => request.status === "pending").length;
}

export function addRequest({ edition, name, enteredName, uuid, note, ipHash }) {
    const request = {
        id: crypto.randomBytes(6).toString("base64url"),
        edition,
        name,
        enteredName,
        uuid: uuid || null,
        note,
        status: "pending",
        createdAt: new Date().toISOString(),
        decidedAt: null,
        decidedVia: null,
        ipHash,
    };
    requests.push(request);
    saveRequests();
    record("requested", { edition, name, requestId: request.id });
    return request;
}

export function decideRequest(id, approve, via) {
    const request = findRequest(id);
    if (!request) return { error: "not_found" };
    const wasApproved = request.status === "approved";
    request.status = approve ? "approved" : "denied";
    request.decidedAt = new Date().toISOString();
    request.decidedVia = via;
    saveRequests();
    record(request.status, { edition: request.edition, name: request.name, via, requestId: request.id });
    // the decision is the history line, so adding or removing the player is not one of its own
    if (approve) {
        addPlayer({ edition: request.edition, name: request.name, uuid: request.uuid, source: `request ${request.id}` });
    } else if (wasApproved) {
        removePlayer(playerKey(request.edition, request.name, request.uuid), true);
    }
    return { request };
}

export function deleteRequest(id) {
    const request = findRequest(id);
    if (!request) return false;
    requests = requests.filter((item) => item !== request);
    saveRequests();
    record("forgotten", { edition: request.edition, name: request.name });
    return true;
}

/* ---------- whitelist ---------- */

export function getWhitelist() {
    return whitelist;
}

export function findPlayer(edition, name, uuid) {
    const key = playerKey(edition, name, uuid);
    return whitelist.players.find((player) => player.key === key);
}

/* also matches a Java player by name, for the public "check my request" lookup */
export function isListedByName(edition, name) {
    const lower = name.toLowerCase();
    return whitelist.players.some((player) => player.edition === edition && player.name.toLowerCase() === lower);
}

export function addPlayer({ edition, name, uuid, source }) {
    const key = playerKey(edition, name, uuid);
    const existing = whitelist.players.find((player) => player.key === key);
    if (existing) {
        existing.name = name; // keeps a Java name up to date after a rename
        saveWhitelist();
        return existing;
    }
    const player = { key, edition, name, uuid: uuid || null, addedAt: new Date().toISOString(), source };
    whitelist.players.push(player);
    saveWhitelist();
    if (!source.startsWith("request")) record("added", { edition, name, source });
    return player;
}

/* isPartOfDecision: a request decision already wrote the history line */
export function removePlayer(key, isPartOfDecision = false) {
    const player = whitelist.players.find((item) => item.key === key);
    if (!player) return false;
    whitelist.players = whitelist.players.filter((item) => item !== player);
    saveWhitelist();
    if (!isPartOfDecision) record("removed", { edition: player.edition, name: player.name });

    // their approved request no longer holds (and they can't simply ask again)
    let changed = false;
    for (const request of requests) {
        if (request.status === "approved" && playerKey(request.edition, request.name, request.uuid) === key) {
            request.status = "denied";
            request.decidedAt = new Date().toISOString();
            request.decidedVia = "removed";
            changed = true;
        }
    }
    if (changed) saveRequests();
    return true;
}

export function updateSettings({ enforced, message }) {
    const wasEnforced = whitelist.enforced;
    const oldMessage = whitelist.message;
    if (typeof enforced === "boolean") whitelist.enforced = enforced;
    if (typeof message === "string") whitelist.message = message;
    saveWhitelist();
    if (whitelist.enforced !== wasEnforced) record(whitelist.enforced ? "turned on" : "turned off", {});
    if (whitelist.message !== oldMessage) record(whitelist.message ? "message changed" : "message reset", {});
    return whitelist;
}

/* ---------- admin logins (for "last login" on the admin page) ---------- */

export function recordLogin(login) {
    logins.push({ at: new Date().toISOString(), ...login });
    if (logins.length > LOGINS_LIMIT) logins = logins.slice(-LOGINS_LIMIT);
    writeAtomic(loginsFile(), JSON.stringify({ version: 1, logins }, null, 2));
}

export function getLogins() {
    return logins;
}

/* ---------- files other programs write: read-only, size-capped, checked line by line ---------- */

function readSmallFile(file, maxBytes) {
    try {
        if (fs.statSync(file).size > maxBytes) return null;
        return fs.readFileSync(file, "utf8");
    } catch {
        return null;
    }
}

const UUID_TEXT = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const validTime = (value) => Number.isFinite(value) && value > 0 && value < 8.64e15;

/* everyone who joined, as the plugin wrote it to seen.tsv */
export function readSeen() {
    const text = readSmallFile(config.seenFile, SEEN_MAX_BYTES);
    if (!text) return [];
    return text.split("\n")
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
            const [uuid, name, edition, firstSeen, lastSeen, logins, turnedAway] = line.split("\t");
            return { uuid, name, edition, firstSeen: Number(firstSeen), lastSeen: Number(lastSeen), logins: Number(logins), turnedAway };
        })
        .filter((entry) => UUID_TEXT.test(entry.uuid || "") && /^[.\w ]{1,32}$/.test(entry.name || "")
            && (entry.edition === "java" || entry.edition === "bedrock")
            && validTime(entry.firstSeen) && validTime(entry.lastSeen))
        .slice(0, 5000)
        .map((entry) => ({
            uuid: entry.uuid, name: entry.name, edition: entry.edition,
            firstSeen: new Date(entry.firstSeen).toISOString(),
            lastSeen: new Date(entry.lastSeen).toISOString(),
            logins: Number.isFinite(entry.logins) ? entry.logins : 0,
            turnedAway: entry.turnedAway === "true",
        }));
}

/* a small list the host scripts write (archived.txt, off.txt): one server per line,
   name <tab> a date <tab> one more field. read again only when the file changes; bad lines are skipped */
const listCache = new Map();

function readServerList(file, toEntry) {
    let mtimeMs;
    try {
        mtimeMs = fs.statSync(file).mtimeMs;
    } catch {
        return [];
    }
    const cached = listCache.get(file);
    if (cached && cached.mtimeMs === mtimeMs) return cached.entries;
    const text = readSmallFile(file, ARCHIVED_MAX_BYTES) || "";
    const entries = text.split("\n")
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => line.split("\t"))
        .filter(([name, date]) => /^[\w.-]{1,40}$/.test(name || "") && validTime(Date.parse(date)))
        .slice(0, 100)
        .map(([name, date, extra]) => toEntry(name, new Date(Date.parse(date)).toISOString(), extra));
    listCache.set(file, { mtimeMs, entries });
    return entries;
}

/* the archived worlds, as mc-backup --archive wrote them: name, when, the archive's size in bytes */
export function readArchived() {
    return readServerList(config.archivedFile, (name, archivedAt, size) => ({
        name,
        archivedAt,
        size: Number.isFinite(Number(size)) && Number(size) >= 0 && size !== "" ? Number(size) : null,
    }));
}

/* servers turned off on purpose, as mc-off wrote them: name, since when, and the reason (shown on
   the website as text; control characters dropped, 80 characters at most) */
export function readOff() {
    return readServerList(config.offFile, (name, since, reason) => ({
        name,
        since,
        reason: String(reason || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80),
    }));
}
