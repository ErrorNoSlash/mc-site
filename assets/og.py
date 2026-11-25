"""python3 assets/og.py -> site/images/og-image.png, the picture Discord, Mastodon, etc. show
when someone shares join.errornoslash.be (1200 x 630, like the contact site's).

Drawn as an SVG with the same pieces as the README (block DS logo, pixel fonts, the block world),
then rendered to PNG, because link previews don't show SVG.
Needs Playwright with Chromium: pip install playwright && playwright install chromium
"""

import base64
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "src"
OUT = HERE.parent / "site" / "images" / "og-image.png"

BG, FG, TEXT, LINE = "#040507", "#ffffff", "#AEB5B8", "#525252"
W, H = 1200, 630
BAND_TOP = 450          # the block world fills the bottom strip

DOTS = [
    (99, 115), (117, 115), (135, 115), (153, 115), (225, 115), (243, 115), (261, 115), (279, 115),
    (99, 133), (117, 133), (153, 133), (171, 133), (207, 133), (225, 133),
    (99, 151), (117, 151), (171, 151), (207, 151), (225, 151), (243, 151), (261, 151),
    (99, 169), (117, 169), (171, 169), (225, 169), (243, 169), (261, 169), (279, 169),
    (99, 187), (117, 187), (171, 187), (261, 187), (279, 187),
    (99, 205), (117, 205), (135, 205), (153, 205), (207, 205), (225, 205), (243, 205), (261, 205),
]


def b64(name):
    return base64.b64encode((SRC / name).read_bytes()).decode()


def svg():
    fonts = (
        f"@font-face{{font-family:Mono;font-weight:400;src:url(data:font/woff2;base64,{b64('monocraft-regular.woff2')})}}"
        f"@font-face{{font-family:Mono;font-weight:700;src:url(data:font/woff2;base64,{b64('monocraft-bold.woff2')})}}"
        f"@font-face{{font-family:Pix;font-weight:700;src:url(data:font/woff2;base64,{b64('pixelify-sans-700.woff2')})}}"
    )
    # the DS logo in blocks, scaled up and centred in the left column
    k = 1.3
    logo_w, logo_h = (279 - 99 + 16) * k, (205 - 115 + 16) * k
    ox, oy = 200 - logo_w / 2 - (99 - 8) * k, (BAND_TOP / 2) - logo_h / 2 - (115 - 8) * k
    blocks = "".join(f'<rect x="{ox + (x - 8) * k:.1f}" y="{oy + (y - 8) * k:.1f}" width="{16 * k:.1f}" height="{16 * k:.1f}"/>' for x, y in DOTS)

    band = b64("og-band.png")
    words = "ONLINE * SURVIVAL * ANARCHY * WHITELISTED * JAVA + BEDROCK * "
    halo = f'stroke="{BG}" stroke-width="6" stroke-linejoin="round" paint-order="stroke"'
    tx = 430
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
  <style>{fonts}</style>
  <rect width="{W}" height="{H}" fill="{BG}"/>
  <image href="data:image/png;base64,{band}" x="0" y="{BAND_TOP}" width="{W}" height="{H - BAND_TOP}" preserveAspectRatio="none" style="image-rendering:pixelated"/>
  <line x1="0" y1="{BAND_TOP}" x2="{W}" y2="{BAND_TOP}" stroke="{LINE}" stroke-width="2"/>
  <text x="36" y="{BAND_TOP + 58}" font-family="Mono" font-size="30" fill="{FG}" {halo} xml:space="preserve">{words}</text>
  <g fill="{FG}">{blocks}</g>
  <line x1="{tx - 50}" y1="90" x2="{tx - 50}" y2="{BAND_TOP - 90}" stroke="{LINE}" stroke-width="2"/>
  <text x="{tx}" y="150" font-family="Mono" font-size="30" fill="{TEXT}">dias@mc:~$ /list</text>
  <rect x="{tx + 16 * 20 + 8}" y="125" width="18" height="32" fill="{TEXT}"/>
  <text x="{tx - 4}" y="268" font-family="Pix" font-weight="700" font-size="112" fill="{FG}">DS Network</text>
  <text x="{tx}" y="330" font-family="Mono" font-size="30" fill="{TEXT}">minecraft · status + whitelist</text>
  <text x="{tx}" y="376" font-family="Mono" font-weight="700" font-size="30" fill="{FG}">join.errornoslash.be</text>
</svg>"""


if __name__ == "__main__":
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
        page.set_content(f'<html><body style="margin:0;background:{BG}">{svg()}</body></html>')
        page.wait_for_function("document.fonts.status === 'loaded'")
        page.wait_for_timeout(300)
        OUT.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(OUT), clip={"x": 0, "y": 0, "width": W, "height": H})
        browser.close()
    print("wrote", OUT)
