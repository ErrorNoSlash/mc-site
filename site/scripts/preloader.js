/*the preloader, like the game's loading screen: the bar fills while the page loads, the line under it
  goes through the game's loading steps. only on the first visit in this browser (firstPaint.js)*/
const preloader = document.querySelector("#preloader");
const preloaderFill = document.querySelector("#preloader-fill");
const preloaderCount = document.querySelector("#preloader-count");
const preloaderStage = document.querySelector("#preloader-stage");
const preloaderSeenKey = "preloaderSeen";

const minimumTime = 1100;
const maximumTime = 3000;
const fadeTime = 450;
const startTime = performance.now();

// the line under the bar, from the percentage it starts at
const loadingStages = [
    [0, "Generating world"],
    [35, "Building terrain"],
    [75, "Joining server"],
    [100, "Done!"]
];

let isPageLoaded = document.readyState === "complete";

window.addEventListener("load", function () {
    isPageLoaded = true;
});

function hidePreloader() {
    // remember that this browser has seen it, so the next visit skips straight to the page
    try {
        localStorage.setItem(preloaderSeenKey, "true");
    } catch (error) { }

    preloader.classList.add("is-done");
    setTimeout(function () {
        preloader.remove();
    }, fadeTime);
}

function updateProgress() {
    const elapsed = performance.now() - startTime;
    const timeProgress = Math.min(elapsed / minimumTime, 1);

    // wait at 90% until the page is loaded, but never longer than maximumTime
    const canFinish = isPageLoaded || elapsed >= maximumTime;
    const progress = canFinish ? timeProgress : Math.min(timeProgress, 0.9);
    const percent = Math.round(progress * 100);

    preloaderFill.style.width = `${percent}%`;
    preloaderCount.textContent = percent;
    preloaderStage.textContent = loadingStages.findLast(function (stage) { return percent >= stage[0]; })[1];

    if (percent < 100) requestAnimationFrame(updateProgress);
    else setTimeout(hidePreloader, 250);
}

/* skip the preloader on a return visit, otherwise start loading */
if (document.documentElement.classList.contains("is-returning")) {
    preloader.remove();
} else {
    requestAnimationFrame(updateProgress);
}
