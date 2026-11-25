// Requests and the whitelist live in two small JSON files in DATA_DIR.
// After every change the whitelist is also written to PLUGIN_DIR/whitelist.txt for the Velocity plugin.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";

const requestsFile = () => path.join(config.dataDir, "requests.json");
const whitelistFile = () => path.join(config.dataDir, "whitelist.json");
const exportFile = () => path.join(config.pluginDir, "whitelist.txt");
const seenFile = () => path.join(config.pluginDir, "seen.tsv");

export const DEFAULT_MESSAGE =
    "<red>You're not on the whitelist yet.</red><newline><newline>"
    + "<gray>Request access at</gray> <white>{site}</white>";

let requests = [];
let whitelist = { enforced: false, message: "", players: [] };
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
    for (const directory of [config.dataDir, config.pluginDir]) {
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
    exportWhitelist();
}

function saveRequests() {
    writeAtomic(requestsFile(), JSON.stringify({ version: 1, requests }, null, 2));
}

function saveWhitelist() {
    writeAtomic(whitelistFile(), JSON.stringify({ version: 1, ...whitelist }, null, 2));
    exportWhitelist();
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
    if (approve) {
        addPlayer({ edition: request.edition, name: request.name, uuid: request.uuid, source: `request ${request.id}` });
    } else if (wasApproved) {
        removePlayer(playerKey(request.edition, request.name, request.uuid));
    }
    return { request };
}

export function deleteRequest(id) {
    const before = requests.length;
    requests = requests.filter((request) => request.id !== id);
    if (requests.length !== before) saveRequests();
    return requests.length !== before;
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
    return player;
}

export function removePlayer(key) {
    const before = whitelist.players.length;
    whitelist.players = whitelist.players.filter((player) => player.key !== key);
    if (whitelist.players.length === before) return false;
    saveWhitelist();

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
    if (typeof enforced === "boolean") whitelist.enforced = enforced;
    if (typeof message === "string") whitelist.message = message;
    saveWhitelist();
    return whitelist;
}

/* ---------- seen players (written by the plugin) ---------- */

export function readSeen() {
    let text;
    try {
        text = fs.readFileSync(seenFile(), "utf8");
    } catch {
        return [];
    }
    return text.split("\n")
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
            const [uuid, name, edition, firstSeen, lastSeen, logins, turnedAway] = line.split("\t");
            return {
                uuid, name, edition,
                firstSeen: new Date(Number(firstSeen)).toISOString(),
                lastSeen: new Date(Number(lastSeen)).toISOString(),
                logins: Number(logins),
                turnedAway: turnedAway === "true",
            };
        })
        .filter((entry) => entry.uuid && entry.name);
}
