/*phones (and short landscape screens): the main page is two screens, status and join.
  the nav pills switch between them, and so does a sideways swipe.
  on desktop both are on screen; "join?" just puts the cursor in the name box.*/
(function () {
    const body = document.body;
    const small = matchMedia("(max-width: 760px), (max-width: 980px) and (max-height: 600px)");
    const pills = document.querySelectorAll(".nav-tabs .pill");

    function show(page, fromClick) {
        const changed = body.dataset.page !== page;
        body.dataset.page = page;
        pills.forEach(function (pill) {
            pill.classList.toggle("is-active", pill.getAttribute("href") === (page === "join" ? "#join" : "#servers"));
        });
        // the panorama measures its row; it was hidden on the join screen
        if (changed && page === "status") dispatchEvent(new Event("resize"));
        if (fromClick && page === "join" && !small.matches) document.getElementById("name-input").focus();
    }

    document.querySelectorAll('a[href="#join"], a[href="#servers"]').forEach(function (link) {
        link.addEventListener("click", function (event) {
            event.preventDefault();
            show(link.getAttribute("href") === "#join" ? "join" : "status", true);
        });
    });

    let startX = null;
    let startY = 0;
    addEventListener("touchstart", function (event) {
        const target = event.target;
        startX = event.touches.length === 1 && !target.closest("input, textarea") ? event.touches[0].clientX : null;
        startY = event.touches.length === 1 ? event.touches[0].clientY : 0;
    }, { passive: true });
    addEventListener("touchend", function (event) {
        if (startX === null || !small.matches) return;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        startX = null;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) show(dx < 0 ? "join" : "status");
    }, { passive: true });

    show(location.hash === "#join" ? "join" : "status");
})();
