/*live status: the big word, the server list, the marquee and the tab title*/
const serverList = document.getElementById("server-list");
const titleRow = document.querySelector(".title");
const titleMeta = document.getElementById("title-meta");
const updatedLabel = document.getElementById("updated");
const marquee = document.getElementById("marquee");

let lastStatus = null;

/*the phrase is repeated an even number of times, so the CSS loop (-50%) is seamless*/
function setMarquee(phrase) {
    marquee.textContent = phrase.repeat(8);
}
setMarquee(marquee.textContent);

/*the addresses come from config.js*/
(function fillAddresses() {
    const java = document.getElementById("java-address");
    const bedrock = document.getElementById("bedrock-address");
    java.textContent = site.javaAddress;
    java.setAttribute("data-copy", site.javaAddress);
    java.setAttribute("aria-label", "Copy Java address " + site.javaAddress);
    bedrock.textContent = site.bedrockAddress;
    document.getElementById("bedrock-port").textContent = site.bedrockPort;
    bedrock.setAttribute("data-copy", site.bedrockAddress);
    bedrock.setAttribute("aria-label", "Copy Bedrock address " + site.bedrockAddress + ", port " + site.bedrockPort);
    // one address for both: phones show it once
    if (site.javaAddress === site.bedrockAddress) java.closest(".lead-address").dataset.same = "";
})();

function playersText(server) {
    if (!server.online || !server.players) return "";
    return server.players.online + "/" + server.players.max;
}

/*how full the server is, drawn like the experience bar: the player count is the "level"*/
function xpBar(server) {
    const fill = server.players.max ? Math.min(100, Math.round(server.players.online / server.players.max * 100)) : 0;
    return h("span", { class: "xp", title: server.players.online + " of " + server.players.max + " slots taken" },
        h("span", { class: "xp-level" }, String(server.players.online)),
        h("span", { class: "xp-track" }, h("span", { class: "xp-fill", style: "width:" + fill + "%" }))
    );
}

function serverRow(server, index, isNetwork) {
    const details = [];
    if (server.online) {
        if (isNetwork && server.motd) details.push(server.motd);
        else if (server.version) details.push(server.version);
        if (!isNetwork && server.players && server.players.names.length) details.push(server.players.names.join(", "));
        else if (!isNetwork && server.players && server.players.online === 0) details.push("nobody on right now");
    } else {
        details.push(isNetwork ? "the proxy isn't answering" : "not answering pings");
    }

    return h("div", { class: "server-row" + (server.online ? "" : " is-offline") + (isNetwork ? " is-network" : "") },
        h("span", { class: "server-number" }, isNetwork ? "~" : String(index).padStart(2, "0")),
        h("span", null,
            h("b", { class: "server-name" }, server.name),
            h("small", { class: "server-detail" }, details.join(" · ")),
            isNetwork && server.online && server.players ? xpBar(server) : null
        ),
        h("span", { class: "server-state" },
            server.online ? playersText(server) : "DOWN",
            pingBars(server.online, server.latencyMs)
        )
    );
}

/*who's online, as a hotbar: one head per player the servers name, "?" heads for the rest*/
function renderHotbar(status) {
    const hotbar = document.getElementById("hotbar");
    const count = status.network.online && status.network.players ? status.network.players.online : 0;
    const names = [];
    for (const server of [status.network, ...status.servers]) {
        for (const name of (server.players && server.players.names) || []) {
            if (!names.includes(name)) names.push(name);
        }
    }

    const slots = [];
    const shown = Math.min(9, Math.max(count, names.length));
    for (let index = 0; index < 9; index++) {
        if (index >= shown) {
            slots.push(h("li", { class: "slot is-empty" }));
            continue;
        }
        const extra = Math.max(count, names.length) - 8;
        if (index === 8 && extra > 1) {
            slots.push(h("li", { class: "slot is-more", "data-name": extra + " more" }, "+" + extra));
            continue;
        }
        const name = names[index];
        slots.push(name
            ? h("li", { class: "slot", "data-name": name, tabindex: "0", "aria-label": name }, playerHead(name))
            : h("li", { class: "slot is-hidden", "data-name": "hidden player", "aria-label": "hidden player" }, plainHead()));
    }
    hotbar.replaceChildren(...slots);
    document.getElementById("hotbar-count").textContent = count;
}

function render(status) {
    const network = status.network;
    const word = network.online ? "ONLINE" : "OFFLINE";
    titleRow.dataset.state = network.online ? "online" : "offline";
    setTitleWord(word, "The server is " + word.toLowerCase());

    titleMeta.textContent = network.online
        ? "[ " + playersText(network) + " playing ]"
        : "[ down ]";

    renderHotbar(status);
    serverList.replaceChildren(
        serverRow(network, 0, true),
        ...status.servers.map(function (server, index) { return serverRow(server, index + 1, false); })
    );

    const up = status.servers.filter(function (server) { return server.online; }).map(function (server) { return server.name.toUpperCase(); });
    setMarquee((network.online ? "ONLINE " + playersText(network) : "OFFLINE")
        + " * " + (up.length ? up.join(" * ") : "NO SERVERS UP")
        + " * " + (status.whitelist && status.whitelist.enforced ? "WHITELISTED" : "OPEN FOR NOW")
        + " * JAVA + BEDROCK * ");

    document.title = "DS Network · " + (network.online ? "online " + playersText(network) : "offline");
    lastStatus = status;
    showUpdated();
    document.dispatchEvent(new CustomEvent("status", { detail: status }));
}

/*nine empty slots until the first answer*/
document.getElementById("hotbar").replaceChildren(...Array.from({ length: 9 }, function () {
    return h("li", { class: "slot is-empty" });
}));

function renderUnreachable(error) {
    titleRow.dataset.state = "unknown";
    setTitleWord("UNKNOWN", "Server status unknown");
    titleMeta.textContent = "[ no answer ]";
    if (!lastStatus) {
        serverList.replaceChildren(h("div", { class: "server-row is-offline" },
            h("span", { class: "server-number" }, "!!"),
            h("span", null,
                h("b", { class: "server-name" }, "status unavailable"),
                h("small", { class: "server-detail" }, error.message)),
            h("span", { class: "server-state" }, "?")
        ));
    }
    updatedLabel.textContent = "retrying...";
}

function showUpdated() {
    if (lastStatus) updatedLabel.textContent = "updated " + timeAgo(lastStatus.updatedAt);
}

async function refresh() {
    try {
        render(await api("/api/status"));
    } catch (error) {
        renderUnreachable(error);
    }
}

refresh();
setInterval(function () {
    if (!document.hidden) refresh();
}, site.refreshSeconds * 1000);
setInterval(showUpdated, 5000);
document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refresh();
});
