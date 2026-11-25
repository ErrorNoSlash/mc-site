/*shared by both pages: talking to the API, building elements safely, the big title*/

/*calls the API and returns the JSON, or throws an Error with the API's own message*/
async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    let response;
    try {
        response = await fetch(site.apiBase + path, {
            ...options,
            headers,
            body: options.body === undefined ? undefined : JSON.stringify(options.body)
        });
    } catch (networkError) {
        const error = new Error("can't reach the server API right now");
        error.status = 0;
        throw error;
    }

    let data = {};
    try {
        data = await response.json();
    } catch (notJson) { }

    if (!response.ok) {
        const error = new Error(data.error || "something went wrong (" + response.status + ")");
        error.status = response.status;
        error.data = data;
        throw error;
    }
    return data;
}

/*h("a", { href: "#", class: "x" }, "text", otherNode): text is always set as text, never as HTML*/
function h(tag, attributes, ...children) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes || {})) {
        if (value === false || value == null) continue;
        if (name.startsWith("on")) element.addEventListener(name.slice(2), value);
        else if (value === true) element.setAttribute(name, "");
        else element.setAttribute(name, value);
    }
    for (const child of children.flat()) {
        if (child == null || child === false) continue;
        element.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return element;
}

function timeAgo(iso) {
    const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (seconds < 5) return "just now";
    if (seconds < 60) return seconds + " sec ago";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + " min ago";
    const hours = Math.round(minutes / 60);
    if (hours < 48) return hours + " hr ago";
    return Math.round(hours / 24) + " days ago";
}

/*big title: every letter its own <span>, so the CSS spreads them across the row*/
function setTitleWord(word, label) {
    document.querySelectorAll(".title .echo, .title h1").forEach(function (element) {
        element.replaceChildren(...[...word].map(function (letter) {
            return h("span", null, letter);
        }));
    });
    const heading = document.querySelector(".title h1");
    if (heading) heading.setAttribute("aria-label", label || word);
}

/*copy buttons: <button data-copy="text">*/
document.addEventListener("click", function (event) {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    const text = button.getAttribute("data-copy");
    const done = function () {
        button.classList.add("is-copied");
        setTimeout(function () { button.classList.remove("is-copied"); }, 2000);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { });
});

/*footer year + contact links*/
document.querySelectorAll("[data-year]").forEach(function (element) {
    element.textContent = new Date().getFullYear();
});
document.querySelectorAll("[data-contact-link]").forEach(function (element) {
    element.href = site.contactUrl;
});

/* minecraft bits */

const svgNamespace = "http://www.w3.org/2000/svg";

/*a tiny pixel drawing: rects is a list of [x, y, width, height, opacity?]*/
function pixelSvg(width, height, rects, label) {
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.setAttribute("class", "pixel");
    if (label) {
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", label);
    } else {
        svg.setAttribute("aria-hidden", "true");
    }
    for (const [x, y, w, hgt, opacity] of rects) {
        const rect = document.createElementNS(svgNamespace, "rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", y);
        rect.setAttribute("width", w);
        rect.setAttribute("height", hgt);
        rect.setAttribute("fill", "currentColor");
        if (opacity != null) rect.setAttribute("opacity", opacity);
        svg.append(rect);
    }
    return svg;
}

/*the five connection bars from the multiplayer screen*/
function pingBars(online, latencyMs) {
    let level = 0;
    if (online) level = latencyMs < 150 ? 5 : latencyMs < 300 ? 4 : latencyMs < 600 ? 3 : latencyMs < 1000 ? 2 : 1;
    const bars = [2, 4, 6, 8, 10].map(function (height, index) {
        return [index * 2, 10 - height, 1, height, index < level ? 1 : 0.22];
    });
    const icon = pixelSvg(9, 10, bars, online ? level + " of 5 bars, " + latencyMs + " ms" : "not answering");
    icon.classList.add("ping-bars");
    return icon;
}

/*a plain 8×8 head for Bedrock players, hidden players and names the skin service doesn't know*/
function plainHead() {
    const face = pixelSvg(8, 8, [
        [0, 0, 8, 8, 0.18],
        [0, 0, 8, 2, 0.35],
        [1, 4, 2, 1], [5, 4, 2, 1],
        [3, 6, 2, 1, 0.6]
    ]);
    face.classList.add("head");
    return face;
}

function playerHead(name, uuid) {
    const isJavaName = /^\w{3,16}$/.test(name || "");
    if (!site.headsUrl || (!isJavaName && !uuid)) return plainHead();
    const image = h("img", {
        class: "head",
        src: site.headsUrl.replace("{name}", encodeURIComponent(uuid || name)),
        alt: "",
        loading: "lazy",
        width: "32",
        height: "32",
        referrerpolicy: "no-referrer"
    });
    image.addEventListener("error", function () { image.replaceWith(plainHead()); }, { once: true });
    return image;
}

/*splash text: a random line, another one on click*/
document.querySelectorAll(".splash").forEach(function (splash) {
    const lines = site.splashes || [];
    if (!lines.length) return;
    if (splash.hasAttribute("data-fixed")) return;
    let index = Math.floor(Math.random() * lines.length);
    splash.textContent = lines[index];
    splash.addEventListener("click", function () {
        index = (index + 1) % lines.length;
        splash.textContent = lines[index];
        // restart the little pop
        splash.classList.remove("is-new");
        void splash.offsetWidth;
        splash.classList.add("is-new");
    });
});

/*phones have no hover: a tap gives the same small effect for a moment*/
const pressable = ".pill, .nav-logo, .title h1 span, .splash, .address, .lead-cta, .server-row, .slot, .choice, .submit, .mc-button, .mc-close, .mc-entry, .admin-row, .contact-link, .icon-link";
document.addEventListener("touchstart", function (event) {
    const target = event.target.closest(pressable);
    if (!target) return;
    target.classList.add("is-pressed");
    setTimeout(function () { target.classList.remove("is-pressed"); }, 450);
}, { passive: true });
