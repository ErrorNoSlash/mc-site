// Minecraft "server list ping": the same request the multiplayer screen sends.
// Pings every server in STATUS_SERVERS straight over the Docker network.

import net from "node:net";
import { config } from "./config.js";

function writeVarInt(value) {
    const bytes = [];
    let rest = value >>> 0;
    do {
        let byte = rest & 0x7f;
        rest >>>= 7;
        if (rest !== 0) byte |= 0x80;
        bytes.push(byte);
    } while (rest !== 0);
    return Buffer.from(bytes);
}

function readVarInt(buffer, offset) {
    let value = 0;
    for (let index = 0; index < 5; index++) {
        if (offset + index >= buffer.length) return null;
        const byte = buffer[offset + index];
        value |= (byte & 0x7f) << (7 * index);
        if ((byte & 0x80) === 0) return { value, size: index + 1 };
    }
    throw new Error("VarInt too long");
}

function packet(id, ...parts) {
    const body = Buffer.concat([writeVarInt(id), ...parts]);
    return Buffer.concat([writeVarInt(body.length), body]);
}

function mcString(text) {
    const bytes = Buffer.from(text, "utf8");
    return Buffer.concat([writeVarInt(bytes.length), bytes]);
}

/* a chat component (string or JSON) → plain text without colour codes */
export function plainText(component) {
    if (component == null) return "";
    if (typeof component === "string") return component.replace(/§./g, "").replace(/&[0-9a-fk-or]/gi, "");
    if (Array.isArray(component)) return component.map(plainText).join("");
    let text = plainText(component.text ?? component.translate ?? "");
    if (Array.isArray(component.extra)) text += component.extra.map(plainText).join("");
    return text;
}

export function ping(host, port, timeoutMs = 3000) {
    return new Promise((resolve) => {
        const started = Date.now();
        const socket = net.connect({ host, port });
        let buffer = Buffer.alloc(0);
        let finished = false;

        const finish = (result) => {
            if (finished) return;
            finished = true;
            socket.destroy();
            resolve(result);
        };

        socket.setTimeout(timeoutMs, () => finish({ online: false, error: "timeout" }));
        socket.on("error", (error) => finish({ online: false, error: error.code || error.message }));
        socket.on("close", () => finish({ online: false, error: "closed" }));

        socket.on("connect", () => {
            const portBytes = Buffer.alloc(2);
            portBytes.writeUInt16BE(port);
            // handshake (protocol -1 = "just asking"), next state 1 = status; then the status request
            socket.write(packet(0x00, writeVarInt(-1), mcString(host), portBytes, writeVarInt(1)));
            socket.write(packet(0x00));
        });

        socket.on("data", (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            if (buffer.length > 1024 * 1024) return finish({ online: false, error: "response too large" });
            try {
                const length = readVarInt(buffer, 0);
                if (!length || buffer.length < length.size + length.value) return;
                let offset = length.size;
                const id = readVarInt(buffer, offset);
                offset += id.size;
                const textLength = readVarInt(buffer, offset);
                offset += textLength.size;
                const json = JSON.parse(buffer.subarray(offset, offset + textLength.value).toString("utf8"));
                finish({ online: true, latencyMs: Date.now() - started, response: json });
            } catch (error) {
                finish({ online: false, error: "bad response" });
            }
        });
    });
}

function summarise(server, result) {
    const summary = { name: server.name, online: result.online };
    if (!result.online) return summary;

    const response = result.response || {};
    const players = response.players || {};
    summary.latencyMs = result.latencyMs;
    summary.version = plainText(response.version?.name || "");
    summary.motd = plainText(response.description).trim();
    summary.players = {
        online: Number(players.online) || 0,
        max: Number(players.max) || 0,
        names: config.showPlayerNames && Array.isArray(players.sample)
            ? players.sample.map((player) => plainText(player.name)).filter((name) => /^[.\w]{1,16}$/.test(name))
            : [],
    };
    if (typeof response.favicon === "string" && response.favicon.startsWith("data:image/png;base64,")) {
        summary.favicon = response.favicon;
    }
    return summary;
}

let cached = null;
let cachedAt = 0;
let inFlight = null;

/* pings everything at most once per STATUS_CACHE_SECONDS, however many visitors ask */
export async function getStatus() {
    if (cached && Date.now() - cachedAt < config.statusCacheSeconds * 1000) return cached;
    if (inFlight) return inFlight;

    inFlight = (async () => {
        const results = await Promise.all(config.servers.map((server) => ping(server.host, server.port)));
        const summaries = config.servers.map((server, index) => summarise(server, results[index]));
        const [network, ...servers] = summaries;
        cached = { updatedAt: new Date().toISOString(), network, servers };
        cachedAt = Date.now();
        return cached;
    })().finally(() => {
        inFlight = null;
    });
    return inFlight;
}
