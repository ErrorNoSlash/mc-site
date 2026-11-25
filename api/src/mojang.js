// Looks up a Java account by name, so typos are caught and the whitelist can match by UUID.

const LOOKUPS = [
    (name) => `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
    (name) => `https://api.minecraftservices.com/minecraft/profile/lookup/name/${encodeURIComponent(name)}`,
];

const cache = new Map(); // lower-case name → { at, profile }
const CACHE_MS = 10 * 60 * 1000;

function dashed(id) {
    return id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5").toLowerCase();
}

/* → { uuid, name } with the account's real capitalisation, null if no such account; throws if Mojang is unreachable */
export async function lookupJavaProfile(name) {
    const key = name.toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.profile;

    let lastError;
    for (const url of LOOKUPS) {
        try {
            const response = await fetch(url(name), { signal: AbortSignal.timeout(5000) });
            if (response.status === 204 || response.status === 404) {
                cache.set(key, { at: Date.now(), profile: null });
                return null;
            }
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const body = await response.json();
            if (!body?.id) throw new Error("no id in response");
            const profile = { uuid: dashed(body.id), name: body.name || name };
            cache.set(key, { at: Date.now(), profile });
            return profile;
        } catch (error) {
            lastError = error;
        }
    }
    throw new Error(`Mojang lookup failed: ${lastError?.message}`);
}
