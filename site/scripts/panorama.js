/*the title-screen panorama: a blocky world turning slowly behind the big word.
  Like the game's own menu, a full 360° view is rendered once (a ray through real block
  voxels for every pixel: grass blocks with their green-strip sides, dirt, stone, sand,
  water, oak trees, snow, clouds, a square sun or a square moon and stars) and then slid
  sideways with CSS, so turning costs nothing. It renders in chunks, so the world sweeps
  in like chunks loading. Everything is drawn in the site's own greys.*/
(function () {
    const holder = document.querySelector(".panorama");
    if (!holder) return;
    const canvas = document.createElement("canvas");
    holder.append(canvas);
    const context = canvas.getContext("2d");

    let PIXEL = 4;                    // css pixels per panorama pixel, see pixelSize()
    const VISIBLE_FOV = 1.9;          // how wide the visible part of the view is (radians)
    const TURN_SECONDS = 200;         // one full turn
    const STRENGTH = 0.62;            // how far the brightest block goes towards the text colour
    const LEVELS = 9;

    /* ---------- the world: a 3D block grid around the camera ---------- */

    const SIZE = 160;                 // blocks across
    const TALL = 48;                  // blocks high
    const WATER = 12;
    const MAX_DISTANCE = 72;

    // block ids
    const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, WATER_BLOCK = 5, LOG = 6, LEAVES = 7, SNOW = 8;

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

    const world = new Uint8Array(SIZE * SIZE * TALL);
    const at = function (x, y, z) { return (z * SIZE + y) * SIZE + x; };
    const surface = new Uint8Array(SIZE * SIZE);

    (function buildWorld() {
        const seed = 4;
        for (let y = 0; y < SIZE; y++) {
            for (let x = 0; x < SIZE; x++) {
                let n = smoothNoise(x / 34, y / 34, seed) * 0.62
                    + smoothNoise(x / 15, y / 15, seed + 1) * 0.26
                    + smoothNoise(x / 6, y / 6, seed + 2) * 0.12;
                // a few proper hills
                n = Math.pow(Math.max(0, n - 0.18) / 0.82, 1.45);
                const top = Math.min(TALL - 10, 7 + Math.floor(n * 34));
                surface[y * SIZE + x] = top;
                for (let z = 0; z <= Math.max(top, WATER - 1); z++) {
                    let block;
                    if (z > top) block = WATER_BLOCK;
                    else if (z === top) block = top >= 30 ? SNOW : top < WATER + 1 ? SAND : GRASS;
                    else if (z > top - 4) block = top < WATER + 1 ? SAND : DIRT;
                    else block = STONE;
                    // bare stone on the steep high parts
                    if (z === top && top >= 25 && top < 30 && hash(x, y, 31) < 0.5) block = STONE;
                    world[at(x, y, z)] = block;
                }
            }
        }
        // oak trees: a log and a leafy top, never in water or on rock
        for (let y = 3; y < SIZE - 3; y++) {
            for (let x = 3; x < SIZE - 3; x++) {
                const ground = surface[y * SIZE + x];
                if (world[at(x, y, ground)] !== GRASS || hash(x, y, 77) > 0.011) continue;
                const trunk = 4 + Math.floor(hash(x, y, 78) * 2);
                for (let z = ground + 1; z <= ground + trunk; z++) world[at(x, y, z)] = LOG;
                for (let dz = trunk - 1; dz <= trunk + 2; dz++) {
                    const radius = dz < trunk + 1 ? 2 : 1;
                    for (let dy = -radius; dy <= radius; dy++) {
                        for (let dx = -radius; dx <= radius; dx++) {
                            const corner = Math.abs(dx) === radius && Math.abs(dy) === radius;
                            if (corner && (radius === 1 || hash(x + dx, y + dy, dz) < 0.6)) continue;
                            const z = ground + dz;
                            if (z >= TALL) continue;
                            const i = at(x + dx, y + dy, z);
                            if (world[i] === AIR) world[i] = LEAVES;
                        }
                    }
                }
            }
        }
    })();

    // the camera stands on a hill near the middle, a few blocks up
    const camera = (function () {
        let best = { x: SIZE / 2, y: SIZE / 2, score: -1 };
        for (let y = SIZE / 2 - 14; y < SIZE / 2 + 14; y++) {
            for (let x = SIZE / 2 - 14; x < SIZE / 2 + 14; x++) {
                const top = surface[y * SIZE + x];
                const score = top >= WATER + 3 && top <= WATER + 10 ? top + hash(x, y, 5) : -1;
                if (score > best.score) best = { x, y, score };
            }
        }
        // no tree in its face: clear logs and leaves close by
        for (let z = 0; z < TALL; z++) {
            for (let y = best.y - 8; y <= best.y + 8; y++) {
                for (let x = best.x - 8; x <= best.x + 8; x++) {
                    const i = at(x, y, z);
                    if ((world[i] === LOG || world[i] === LEAVES) && (x - best.x) ** 2 + (y - best.y) ** 2 < 64) world[i] = AIR;
                }
            }
        }
        return { x: best.x + 0.5, y: best.y + 0.5, z: surface[best.y * SIZE + best.x] + 8.6 };
    })();

    /* ---------- how a block face looks (0 = background, 1 = brightest) ---------- */

    const FACE_LIGHT = [0.66, 0.82, 1, 0.5]; // x sides, y sides, top, bottom

    function texture(block, face, u, v) {
        const tu = Math.floor(u * 8), tv = Math.floor(v * 8);
        const grain = (hash(tu, tv, block * 8 + face) - 0.5) * 0.6;
        const top = face === 2;
        switch (block) {
            case GRASS:
                if (top) return 0.8 + grain * 0.12;
                return v > 0.8 ? 0.76 + grain * 0.1 : (v > 0.68 && hash(tu, 0, 9) < 0.5 ? 0.74 : 0.47 + grain * 0.1);
            case DIRT: return 0.47 + grain * 0.12;
            case STONE: return 0.58 + grain * 0.16;
            case SAND: return 0.74 + grain * 0.08;
            case WATER_BLOCK: return 0.3 + (hash(tu, Math.floor(v * 3), 2) < 0.2 ? 0.08 : 0);
            case LOG: return top ? 0.55 : 0.32 + (tu % 3 === 0 ? -0.06 : 0) + grain * 0.05;
            case LEAVES: return hash(tu, tv, face + 40) < 0.14 ? 0.36 : 0.56 + grain * 0.12;
            case SNOW: return top || v > 0.75 ? 0.96 : 0.58 + grain * 0.16;
        }
        return 0.5;
    }

    /* ---------- tracing ---------- */

    let night = false;

    function skyValue(dz, yaw) {
        const elevation = Math.asin(Math.max(-1, Math.min(1, dz)));
        const value = (night ? 0.03 : 0.1) + Math.max(0, 0.16 - elevation * 0.5);
        // the square sun / moon
        const bodyYaw = night ? 2.3 : 0.8;
        const offset = ((yaw - bodyYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const size = 0.085;
        if (Math.abs(offset) < size && Math.abs(elevation - 0.18) < size) {
            const crater = night && ((offset > size * 0.2 && elevation > 0.18 + size * 0.2) || (offset < -size * 0.4 && elevation < 0.18 - size * 0.3));
            return { value: crater ? 0.6 : 0.99, flat: true };
        }
        if (night && elevation > 0.04 && hash(Math.floor(yaw * 160), Math.floor(elevation * 160), 12) < 0.012) {
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

        while (t < MAX_DISTANCE) {
            if (maxX < maxY && maxX < maxZ) { x += stepX; t = maxX; maxX += deltaX; face = 0; }
            else if (maxY < maxZ) { y += stepY; t = maxY; maxY += deltaY; face = 1; }
            else { z += stepZ; t = maxZ; maxZ += deltaZ; face = dz < 0 ? 2 : 3; }

            if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || z < 0) break;
            if (z >= TALL) {
                if (dz > 0) break;
                continue;
            }
            const block = world[at(x, y, z)];
            if (block === AIR) continue;

            const hx = camera.x + dx * t, hy = camera.y + dy * t, hz = camera.z + dz * t;
            let u, v;
            if (face === 0) { u = hy - Math.floor(hy); v = hz - Math.floor(hz); }
            else if (face === 1) { u = hx - Math.floor(hx); v = hz - Math.floor(hz); }
            else { u = hx - Math.floor(hx); v = hy - Math.floor(hy); }

            let lit = texture(block, face, u, v) * FACE_LIGHT[face];
            // on a light page, light faces stay close to the paper and shadows get ink
            if (!night) lit = 0.08 + (1 - lit) * 0.78;
            const fog = Math.min(1, Math.pow(Math.max(0, t - 14) / (MAX_DISTANCE - 14), 1.15));
            const haze = night ? 0.12 : 0.16;
            return { value: lit * (1 - fog) + haze * fog, flat: fog < 0.3 };
        }

        // nothing hit: clouds, then sky
        if (dz > 0.02) {
            const distance = 18 / dz;
            const cx = Math.floor((camera.x + dx * distance) / 10), cy = Math.floor((camera.y + dy * distance) / 10);
            if (distance < 260 && smoothNoise(cx * 0.5, cy * 0.5, 21) > (night ? 0.7 : 0.62)) {
                const fade = Math.min(1, distance / 260);
                return { value: (night ? 0.42 : 0.3) * (1 - fade) + 0.16 * fade, flat: fade < 0.4 };
            }
        }
        return skyValue(dz, yaw);
    }

    /* ---------- the panorama image ---------- */

    const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(function (b) { return (b + 0.5) / 16; });
    let palette = [];
    let job = 0;

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
        palette = [];
        for (let level = 0; level < LEVELS; level++) {
            const amount = level / (LEVELS - 1) * STRENGTH;
            palette.push(background.map(function (channel, c) { return Math.round(channel + (foreground[c] - channel) * amount); }));
        }
        night = matchMedia("(prefers-color-scheme: dark)").matches;
    }

    /* 4 css px per panorama pixel at the designed 16 px text size (3 on phones), scaled with the
       page so Windows display scaling doesn't change the look, then rounded to whole device
       pixels so the blocks stay sharp at 125 % / 150 % too */
    function pixelSize() {
        const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const css = (innerWidth < 760 ? 3 : 4) * root / 16;
        const ratio = devicePixelRatio || 1;
        return Math.max(1, Math.round(css * ratio)) / ratio;
    }

    /* renders the whole 360° strip, a chunk of columns at a time, starting where the view starts */
    function render() {
        const thisJob = ++job;
        readColors();
        PIXEL = pixelSize();

        const box = holder.parentElement.getBoundingClientRect();
        const rows = Math.max(20, Math.ceil(box.height / PIXEL));
        const visibleColumns = Math.max(40, Math.ceil(box.width / PIXEL));
        const columns = Math.round(visibleColumns * Math.PI * 2 / VISIBLE_FOV);
        const focal = columns / (Math.PI * 2);
        const horizon = rows * 0.32;

        canvas.width = columns * 2;          // twice, so the slide can loop without a gap
        canvas.height = rows;
        holder.style.setProperty("--panorama-width", columns * PIXEL + "px");
        holder.style.setProperty("--panorama-height", rows * PIXEL + "px");
        context.fillStyle = "rgb(" + palette[0].join(",") + ")";
        context.fillRect(0, 0, canvas.width, rows);

        const strip = context.createImageData(1, rows);
        let column = 0;
        const CHUNK = 12;

        function chunk() {
            if (thisJob !== job) return;
            const until = Math.min(columns, column + CHUNK);
            for (; column < until; column++) {
                const yaw = column / columns * Math.PI * 2;
                const cos = Math.cos(yaw), sin = Math.sin(yaw);
                for (let row = 0; row < rows; row++) {
                    const up = (horizon - row - 0.5) / focal;
                    const length = Math.sqrt(1 + up * up);
                    const result = trace(cos / length, sin / length, up / length, yaw);
                    const threshold = result.flat ? 0.5 : BAYER[(row & 3) * 4 + (column & 3)];
                    const level = Math.max(0, Math.min(LEVELS - 1, Math.floor(result.value * (LEVELS - 1) + threshold)));
                    const color = palette[level];
                    strip.data[row * 4] = color[0];
                    strip.data[row * 4 + 1] = color[1];
                    strip.data[row * 4 + 2] = color[2];
                    strip.data[row * 4 + 3] = 255;
                }
                context.putImageData(strip, column, 0);
                context.putImageData(strip, column + columns, 0);
            }
            if (column < columns) setTimeout(chunk, 0);
            else holder.classList.add("is-ready");
        }
        chunk();
    }

    /* ---------- start, and redo on resize / theme change ---------- */

    let lastWidth = 0;
    let resizeTimer = null;
    addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            const width = holder.parentElement.getBoundingClientRect().width;
            if (Math.abs(width - lastWidth) > 40) {
                lastWidth = width;
                render();
            }
        }, 250);
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);

    // the turning itself is a CSS animation; pause it when the row is off screen
    if ("IntersectionObserver" in window) {
        new IntersectionObserver(function (entries) {
            holder.classList.toggle("is-paused", !entries[0].isIntersecting);
        }).observe(holder.parentElement);
    }
    holder.style.setProperty("--panorama-turn", TURN_SECONDS + "s");

    lastWidth = holder.parentElement.getBoundingClientRect().width;
    render();
})();
