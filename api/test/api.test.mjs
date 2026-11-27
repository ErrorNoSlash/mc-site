// End-to-end checks of the whitelist API: it is started as a real process on a free port, with its
// files in a temporary folder, and talked to over HTTP like the site, the admin page and the phone do.
// Run with: node --test api/test/*.test.mjs   (GitHub Actions runs it on every push: .github/workflows/api.yml)

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codeFor, base32Decode } from "../src/totp.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-api-test-"));
for (const sub of ["data", "plugin", "archived"]) fs.mkdirSync(path.join(dir, sub));

const token = crypto.randomBytes(24).toString("hex");
const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const port = 20000 + Math.floor(Math.random() * 20000);
const origin = `http://127.0.0.1:${port}`;
const site = "http://site.test";
const griefer = crypto.randomUUID();
const home = { "x-real-ip": "10.0.0.151" };
const away = { "x-real-ip": "203.0.113.5" };

fs.writeFileSync(path.join(dir, "plugin/seen.tsv"), `${griefer}\tGriefer\tjava\t1700000000000\t1700000500000\t3\ttrue\n`);
fs.writeFileSync(path.join(dir, "archived/archived.txt"), "survival-old\t2026-11-27T17:04:00Z\t553000000\n");
fs.writeFileSync(path.join(dir, "archived/off.txt"), "anarchy\t2026-11-27T18:00:00Z\tback in december\n");

let api;
let cookie = "";

before(async () => {
    api = spawn(process.execPath, [path.join(repo, "api/src/server.js")], {
        env: {
            ...process.env, PORT: String(port), ADMIN_TOKEN: token, ADMIN_TOTP_SECRET: secret, ADMIN_ORIGIN: origin,
            ADMIN_NETWORKS: "10.0.0.0/24, 100.64.0.0/10", CLIENT_IP_HEADER: "x-real-ip", SITE_URL: site, ALLOWED_ORIGINS: site,
            PUBLIC_API_URL: origin, PAGE_DIR: repo, DATA_DIR: path.join(dir, "data"), EXPORT_DIR: path.join(dir, "data/export"),
            SEEN_FILE: path.join(dir, "plugin/seen.tsv"), ARCHIVED_FILE: path.join(dir, "archived/archived.txt"),
            STATUS_SERVERS: "DS Network=127.0.0.1:1, survival=127.0.0.1:2, anarchy=127.0.0.1:3, survival-old=127.0.0.1:4",
        },
        stdio: "ignore",
    });
    for (let i = 0; i < 100; i++) {
        try {
            await fetch(origin + "/api/health");
            return;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    throw new Error("the API didn't start");
});

after(() => {
    api?.kill();
    fs.rmSync(dir, { recursive: true, force: true });
});

async function call(pathname, { method = "GET", body, headers = {} } = {}) {
    const response = await fetch(origin + pathname, {
        method, redirect: "manual",
        headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let data = null;
    try {
        data = JSON.parse(text);
    } catch { }
    return { status: response.status, headers: response.headers, text, data };
}

const code = () => codeFor(base32Decode(secret), Math.floor(Date.now() / 30_000));
const asAdmin = (extra = {}) => ({ ...home, cookie, origin, "sec-fetch-site": "same-origin", ...extra });
const signed = (id, action) => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const sig = crypto.createHmac("sha256", token).update(`act:${id}:${action}:${exp}`).digest("base64url");
    return `/api/act/${id}/${action}?exp=${exp}&sig=${sig}`;
};

test("status: archived worlds left out, a turned-off server marked off", async () => {
    const { data } = await call("/api/status");
    assert.deepEqual(data.servers.map((server) => server.name), ["survival", "anarchy"]);
    assert.equal(data.servers[0].off, undefined);
    assert.deepEqual(data.servers[1].off, { since: "2026-11-27T18:00:00.000Z", reason: "back in december" });
    assert.equal(data.archived[0].name, "survival-old");
});

test("a request needs a note saying who is asking", async () => {
    const none = await call("/api/requests", { method: "POST", body: { edition: "bedrock", name: "Some One" } });
    assert.equal(none.status, 400);
    const ok = await call("/api/requests", { method: "POST", body: { edition: "bedrock", name: "Some One", note: "friend of Soelaas" } });
    assert.equal(ok.status, 201);
});

test("the admin page only exists on the home network and the VPN", async () => {
    assert.equal((await call("/admin/", { headers: away })).status, 404);
    const page = await call("/admin/", { headers: home });
    assert.equal(page.status, 200);
    assert.match(page.text, /Admin login/);
    assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal((await call("/admin/scripts/../../api/src/config.js", { headers: home })).status, 404);
    assert.equal((await call("/api/admin/overview", { headers: away })).status, 403);
});

test("login takes the token and a fresh authenticator code, from the admin page only", async () => {
    const login = (body, headers = {}) => call("/api/admin/login", { method: "POST", body, headers: { ...home, origin, ...headers } });
    assert.equal((await login({ token })).status, 401);
    assert.equal((await login({ token: "x".repeat(48), code: code() })).status, 401);
    assert.equal((await login({ token, code: code() }, { origin: site })).status, 403);
    const fresh = code();
    const ok = await login({ token, code: fresh });
    assert.equal(ok.status, 200);
    cookie = ok.headers.get("set-cookie").split(";")[0];
    assert.equal((await login({ token, code: fresh })).status, 401, "a code works once");
});

test("admin calls with the cookie only work from the admin page", async () => {
    assert.equal((await call("/api/admin/overview", { headers: asAdmin() })).status, 200);
    assert.equal((await call("/api/admin/overview", { headers: asAdmin({ "sec-fetch-site": "same-site" }) })).status, 403);
    assert.equal((await call("/api/admin/settings", { method: "PUT", body: { enforced: true }, headers: asAdmin({ origin: site }) })).status, 403);
    assert.equal((await call("/api/admin/settings", { method: "PUT", body: { enforced: true }, headers: asAdmin() })).status, 200);
    assert.equal(await call("/api/admin/login", { headers: { ...home, origin: site } }).then((r) => r.headers.get("access-control-allow-origin")), null);
});

test("blacklist: from the seen list, then nobody can add, approve or let them ask", async () => {
    const block = await call("/api/admin/blocked", { method: "POST", headers: asAdmin(), body: { fromSeen: true, edition: "java", name: "Griefer", uuid: griefer, reason: "burned the spawn" } });
    assert.equal(block.status, 200);
    const add = await call("/api/admin/players", { method: "POST", headers: asAdmin(), body: { fromSeen: true, edition: "java", name: "Griefer", uuid: griefer } });
    assert.equal(add.status, 409);
    const exported = fs.readFileSync(path.join(dir, "data/export/whitelist.txt"), "utf8");
    assert.match(exported, new RegExp(`blocked\\tjava\\t${griefer}\\tGriefer`));
    assert.match(exported, /^blockmessage\t/m);
    const { data } = await call("/api/admin/overview", { headers: asAdmin() });
    assert.equal(data.seen[0].blocked, true);
    const key = data.whitelist.blocked[0].key;
    assert.equal((await call(`/api/admin/blocked/${encodeURIComponent(key)}`, { method: "DELETE", headers: asAdmin() })).status, 200);
});

test("the Block button in a notification blacklists the requester", async () => {
    const { data } = await call("/api/admin/overview", { headers: asAdmin() });
    const request = data.requests.find((item) => item.status === "pending");
    assert.ok(request, "the request from the earlier test");
    assert.equal((await call(signed(request.id, "block").replace(/sig=.*/, "sig=wrong"), { method: "POST" })).status, 403);
    assert.equal((await call(signed(request.id, "block"), { method: "POST" })).status, 200);
    const again = await call("/api/requests", { method: "POST", body: { edition: "bedrock", name: "Some One", note: "let me in again" } });
    assert.equal(again.status, 403);
    const lookup = await call("/api/requests/lookup?edition=bedrock&name=Some%20One");
    assert.equal(lookup.data.status, "denied");
});
