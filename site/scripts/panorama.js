/*the title-screen panorama: a blocky world turning slowly behind the title and the intro.
  like the game's own menu, a full 360° view is drawn once (a ray through real block voxels
  for every pixel: grass, dirt, stone, sand, water, oak trees, snow, clouds, a square sun or
  moon and stars) and then slid sideways with CSS, so turning costs nothing. it is drawn in
  chunks, so the world sweeps in like chunks loading, and only in the site's own greys.*/
const panorama = document.querySelector(".panorama");
const panoramaCanvas = document.createElement("canvas");
panorama.append(panoramaCanvas);
const panoramaContext = panoramaCanvas.getContext("2d");

let pixelSize = 4;                    // css pixels per panorama pixel, see measurePixelSize()
const visibleFov = 2.2;          // how wide the visible part of the view is (radians), about the game's menu
const turnSeconds = 200;         // one full turn
const maxStrength = 0.62;            // how far the brightest block goes towards the text colour
const shadeLevels = 9;

/* the world: a 3D block grid around the camera */

const worldSize = 160;                 // blocks across
const worldHeight = 48;                  // blocks high
const waterLevel = 12;
const maxDistance = 72;

// block ids
const blocks = { air: 0, grass: 1, dirt: 2, stone: 3, sand: 4, water: 5, log: 6, leaves: 7, snow: 8 };

function hash(x, y, seed) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothNoise(x, y, seed) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(x0, y0, seed), b = hash(x0 + 1, y0, seed);
    const c = hash(x0, y0 + 1, seed), d = hash(x0 + 1, y0 + 1, seed);
    const top = a + (b - a) * sx, bottom = c + (d - c) * sx;
    return top + (bottom - top) * sy;
}

const world = new Uint8Array(worldSize * worldSize * worldHeight);
const at = function (x, y, z) { return (z * worldSize + y) * worldSize + x; };
const surface = new Uint8Array(worldSize * worldSize);

function buildWorld() {
    const seed = 4;
    for (let y = 0; y < worldSize; y++) {
        for (let x = 0; x < worldSize; x++) {
            let n = smoothNoise(x / 34, y / 34, seed) * 0.62
                + smoothNoise(x / 15, y / 15, seed + 1) * 0.26
                + smoothNoise(x / 6, y / 6, seed + 2) * 0.12;
            // a few proper hills
            n = Math.pow(Math.max(0, n - 0.18) / 0.82, 1.45);
            const top = Math.min(worldHeight - 10, 7 + Math.floor(n * 34));
            surface[y * worldSize + x] = top;
            for (let z = 0; z <= Math.max(top, waterLevel - 1); z++) {
                let block;
                if (z > top) block = blocks.water;
                else if (z === top) block = top >= 30 ? blocks.snow : top < waterLevel + 1 ? blocks.sand : blocks.grass;
                else if (z > top - 4) block = top < waterLevel + 1 ? blocks.sand : blocks.dirt;
                else block = blocks.stone;
                // bare stone on the steep high parts
                if (z === top && top >= 25 && top < 30 && hash(x, y, 31) < 0.5) block = blocks.stone;
                world[at(x, y, z)] = block;
            }
        }
    }
    // oak trees: a log and a leafy top, never in water or on rock
    for (let y = 3; y < worldSize - 3; y++) {
        for (let x = 3; x < worldSize - 3; x++) {
            const ground = surface[y * worldSize + x];
            if (world[at(x, y, ground)] !== blocks.grass || hash(x, y, 77) > 0.011) continue;
            const trunk = 4 + Math.floor(hash(x, y, 78) * 2);
            for (let z = ground + 1; z <= ground + trunk; z++) world[at(x, y, z)] = blocks.log;
            for (let dz = trunk - 1; dz <= trunk + 2; dz++) {
                const radius = dz < trunk + 1 ? 2 : 1;
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const corner = Math.abs(dx) === radius && Math.abs(dy) === radius;
                        if (corner && (radius === 1 || hash(x + dx, y + dy, dz) < 0.6)) continue;
                        const z = ground + dz;
                        if (z >= worldHeight) continue;
                        const i = at(x + dx, y + dy, z);
                        if (world[i] === blocks.air) world[i] = blocks.leaves;
                    }
                }
            }
        }
    }
}


// the camera stands on a hill near the middle at eye height, with a clear view all round
function placeCamera() {
    let best = { x: worldSize / 2, y: worldSize / 2, score: -1 };
    for (let y = worldSize / 2 - 14; y < worldSize / 2 + 14; y++) {
        for (let x = worldSize / 2 - 14; x < worldSize / 2 + 14; x++) {
            const top = surface[y * worldSize + x];
            // an open view: nothing close by stands taller than the camera's own hill
            let highest = 0;
            for (let dy = -10; dy <= 10; dy++) {
                for (let dx = -10; dx <= 10; dx++) {
                    highest = Math.max(highest, surface[(y + dy) * worldSize + x + dx]);
                }
            }
            const score = top >= waterLevel + 3 && top <= waterLevel + 10 && highest <= top + 1 ? top + hash(x, y, 5) : -1;
            if (score > best.score) best = { x, y, score };
        }
    }
    // no tree in its face: clear logs and leaves close by
    for (let z = 0; z < worldHeight; z++) {
        for (let y = best.y - 14; y <= best.y + 14; y++) {
            for (let x = best.x - 14; x <= best.x + 14; x++) {
                const i = at(x, y, z);
                if ((world[i] === blocks.log || world[i] === blocks.leaves) && (x - best.x) ** 2 + (y - best.y) ** 2 < 196) world[i] = blocks.air;
            }
        }
    }
    return { x: best.x + 0.5, y: best.y + 0.5, z: surface[best.y * worldSize + best.x] + 4.5 };
}

// built on the first draw, not when the page loads: the admin page doesn't need it once you're logged in
let camera = null;

/* how a block face looks (0 = background, 1 = brightest) */

const faceLight = [0.66, 0.82, 1, 0.5]; // x sides, y sides, top, bottom

function texture(block, face, u, v) {
    const tu = Math.floor(u * 8), tv = Math.floor(v * 8);
    const grain = (hash(tu, tv, block * 8 + face) - 0.5) * 0.6;
    const top = face === 2;
    switch (block) {
        case blocks.grass:
            if (top) return 0.8 + grain * 0.12;
            return v > 0.8 ? 0.76 + grain * 0.1 : (v > 0.68 && hash(tu, 0, 9) < 0.5 ? 0.74 : 0.47 + grain * 0.1);
        case blocks.dirt: return 0.47 + grain * 0.12;
        case blocks.stone: return 0.58 + grain * 0.16;
        case blocks.sand: return 0.74 + grain * 0.08;
        case blocks.water: return 0.3 + (hash(tu, Math.floor(v * 3), 2) < 0.2 ? 0.08 : 0);
        case blocks.log: return top ? 0.55 : 0.32 + (tu % 3 === 0 ? -0.06 : 0) + grain * 0.05;
        case blocks.leaves: return hash(tu, tv, face + 40) < 0.14 ? 0.36 : 0.56 + grain * 0.12;
        case blocks.snow: return top || v > 0.75 ? 0.96 : 0.58 + grain * 0.16;
    }
    return 0.5;
}

/* tracing */

let isNight = true;

function skyValue(dz, yaw) {
    const elevation = Math.asin(Math.max(-1, Math.min(1, dz)));
    const value = (isNight ? 0.03 : 0.1) + Math.max(0, 0.16 - elevation * 0.5);
    // the square sun / moon
    const bodyYaw = isNight ? 2.3 : 0.8;
    const offset = ((yaw - bodyYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const size = 0.085;
    if (Math.abs(offset) < size && Math.abs(elevation - 0.18) < size) {
        const crater = isNight && ((offset > size * 0.2 && elevation > 0.18 + size * 0.2) || (offset < -size * 0.4 && elevation < 0.18 - size * 0.3));
        return { value: crater ? 0.6 : 0.99, flat: true };
    }
    if (isNight && elevation > 0.04 && hash(Math.floor(yaw * 160), Math.floor(elevation * 160), 12) < 0.012) {
        return { value: 0.5 + hash(Math.floor(yaw * 160), 1, 13) * 0.35, flat: true };
    }
    return { value: value, flat: false };
}

/* follows one ray through the grid; returns { value, flat } */
function trace(dx, dy, dz, yaw) {
    let x = Math.floor(camera.x), y = Math.floor(camera.y), z = Math.floor(camera.z);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const deltaX = Math.abs(1 / dx), deltaY = Math.abs(1 / dy), deltaZ = Math.abs(1 / dz);
    let maxX = (dx > 0 ? x + 1 - camera.x : camera.x - x) * deltaX;
    let maxY = (dy > 0 ? y + 1 - camera.y : camera.y - y) * deltaY;
    let maxZ = (dz > 0 ? z + 1 - camera.z : camera.z - z) * deltaZ;
    let t = 0, face = 0;

    while (t < maxDistance) {
        if (maxX < maxY && maxX < maxZ) { x += stepX; t = maxX; maxX += deltaX; face = 0; }
        else if (maxY < maxZ) { y += stepY; t = maxY; maxY += deltaY; face = 1; }
        else { z += stepZ; t = maxZ; maxZ += deltaZ; face = dz < 0 ? 2 : 3; }

        if (x < 0 || y < 0 || x >= worldSize || y >= worldSize || z < 0) break;
        if (z >= worldHeight) {
            if (dz > 0) break;
            continue;
        }
        const block = world[at(x, y, z)];
        if (block === blocks.air) continue;

        const hx = camera.x + dx * t, hy = camera.y + dy * t, hz = camera.z + dz * t;
        let u, v;
        if (face === 0) { u = hy - Math.floor(hy); v = hz - Math.floor(hz); }
        else if (face === 1) { u = hx - Math.floor(hx); v = hz - Math.floor(hz); }
        else { u = hx - Math.floor(hx); v = hy - Math.floor(hy); }

        let lit = texture(block, face, u, v) * faceLight[face];
        // on a light page, light faces stay close to the paper and shadows get ink
        if (!isNight) lit = 0.08 + (1 - lit) * 0.78;
        const fog = Math.min(1, Math.pow(Math.max(0, t - 14) / (maxDistance - 14), 1.15));
        const haze = isNight ? 0.12 : 0.16;
        return { value: lit * (1 - fog) + haze * fog, flat: fog < 0.3 };
    }

    // nothing hit: clouds, then sky
    if (dz > 0.02) {
        const distance = 18 / dz;
        const cx = Math.floor((camera.x + dx * distance) / 10), cy = Math.floor((camera.y + dy * distance) / 10);
        if (distance < 260 && smoothNoise(cx * 0.5, cy * 0.5, 21) > (isNight ? 0.7 : 0.62)) {
            const fade = Math.min(1, distance / 260);
            return { value: (isNight ? 0.42 : 0.3) * (1 - fade) + 0.16 * fade, flat: fade < 0.4 };
        }
    }
    return skyValue(dz, yaw);
}

/* the panorama image */

const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(function (b) { return (b + 0.5) / 16; });
let palette = [];
let drawJob = 0;

function parseColor(text) {
    text = text.trim();
    if (text.startsWith("#")) {
        const hex = text.length === 4 ? text.replace(/\w/g, "$&$&").slice(1) : text.slice(1);
        return [0, 2, 4].map(function (start) { return parseInt(hex.slice(start, start + 2), 16); });
    }
    const numbers = text.match(/\d+(\.\d+)?/g);
    return numbers ? numbers.slice(0, 3).map(Number) : [0, 0, 0];
}

function readColors() {
    const style = getComputedStyle(document.documentElement);
    const background = parseColor(style.getPropertyValue("--background"));
    const foreground = parseColor(style.getPropertyValue("--foreground"));
    // dark mode (the default) is a night sky, light mode a day sky
    isNight = document.documentElement.dataset.theme !== "light";
    palette = [];
    for (let level = 0; level < shadeLevels; level++) {
        const amount = level / (shadeLevels - 1) * maxStrength;
        palette.push(background.map(function (channel, c) { return Math.round(channel + (foreground[c] - channel) * amount); }));
    }
}

/* hidden (the admin page once you're logged in): nothing is drawn, and a draw that was going stops.
   forgetting the drawn size makes it draw again as soon as it shows */
function isHidden() {
    if (panorama.getClientRects().length) return false;
    drawnWidth = 0;
    return true;
}

/* 4 css px per panorama pixel at the designed 16 px text size (3 on phones), scaled with the
   page so Windows display scaling doesn't change the look, then rounded to whole device
   pixels so the blocks stay sharp at 125 % / 150 % too */
function measurePixelSize() {
    const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const css = (innerWidth < 760 ? 3 : 4) * root / 16;
    const ratio = devicePixelRatio || 1;
    return Math.max(1, Math.round(css * ratio)) / ratio;
}

/* renders the whole 360° strip, a chunk of columns at a time, starting where the view starts */
function drawPanorama() {
    if (isHidden()) return;
    if (!camera) {
        buildWorld();
        camera = placeCamera();
    }
    const thisJob = ++drawJob;
    readColors();
    pixelSize = measurePixelSize();

    const box = panorama.parentElement.getBoundingClientRect();
    const rows = Math.max(20, Math.ceil(box.height / pixelSize));
    const visibleColumns = Math.max(40, Math.ceil(box.width / pixelSize));
    const columns = Math.round(visibleColumns * Math.PI * 2 / visibleFov);
    const focal = columns / (Math.PI * 2);
    const horizon = rows * 0.42;       // eye level a little above the middle, like the menu: hills and trees against the sky

    panoramaCanvas.width = columns * 2;          // twice, so the slide can loop without a gap
    panoramaCanvas.height = rows;
    panorama.style.setProperty("--panorama-width", columns * pixelSize + "px");
    panorama.style.setProperty("--panorama-height", rows * pixelSize + "px");
    panoramaContext.fillStyle = "rgb(" + palette[0].join(",") + ")";
    panoramaContext.fillRect(0, 0, panoramaCanvas.width, rows);

    const strip = panoramaContext.createImageData(1, rows);
    let column = 0;

    // a few ms of columns at a time, so the page stays smooth while it draws, on slow machines too
    function chunk() {
        if (thisJob !== drawJob || isHidden()) return;
        const until = performance.now() + 8;
        for (; column < columns && performance.now() < until; column++) {
            const yaw = column / columns * Math.PI * 2;
            const cos = Math.cos(yaw), sin = Math.sin(yaw);
            for (let row = 0; row < rows; row++) {
                const up = (horizon - row - 0.5) / focal;
                const length = Math.sqrt(1 + up * up);
                const result = trace(cos / length, sin / length, up / length, yaw);
                const threshold = result.flat ? 0.5 : bayer[(row & 3) * 4 + (column & 3)];
                const level = Math.max(0, Math.min(shadeLevels - 1, Math.floor(result.value * (shadeLevels - 1) + threshold)));
                const color = palette[level];
                strip.data[row * 4] = color[0];
                strip.data[row * 4 + 1] = color[1];
                strip.data[row * 4 + 2] = color[2];
                strip.data[row * 4 + 3] = 255;
            }
            panoramaContext.putImageData(strip, column, 0);
            panoramaContext.putImageData(strip, column + columns, 0);
        }
        if (column < columns) setTimeout(chunk, 0);
        else panorama.classList.add("is-ready");
    }
    chunk();
}

/* start, and redo on resize / theme change */

/* redraw when the area gets wider/narrower, or taller than what was drawn */
let drawnWidth = 0;
let drawnHeight = 0;
let redrawTimer = null;
function redrawIfResized() {
    const box = panorama.parentElement.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    if (Math.abs(box.width - drawnWidth) > 40 || box.height > drawnHeight + 2) {
        drawnWidth = box.width;
        drawnHeight = box.height;
        drawPanorama();
    }
}
function scheduleRedraw() {
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(redrawIfResized, 200);
}
if ("ResizeObserver" in window) new ResizeObserver(scheduleRedraw).observe(panorama.parentElement);
window.addEventListener("resize", scheduleRedraw);
window.addEventListener("themechange", drawPanorama);

// the turning itself is a CSS animation; pause it when the row is off screen
// it stops turning when scrolled away or behind a popup
let panoramaOnScreen = true;
if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
        panoramaOnScreen = entries[0].isIntersecting;
        panorama.classList.toggle("is-paused", !panoramaOnScreen || document.body.classList.contains("popup-open"));
    }).observe(panorama.parentElement);
}
panorama.style.setProperty("--panorama-turn", turnSeconds + "s");

redrawIfResized();
