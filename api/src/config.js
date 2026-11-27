// every setting comes from the environment (see the README)

import path from "node:path";

const env = process.env;

function trimSlash(value) {
    return (value || "").trim().replace(/\/+$/, "");
}

function list(value) {
    return (value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

/* "DS Network=velocity:25565, survival=mc-survival:25565" → [{ name, host, port }]
   The first entry is the proxy everyone joins through. */
function parseServers(value) {
    return list(value).map((entry) => {
        const [name, address] = entry.includes("=") ? entry.split("=") : [entry, entry];
        const [host, port] = address.trim().split(":");
        return { name: name.trim(), host, port: Number(port) || 25565 };
    });
}

export const config = {
    port: Number(env.PORT) || 8080,
    adminToken: env.ADMIN_TOKEN || "",
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    siteUrl: trimSlash(env.SITE_URL),
    publicApiUrl: trimSlash(env.PUBLIC_API_URL),
    clientIpHeader: (env.CLIENT_IP_HEADER || "").trim().toLowerCase(),

    // the networks the admin works from (home, VPN), e.g. "10.0.0.0/24, 100.64.0.0/10"; empty = anywhere
    adminNetworks: list(env.ADMIN_NETWORKS),
    // how long a login lasts: until the browser closes (at most this many hours), or with "remember" this many days
    sessionHours: Number(env.SESSION_HOURS) || 12,
    rememberDays: Number(env.REMEMBER_DAYS) || 30,
    // a login also ends after this long without using the admin (with "remember": this many days)
    idleMinutes: Number(env.IDLE_MINUTES) || 30,
    rememberIdleDays: Number(env.REMEMBER_IDLE_DAYS) || 7,

    // the API's own files (requests, whitelist, history); the only place it may write besides exportDir
    dataDir: env.DATA_DIR || "/data",
    // where whitelist.txt is written for the Velocity plugin, which reads it read-only
    exportDir: env.EXPORT_DIR || env.PLUGIN_DIR || "/plugin",
    // what the plugin writes about everyone who joined; read-only here
    seenFile: env.SEEN_FILE || path.join(env.PLUGIN_DIR || "/plugin", "seen.tsv"),
    // the archived worlds, written by mc-backup --archive on the server; read-only here
    archivedFile: env.ARCHIVED_FILE || "/archived/archived.txt",
    // servers turned off on purpose (mc-off), next to it; read-only too
    offFile: env.OFF_FILE || path.join(path.dirname(env.ARCHIVED_FILE || "/archived/archived.txt"), "off.txt"),

    servers: parseServers(env.STATUS_SERVERS || "DS Network=velocity:25565"),
    statusCacheSeconds: Number(env.STATUS_CACHE_SECONDS) || 15,
    showPlayerNames: env.STATUS_SHOW_PLAYERS !== "false",

    floodgatePrefix: env.FLOODGATE_PREFIX ?? ".",
    floodgateReplaceSpaces: env.FLOODGATE_REPLACE_SPACES !== "false",

    maxPending: Number(env.MAX_PENDING) || 100,

    ntfy: {
        url: trimSlash(env.NTFY_URL) || "https://ntfy.sh",
        topic: (env.NTFY_TOPIC || "").trim(),
        token: (env.NTFY_TOKEN || "").trim(),
        username: env.NTFY_USERNAME || "",
        password: env.NTFY_PASSWORD || "",
        priority: Number(env.NTFY_PRIORITY) || 3,
    },
};

export function checkConfig() {
    const problems = [];
    if (config.adminToken.length < 24) {
        problems.push("ADMIN_TOKEN must be set and at least 24 characters (try: openssl rand -hex 32)");
    }
    if (config.allowedOrigins.length === 0) {
        problems.push("ALLOWED_ORIGINS must list the site's origin, e.g. https://join.errornoslash.be");
    }
    for (const network of config.adminNetworks) {
        if (!/^[\d.]+\/\d{1,2}$|^[\da-f:]+\/\d{1,3}$/i.test(network)) {
            problems.push(`ADMIN_NETWORKS: "${network}" is not a network like 10.0.0.0/24`);
        }
    }
    if (config.servers.length === 0) {
        problems.push("STATUS_SERVERS must list at least the proxy, e.g. DS Network=velocity:25565");
    }
    return problems;
}
