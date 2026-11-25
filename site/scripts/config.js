/*the only file to edit when something moves*/
window.SITE_CONFIG = {
    // the whitelist API (must be https, because GitHub Pages is)
    apiBase: "https://mc-api.errornoslash.be",

    // what players type into Minecraft
    javaAddress: "play.errornoslash.be",
    bedrockAddress: "play.errornoslash.be",
    bedrockPort: 19132,

    // the "ds/" logo and the footer link
    contactUrl: "https://contact.errornoslash.be",

    // how often the status refreshes (seconds)
    refreshSeconds: 30,

    // player heads in the hotbar and admin lists ({name} is filled in); set to "" to turn them off
    // (Bedrock players and unknown names get a plain pixel head instead)
    headsUrl: "https://mc-heads.net/avatar/{name}/32",

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

/*while testing on your own computer: open index.html?api=http://localhost:8080
  (only works on localhost, so nobody can point the admin page at another server)*/
(function () {
    const override = new URLSearchParams(location.search).get("api");
    const isLocal = ["localhost", "127.0.0.1", ""].includes(location.hostname);
    if (override && isLocal) window.SITE_CONFIG.apiBase = override.replace(/\/+$/, "");
})();
