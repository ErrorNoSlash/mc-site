/*ds/, status? and join? open a popup drawn like the game's menu screens: contact links, the server list or the request form.
  a head in the hotbar opens that player*/
const veil = document.querySelector("#veil");
const sheet = document.querySelector(".sheet");
const panels = [...veil.querySelectorAll(".panel")];
const panelTabs = [...document.querySelectorAll(".nav-tabs a[href='#servers'], .nav-tabs a[href='#join'], .lead-cta, .nav-logo")];
const requestForm = document.querySelector("#request-form");
const requestFormHome = requestForm.parentElement;
let lastClickedTab = null;

/* the server list in the status popup, like the multiplayer screen */
function serverIcon(isNetwork) {
    // a grass block, or for the proxy a little stack of them
    const rects = isNetwork
        ? [[0, 0, 8, 8, 0.25], [0, 0, 8, 2, 0.9], [0, 2, 8, 1, 0.55], [1, 4, 1, 1, 0.6], [5, 5, 1, 1, 0.6], [3, 6, 1, 1, 0.6], [6, 3, 1, 1, 0.6]]
        : [[0, 0, 8, 8, 0.25], [0, 0, 8, 2, 0.75], [0, 2, 3, 1, 0.5], [5, 2, 3, 1, 0.5], [2, 5, 1, 1, 0.6], [6, 6, 1, 1, 0.6]];
    const icon = pixelSvg(8, 8, rects);
    icon.classList.add("mc-icon");
    return icon;
}

function serverEntry(server, isNetwork) {
    const detail = !server.online ? "Can't connect to server"
        : isNetwork ? site.javaAddress + (server.motd ? " · " + server.motd : "")
            : (server.version || "") + (server.players && server.players.names.length ? " · " + server.players.names.join(", ") : "");

    return h(isNetwork ? "button" : "div", isNetwork
        ? { class: "mc-entry is-network", type: "button", "data-copy": site.javaAddress, title: "Copy the address" }
        : { class: "mc-entry" + (server.online ? "" : " is-offline") },
        serverIcon(isNetwork),
        h("span", { class: "mc-entry-text" },
            h("b", null, server.name),
            h("small", null, detail)
        ),
        h("span", { class: "mc-entry-state" }, server.online ? playersText(server) : "", pingBars(server.online, server.latencyMs))
    );
}

function fillStatusPanel(status) {
    if (!status) return;
    document.querySelector("#panel-servers").replaceChildren(
        serverEntry(status.network, true),
        ...status.servers.map(function (server) { return serverEntry(server, false); })
    );

    const names = [];
    for (const server of status.servers) {
        for (const name of (server.players && server.players.names) || []) {
            if (!names.includes(name)) names.push(name);
        }
    }
    const count = status.network.online && status.network.players ? status.network.players.online : 0;
    document.querySelector("#panel-players").textContent = count === 0 ? "Nobody is online right now."
        : count + " online" + (names.length ? ": " + names.join(", ") + (count > names.length ? " and " + (count - names.length) + " more" : "") : "");
}

/* a player in the hotbar: their skin and what the server list says about them. only what anyone
   can already see in the game's server list; nothing from the whitelist */
function fillPlayerPanel(name) {
    const servers = lastStatus ? lastStatus.servers.filter(function (server) {
        return server.players && server.players.names.includes(name);
    }) : [];
    // floodgate puts a dot in front of Bedrock names
    const isBedrock = name.startsWith(".");

    document.querySelector("#panel-player-title").textContent = name;
    document.querySelector("#panel-player-body").replaceChildren(playerCard(name, null, [
        ["edition", isBedrock ? "Bedrock" : "Java"],
        ["status", "online now"],
        ["playing on", servers.length ? servers.map(function (server) { return server.name; }).join(", ") : "DS Network"]
    ]));
    const buttons = [h("button", { class: "mc-button", type: "button", "data-panel": "status" }, "Server List")];
    if (!isBedrock) buttons.unshift(h("a", { class: "mc-button", href: "https://namemc.com/profile/" + encodeURIComponent(name), target: "_blank", rel: "noopener" }, "NameMC ↗"));
    document.querySelector("#panel-player-buttons").replaceChildren(...buttons);
}

// which popup a link opens
function panelFor(tab) {
    if (tab.classList.contains("nav-logo")) return "contact";
    return tab.hash === "#join" ? "join" : "status";
}

/* open and close, like the contact site's who? / links? */
function showPanel(panelName) {
    const isPanelName = ["status", "join", "contact", "player"].includes(panelName);

    if (isPanelName) {
        panels.forEach(function (panel) {
            panel.hidden = panel.id !== `panel-${panelName}`;
        });
    }

    // the request form lives in the page; it visits the join popup while that is open
    if (panelName === "join") document.querySelector("#panel-form").append(requestForm);
    else if (requestForm.parentElement !== requestFormHome) requestFormHome.append(requestForm);
    if (panelName === "status") fillStatusPanel(lastStatus);

    veil.classList.toggle("is-open", isPanelName);
    // nothing behind a popup moves while it is open, so no work is spent on a page nobody can see
    document.body.classList.toggle("popup-open", isPanelName);
    panorama.classList.toggle("is-paused", isPanelName || !panoramaOnScreen);
    veil.setAttribute("aria-hidden", String(!isPanelName));
    sheet.toggleAttribute("inert", isPanelName);
    panelTabs.forEach(function (tab) {
        tab.classList.toggle("is-active", isPanelName && panelFor(tab) === panelName);
    });

    if (panelName === "join") document.querySelector("#name-input").focus();
    else if (isPanelName) veil.querySelector(`#panel-${panelName} [data-close]`).focus();
    else if (lastClickedTab) {
        lastClickedTab.focus();
        lastClickedTab = null;
    }
}

function closePanel() {
    showPanel("");
}

panelTabs.forEach(function (tab) {
    tab.addEventListener("click", function (e) {
        e.preventDefault();
        lastClickedTab = tab;
        showPanel(panelFor(tab));
    });
});

veil.addEventListener("click", function (e) {
    if (e.target === veil || e.target.closest("[data-close]")) closePanel();
    const switchTo = e.target.closest("[data-panel]");
    if (switchTo) showPanel(switchTo.dataset.panel);
});

document.querySelector("#panel-refresh").addEventListener("click", refresh);

// "already asked?" sits above the form on the page, so the join popup gets its own button for it
const pageModeToggle = document.querySelector("#mode-toggle");
const panelCheck = document.querySelector("#panel-check");
panelCheck.addEventListener("click", function () {
    pageModeToggle.click();
    panelCheck.textContent = pageModeToggle.textContent.replace(/(^|\s)\S/g, function (letter) { return letter.toUpperCase(); });
});

// the popup follows the live status while it is open
document.addEventListener("status", function (e) {
    if (!document.querySelector("#panel-status").hidden) fillStatusPanel(e.detail);
});

window.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && veil.classList.contains("is-open")) closePanel();
});

/* a named head in the hotbar opens its player, by click, tap, Enter or Space */
function openPlayer(slot) {
    lastClickedTab = slot;
    hotbarTip.hidden = true;
    fillPlayerPanel(slot.dataset.name);
    showPanel("player");
}

hotbar.addEventListener("click", function (e) {
    const slot = e.target.closest(".slot[data-name]:not(.is-hidden)");
    if (slot) openPlayer(slot);
});

hotbar.addEventListener("keydown", function (e) {
    const slot = e.target.closest(".slot[data-name]:not(.is-hidden)");
    if (!slot || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    openPlayer(slot);
});

if (location.hash === "#join") showPanel("join");

// the title may shrink, the intro row under it may not: tell the CSS how tall that row is
const heroBlock = document.querySelector(".hero");
const leadRow = document.querySelector(".lead");
function measureLead() {
    heroBlock.style.setProperty("--lead-height", leadRow.offsetHeight + "px");
}
if ("ResizeObserver" in window) new ResizeObserver(measureLead).observe(leadRow);
measureLead();
