/*the whitelist request form, which also checks on an earlier request ("already asked?")*/
const form = document.querySelector("#request-form");
const nameInput = document.querySelector("#name-input");
const nameLabel = document.querySelector("#name-label");
const nameHint = document.querySelector("#name-hint");
const noteField = document.querySelector("#note-field");
const submitButton = document.querySelector("#submit-button");
const submitLabel = document.querySelector("#submit-label");
const output = document.querySelector("#form-output");
const modeToggle = document.querySelector("#mode-toggle");

let checking = false; // false: send a request, true: look up an earlier one
let floodgate = { prefix: ".", replaceSpaces: true };

function edition() {
    return form.elements.edition.value;
}

/*the name Floodgate will give a Bedrock player, so they know what to expect*/
function floodgateName(gamertag) {
    let name = gamertag.trim();
    if (floodgate.prefix && name.startsWith(floodgate.prefix)) name = name.slice(floodgate.prefix.length);
    name = floodgate.prefix + name.slice(0, 16 - floodgate.prefix.length);
    return floodgate.replaceSpaces ? name.replace(/ /g, "_") : name;
}

function updateLabels() {
    const isJava = edition() === "java";
    nameLabel.textContent = isJava ? "java username" : "xbox gamertag";
    nameInput.placeholder = isJava ? "Steve" : "Steve Bedrock";
    if (isJava) {
        nameHint.textContent = "exactly as it shows in the game";
    } else if (nameInput.value.trim()) {
        nameHint.textContent = "in game you'll show up as " + floodgateName(nameInput.value);
    } else {
        nameHint.textContent = "in game you'll get a " + (floodgate.prefix || "no") + " in front of your name";
    }
    noteField.hidden = checking;
    submitLabel.textContent = checking ? "check status" : "send request";
    modeToggle.textContent = checking ? "new request?" : "already asked?";
}

/*pixel icons for the toast: a pickaxe for "asked", a tick for "whitelisted"*/
const toastIcons = {
    asked: [[2, 1, 7, 1], [1, 2, 2, 1], [8, 2, 2, 1], [0, 3, 1, 2], [10, 3, 1, 2], [5, 2, 2, 10, 0.75]],
    listed: [[1, 6, 2, 2], [3, 8, 2, 2], [5, 6, 2, 2], [7, 4, 2, 2], [9, 2, 2, 2]]
};

/*the "advancement made!" toast from the top-right corner of the game*/
function toast(title, text, icon) {
    return h("span", { class: "toast" },
        h("span", { class: "toast-icon" }, pixelSvg(12, 12, toastIcons[icon])),
        h("span", null, h("b", null, title), h("span", null, text))
    );
}

function say(lines, tone, banner) {
    output.dataset.tone = tone || "";
    output.replaceChildren(
        ...(banner ? [banner] : []),
        ...lines.map(function (line) { return h("span", null, "> " + line); })
    );
}

function explain(result) {
    const who = result.name + " (" + (result.edition || edition()) + ")";
    switch (result.status) {
        case "approved":
            return [[who + " is whitelisted.", "join at " + (edition() === "java" ? site.javaAddress : site.bedrockAddress + " port " + site.bedrockPort)], "ok"];
        case "pending":
            return [[who + ": request is waiting.", "you can join as soon as it's approved."], "wait"];
        case "denied":
            return [[who + ": request was declined.", "get in touch if that's a mistake."], "error"];
        default:
            return [["no request found for " + result.name + ".", "send one with the form."], ""];
    }
}

function remember(result) {
    try {
        localStorage.setItem("whitelistRequest", JSON.stringify({ edition: result.edition || edition(), name: result.name }));
    } catch (storageOff) { }
}

form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
        say(["type your " + (edition() === "java" ? "username" : "gamertag") + " first."], "error");
        nameInput.focus();
        return;
    }

    submitButton.disabled = true;
    say([checking ? "looking it up..." : "sending..."], "wait");
    try {
        let result;
        if (checking) {
            result = await api("/api/requests/lookup?edition=" + encodeURIComponent(edition()) + "&name=" + encodeURIComponent(name));
        } else {
            result = await api("/api/requests", {
                method: "POST",
                body: { edition: edition(), name: name, note: form.elements.note.value, website: form.elements.website.value }
            });
            remember(result);
        }
        const [lines, tone] = explain(result);
        let banner = null;
        if (!checking && result.status === "pending" && !result.message) {
            lines[0] = "request sent for " + result.name + ".";
            banner = toast("Advancement Made!", "Knock knock", "asked");
        } else if (result.status === "approved") {
            banner = toast("Advancement Made!", "On the list", "listed");
        }
        say(lines, banner ? "toast" : tone, banner);
        if (!checking) form.elements.note.value = "";
    } catch (error) {
        say([error.message.charAt(0).toLowerCase() + error.message.slice(1)], "error");
    } finally {
        submitButton.disabled = false;
    }
});

form.addEventListener("change", updateLabels);
nameInput.addEventListener("input", updateLabels);
modeToggle.addEventListener("click", function () {
    checking = !checking;
    output.replaceChildren();
    updateLabels();
    nameInput.focus();
});

/*coming back: show how the last request is doing*/
async function showRememberedRequest() {
    let saved = null;
    try {
        saved = JSON.parse(localStorage.getItem("whitelistRequest") || "null");
    } catch (storageOff) { }
    if (!saved || !saved.name) return;

    form.elements.edition.value = saved.edition;
    nameInput.value = saved.edition === "bedrock" ? saved.name.replace(floodgate.prefix, "") : saved.name;
    updateLabels();
    try {
        const result = await api("/api/requests/lookup?edition=" + encodeURIComponent(saved.edition) + "&name=" + encodeURIComponent(saved.name));
        if (result.status === "none") return;
        const [lines, tone] = explain({ ...result, edition: saved.edition });
        say(lines, result.status === "approved" ? "toast" : tone,
            result.status === "approved" ? toast("Advancement Made!", "On the list", "listed") : null);
    } catch (error) { }
}

showRememberedRequest();

/*the API knows the server's real Floodgate prefix (status.js fires this after every refresh)*/
document.addEventListener("status", function (event) {
    if (event.detail.floodgate) floodgate = event.detail.floodgate;
    updateLabels();
});

updateLabels();
