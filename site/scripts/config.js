/*the only file to edit when something moves*/
const site = {
    // the whitelist API (must be https, because GitHub Pages is)
    apiBase: "https://mc-api.errornoslash.be",

    // what players type into Minecraft
    javaAddress: "mc.errornoslash.be",
    bedrockAddress: "mc.errornoslash.be",
    bedrockPort: 19132,

    // the "ds/" logo and the footer link
    contactUrl: "https://contact.errornoslash.be",

    // how often the status refreshes (seconds)
    refreshSeconds: 30,

    // player heads in the hotbar and admin lists ({name} is filled in); set to "" to turn them off
    // (Bedrock players and unknown names get a plain pixel head instead)
    headsUrl: "https://mc-heads.net/avatar/{name}/32",
    // the whole skin in the player popup, the same way
    skinsUrl: "https://mc-heads.net/body/{name}/120",

    // a short line about each server in its popup (and about each archived world in the archived
    // list), by the name the status gives it, any case; a server that isn't here gets no line
    serverInfo: {
        "ds network": "The address everyone joins: one network that holds the worlds below, for Java and Bedrock alike.",
        "survival": "The main world: plain survival with friends. Build, explore, and leave other people's things alone.",
        "survival-old": "The previous survival world, kept up so nothing built there gets lost.",
        "anarchy": "No rules: anything goes, griefing included. Don't bring anything you'd miss."
    },

    // the yellow-text-on-the-title-screen kind of line, one picked at random
    splashes: [
        "now with bedrock!",
        "whitelisted!",
        "ask nicely!",
        "ping --all!",
        "no griefers!",
        "made by hand!",
        "one proxy, many worlds!",
        "also try anarchy!",
        "touch grass (blocks)!",
        "/list says hi!"
    ]
};

// while testing on your own computer: open index.html?api=http://localhost:8080
// (only works on localhost, so nobody can point the admin page at another server)
const apiOverride = new URLSearchParams(location.search).get("api");
const isLocalhost = ["localhost", "127.0.0.1", ""].includes(location.hostname);
if (apiOverride && isLocalhost) site.apiBase = apiOverride.replace(/\/+$/, "");
