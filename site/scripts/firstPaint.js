/*runs in <head> before the page is drawn, so it is a plain script and not deferred:
  a visit over plain http is sent to https, a page inside someone else's frame stays hidden,
  and a browser that has seen the preloader skips it*/

// the sites only work over https; github pages does this too, this catches it if that is ever off
if (location.protocol === "http:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    location.replace("https://" + location.host + location.pathname + location.search + location.hash);
}

// github pages can't send the header that forbids framing (and a meta tag can't do it), so a page
// put in an invisible frame to trick clicks (clickjacking) hides itself and tries to break out
if (window.top !== window.self) {
    document.documentElement.classList.add("is-framed");
    try {
        window.top.location = window.self.location.href;
    } catch (error) { }
}

try {
    if (localStorage.getItem("preloaderSeen")) document.documentElement.classList.add("is-returning");
} catch (error) { }
