/*admin page: approve requests, manage the whitelist, turn it on and off.
  on phones and tablets it is split into three pages, picked with the tabs under the menu.
  logging in swaps the token for a session cookie the page itself can't read; the token is never kept*/

// where older versions of this page kept the token: cleared on every visit
const oldTokenKey = "whitelistAdminToken";

const loginScreen = document.querySelector("#login-screen");
const pageTabs = document.querySelectorAll(".admin-tabs [data-show]");
const loginForm = document.querySelector("#login-form");
const loginOutput = document.querySelector("#login-output");
const sheet = document.querySelector(".sheet");
const adminView = document.querySelector("#admin-view");
const logoutButton = document.querySelector("#logout");
const notice = document.querySelector("#notice");
const enforceButton = document.querySelector("#enforce");
const messageForm = document.querySelector("#message-form");
const messageBox = messageForm.elements.message;
const messagePreview = document.querySelector("#message-preview");

const veil = document.querySelector("#veil");
const confirmTitle = document.querySelector("#confirm-title");
const confirmText = document.querySelector("#confirm-text");
const confirmYes = document.querySelector("#confirm-yes");

let isLoggedIn = false;
let overview = null;
let renderedKey = "";
let messageDirty = false;
let noticeTimer = null;
let answerConfirm = null;
let focusBeforeConfirm = null;

/* login */

function forgetOldToken() {
    try {
        sessionStorage.removeItem(oldTokenKey);
        localStorage.removeItem(oldTokenKey);
    } catch (storageOff) { }
}

// admin calls carry the session cookie
function adminApi(path, options = {}) {
    return api(path, { ...options, credentials: "include" });
}

/*the reason a call was turned away, in words for the login screen*/
function loginProblem(error) {
    if (error.status === 403 && error.data && error.data.reason === "network") return "the admin only works from home or over the VPN";
    if (error.status === 429) return "too many wrong tries, wait a while";
    return error.message;
}

function showLogin(message) {
    adminView.hidden = true;
    loginScreen.hidden = false;
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

/* confirm popup: the game's menu screen instead of the browser's confirm box */

/*opens the popup and waits: true for the yes button, false for cancel, the ✕, Esc or a click outside*/
function askConfirm(title, text, yesLabel) {
    confirmTitle.textContent = title;
    confirmText.textContent = text;
    confirmYes.textContent = yesLabel;
    focusBeforeConfirm = document.activeElement;

    veil.classList.add("is-open");
    veil.setAttribute("aria-hidden", "false");
    document.body.classList.add("popup-open");
    sheet.inert = true;
    confirmYes.focus();

    return new Promise(function (resolve) {
        answerConfirm = resolve;
    });
}

function closeConfirm(answer) {
    if (!answerConfirm) return;
    veil.classList.remove("is-open");
    veil.setAttribute("aria-hidden", "true");
    document.body.classList.remove("popup-open");
    sheet.inert = false;

    answerConfirm(answer);
    answerConfirm = null;
    if (focusBeforeConfirm) focusBeforeConfirm.focus();
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
            isLoggedIn = false;
            showLogin("your login ran out, log in again");
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

/*a waiting request: a big card, it is the thing to act on*/
function pendingRow(request) {
    const details = ["asked " + timeAgo(request.createdAt)];
    if (request.edition === "bedrock") details.push("gamertag “" + request.enteredName + "”");
    else if (request.uuid) details.push("real Mojang account");

    return h("article", { class: "request-card" },
        playerHead(request.name, request.edition === "java" ? request.uuid : null),
        h("div", { class: "request-text" },
            h("div", null, h("b", null, request.name), editionTag(request.edition)),
            h("small", null, details.join(" · ")),
            request.note ? h("span", { class: "note" }, request.note) : null
        ),
        h("div", { class: "actions" },
            h("button", {
                class: "pill big is-main", type: "button",
                onclick: function () { act(adminApi("/api/admin/requests/" + request.id + "/approve", { method: "POST" }), request.name + " is whitelisted"); }
            }, "approve"),
            h("button", {
                class: "pill big", type: "button",
                onclick: function () { act(adminApi("/api/admin/requests/" + request.id + "/deny", { method: "POST" }), request.name + " denied"); }
            }, "deny")
        )
    );
}

/*what the seen list knows about a listed player: when they last played and how often*/
function seenFor(player) {
    return overview.seen.find(function (entry) {
        if (player.edition === "java") return entry.uuid === player.uuid;
        return entry.edition === "bedrock" && entry.name.toLowerCase() === player.name.toLowerCase();
    });
}

function listedRow(player) {
    const seen = seenFor(player);
    const played = seen
        ? "last seen " + timeAgo(seen.lastSeen) + " · " + seen.logins + (seen.logins === 1 ? " login" : " logins")
        : "hasn't joined yet";
    return h("div", { class: "admin-row" },
        who(player,
            h("b", null, player.name), editionTag(player.edition),
            h("small", null, played)
        ),
        h("div", { class: "actions" },
            h("small", { class: "listed-when", title: new Date(player.addedAt).toLocaleString() }, "listed " + timeAgo(player.addedAt)),
            h("button", {
                class: "pill icon", type: "button", "aria-label": "Remove " + player.name, title: "Remove " + player.name,
                onclick: async function () {
                    const kickNote = overview.whitelist.enforced ? " If they're online they get kicked." : "";
                    if (!await askConfirm("Remove " + player.name + "?", "They come off the whitelist." + kickNote, "Remove")) return;
                    act(adminApi("/api/admin/players/" + encodeURIComponent(player.key), { method: "DELETE" }), player.name + " removed");
                }
            }, "✕")
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

/* history */

const historyText = {
    "added": function (entry) { return [h("b", null, entry.name), " added ", h("small", null, entry.source === "seen" ? "from the seen list" : "by hand")]; },
    "removed": function (entry) { return [h("b", null, entry.name), " removed"]; },
    "requested": function (entry) { return [h("b", null, entry.name), " asked to join"]; },
    "approved": function (entry) { return [h("b", null, entry.name), " approved ", h("small", null, entry.via === "ntfy" ? "from a notification" : "")]; },
    "denied": function (entry) { return [h("b", null, entry.name), " denied ", h("small", null, entry.via === "removed" ? "taken off the list" : entry.via === "ntfy" ? "from a notification" : "")]; },
    "forgotten": function (entry) { return [h("b", null, entry.name), "'s request forgotten"]; },
    "turned on": function () { return ["whitelist turned ", h("b", null, "ON")]; },
    "turned off": function () { return ["whitelist turned ", h("b", null, "OFF")]; },
    "message changed": function () { return ["kick message changed"]; },
    "message reset": function () { return ["kick message back to the default"]; }
};

/*a denied request that is still there can be approved after all, or forgotten so they can ask again*/
function deniedActions(entry) {
    const request = overview.requests.find(function (item) { return item.id === entry.requestId; });
    if (!request || request.status !== "denied") return null;
    return h("span", { class: "actions" },
        h("button", {
            class: "pill small", type: "button",
            onclick: function () { act(adminApi("/api/admin/requests/" + request.id + "/approve", { method: "POST" }), request.name + " is whitelisted"); }
        }, "approve"),
        h("button", {
            class: "pill small", type: "button", title: "Delete the request so they can ask again",
            onclick: function () { act(adminApi("/api/admin/requests/" + request.id, { method: "DELETE" }), "request deleted"); }
        }, "forget")
    );
}

/*one line; only the newest line about a request (the list is newest first) gets its buttons*/
function historyRow(entry, isNewestForRequest) {
    const text = historyText[entry.action] ? historyText[entry.action](entry) : [entry.action];
    const time = new Date(entry.at);
    return h("li", null,
        h("time", { datetime: entry.at, title: time.toLocaleString() }, time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })),
        h("span", null, ...text),
        entry.action === "denied" && isNewestForRequest ? deniedActions(entry) : null
    );
}

function historyRows(activity) {
    const requestsShown = new Set();
    return activity.map(function (entry) {
        const isNewest = Boolean(entry.requestId) && !requestsShown.has(entry.requestId);
        if (entry.requestId) requestsShown.add(entry.requestId);
        return historyRow(entry, isNewest);
    });
}

/* kick message preview: the MiniMessage tags the plugin understands, drawn like the game draws them */

const minecraftColors = {
    black: "#000000", dark_blue: "#0000aa", dark_green: "#00aa00", dark_aqua: "#00aaaa",
    dark_red: "#aa0000", dark_purple: "#aa00aa", gold: "#ffaa00", gray: "#aaaaaa",
    dark_gray: "#555555", blue: "#5555ff", green: "#55ff55", aqua: "#55ffff",
    red: "#ff5555", light_purple: "#ff55ff", yellow: "#ffff55", white: "#ffffff"
};
const minecraftStyles = {
    bold: "font-weight:700", b: "font-weight:700",
    italic: "font-style:italic", i: "font-style:italic", em: "font-style:italic",
    underlined: "text-decoration:underline", u: "text-decoration:underline",
    strikethrough: "text-decoration:line-through", st: "text-decoration:line-through"
};

/*one tag as a bit of css, or nothing when the preview doesn't know it*/
function tagStyle(tag) {
    const name = tag.replace(/^color:/, "");
    if (minecraftColors[name]) return "color:" + minecraftColors[name];
    if (/^#[0-9a-f]{6}$/i.test(name)) return "color:" + name;
    return minecraftStyles[tag] || null;
}

function renderMessagePreview() {
    const text = messageBox.value
        .replaceAll("{name}", "Steve")
        .replaceAll("{site}", location.host || "join.errornoslash.be");
    const parts = [];
    let styles = [];
    let last = 0;

    // plain text between the tags gets the styles that are open at that point
    function addText(piece) {
        const css = styles.map(function (open) { return open.css; }).join(";");
        if (piece) parts.push(h("span", { style: css || null }, piece));
    }

    for (const match of text.matchAll(/<(\/?)([\w#:]+)>/g)) {
        addText(text.slice(last, match.index));
        last = match.index + match[0].length;
        const [, closing, tag] = match;
        const name = tag.toLowerCase();
        const style = tagStyle(name);
        if (name === "newline" || name === "br") parts.push(h("br"));
        else if (name === "reset") styles = [];
        else if (closing) styles = styles.filter(function (open) { return open.tag !== name; });
        else if (style) styles.push({ tag: name, css: style });
        else addText(match[0]);
    }
    addText(text.slice(last));
    messagePreview.replaceChildren(...parts);
}

function fill(id, rows, emptyText) {
    const list = document.querySelector("#" + id);
    const empty = h(list.tagName === "OL" ? "li" : "div", { class: "empty" }, emptyText);
    list.replaceChildren(...(rows.length ? rows : [empty]));
}

/* render */

/*draws everything from the overview. the 20 s refresh only redraws when something changed, or once a
  minute for the "x min ago" texts, so a focused button isn't swapped out under you for nothing*/
function render(data) {
    document.querySelector("#refreshed").textContent = "refreshed " + new Date().toLocaleTimeString();
    const key = JSON.stringify(data) + Math.floor(Date.now() / 60000);
    if (key === renderedKey) return;
    renderedKey = key;
    overview = data;
    const pending = data.requests.filter(function (request) { return request.status === "pending"; });
    const unlisted = data.seen.filter(function (entry) { return !entry.listed; });
    const players = [...data.whitelist.players].sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }); });

    document.querySelector("#stat-pending").textContent = pending.length;
    document.querySelector("#tab-waiting").textContent = pending.length ? " · " + pending.length : "";
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
    document.querySelector("#pending-list").replaceChildren(...pending.map(pendingRow));
    document.querySelector("#pending-empty").hidden = pending.length > 0;
    document.querySelector("#listed-count").textContent = players.length + (players.length === 1 ? " player" : " players");
    fill("listed-list", players.map(listedRow), "nobody yet. add yourself first!");
    fill("seen-list", unlisted.map(seenRow), data.seen.length ? "everyone who joined is listed." : "nobody has joined since the plugin was installed.");
    document.querySelector("#add-all-seen").hidden = unlisted.length < 2;
    fill("history-list", historyRows(data.activity || []), "nothing has changed yet.");

    if (!messageDirty && document.activeElement !== messageBox) {
        messageBox.value = data.whitelist.message || data.whitelist.defaultMessage;
        renderMessagePreview();
    }
}

/*loads everything; without a valid session cookie that is the login screen*/
async function load() {
    try {
        render(await adminApi("/api/admin/overview"));
        isLoggedIn = true;
        loginScreen.hidden = true;
        adminView.hidden = false;
        logoutButton.hidden = false;
    } catch (error) {
        if (error.status === 401) {
            const wasLoggedIn = isLoggedIn;
            isLoggedIn = false;
            return showLogin(wasLoggedIn ? "your login ran out, log in again" : "");
        }
        if (adminView.hidden) showLogin(loginProblem(error));
        else flash(error.message, true);
    }
}

/* events */

loginForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    const token = loginForm.elements.token.value.trim();
    const remember = loginForm.elements.remember.checked;
    // the token leaves the field straight away; only the cookie the API answers with stays
    loginForm.elements.token.value = "";
    loginOutput.dataset.tone = "wait";
    loginOutput.replaceChildren(h("span", null, "> checking..."));
    try {
        await adminApi("/api/admin/login", { method: "POST", body: { token: token, remember: remember } });
    } catch (error) {
        loginOutput.dataset.tone = "error";
        loginOutput.replaceChildren(h("span", null, "> " + (error.status === 401 ? "that token isn't right" : loginProblem(error))));
        return;
    }
    loginOutput.replaceChildren();
    loginForm.reset();
    await load();
});

logoutButton.addEventListener("click", async function () {
    try {
        await adminApi("/api/admin/logout", { method: "POST", body: {} });
    } catch (error) { }
    isLoggedIn = false;
    overview = null;
    renderedKey = "";
    showLogin();
});

/* the switch asks first, both ways */
enforceButton.addEventListener("click", async function () {
    if (!overview) return;
    const turnOn = !overview.whitelist.enforced;

    if (turnOn) {
        const unlisted = overview.seen.filter(function (entry) { return !entry.listed; });
        let warning = "Only listed players can join, and anyone online who isn't listed gets kicked.";
        if (overview.whitelist.players.length === 0) {
            warning = "Nobody is on the whitelist yet, so everyone (you too) will be turned away.";
        } else if (unlisted.length) {
            const names = unlisted.slice(0, 8).map(function (entry) { return entry.name; }).join(", ");
            warning += "\n\n" + unlisted.length + " player(s) who joined before aren't listed: " + names + (unlisted.length > 8 ? ", ..." : "");
        }
        if (!await askConfirm("Turn the whitelist on?", warning, "Turn on")) return;
    } else if (!await askConfirm("Turn the whitelist off?", "Anyone can join the server again until you turn it back on.", "Turn off")) {
        return;
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
    if (!await askConfirm("Add all " + unlisted.length + " players?", "Everyone who joined before but isn't listed goes on the whitelist.", "Add all")) return;
    act(Promise.all(unlisted.map(addSeen)), unlisted.length + " players whitelisted");
});

document.querySelector("#ntfy-test").addEventListener("click", function () {
    act(adminApi("/api/admin/test-notification", { method: "POST" }), "test notification sent, check your phone");
});

/* the preview follows every key */
messageBox.addEventListener("input", function () {
    messageDirty = true;
    renderMessagePreview();
});

messageForm.addEventListener("submit", function (e) {
    e.preventDefault();
    const message = messageBox.value.trim() === overview.whitelist.defaultMessage ? "" : messageBox.value;
    messageDirty = false;
    act(adminApi("/api/admin/settings", { method: "PUT", body: { message: message } }), "kick message saved");
});

document.querySelector("#message-reset").addEventListener("click", function () {
    messageBox.value = overview.whitelist.defaultMessage;
    messageDirty = false;
    renderMessagePreview();
    act(adminApi("/api/admin/settings", { method: "PUT", body: { message: "" } }), "back to the default message");
});

/* phones and tablets: the tabs under the menu switch between the three pages */
pageTabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
        adminView.dataset.page = tab.dataset.show;
        pageTabs.forEach(function (other) {
            other.setAttribute("aria-pressed", String(other === tab));
        });
    });
});

/* the popup's buttons, or a click on the dark veil around it */
veil.addEventListener("click", function (e) {
    const button = e.target.closest("[data-answer]");
    if (button) closeConfirm(button.dataset.answer === "yes");
    else if (e.target === veil) closeConfirm(false);
});

window.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeConfirm(false);
});

/* start */

setTitleWord("ADMIN");
forgetOldToken();
load();
setInterval(function () {
    if (isLoggedIn && !document.hidden && !adminView.hidden) load();
}, 20000);
