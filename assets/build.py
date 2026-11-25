"""python3 assets/build.py -> rebuilds the animated SVGs for this README, in a dark and a light version
(and a narrow one for phones). Same building blocks as the GitHub profile README, with the site's
Minecraft touches: the pixel fonts, the DS logo drawn in blocks, and the block world under the marquee.

Animations are SMIL (<animate>/<set>) plus a little CSS, which GitHub renders inside <img>.
The fonts (Monocraft and Pixelify Sans, both SIL OFL) are embedded, because an <img> can't load any.
Monospace text uses textLength, so every character is exactly CW wide whatever font ends up drawing it,
and the typed text, the clip and the cursor always line up.

Needs only Python 3. Inputs live in assets/src/ (font subsets and the panorama bands).
"""

import base64
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "src"
OUT = HERE

THEMES = {
    "dark": dict(bg="#040507", fg="#ffffff", text="#AEB5B8", dim="#7d8589", line="#525252", soft="#1c1c1c", echo="#AEB5B8"),
    "light": dict(bg="#e4e4e4", fg="#1a1a1a", text="#3a3a3a", dim="#6a6a6a", line="#6f6f6f", soft="#f6f6f6", echo="#6f6f6f"),
}


def b64(name):
    return base64.b64encode((SRC / name).read_bytes()).decode()


# the site's fonts, embedded once per SVG (ASCII only, a few KB each)
FONTS = (
    f"@font-face{{font-family:Mono;font-weight:400;src:url(data:font/woff2;base64,{b64('monocraft-regular.woff2')}) format('woff2')}}"
    f"@font-face{{font-family:Mono;font-weight:700;src:url(data:font/woff2;base64,{b64('monocraft-bold.woff2')}) format('woff2')}}"
    f"@font-face{{font-family:Pix;font-weight:700;src:url(data:font/woff2;base64,{b64('pixelify-sans-700.woff2')}) format('woff2')}}"
)
MONO = "Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"
DISPLAY = "Pix, 'Arial Black', 'Helvetica Neue', Arial, sans-serif"

# the DS dot matrix from the contact and profile banners, drawn here as blocks
DOTS = [
    (99, 115), (117, 115), (135, 115), (153, 115), (225, 115), (243, 115), (261, 115), (279, 115),
    (99, 133), (117, 133), (153, 133), (171, 133), (207, 133), (225, 133),
    (99, 151), (117, 151), (171, 151), (207, 151), (225, 151), (243, 151), (261, 151),
    (99, 169), (117, 169), (171, 169), (225, 169), (243, 169), (261, 169), (279, 169),
    (99, 187), (117, 187), (171, 187), (261, 187), (279, 187),
    (99, 205), (117, 205), (135, 205), (153, 205), (207, 205), (225, 205), (243, 205), (261, 205),
]


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def mono_text(x, y, s, size, cw, fill, extra=""):
    """Monospace text forced to len(s) * cw wide."""
    return (f'<text x="{x}" y="{y}" font-family="{MONO}" font-size="{size}" fill="{fill}" '
            f'textLength="{len(s) * cw:.1f}" lengthAdjust="spacingAndGlyphs" xml:space="preserve"{extra}>{esc(s)}</text>')


def discrete(attr, frames, dur, extra=""):
    """frames: list of (time_s, value) starting at 0 -> one discrete SMIL animation over dur."""
    times = ";".join(f"{t / dur:.5f}" for t, _ in frames)
    values = ";".join(str(v) for _, v in frames)
    return (f'<animate attributeName="{attr}" dur="{dur}s" repeatCount="indefinite" '
            f'calcMode="discrete" keyTimes="{times}" values="{values}"{extra}/>')


def clean(frames):
    """Sort, drop duplicate times (keep last) and make sure the list starts at 0."""
    out = {}
    for t, v in sorted(frames, key=lambda f: f[0]):
        out[round(t, 4)] = v
    items = sorted(out.items())
    if items[0][0] != 0:
        items.insert(0, (0, items[0][1]))
    return items


def blink(dur="1s"):
    return f'<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.5;0.5;1" dur="{dur}" repeatCount="indefinite" calcMode="discrete"/>'


def typing(commands, tx, py, cw, size, fill, cursor_fill, idp):
    """The prompt that types a command, holds it, deletes it and moves on (like the sites' tab title)."""
    windows, now = [], 0.0
    for cmd in commands:
        windows.append((now, cmd))
        now += len(cmd) * TYPE + HOLD + len(cmd) * DELETE + GAP
    cycle = round(now, 2)
    parts, cursor_frames = [], [(0, tx)]
    for i, (start, cmd) in enumerate(windows):
        n = len(cmd)
        frames = [(0, 0)] + [(start + k * TYPE, k * cw) for k in range(1, n + 1)]
        held = start + n * TYPE + HOLD
        frames += [(held + (n - k) * DELETE, k * cw) for k in range(n - 1, -1, -1)]
        cursor_frames += [(ft, tx + w) for ft, w in frames[1:]]
        frames = clean(frames)
        parts.append(f'<clipPath id="{idp}{i}"><rect x="{tx}" y="{py - size * 1.15:.1f}" width="0" height="{size * 1.6:.1f}">'
                     f'{discrete("width", frames, cycle)}</rect></clipPath>'
                     f'<g clip-path="url(#{idp}{i})">{mono_text(tx, py, cmd, size, cw, fill)}</g>')
    cursor = (f'<rect x="{tx}" y="{py - size * .85:.1f}" width="{cw * .9:.1f}" height="{size * 1.08:.1f}" fill="{cursor_fill}">'
              f'{discrete("x", clean(cursor_frames), cycle)}{blink()}</rect>')
    return "".join(parts) + cursor


def world_band(theme, y, h, W, mobile=False):
    """The site's block world, sliding slowly under the marquee (two copies, so the loop has no seam)."""
    name = f"band-m-{theme}.png" if mobile else f"band-{theme}.png"
    data = b64(name)
    bw = 3968
    img = lambda x: f'<image href="data:image/png;base64,{data}" x="{x}" y="{y}" width="{bw}" height="{h}" preserveAspectRatio="none" style="image-rendering:pixelated"/>'
    return (f'<g opacity=".9">{img(0)}{img(bw)}'
            f'<animateTransform attributeName="transform" type="translate" from="0 0" to="{-bw} 0" dur="240s" repeatCount="indefinite"/></g>')


def marquee_row(t, theme, W, split, H, mobile=False):
    msize, mcw = 22, 13.2
    phrase_w = len(MARQUEE) * mcw
    reps = int(W * 2 / phrase_w) + 2
    my = split + (H - split) / 2 + 8
    halo = f' stroke="{t["bg"]}" stroke-width="5" stroke-linejoin="round" paint-order="stroke"'
    text = "".join(mono_text(f"{20 + r * phrase_w:.1f}", f"{my:.1f}", MARQUEE, msize, mcw, t["fg"], halo) for r in range(reps))
    cid = "mmq" if mobile else "mq"
    return (f'<clipPath id="{cid}"><rect x="1" y="{split + .5}" width="{W - 2}" height="{H - split - 1.5}"/></clipPath>'
            f'<g clip-path="url(#{cid})">{world_band(theme, split, H - split, W, mobile)}'
            f'<g>{text}<animateTransform attributeName="transform" type="translate" from="0 0" to="{-phrase_w:.1f} 0" '
            f'dur="{phrase_w / 60:.2f}s" repeatCount="indefinite"/></g></g>')


# ---------------------------------------------------------------- banner

PROMPT = "dias@mc:~$ "
# in-game commands, typed and deleted like the tab title on the sites
COMMANDS = ["/list", "/ping --all", "/whitelist add you", "/time set day", "/msg dias hi"]
TYPE, DELETE, HOLD, GAP = 0.11, 0.055, 1.8, 0.45
MARQUEE = "ONLINE * SURVIVAL * ANARCHY * WHITELISTED * JAVA + BEDROCK * ASK TO JOIN * "
TITLE = "DS Network"


def banner(t, theme):
    W, H = 1200, 400
    split = 320
    cw, size = 15.6, 26
    px, py = 390, 92
    ty = 202
    tx = px + len(PROMPT) * cw

    # the DS logo in blocks: they pop in along the diagonal, then flicker now and then
    blocks = []
    for i, (x, y) in enumerate(DOTS):
        delay = 0.15 + ((x - 99) + (y - 115)) / 900
        flick = 3 + (i * 7919 % 97) / 97 * 9
        blocks.append(f'<rect class="d" x="{x - 8}" y="{y - 8}" width="16" height="16" style="animation-delay:{delay:.2f}s,{flick:.2f}s"/>')
    block_css = f"""
      .d {{ fill: {t['fg']}; transform-box: fill-box; transform-origin: center;
            animation: pop .45s cubic-bezier(.3,1.6,.5,1) both, flick 9s steps(1) infinite; }}
      @keyframes pop {{ from {{ transform: scale(0); }} to {{ transform: scale(1); }} }}
      @keyframes flick {{ 0%, 93%, 100% {{ opacity: 1; }} 94% {{ opacity: .15; }} 96% {{ opacity: 1; }} 97% {{ opacity: .3; }} }}
    """

    # the title in the pixel font, with two sliced echoes that glitch sideways every few seconds
    tattr = f'font-family="{DISPLAY}" font-size="86" font-weight="700"'
    title_svg = f"""
    <clipPath id="sliceA"><rect x="380" y="140" width="760" height="20"/></clipPath>
    <clipPath id="sliceB"><rect x="380" y="174" width="760" height="14"/></clipPath>
    <text x="386" y="{ty}" {tattr} fill="{t['fg']}" class="title">{TITLE}</text>
    <g clip-path="url(#sliceA)"><rect class="echoA" x="380" y="140" width="760" height="20" fill="{t['bg']}"/><text class="echoA" x="386" y="{ty}" {tattr} fill="{t['echo']}">{TITLE}</text></g>
    <g clip-path="url(#sliceB)"><rect class="echoB" x="380" y="174" width="760" height="14" fill="{t['bg']}"/><text class="echoB" x="386" y="{ty}" {tattr} fill="{t['fg']}">{TITLE}</text></g>
    """
    title_css = """
      .title { animation: rise .8s .3s cubic-bezier(.2,.8,.2,1) both; }
      @keyframes rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
      .echoA, .echoB { opacity: 0; }
      .echoA { animation: glitchA 5s 2s steps(1) infinite; }
      .echoB { animation: glitchB 5s 2s steps(1) infinite; }
      @keyframes glitchA { 0%, 100% { opacity: 0; transform: none; } 80% { opacity: 1; transform: translateX(14px); } 83% { opacity: 1; transform: translateX(-9px); } 86% { opacity: 1; transform: translateX(5px); } 88% { opacity: 0; transform: none; } }
      @keyframes glitchB { 0%, 100% { opacity: 0; transform: none; } 81% { opacity: 1; transform: translateX(-16px); } 84% { opacity: 1; transform: translateX(10px); } 87% { opacity: 0; transform: none; } }
      .sub { animation: rise .7s 1s cubic-bezier(.2,.8,.2,1) both; }
    """
    sub = [
        mono_text(390, 250, "minecraft network · status + whitelist", 24, 14.4, t["text"]),
        mono_text(390, 286, "java + bedrock · velocity · fabric", 24, 14.4, t["text"]),
    ]

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W + 10} {H + 10}" role="img" aria-label="DS Network - Minecraft server status and whitelist">
  <style>{FONTS}{block_css}{title_css}</style>
  <rect x="9.5" y="9.5" width="{W}" height="{H}" fill="{t['line']}"/>
  <rect x="0.5" y="0.5" width="{W - 1}" height="{H - 1}" fill="{t['bg']}" stroke="{t['line']}"/>
  <line x1="0" y1="{split}" x2="{W}" y2="{split}" stroke="{t['line']}"/>
  <line x1="340" y1="40" x2="340" y2="{split - 40}" stroke="{t['line']}"/>
  <g>{''.join(blocks)}</g>
  {mono_text(px, py, PROMPT, size, cw, t['text'])}
  {typing(COMMANDS, tx, py, cw, size, t['fg'], t['text'], 'cmd')}
  {title_svg}
  <g class="sub">{''.join(sub)}</g>
  {marquee_row(t, theme, W, split, H)}
</svg>
"""


# ---------------------------------------------------------------- terminal

SESSION = [
    ("$", "/list"),
    (">", "There are 7 of a max of 20 players online: Alex_Builds, .Moss_Golem, ..."),
    ("$", "/ping --all"),
    (">", "DS Network 4ms · survival 3ms · survival-old 3ms · anarchy 3ms"),
    ("$", "/whitelist add .Pixel_Fox"),
    (">", "Added .Pixel_Fox to the whitelist"),
    ("$", "ls ~/mc-site"),
    ("dir", "site/  api/  velocity-plugin/  server/"),
    ("$", "/msg dias can i join?"),
    (">", "ask at join.errornoslash.be, he gets a ping"),
]


def terminal(t, session=None, W=1200, cw=14.4, size=24, lh=42, top=96, left=36, bar=44, bs=1.0):
    SESSION_ = session or SESSION
    H = top + len(SESSION_) * lh + lh + 16
    TYPE_T, PAUSE, OUT_PAUSE, END_HOLD = 0.07, 0.35, 0.5, 6.0

    events, now = [], 0.9
    for kind, s in SESSION_:
        events.append((kind, s, now))
        now += len(s) * TYPE_T + PAUSE if kind == "$" else OUT_PAUSE
    final_prompt_t = now
    cycle = round(now + END_HOLD, 2)

    lines = []
    cursor_x, cursor_y = [(0, left + 2 * cw)], [(0, top - size * .83)]
    for i, (kind, s, start) in enumerate(events):
        y = top + i * lh
        if kind == "$":
            x0 = left + 2 * cw
            frames = clean([(0, 0)] + [(start + k * TYPE_T, k * cw) for k in range(1, len(s) + 1)])
            show = clean([(0, "hidden"), (start, "visible")])
            lines.append(
                f'<g visibility="hidden">{discrete("visibility", show, cycle)}'
                f'{mono_text(left, y, "$", size, cw, t["text"])}</g>'
                f'<clipPath id="t{i}"><rect x="{x0}" y="{y - size * 1.1:.1f}" width="0" height="{size * 1.5:.1f}">{discrete("width", frames, cycle)}</rect></clipPath>'
                f'<g clip-path="url(#t{i})">{mono_text(x0, y, s, size, cw, t["fg"])}</g>'
            )
            cursor_x += [(start, x0)] + [(ft, x0 + w) for ft, w in frames[1:]]
            cursor_y += [(start, y - size * .83)]
        else:
            show = clean([(0, "hidden"), (start, "visible")])
            color = t["fg"] if kind == "dir" else t["text"]
            weight = ' font-weight="700"' if kind == "dir" else ""
            lines.append(f'<g visibility="hidden">{discrete("visibility", show, cycle)}'
                         f'{mono_text(left, y, s, size, cw, color, weight)}</g>')
    fy = top + len(events) * lh
    show = clean([(0, "hidden"), (final_prompt_t, "visible")])
    lines.append(f'<g visibility="hidden">{discrete("visibility", show, cycle)}{mono_text(left, fy, "$", size, cw, t["text"])}</g>')
    cursor_x += [(final_prompt_t, left + 2 * cw)]
    cursor_y += [(final_prompt_t, fy - size * .83)]

    cursor = (f'<rect x="{left + 2 * cw}" y="{top - size * .83:.1f}" width="{cw * 0.9:.1f}" height="{size * 1.08:.1f}" fill="{t["text"]}">'
              f'{discrete("x", clean(cursor_x), cycle)}{discrete("y", clean(cursor_y), cycle)}{blink()}</rect>')

    title = "dias@mc: ~"
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" role="img" aria-label="A terminal: /list, /ping, /whitelist add, the repo and how to ask to join">
  <style>{FONTS}</style>
  <rect x="9.5" y="9.5" width="{W - 10}" height="{H - 10}" fill="{t['line']}"/>
  <rect x="0.5" y="0.5" width="{W - 10}" height="{H - 10}" fill="{t['bg']}" stroke="{t['line']}"/>
  <rect x="0.5" y="0.5" width="{W - 10}" height="{bar}" fill="{t['soft']}" stroke="{t['line']}"/>
  <g fill="none" stroke="{t['text']}" stroke-width="1.5">
    <rect x="{20 * bs}" y="{bar / 2 - 5.5 * bs:.1f}" width="{11 * bs}" height="{11 * bs}"/><rect x="{42 * bs}" y="{bar / 2 - 5.5 * bs:.1f}" width="{11 * bs}" height="{11 * bs}"/><rect x="{64 * bs}" y="{bar / 2 - 5.5 * bs:.1f}" width="{11 * bs}" height="{11 * bs}"/>
  </g>
  {mono_text((W - 10) / 2 - len(title) * 5.4 * bs, bar / 2 + 6 * bs, title, 17 * bs, 10.8 * bs, t['text'])}
  {''.join(lines)}
  {cursor}
</svg>
"""


# ---------------------------------------------------------------- static pieces
# lighter than the banner: they rise in once, only the cursors keep blinking

RISE = """
  .rise { animation: rise .7s cubic-bezier(.2,.8,.2,1) both; }
  @keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
"""


def blink_cursor(x, y, w, h, fill):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}">{blink()}</rect>'


def window(t, W, H, title, body, label, shadow=10, bar=44, right="", vbw=None, ox=0, bs=1.0):
    """A window like the terminal: title bar, three square buttons (blocks, not rings), hard shadow."""
    w, h = W - shadow, H - shadow
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vbw or W} {H}" role="img" aria-label="{esc(label)}">
  <style>{FONTS}{RISE}</style>
  <g transform="translate({ox} 0)"><g class="rise">
  <rect x="{shadow - .5}" y="{shadow - .5}" width="{w}" height="{h}" fill="{t['line']}"/>
  <rect x="0.5" y="0.5" width="{w - 1}" height="{h - 1}" fill="{t['bg']}" stroke="{t['line']}"/>
  <rect x="0.5" y="0.5" width="{w - 1}" height="{bar}" fill="{t['soft']}" stroke="{t['line']}"/>
  <g fill="none" stroke="{t['text']}" stroke-width="1.5">
    <rect x="{20 * bs}" y="{bar / 2 - 5.5 * bs:.1f}" width="{11 * bs}" height="{11 * bs}"/><rect x="{42 * bs}" y="{bar / 2 - 5.5 * bs:.1f}" width="{11 * bs}" height="{11 * bs}"/><rect x="{64 * bs}" y="{bar / 2 - 5.5 * bs:.1f}" width="{11 * bs}" height="{11 * bs}"/>
  </g>
  {mono_text(w / 2 - len(title) * 5.4 * bs, bar / 2 + 6 * bs, title, 17 * bs, 10.8 * bs, t['text'])}
  {right}
  {body}
  </g></g>
</svg>
"""


PAGES = [
    ("01", "join", "join.errornoslash.be", "the status, and the form to ask to join", "site/index.html"),
    ("02", "admin", "join.errornoslash.be/admin.html", "approve, deny, switch the whitelist on", "site/admin.html"),
    ("03", "api", "mc-api.errornoslash.be", "server pings, requests, ntfy pushes", "api/"),
    ("04", "plugin", "built by github actions", "checks every login at the proxy", "velocity-plugin/"),
]


def page_card(t, num, name, url, desc, src, side="left"):
    W, H = 595, 300
    num_svg = mono_text(W - 10 - 22 - len(num) * 12, 28, num, 20, 12, t["fg"], ' font-weight="700"')
    acw = min(12.6, (W - 10 - 64) / (len(url) + 2))
    body = [
        f'<text x="30" y="128" font-family="{DISPLAY}" font-size="72" font-weight="700" fill="{t["fg"]}">{name}</text>',
        mono_text(32, 172, url + " ↗", acw / .6, acw, t["fg"]),
        mono_text(32, 208, desc, 18, 10.8, t["text"]),
        f'<line x1="30" y1="232" x2="{W - 40}" y2="232" stroke="{t["line"]}" stroke-dasharray="4 6"/>',
        mono_text(32, 264, "src  " + src, 17, 10.2, t["text"]),
    ]
    return window(t, W, H, f"~/mc-site/{name}", "".join(body), f"{name}: {desc}", right=num_svg, vbw=600, ox=0 if side == "left" else 5)


def text_window(t, title, rows, label, cursor_prompt=True, W=1200, cw=14.4, size=24, lh=42, gap=14, top=96, left=36, keychars=13, bar=44, bs=1.0):
    """rows: (kind, value).
    '$' command (dim prompt, bright command)   '$link' the same, underlined
    '#' comment (dim)                          'kv' (key, value): key, dotted leader, bright value
    """
    keycol = keychars * cw
    out, y = [], top
    for i, (kind, val) in enumerate(rows):
        if kind.startswith("$") and i > 0:
            y += gap
        if kind.startswith("$"):
            out.append(mono_text(left, y, "$", size, cw, t["dim"]))
            out.append(mono_text(left + 2 * cw, y, val, size, cw, t["fg"]))
            if kind == "$link":
                x0 = left + 2 * cw + val.index(" ") * cw + cw
                x1 = left + 2 * cw + len(val.rstrip(" ↗")) * cw
                out.append(f'<line x1="{x0:.1f}" y1="{y + 6}" x2="{x1:.1f}" y2="{y + 6}" stroke="{t["fg"]}" stroke-width="1.5"/>')
        elif kind == "kv":
            k, v = val
            out.append(mono_text(left, y, k, size, cw, t["text"]))
            out.append(f'<line x1="{left + len(k) * cw + 10:.1f}" y1="{y - 7}" x2="{left + keycol - 14:.1f}" y2="{y - 7}" '
                       f'stroke="{t["dim"]}" stroke-width="2" stroke-dasharray="1.5 7" stroke-linecap="round"/>')
            out.append(mono_text(left + keycol, y, v, size, cw, t["fg"]))
        elif kind == "#":
            out.append(mono_text(left, y, val, size, cw, t["dim"], ' font-style="italic"'))
        else:
            out.append(mono_text(left, y, val, size, cw, t["text"]))
        y += lh
    if cursor_prompt:
        y += gap
        out.append(mono_text(left, y, "$", size, cw, t["dim"]))
        out.append(blink_cursor(left + 2 * cw, y - size * .83, cw * .9, size * 1.08, t["text"]))
        y += lh
    H = y - lh + 40 + 10
    return window(t, W, H, title, "".join(out), label, bar=bar, bs=bs)


def how_it_works(t):
    rows = [
        ("$", "cat how-it-works.md"),
        ("#", "# whitelisted at the proxy, managed from the site"),
        ("kv", ("site", "github pages · live status + the request form")),
        ("kv", ("api", "node 26 · no dependencies · pings every server")),
        ("kv", ("plugin", "velocity 4 · checks every login, kicks the removed")),
        ("kv", ("alerts", "ntfy · approve or deny straight from the push")),
        ("$link", "open join.errornoslash.be ↗"),
    ]
    return text_window(t, "dias@mc: ~/mc-site", rows, "How it works: the site, the API, the Velocity plugin and ntfy alerts")


def server_properties(t):
    rows = [
        ("$", "cat server.properties"),
        ("kv", ("address", "mc.errornoslash.be")),
        ("kv", ("bedrock", "mc.errornoslash.be · port 19132")),
        ("kv", ("servers", "survival · survival-old · anarchy")),
        ("kv", ("white-list", "true · ask at join.errornoslash.be")),
    ]
    return text_window(t, "dias@mc: ~", rows, "server.properties: the address, the Bedrock port, the servers and how to get whitelisted")


LINKS = [
    ("join", "join ↗"),
    ("admin", "admin ↗"),
    ("plugin", "plugin ↗"),
    ("status", "status.json ↗"),
]

FOOTER = [
    ("copy", "©Dias Stas"),
    ("website", "website ↗"),
    ("blog", "blog ↗"),
    ("contact", "contact ↗"),
    ("gitlab", "gitlab ↗"),
    ("mastodon", "mastodon ↗"),
]


def pill(t, text, inverted=False):
    cw, size, pad, sh = 13.2, 22, 22, 5
    w = len(text) * cw + pad * 2
    H = 56 + sh
    W = w + sh
    face, ink = (t["fg"], t["bg"]) if inverted else (t["bg"], t["fg"])
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} {H}" role="img" aria-label="{esc(text)}">
  <style>{FONTS}{RISE}</style>
  <g class="rise">
  <rect x="{sh - .5}" y="{sh - .5}" width="{w:.1f}" height="56" fill="{t['line']}"/>
  <rect x="0.5" y="0.5" width="{w - 1:.1f}" height="55" fill="{face}" stroke="{t['line']}"/>
  {mono_text(pad, 36, text, size, cw, ink, ' font-weight="700"' if inverted else '')}
  </g>
</svg>
"""


MOTD = "A small Minecraft network. Whitelisted: ask on the site to get in."


def motd(t):
    """The tagline under the banner: a bordered row with a `$ cat motd` cell."""
    W, sh = 1200, 10
    w, h = W - sh, 84
    cw, size = 14.4, 24
    cell = 236
    label = "$ cat motd"
    tx = cell + 24
    tw = len(MOTD) * cw
    top = 34
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {h + sh + top}" role="img" aria-label="{esc(MOTD)}">
  <style>{FONTS}{RISE}</style>
  <g transform="translate(0 {top})"><g class="rise">
  <rect x="{sh - .5}" y="{sh - .5}" width="{w}" height="{h}" fill="{t['line']}"/>
  <rect x="0.5" y="0.5" width="{w - 1}" height="{h - 1}" fill="{t['bg']}" stroke="{t['line']}"/>
  <rect x="0.5" y="0.5" width="{cell}" height="{h - 1}" fill="{t['soft']}" stroke="{t['line']}"/>
  {mono_text(26, h / 2 + 8, label, size, cw, t['text'])}
  {blink_cursor(26 + len(label) * cw + 6, h / 2 - 12, cw * .9, 26, t['text'])}
  {mono_text(tx, h / 2 + 8, MOTD, size, cw * min(1, (w - tx - 24) / tw), t['fg'], ' font-weight="700"')}
  </g></g>
</svg>
"""


# ---------------------------------------------------------------- phone layouts
# 600 wide instead of 1200, so on a phone everything is drawn about twice as large.
# GitHub swaps them in with <source media="(max-width: 600px)">.

MW = 600
M = dict(W=MW, cw=13.2, size=22, lh=38, top=88, left=26, bar=50, bs=1.3)

SESSION_M = [
    ("$", "/list"),
    (">", "7 of 20 online: Alex_Builds, ..."),
    ("$", "/ping --all"),
    (">", "DS Network 4ms · survival 3ms"),
    ("$", "/whitelist add .Pixel_Fox"),
    (">", "Added .Pixel_Fox to the whitelist"),
    ("$", "ls ~/mc-site"),
    ("dir", "site/  api/  plugin/  server/"),
    ("$", "/msg dias can i join?"),
    (">", "ask at join.errornoslash.be"),
]


def terminal_m(t):
    return terminal(t, session=SESSION_M, **M)


def how_it_works_m(t):
    rows = [
        ("$", "cat how-it-works.md"),
        ("#", "# whitelisted at the proxy"),
        ("kv", ("site", "github pages")),
        ("kv", ("api", "node 26, no deps")),
        ("kv", ("plugin", "velocity 4")),
        ("kv", ("alerts", "ntfy push")),
        ("$link", "open join.errornoslash.be ↗"),
    ]
    return text_window(t, "~/mc-site", rows, "How it works", keychars=8, gap=12, **M)


def server_properties_m(t):
    rows = [
        ("$", "cat server.properties"),
        ("kv", ("address", "mc.errornoslash.be")),
        ("kv", ("bedrock", "port 19132")),
        ("kv", ("servers", "survival · anarchy")),
        ("kv", ("whitelist", "ask on the site")),
    ]
    return text_window(t, "dias@mc: ~", rows, "server.properties", keychars=11, gap=12, **M)


def motd_m(t):
    W, sh, top = MW, 8, 22
    w = W - sh
    lines = ["A small Minecraft network.", "Whitelisted: ask on the", "site to get in."]
    cw, size, lh = 15.6, 26, 40
    head = 60
    h = head + 26 + len(lines) * lh
    label = "$ cat motd"
    body = "".join(mono_text(26, head + 22 + (i + 1) * lh - 10, ln, size, cw, t["fg"], ' font-weight="700"') for i, ln in enumerate(lines))
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {h + sh + top}" role="img" aria-label="{esc(MOTD)}">
  <style>{FONTS}{RISE}</style>
  <g transform="translate(0 {top})"><g class="rise">
  <rect x="{sh - .5}" y="{sh - .5}" width="{w}" height="{h}" fill="{t['line']}"/>
  <rect x="0.5" y="0.5" width="{w - 1}" height="{h - 1}" fill="{t['bg']}" stroke="{t['line']}"/>
  <rect x="0.5" y="0.5" width="{w - 1}" height="{head}" fill="{t['soft']}" stroke="{t['line']}"/>
  {mono_text(26, head / 2 + 9, label, 26, 15.6, t['text'])}
  {blink_cursor(26 + len(label) * 15.6 + 6, head / 2 - 13, 14, 28, t['text'])}
  {body}
  </g></g>
</svg>
"""


def banner_m(t, theme):
    W, H, split = MW, 420, 352
    k = 0.8
    ox, oy = 30 - (99 - 8) * k, 40 - (115 - 8) * k
    blocks = "".join(f'<rect x="{ox + (x - 8) * k:.1f}" y="{oy + (y - 8) * k:.1f}" width="{16 * k:.1f}" height="{16 * k:.1f}"/>' for x, y in DOTS)
    tattr = f'font-family="{DISPLAY}" font-size="58" font-weight="700"'
    cw, size, py = 14.4, 24, 292
    tx = 30 + len(PROMPT) * cw
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W + 8} {H + 8}" role="img" aria-label="DS Network - Minecraft server status and whitelist">
  <style>{FONTS}{RISE} .d {{ fill: {t['fg']}; }}</style>
  <rect x="7.5" y="7.5" width="{W}" height="{H}" fill="{t['line']}"/>
  <rect x="0.5" y="0.5" width="{W - 1}" height="{H - 1}" fill="{t['bg']}" stroke="{t['line']}"/>
  <line x1="0" y1="{split}" x2="{W}" y2="{split}" stroke="{t['line']}"/>
  <g class="d">{blocks}</g>
  <line x1="214" y1="40" x2="214" y2="128" stroke="{t['line']}"/>
  <text x="234" y="106" {tattr} fill="{t['fg']}" class="rise">{TITLE}</text>
  <line x1="30" y1="160" x2="{W - 30}" y2="160" stroke="{t['line']}" stroke-dasharray="4 6"/>
  <g class="rise">
  {mono_text(30, 202, "minecraft · status + whitelist", 24, 14.4, t['text'])}
  {mono_text(30, 238, "java + bedrock · velocity", 24, 14.4, t['text'])}
  </g>
  {mono_text(30, py, PROMPT, size, cw, t['text'])}
  {typing(COMMANDS, tx, py, cw, size, t['fg'], t['text'], 'mcmd')}
  {marquee_row(t, theme, W, split, H, mobile=True)}
</svg>
"""


def page_card_m(t, num, name, url, side="left"):
    """A half-width card for phones: just the name and the address, both large."""
    W, H, bar = 595, 300, 60
    num_svg = mono_text(W - 10 - 24 - len(num) * 15.6, bar / 2 + 9, num, 26, 15.6, t["fg"], ' font-weight="700"')
    acw = min(21.6, (W - 10 - 60) / (len(url) + 2))
    body = (f'<text x="28" y="{bar + 120}" font-family="{DISPLAY}" font-size="104" font-weight="700" fill="{t["fg"]}">{name}</text>'
            + mono_text(30, bar + 196, url + " ↗", acw / .6, acw, t["fg"]))
    return window(t, W, H, "~/" + name, body, f"{name}: {url}", bar=bar, bs=1.4, right=num_svg, vbw=600, ox=0 if side == "left" else 5)


if __name__ == "__main__":
    for name, theme in THEMES.items():
        (OUT / f"banner-{name}.svg").write_text(banner(theme, name))
        (OUT / f"banner-m-{name}.svg").write_text(banner_m(theme, name))
        (OUT / f"motd-{name}.svg").write_text(motd(theme))
        (OUT / f"motd-m-{name}.svg").write_text(motd_m(theme))
        (OUT / f"terminal-{name}.svg").write_text(terminal(theme))
        (OUT / f"terminal-m-{name}.svg").write_text(terminal_m(theme))
        (OUT / f"how-it-works-{name}.svg").write_text(how_it_works(theme))
        (OUT / f"how-it-works-m-{name}.svg").write_text(how_it_works_m(theme))
        (OUT / f"server-properties-{name}.svg").write_text(server_properties(theme))
        (OUT / f"server-properties-m-{name}.svg").write_text(server_properties_m(theme))
        for i, (num, page, url, desc, src) in enumerate(PAGES):
            side = "left" if i % 2 == 0 else "right"
            (OUT / f"page-{page}-{name}.svg").write_text(page_card(theme, num, page, url, desc, src, side))
            (OUT / f"page-{page}-m-{name}.svg").write_text(page_card_m(theme, num, page, url, side))
        for key, text in LINKS:
            (OUT / f"link-{key}-{name}.svg").write_text(pill(theme, text, inverted=key == "join"))
        for key, text in FOOTER:
            (OUT / f"footer-{key}-{name}.svg").write_text(pill(theme, text, inverted=key == "copy"))
    print("ok")
