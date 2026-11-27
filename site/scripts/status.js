/*live status: the big word, the server list, the marquee and the tab title*/
const serverList = document.querySelector("#server-list");
const titleRow = document.querySelector(".title");
const titleMeta = document.querySelector("#title-meta");
const updatedLabel = document.querySelector("#updated");
const marquee = document.querySelector("#marquee");

let lastStatus = null;

/*the phrase is repeated an even number of times, so the CSS loop (-50%) is seamless*/
function setMarquee(phrase) {
    marquee.textContent = phrase.repeat(8);
}
setMarquee(marquee.textContent);

/*the addresses come from config.js*/
function fillAddresses() {
    const java = document.querySelector("#java-address");
    const bedrock = document.querySelector("#bedrock-address");
    java.textContent = site.javaAddress;
    java.setAttribute("data-copy", site.javaAddress);
    java.setAttribute("aria-label", "Copy Java address " + site.javaAddress);
    bedrock.textContent = site.bedrockAddress;
    document.querySelector("#bedrock-port").textContent = site.bedrockPort;
    bedrock.setAttribute("data-copy", site.bedrockAddress);
    bedrock.setAttribute("aria-label", "Copy Bedrock address " + site.bedrockAddress + ", port " + site.bedrockPort);
    // one address for both: phones show it once
    if (site.javaAddress === site.bedrockAddress) java.closest(".lead-address").dataset.same = "";
}

fillAddresses();

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
    } else if (server.off) {
        details.push(offText(server.off));
    } else {
        details.push(isNetwork ? "the proxy isn't answering" : "not answering pings");
    }

    // turned off on purpose (OFF) reads differently from down (DOWN, struck through)
    const state = server.online ? "" : server.off ? " is-off" : " is-offline";

    // the row opens its server popup (popups.js)
    return h("div", {
        class: "server-row" + state + (isNetwork ? " is-network" : ""),
        role: "button", tabindex: "0", "aria-label": "About " + server.name,
        "data-server": isNetwork ? "network" : String(index - 1)
    },
        h("span", { class: "server-number" }, isNetwork ? "~" : String(index).padStart(2, "0")),
        h("span", null,
            h("b", { class: "server-name" }, server.name),
            h("small", { class: "server-detail" }, details.join(" · ")),
            isNetwork && server.online && server.players ? xpBar(server) : null
        ),
        h("span", { class: "server-state" },
            server.online ? playersText(server) : server.off ? "OFF" : "DOWN",
            pingBars(server.online, server.latencyMs)
        )
    );
}

/*who's online, as a hotbar: one slot per player (named heads first, "?" heads for the
  ones the servers don't name), padded with empty slots. more players than fit: it scrolls sideways*/
const hotbar = document.querySelector("#hotbar");
const hotbarScroll = document.querySelector("#hotbar-scroll");
const phone = window.matchMedia("(max-width: 760px)");

function minimumSlots() {
    return phone.matches ? 9 : 12;
}

function emptySlots(count) {
    return Array.from({ length: count }, function () { return h("li", { class: "slot is-empty" }); });
}

function renderHotbar(status) {
    const count = status.network.online && status.network.players ? status.network.players.online : 0;
    const names = [];
    for (const server of [status.network, ...status.servers]) {
        for (const name of (server.players && server.players.names) || []) {
            if (!names.includes(name)) names.push(name);
        }
    }

    const players = Math.max(count, names.length);
    const slots = [];
    for (let index = 0; index < players; index++) {
        const name = names[index];
        slots.push(name
            ? h("li", { class: "slot", "data-name": name, tabindex: "0", "aria-label": name }, playerHead(name))
            : h("li", { class: "slot is-hidden", "data-name": "hidden player", "aria-label": "hidden player" }, plainHead()));
    }
    slots.push(...emptySlots(Math.max(0, minimumSlots() - players)));
    hotbar.style.setProperty("--slots", slots.length);
    hotbar.replaceChildren(...slots);
    hotbar.setAttribute("aria-label", players + " players online");
    document.querySelector("#hotbar-count").textContent = count;
}

/*the name tooltip lives outside the scroll box, so it isn't cut off*/
const hotbarTip = h("div", { class: "hotbar-tip", "aria-hidden": "true" });
hotbarTip.hidden = true;
document.body.append(hotbarTip);

function showTip(slot) {
    if (!slot || !slot.dataset.name) {
        hotbarTip.hidden = true;
        return;
    }
    const box = slot.getBoundingClientRect();
    hotbarTip.textContent = slot.dataset.name;
    hotbarTip.style.left = box.left + box.width / 2 + "px";
    hotbarTip.style.top = box.top + "px";
    hotbarTip.hidden = false;
}
hotbar.addEventListener("pointerover", function (e) { showTip(e.target.closest(".slot")); });
hotbar.addEventListener("focusin", function (e) { showTip(e.target.closest(".slot")); });
hotbar.addEventListener("pointerleave", function () { hotbarTip.hidden = true; });
hotbar.addEventListener("focusout", function () { hotbarTip.hidden = true; });
hotbarScroll.addEventListener("scroll", function () { hotbarTip.hidden = true; }, { passive: true });

/*a mouse wheel scrolls the hotbar sideways when it's full*/
hotbarScroll.addEventListener("wheel", function (e) {
    if (hotbarScroll.scrollWidth <= hotbarScroll.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    hotbarScroll.scrollLeft += e.deltaY;
    e.preventDefault();
}, { passive: false });

phone.addEventListener("change", function () {
    if (lastStatus) renderHotbar(lastStatus);
});

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
        ...status.servers.map(function (server, index) { return serverRow(server, index + 1, false); }),
        ...archiveRows(status.archived)
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

/*the last row: the archived worlds (mc-backup --archive on the server), when there are any;
  it opens their popup (popups.js)*/
function archiveRows(worlds) {
    if (!worlds || worlds.length === 0) return [];
    const names = worlds.map(function (world) { return world.name; }).join(", ");
    return [h("div", { class: "server-row is-archive", role: "button", tabindex: "0", "aria-label": "Archived worlds", "data-archive": "" },
        h("span", { class: "server-number" }, "--"),
        h("span", null,
            h("b", { class: "server-name" }, "archived worlds"),
            h("small", { class: "server-detail" }, worlds.length + (worlds.length === 1 ? " world" : " worlds") + " packed away · " + names)
        ),
        h("span", { class: "server-state" }, "→")
    )];
}

/*empty slots until the first answer*/
hotbar.style.setProperty("--slots", minimumSlots());
hotbar.replaceChildren(...emptySlots(minimumSlots()));

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
