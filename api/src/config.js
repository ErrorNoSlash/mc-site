// every setting comes from the environment (see .env.example)

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

    dataDir: env.DATA_DIR || "/data",
    pluginDir: env.PLUGIN_DIR || "/plugin",

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
        problems.push("ALLOWED_ORIGINS must list the site's origin, e.g. https://mc.errornoslash.be");
    }
    if (config.servers.length === 0) {
        problems.push("STATUS_SERVERS must list at least the proxy, e.g. DS Network=velocity:25565");
    }
    return problems;
}
