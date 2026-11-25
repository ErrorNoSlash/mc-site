/*status? / join? open a popup drawn like the game's menu screens: the server list, or the request form*/
const veil = document.querySelector("#veil");
const sheet = document.querySelector(".sheet");
const panels = [...veil.querySelectorAll(".panel")];
const panelTabs = [...document.querySelectorAll(".nav-tabs a[href='#servers'], .nav-tabs a[href='#join'], .lead-cta")];
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

/* open and close, like the contact site's who? / links? */
function showPanel(panelName) {
    const isPanelName = panelName === "status" || panelName === "join";

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
    veil.setAttribute("aria-hidden", String(!isPanelName));
    sheet.toggleAttribute("inert", isPanelName);
    panelTabs.forEach(function (tab) {
        tab.classList.toggle("is-active", tab.hash === (panelName === "join" ? "#join" : panelName === "status" ? "#servers" : ""));
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
    tab.addEventListener("click", function (event) {
        event.preventDefault();
        lastClickedTab = tab;
        showPanel(tab.hash === "#join" ? "join" : "status");
    });
});

veil.addEventListener("click", function (event) {
    if (event.target === veil || event.target.closest("[data-close]")) closePanel();
    const switchTo = event.target.closest("[data-panel]");
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
document.addEventListener("status", function (event) {
    if (!document.querySelector("#panel-status").hidden) fillStatusPanel(event.detail);
});

window.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && veil.classList.contains("is-open")) closePanel();
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
