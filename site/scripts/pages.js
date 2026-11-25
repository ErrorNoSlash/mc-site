/*phones (and short landscape screens): the main page is two screens, status and join.
  the nav pills switch between them, and so does a sideways swipe.
  on desktop both are on screen; "join?" just puts the cursor in the name box.*/
const twoScreens = window.matchMedia("(max-width: 760px), (max-width: 980px) and (max-height: 600px)");
const pageTabs = document.querySelectorAll(".nav-tabs .pill");

function showPage(page, fromClick) {
    const changed = document.body.dataset.page !== page;
    document.body.dataset.page = page;
    pageTabs.forEach(function (pill) {
        pill.classList.toggle("is-active", pill.getAttribute("href") === (page === "join" ? "#join" : "#servers"));
    });
    // the panorama measures its area again, it may have changed size
    if (changed && page === "status") window.dispatchEvent(new Event("resize"));
    if (fromClick && page === "join" && !twoScreens.matches) document.querySelector("#name-input").focus();
}

document.querySelectorAll('a[href="#join"], a[href="#servers"]').forEach(function (link) {
    link.addEventListener("click", function (event) {
        event.preventDefault();
        showPage(link.getAttribute("href") === "#join" ? "join" : "status", true);
    });
});

let swipeStartX = null;
let swipeStartY = 0;
window.addEventListener("touchstart", function (event) {
    const target = event.target;
    swipeStartX = event.touches.length === 1 && !target.closest("input, textarea, .hotbar-scroll") ? event.touches[0].clientX : null;
    swipeStartY = event.touches.length === 1 ? event.touches[0].clientY : 0;
}, { passive: true });
window.addEventListener("touchend", function (event) {
    if (swipeStartX === null || !twoScreens.matches) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - swipeStartX;
    const dy = touch.clientY - swipeStartY;
    swipeStartX = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) showPage(dx < 0 ? "join" : "status");
}, { passive: true });

showPage(location.hash === "#join" ? "join" : "status");

// the title may shrink, the intro row under it may not: tell the CSS how tall that row is
const heroBlock = document.querySelector(".hero");
const leadRow = document.querySelector(".lead");
function measureLead() {
    heroBlock.style.setProperty("--lead-height", leadRow.offsetHeight + "px");
}
if ("ResizeObserver" in window) new ResizeObserver(measureLead).observe(leadRow);
measureLead();
