/*admin page: approve requests, manage the whitelist, turn it on and off*/
const tokenStorageKey = "whitelistAdminToken";

const loginView = document.querySelector("#login-view");
const loginForm = document.querySelector("#login-form");
const loginOutput = document.querySelector("#login-output");
const adminView = document.querySelector("#admin-view");
const logoutButton = document.querySelector("#logout");
const notice = document.querySelector("#notice");
const enforceButton = document.querySelector("#enforce");
const messageForm = document.querySelector("#message-form");
const messageBox = messageForm.elements.message;

let token = "";
let overview = null;
let messageDirty = false;
let noticeTimer = null;

/* token */

function storedToken() {
    try {
        return sessionStorage.getItem(tokenStorageKey) || localStorage.getItem(tokenStorageKey) || "";
    } catch (storageOff) {
        return "";
    }
}

function storeToken(value, remember) {
    try {
        sessionStorage.setItem(tokenStorageKey, value);
        if (remember) localStorage.setItem(tokenStorageKey, value);
    } catch (storageOff) { }
}

function forgetToken() {
    try {
        sessionStorage.removeItem(tokenStorageKey);
        localStorage.removeItem(tokenStorageKey);
    } catch (storageOff) { }
}

function adminApi(path, options = {}) {
    return api(path, { ...options, headers: { Authorization: "Bearer " + token } });
}

function showLogin(message) {
    adminView.hidden = true;
    loginView.hidden = false;
    logoutButton.hidden = true;
    if (message) {
        loginOutput.dataset.tone = "error";
        loginOutput.replaceChildren(h("span", null, "> " + message));
    }
}

function flash(message, isError) {
    notice.textContent = (isError ? "! " : "> ") + message;
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () { notice.hidden = true; }, isError ? 7000 : 3000);
}

/* runs an admin action, shows what happened and reloads the lists */
async function act(promise, success) {
    let ok = false;
    try {
        await promise;
        ok = true;
        if (success) flash(success);
    } catch (error) {
        if (error.status === 401) {
            showLogin("the token stopped working, log in again");
            return false;
        }
        flash(error.message, true);
    }
    await load();
    return ok;
}

/* rows */

/*head + text, like a player in the tab list*/
function who(entry, ...children) {
    return h("div", { class: "who" },
        playerHead(entry.name, entry.edition === "java" ? entry.uuid : null),
        h("div", null, ...children)
    );
}

function editionTag(edition) {
    return h("span", { class: "tag" }, edition);
}

function pendingRow(request) {
    const details = ["asked " + timeAgo(request.createdAt)];
    if (request.edition === "bedrock") details.push("gamertag “" + request.enteredName + "”");
    else if (request.uuid) details.push(request.uuid);

    return h("div", { class: "admin-row" },
        who(request,
            h("b", null, request.name), editionTag(request.edition),
            h("small", null, details.join(" · ")),
            request.note ? h("span", { class: "note" }, request.note) : null
        ),
        h("div", { class: "actions" },
            h("button", {
                class: "pill", type: "button",
                onclick: function () { act(adminApi("/api/admin/requests/" + request.id + "/approve", { method: "POST" }), request.name + " is whitelisted"); }
            }, "approve"),
            h("button", {
                class: "pill", type: "button",
                onclick: function () { act(adminApi("/api/admin/requests/" + request.id + "/deny", { method: "POST" }), request.name + " denied"); }
            }, "deny")
        )
    );
}

function listedRow(player) {
    const source = player.source && player.source.startsWith("request") ? "from a request" : player.source === "seen" ? "from the seen list" : "added by hand";
    return h("div", { class: "admin-row" },
        who(player,
            h("b", null, player.name), editionTag(player.edition),
            h("small", null, "added " + timeAgo(player.addedAt) + " · " + source)
        ),
        h("div", { class: "actions" },
            h("button", {
                class: "pill small", type: "button",
                onclick: function () {
                    if (!confirm("Take " + player.name + " off the whitelist?" + (overview.whitelist.enforced ? " If they're online they get kicked." : ""))) return;
                    act(adminApi("/api/admin/players/" + encodeURIComponent(player.key), { method: "DELETE" }), player.name + " removed");
                }
            }, "remove")
        )
    );
}

function addSeen(entry) {
    return adminApi("/api/admin/players", {
        method: "POST",
        body: { fromSeen: true, edition: entry.edition, name: entry.name, uuid: entry.uuid }
    });
}

function seenRow(entry) {
    const details = ["last seen " + timeAgo(entry.lastSeen), entry.logins + (entry.logins === 1 ? " login" : " logins")];
    if (entry.turnedAway) details.push("turned away");
    return h("div", { class: "admin-row" },
        who(entry,
            h("b", null, entry.name), editionTag(entry.edition),
            h("small", null, details.join(" · "))
        ),
        h("div", { class: "actions" },
            h("button", {
                class: "pill small", type: "button",
                onclick: function () { act(addSeen(entry), entry.name + " whitelisted"); }
            }, "add")
        )
    );
}

function historyRow(request) {
    const actions = [];
    if (request.status === "approved") {
        actions.push(h("button", {
            class: "pill small", type: "button",
            onclick: function () {
                if (!confirm("Revoke " + request.name + "? They come off the whitelist.")) return;
                act(adminApi("/api/admin/requests/" + request.id + "/deny", { method: "POST" }), request.name + " revoked");
            }
        }, "revoke"));
    } else {
        actions.push(h("button", {
            class: "pill small", type: "button",
            onclick: function () { act(adminApi("/api/admin/requests/" + request.id + "/approve", { method: "POST" }), request.name + " is whitelisted"); }
        }, "approve"));
    }
    actions.push(h("button", {
        class: "pill small", type: "button", title: "Delete the request so they can ask again",
        onclick: function () { act(adminApi("/api/admin/requests/" + request.id, { method: "DELETE" }), "request deleted"); }
    }, "forget"));

    return h("div", { class: "admin-row" },
        who(request,
            h("b", null, request.name), editionTag(request.edition), h("span", { class: "tag" }, request.status),
            h("small", null, timeAgo(request.decidedAt || request.createdAt) + (request.decidedVia ? " via " + request.decidedVia : "")),
            request.note ? h("span", { class: "note" }, request.note) : null
        ),
        h("div", { class: "actions" }, actions)
    );
}

function fill(id, rows, emptyText) {
    document.querySelector("#" + id).replaceChildren(...(rows.length ? rows : [h("div", { class: "empty" }, emptyText)]));
}

/* render */

function render(data) {
    overview = data;
    const pending = data.requests.filter(function (request) { return request.status === "pending"; });
    const decided = data.requests.filter(function (request) { return request.status !== "pending"; });
    const unlisted = data.seen.filter(function (entry) { return !entry.listed; });
    const players = [...data.whitelist.players].sort(function (a, b) { return a.name.localeCompare(b.name); });

    document.querySelector("#stat-pending").textContent = pending.length;
    document.querySelector("#stat-listed").textContent = players.length;
    document.querySelector("#stat-unlisted").textContent = unlisted.length;
    document.querySelector("#title-meta").textContent = "[ " + pending.length + " waiting ]";
    document.title = (pending.length ? "(" + pending.length + ") " : "") + "DS Network · admin";

    const on = data.whitelist.enforced;
    enforceButton.setAttribute("aria-pressed", String(on));
    document.querySelector("#enforce-label").textContent = on ? "ON" : "OFF";
    document.querySelector("#enforce-hint").textContent = on ? "only listed players · click to turn off" : "anyone can join · click to turn on";

    document.querySelector("#ntfy-state").textContent = data.ntfy ? "ntfy on" : "ntfy off";
    document.querySelector("#ntfy-test").hidden = !data.ntfy;
    fill("pending-list", pending.map(pendingRow), "nothing waiting.");
    fill("listed-list", players.map(listedRow), "nobody yet. add yourself first!");
    fill("seen-list", unlisted.map(seenRow), data.seen.length ? "everyone who joined is listed." : "nobody has joined since the plugin was installed.");
    document.querySelector("#add-all-seen").hidden = unlisted.length < 2;
    document.querySelector("#history-count").textContent = decided.length;
    fill("history-list", decided.map(historyRow), "no decisions yet.");

    if (!messageDirty && document.activeElement !== messageBox) {
        messageBox.value = data.whitelist.message || data.whitelist.defaultMessage;
    }
    document.querySelector("#refreshed").textContent = "refreshed " + new Date().toLocaleTimeString();
}

async function load() {
    if (!token) return showLogin();
    try {
        render(await adminApi("/api/admin/overview"));
        loginView.hidden = true;
        adminView.hidden = false;
        logoutButton.hidden = false;
    } catch (error) {
        if (error.status === 401) {
            forgetToken();
            token = "";
            return showLogin("that token isn't right");
        }
        if (adminView.hidden) showLogin(error.message);
        else flash(error.message, true);
    }
}

/* events */

loginForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    token = loginForm.elements.token.value.trim();
    loginOutput.dataset.tone = "wait";
    loginOutput.replaceChildren(h("span", null, "> checking..."));
    await load();
    if (!adminView.hidden) {
        storeToken(token, loginForm.elements.remember.checked);
        loginForm.reset();
        loginOutput.replaceChildren();
    }
});

logoutButton.addEventListener("click", function () {
    forgetToken();
    token = "";
    overview = null;
    showLogin();
});

enforceButton.addEventListener("click", function () {
    if (!overview) return;
    const turnOn = !overview.whitelist.enforced;
    if (turnOn) {
        const unlisted = overview.seen.filter(function (entry) { return !entry.listed; });
        let warning = "Turn the whitelist ON? Only listed players can join, and anyone online who isn't listed gets kicked.";
        if (overview.whitelist.players.length === 0) {
            warning = "Nobody is on the whitelist yet, so EVERYONE (you too) will be turned away. Turn it on anyway?";
        } else if (unlisted.length) {
            const names = unlisted.slice(0, 8).map(function (entry) { return entry.name; }).join(", ");
            warning += "\n\n" + unlisted.length + " player(s) who joined before aren't listed: " + names + (unlisted.length > 8 ? ", ..." : "");
        }
        if (!confirm(warning)) return;
    }
    act(adminApi("/api/admin/settings", { method: "PUT", body: { enforced: turnOn } }), "whitelist " + (turnOn ? "on" : "off"));
});

document.querySelector("#add-form").addEventListener("submit", function (e) {
    e.preventDefault();
    const form = e.target;
    const name = form.elements.name.value.trim();
    act(adminApi("/api/admin/players", { method: "POST", body: { edition: form.elements.edition.value, name: name } }), name + " added")
        .then(function (ok) { if (ok) form.elements.name.value = ""; });
});

document.querySelector("#add-all-seen").addEventListener("click", async function () {
    const unlisted = overview.seen.filter(function (entry) { return !entry.listed; });
    if (!confirm("Whitelist all " + unlisted.length + " players who joined before?")) return;
    act(Promise.all(unlisted.map(addSeen)), unlisted.length + " players whitelisted");
});

document.querySelector("#ntfy-test").addEventListener("click", function () {
    act(adminApi("/api/admin/test-notification", { method: "POST" }), "test notification sent, check your phone");
});

messageBox.addEventListener("input", function () { messageDirty = true; });

messageForm.addEventListener("submit", function (e) {
    e.preventDefault();
    const message = messageBox.value.trim() === overview.whitelist.defaultMessage ? "" : messageBox.value;
    messageDirty = false;
    act(adminApi("/api/admin/settings", { method: "PUT", body: { message: message } }), "kick message saved");
});

document.querySelector("#message-reset").addEventListener("click", function () {
    messageBox.value = overview.whitelist.defaultMessage;
    messageDirty = false;
    act(adminApi("/api/admin/settings", { method: "PUT", body: { message: "" } }), "back to the default message");
});

/* start */

setTitleWord("ADMIN");
token = storedToken();
load();
setInterval(function () {
    if (token && !document.hidden && !adminView.hidden) load();
}, 20000);
