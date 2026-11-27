/*admin page: approve requests, manage the whitelist, turn it on and off.
  on phones and tablets it is split into three pages, picked with the tabs under the menu.
  logging in swaps the token for a session cookie the page itself can't read; the token is never kept*/

// the page is served by the API itself (/admin/ on mc-api), so every call goes to where it came from
site.apiBase = location.origin;

// where older versions of this page kept the token: cleared on every visit
const oldTokenKey = "whitelistAdminToken";

const loginScreen = document.querySelector("#login-screen");
const pageTabs = document.querySelectorAll(".admin-tabs [data-show]");
const loginForm = document.querySelector("#login-form");
const loginOutput = document.querySelector("#login-output");
const sheet = document.querySelector(".sheet");
const adminView = document.querySelector("#admin-view");
const logoutButton = document.querySelector("#logout");
const securityLine = document.querySelector("#security-line");
const addForm = document.querySelector("#add-form");
const listTabs = document.querySelectorAll(".list-tabs [data-list]");
// which list the left block shows: "whitelist" or "blacklist"
let shownList = "whitelist";
const notice = document.querySelector("#notice");
const enforceButton = document.querySelector("#enforce");
const messageForm = document.querySelector("#message-form");
const messageBox = messageForm.elements.message;
const messagePreview = document.querySelector("#message-preview");

const veil = document.querySelector("#veil");
const playerPanel = document.querySelector("#panel-player");
const confirmPanel = document.querySelector("#panel-confirm");
const confirmTitle = document.querySelector("#confirm-title");
const confirmText = document.querySelector("#confirm-text");
const confirmYes = document.querySelector("#confirm-yes");

let isLoggedIn = false;
let overview = null;
// a login ends after a while without clicking anything, or at its end time (the API decides)
const loggedOutText = "logged out: unused for a while, or the login reached its end. log in again";
let renderedKey = "";
let messageDirty = false;
let noticeTimer = null;
let answerConfirm = null;
let focusBeforePopup = null;

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

/*the login form asks for the authenticator code only when 2FA is set up on the API*/
async function askLoginOptions() {
    let needsCode = true;
    try {
        needsCode = (await adminApi("/api/admin/login")).code;
    } catch (error) {
        // can't tell: keep the field, the API ignores a code it doesn't need
    }
    document.querySelector("#login-code").hidden = !needsCode;
    document.querySelector("#login-code-text").hidden = !needsCode;
    loginForm.elements.code.required = needsCode;
}

function showLogin(message) {
    adminView.hidden = true;
    loginScreen.hidden = false;
    askLoginOptions();
    logoutButton.hidden = true;
    securityLine.hidden = true;
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

/* popups: drawn like the game's menu screens; one at a time, the page behind can't be reached meanwhile */

function openPopup(panel) {
    if (!veil.classList.contains("is-open")) focusBeforePopup = document.activeElement;
    [playerPanel, confirmPanel].forEach(function (other) {
        other.hidden = other !== panel;
    });
    veil.classList.add("is-open");
    veil.setAttribute("aria-hidden", "false");
    document.body.classList.add("popup-open");
    sheet.inert = true;
}

function closePopup() {
    // a confirm question that is closed some other way counts as "no"
    if (answerConfirm) {
        answerConfirm(false);
        answerConfirm = null;
    }
    veil.classList.remove("is-open");
    veil.setAttribute("aria-hidden", "true");
    document.body.classList.remove("popup-open");
    sheet.inert = false;
    if (focusBeforePopup) focusBeforePopup.focus();
    focusBeforePopup = null;
}

/*asks first, in the confirm popup instead of the browser's confirm box: true for the yes button,
  false for cancel, the ✕, Esc or a click outside*/
function askConfirm(title, text, yesLabel) {
    confirmTitle.textContent = title;
    confirmText.textContent = text;
    confirmYes.textContent = yesLabel;
    openPopup(confirmPanel);
    confirmYes.focus();

    return new Promise(function (resolve) {
        answerConfirm = resolve;
    });
}

function closeConfirm(answer) {
    if (!answerConfirm) return;
    const resolve = answerConfirm;
    answerConfirm = null;
    closePopup();
    resolve(answer);
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
            showLogin(loggedOutText);
            return false;
        }
        flash(error.message, true);
    }
    await load();
    return ok;
}

/* rows */

/*a head that opens its player*/
function headButton(entry) {
    return h("button", {
        class: "head-button", type: "button", title: "About " + entry.name, "aria-label": "About " + entry.name,
        onclick: function () { showPlayer(entry.edition, entry.name, entry.uuid); }
    }, playerHead(entry.name, entry.edition === "java" ? entry.uuid : null));
}

/*head + text, like a player in the tab list*/
function who(entry, ...children) {
    return h("div", { class: "who" },
        headButton(entry),
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
        headButton(request),
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
            }, "deny"),
            h("button", {
                class: "pill big", type: "button", title: "Deny and blacklist",
                onclick: function () { block(request.name, { requestId: request.id }); }
            }, "block")
        )
    );
}

/* blacklisting: asks first, then the API declines their request, takes them off the whitelist and
   turns them away from now on, whitelist on or off */
async function block(name, body) {
    const sure = await askConfirm("Blacklist " + name + "?",
        "They come off the whitelist, any request is declined, and they can't join or ask again (whitelist on or off). If they're online they get kicked.",
        "Blacklist");
    if (!sure) return false;
    return act(adminApi("/api/admin/blocked", { method: "POST", body: body }), name + " is blacklisted");
}

function unblock(player) {
    return act(adminApi("/api/admin/blocked/" + encodeURIComponent(player.key), { method: "DELETE" }), player.name + " is off the blacklist");
}

/*a blacklisted player: when, why, and the way back*/
function blockedRow(player) {
    const details = ["blacklisted " + timeAgo(player.blockedAt)];
    if (player.reason) details.push(player.reason);
    return h("div", { class: "admin-row" },
        who(player,
            h("b", null, player.name), editionTag(player.edition),
            h("small", null, details.join(" · "))
        ),
        h("div", { class: "actions" },
            h("button", {
                class: "pill small", type: "button", title: "Take " + player.name + " off the blacklist",
                onclick: function () { unblock(player); }
            }, "unblock")
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
            }, "add"),
            h("button", {
                class: "pill small", type: "button", title: "Blacklist " + entry.name,
                onclick: function () { block(entry.name, { fromSeen: true, edition: entry.edition, name: entry.name, uuid: entry.uuid }); }
            }, "block")
        )
    );
}

/* history */

const historyText = {
    "added": function (entry) { return [h("b", null, entry.name), " added ", h("small", null, entry.source === "seen" ? "from the seen list" : "by hand")]; },
    "removed": function (entry) { return [h("b", null, entry.name), " removed"]; },
    "requested": function (entry) { return [h("b", null, entry.name), " asked to join"]; },
    "approved": function (entry) { return [h("b", null, entry.name), " approved ", h("small", null, entry.via === "ntfy" ? "from a notification" : "")]; },
    "denied": function (entry) { return [h("b", null, entry.name), " denied ", h("small", null, entry.via === "removed" ? "taken off the list" : entry.via === "blocked" ? "blacklisted" : entry.via === "ntfy" ? "from a notification" : "")]; },
    "forgotten": function (entry) { return [h("b", null, entry.name), "'s request forgotten"]; },
    "blocked": function (entry) { return [h("b", null, entry.name), " blacklisted ", h("small", null, entry.reason || "")]; },
    "unblocked": function (entry) { return [h("b", null, entry.name), " taken off the blacklist"]; },
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

/* the player popup */

/*everything the lists already know about one player*/
function playerInfo(edition, name, uuid) {
    const lowerName = name.toLowerCase();
    function isThem(item) {
        if (item.edition !== edition) return false;
        if (edition === "java" && uuid && item.uuid) return item.uuid === uuid;
        return String(item.name).toLowerCase() === lowerName;
    }
    return {
        listed: overview.whitelist.players.find(isThem),
        blocked: (overview.whitelist.blocked || []).find(isThem),
        seen: overview.seen.find(isThem),
        // newest first, so this is their latest request
        request: overview.requests.find(isThem),
        history: (overview.activity || []).filter(function (entry) { return entry.name && isThem(entry); })
    };
}

function dateText(iso) {
    return new Date(iso).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

// how they got on the list ("request <id>" for an approved request)
const listedHow = { seen: "from the seen list", admin: "by hand", request: "approved request" };

function showPlayer(edition, name, uuid) {
    const info = playerInfo(edition, name, uuid);
    const listed = info.listed;
    const seen = info.seen;
    const request = info.request;
    const blocked = info.blocked;
    uuid = uuid || (listed && listed.uuid) || (seen && edition === "java" ? seen.uuid : null);

    playerPanel.querySelector("#panel-player-title").textContent = name;
    const card = playerCard(name, edition === "java" ? uuid : null, [
        ["edition", edition === "java" ? "Java" : "Bedrock"],
        uuid ? ["uuid", h("button", { class: "copy-text", type: "button", "data-copy": uuid, title: "Copy" }, uuid)] : null,
        ["whitelist", blocked ? "blacklisted " + timeAgo(blocked.blockedAt) + (blocked.reason ? " · " + blocked.reason : "")
            : listed ? "listed " + timeAgo(listed.addedAt) + " · " + (listedHow[String(listed.source).split(" ")[0]] || listed.source) : "not listed"],
        ["first seen", seen ? dateText(seen.firstSeen) : "hasn't joined yet"],
        seen ? ["last seen", timeAgo(seen.lastSeen) + (seen.turnedAway ? " · turned away" : "")] : null,
        seen ? ["logins", String(seen.logins)] : null,
        request ? ["request", request.status + " · asked " + timeAgo(request.createdAt)] : null,
        request && request.note ? ["their note", "“" + request.note + "”"] : null
    ]);
    // their part of the history, newest first
    const body = [card];
    if (info.history.length) {
        body.push(h("ol", { class: "player-history" }, ...info.history.slice(0, 8).map(function (entry) { return historyRow(entry, false); })));
    }
    playerPanel.querySelector("#panel-player-body").replaceChildren(...body);

    // what can be done with them, depending on where they stand
    let action = null;
    if (blocked) {
        action = h("button", {
            class: "mc-button", type: "button",
            onclick: function () {
                closePopup();
                unblock(blocked);
            }
        }, "Unblock");
    } else if (listed) {
        action = h("button", {
            class: "mc-button", type: "button",
            onclick: async function () {
                const kickNote = overview.whitelist.enforced ? " If they're online they get kicked." : "";
                if (!await askConfirm("Remove " + name + "?", "They come off the whitelist." + kickNote, "Remove")) return;
                act(adminApi("/api/admin/players/" + encodeURIComponent(listed.key), { method: "DELETE" }), name + " removed");
            }
        }, "Remove");
    } else if (request && request.status === "pending") {
        action = h("button", {
            class: "mc-button", type: "button",
            onclick: function () {
                closePopup();
                act(adminApi("/api/admin/requests/" + request.id + "/approve", { method: "POST" }), name + " is whitelisted");
            }
        }, "Approve");
    } else if (seen) {
        action = h("button", {
            class: "mc-button", type: "button",
            onclick: function () {
                closePopup();
                act(addSeen(seen), name + " whitelisted");
            }
        }, "Add To Whitelist");
    }
    const buttons = [];
    if (edition === "java") buttons.push(h("a", { class: "mc-button", href: "https://namemc.com/profile/" + encodeURIComponent(uuid || name), target: "_blank", rel: "noopener" }, "NameMC ↗"));
    if (action) buttons.push(action);
    if (!blocked) {
        buttons.push(h("button", {
            class: "mc-button", type: "button",
            onclick: function () {
                closePopup();
                block(name, listed ? { key: listed.key } : request ? { requestId: request.id }
                    : seen ? { fromSeen: true, edition: edition, name: seen.name, uuid: seen.uuid } : { edition: edition, name: name });
            }
        }, "Blacklist"));
    }
    playerPanel.querySelector("#panel-player-buttons").replaceChildren(...buttons);

    openPopup(playerPanel);
    playerPanel.querySelector("[data-close]").focus();
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
    // the blacklisted don't count as "seen, not listed": that list is for people you might still add
    const unlisted = data.seen.filter(function (entry) { return !entry.listed && !entry.blocked; });
    const blockedPlayers = [...(data.whitelist.blocked || [])].sort(function (a, b) { return b.blockedAt.localeCompare(a.blockedAt); });
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
    document.querySelector("#listed-count").textContent = players.length;
    document.querySelector("#blocked-count").textContent = blockedPlayers.length;
    fill("listed-list", players.map(listedRow), "nobody yet. add yourself first!");
    fill("blocked-list", blockedPlayers.map(blockedRow), "nobody is blacklisted.");
    fill("seen-list", unlisted.map(seenRow), data.seen.length ? "everyone who joined is listed." : "nobody has joined since the plugin was installed.");
    document.querySelector("#add-all-seen").hidden = unlisted.length < 2;
    fill("history-list", historyRows(data.activity || []), "nothing has changed yet.");

    if (!messageDirty && document.activeElement !== messageBox) {
        messageBox.value = data.whitelist.message || data.whitelist.defaultMessage;
        renderMessagePreview();
    }

    renderSecurity(data.security);
}

/*the footer's line: when and from where the login before this one was, and how many are open*/
function renderSecurity(security) {
    if (!security) return;
    const before = security.previousLogin;
    const devices = security.sessions + (security.sessions === 1 ? " login open" : " logins open");
    document.querySelector("#security-text").textContent =
        (before ? "login before this: " + timeAgo(before.at) + " from " + before.from + " (" + before.ip + ")" : "first login") + " · " + devices
        + (security.twoFactor ? " · 2FA on" : " · 2FA off");
}

/*loads everything; without a valid session cookie that is the login screen. the page's own
  refreshes say so (auto), so they don't keep an unused login alive*/
async function load(auto) {
    try {
        render(await adminApi("/api/admin/overview" + (auto ? "?auto=1" : "")));
        isLoggedIn = true;
        loginScreen.hidden = true;
        adminView.hidden = false;
        logoutButton.hidden = false;
        securityLine.hidden = false;
    } catch (error) {
        if (error.status === 401) {
            const wasLoggedIn = isLoggedIn;
            isLoggedIn = false;
            overview = null;
            renderedKey = "";
            return showLogin(wasLoggedIn ? loggedOutText : "");
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
    const code = loginForm.elements.code.value.trim();
    // the token and code leave the fields straight away; only the cookie the API answers with stays
    loginForm.elements.token.value = "";
    loginForm.elements.code.value = "";
    loginOutput.dataset.tone = "wait";
    loginOutput.replaceChildren(h("span", null, "> checking..."));
    try {
        await adminApi("/api/admin/login", { method: "POST", body: { token: token, code: code, remember: remember } });
    } catch (error) {
        loginOutput.dataset.tone = "error";
        loginOutput.replaceChildren(h("span", null, "> " + (error.status === 401 ? error.message.toLowerCase().replace(/\.$/, "") : loginProblem(error))));
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

/* ends every login, on every device: for a login you don't remember */
document.querySelector("#logout-everywhere").addEventListener("click", async function () {
    const open = overview && overview.security ? overview.security.sessions : 0;
    const text = (open > 1 ? open + " logins are open. " : "") + "Every device is logged out, this one too, and needs the token again.";
    if (!await askConfirm("Log out everywhere?", text, "Log out all")) return;
    try {
        await adminApi("/api/admin/logout-everywhere", { method: "POST", body: {} });
    } catch (error) {
        if (error.status !== 401) return flash(error.message, true);
    }
    isLoggedIn = false;
    overview = null;
    renderedKey = "";
    showLogin("logged out everywhere");
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

/* the form adds to the list that is showing: the whitelist, or the blacklist (with an optional why) */
addForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    const name = addForm.elements.name.value.trim();
    const edition = addForm.elements.edition.value;
    const ok = shownList === "blacklist"
        ? await block(name, { edition: edition, name: name, reason: addForm.elements.reason.value.trim() })
        : await act(adminApi("/api/admin/players", { method: "POST", body: { edition: edition, name: name } }), name + " added");
    if (ok) {
        addForm.elements.name.value = "";
        addForm.elements.reason.value = "";
    }
});

/* whitelist / blacklist: the tabs in the list's header line */
listTabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
        shownList = tab.dataset.list;
        const isBlacklist = shownList === "blacklist";
        listTabs.forEach(function (other) { other.setAttribute("aria-pressed", String(other === tab)); });
        document.querySelector("#listed-head").textContent = "dias@mc:~$ /" + shownList + " list";
        document.querySelector("#listed-list").hidden = isBlacklist;
        document.querySelector("#blocked-list").hidden = !isBlacklist;
        addForm.elements.reason.hidden = !isBlacklist;
        document.querySelector("#add-button").textContent = isBlacklist ? "block" : "add";
    });
});

document.querySelector("#add-all-seen").addEventListener("click", async function () {
    const unlisted = overview.seen.filter(function (entry) { return !entry.listed && !entry.blocked; });
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

/* the popups' buttons, or a click on the dark veil around them */
veil.addEventListener("click", function (e) {
    const answer = e.target.closest("[data-answer]");
    if (answer) closeConfirm(answer.dataset.answer === "yes");
    else if (e.target === veil || e.target.closest("[data-close]")) closePopup();
});

window.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && veil.classList.contains("is-open")) closePopup();
});

/* start */

setTitleWord("ADMIN");
forgetOldToken();
load();
setInterval(function () {
    if (isLoggedIn && !document.hidden && !adminView.hidden) load(true);
}, 20000);

// back on the tab: check straight away, so a login that ran out meanwhile doesn't keep showing the lists
document.addEventListener("visibilitychange", function () {
    if (isLoggedIn && !document.hidden) load(true);
});
