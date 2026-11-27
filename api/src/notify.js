// ntfy push for every new request, with Approve / Deny buttons that work from the notification.

import crypto from "node:crypto";
import { config } from "./config.js";

const ACTION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

function signature(id, action, expires) {
    return crypto.createHmac("sha256", config.adminToken).update(`act:${id}:${action}:${expires}`).digest("base64url");
}

export function signedActionUrl(id, action) {
    const expires = Math.floor(Date.now() / 1000) + ACTION_LIFETIME_SECONDS;
    return `${config.publicApiUrl}/api/act/${encodeURIComponent(id)}/${action}?exp=${expires}&sig=${signature(id, action, expires)}`;
}

export function verifyAction(id, action, expires, sig) {
    if (!/^\d+$/.test(expires || "") || Number(expires) < Date.now() / 1000) return false;
    const expected = Buffer.from(signature(id, action, expires));
    const given = Buffer.from(String(sig || ""));
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export function ntfyEnabled() {
    return Boolean(config.ntfy.topic);
}

function authHeader() {
    if (config.ntfy.token) return `Bearer ${config.ntfy.token}`;
    if (config.ntfy.username) {
        return `Basic ${Buffer.from(`${config.ntfy.username}:${config.ntfy.password}`).toString("base64")}`;
    }
    return null;
}

async function publish(message) {
    if (!ntfyEnabled()) return;
    const headers = { "Content-Type": "application/json" };
    const auth = authHeader();
    if (auth) headers.Authorization = auth;

    let response;
    try {
        response = await fetch(config.ntfy.url, {
            method: "POST",
            headers,
            body: JSON.stringify({ topic: config.ntfy.topic, ...message }),
            signal: AbortSignal.timeout(8000),
        });
    } catch (error) {
        // ENOTFOUND: not on the same Docker network; ECONNREFUSED: wrong port; TimeoutError: firewall
        throw new Error(`can't reach ${config.ntfy.url} (${error.cause?.code || error.name || error.message})`);
    }
    if (response.status === 401 || response.status === 403) {
        throw new Error(`ntfy refused the message (HTTP ${response.status}): check NTFY_TOKEN and that its user may write to "${config.ntfy.topic}"`);
    }
    if (!response.ok) {
        throw new Error(`ntfy answered HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
}

export async function notifyNewRequest(request, waiting = 1) {
    const adminUrl = config.publicApiUrl ? `${config.publicApiUrl}/admin/` : undefined;
    const edition = request.edition === "java" ? "Java" : "Bedrock";
    const lines = [`${request.name} (${edition}) wants to join.`];
    if (request.edition === "bedrock" && request.enteredName !== request.name) lines.push(`Gamertag: ${request.enteredName}`);
    if (request.note) lines.push(`"${request.note}"`);
    if (waiting > 1) lines.push(`${waiting} requests are waiting for approval.`);

    const actions = [];
    if (config.publicApiUrl) {
        actions.push(
            { action: "http", label: "Approve", url: signedActionUrl(request.id, "approve"), method: "POST", clear: true },
            { action: "http", label: "Deny", url: signedActionUrl(request.id, "deny"), method: "POST", clear: true },
        );
    }
    if (adminUrl) actions.push({ action: "view", label: "Admin page", url: adminUrl });

    await publish({
        title: "Approval needed: whitelist request",
        message: lines.join("\n"),
        tags: ["video_game"],
        priority: config.ntfy.priority,
        click: adminUrl,
        actions,
    });
}

/* the admin page's "test" button: proves the whole path to your phone works */
export async function notifyTest() {
    if (!ntfyEnabled()) throw new Error("ntfy is off: set NTFY_TOPIC (and NTFY_URL / NTFY_TOKEN) for the API");
    const adminUrl = config.publicApiUrl ? `${config.publicApiUrl}/admin/` : undefined;
    await publish({
        title: "Whitelist notifications work",
        message: "This is a test from the admin page. New whitelist requests will show up like this, with Approve and Deny buttons.",
        tags: ["white_check_mark"],
        priority: config.ntfy.priority,
        click: adminUrl,
        actions: adminUrl ? [{ action: "view", label: "Admin page", url: adminUrl }] : [],
    });
}

/* security: a login on the admin page, or someone guessing tokens. you hear about it straight away,
   so a login that wasn't you stands out */
export async function notifySecurity(title, message) {
    const adminUrl = config.publicApiUrl ? `${config.publicApiUrl}/admin/` : undefined;
    await publish({
        title,
        message,
        tags: ["lock"],
        priority: config.ntfy.priority,
        click: adminUrl,
    });
}

export async function notifyDecision(request, via) {
    if (via !== "ntfy") return; // the admin page shows the result itself
    await publish({
        title: request.status === "approved" ? "Whitelisted" : "Request denied",
        message: `${request.name} (${request.edition === "java" ? "Java" : "Bedrock"})`,
        tags: [request.status === "approved" ? "white_check_mark" : "x"],
        priority: 2,
    });
}
