# End-to-end check of the whole visitor path on a deployed URL, in a real Chromium (Playwright).
#   voice:  tap the circle -> Gemini Live guide speaks -> a recorded answer is played into the
#           page's microphone when the guide is listening -> transcript -> /api/curate -> 3D room
#   typed:  tap the circle -> type into the box -> "Show me the room"
#   chip:   tap a suggestion
# Every case then opens a card, checks the detail dialog, and closes it with Esc.
# The mic is replaced (getUserMedia) by a stream we feed, so the answer starts exactly when the
# guide opens the mic; everything after the mic (levels, transcription, tool call, routing) is real.
#
# Usage: python scripts/verify-e2e.py <voice_dir> [base_url] [--shots <dir>]
#   voice_dir holds <name>.wav files (16 kHz mono) named in VOICE below.
# Exits non-zero if any case fails.
import sys, time, pathlib
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

args = [a for a in sys.argv[1:]]
shots = None
if "--shots" in args:
    i = args.index("--shots"); shots = pathlib.Path(args[i + 1]); del args[i:i + 2]
    shots.mkdir(parents=True, exist_ok=True)
VOICE_DIR = pathlib.Path(args[0])
BASE = (args[1] if len(args) > 1 else "https://converge-gallery.vercel.app").rstrip("/")

# (kind, input, room the matches should land in)
CASES = [
    ("voice", "techno", "Red Room"),
    ("voice", "murals", "Atrium"),
    ("voice", "interiors", "Design Library"),
    ("typed", "Sunny, playful and colourful. I want ceramic sculptors and painters who do big, joyful pieces.", "Atrium"),
    ("typed", "Smoky, intimate, old-school. Latin jazz and bolero singers, like a late night in Little Havana.", "Red Room"),
    ("typed", "Sleek and futuristic, chrome and glass. Architects and product designers.", "Design Library"),
    ("chip", "Jazz musicians in Little Havana", "Red Room"),
    ("typed", "Dreamy and psychedelic. I want illustrators and painters who make album cover art.", "Atrium"),
    ("typed", "Gritty and loud, a warehouse block party. Mostly DJs, maybe a muralist or two.", "Red Room|Atrium"),
]

# Replaces the microphone with a stream the test controls: window.__say(url) plays a WAV into it.
FAKE_MIC = """
(() => {
  let ctx, dest;
  const ensure = () => {
    if (!ctx) { ctx = new AudioContext({ sampleRate: 16000 }); dest = ctx.createMediaStreamDestination(); }
    return dest;
  };
  navigator.mediaDevices.getUserMedia = async () => ensure().stream;
  window.__say = async (url) => {
    ensure(); await ctx.resume();
    const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(dest); src.start();
    return buf.duration;
  };
})();
"""

def room_label(pg):
    return pg.locator("text=scroll to walk").first.inner_text(timeout=45000)

def check_card(pg):
    """Open the nearest visible card, confirm the dialog names the creative, close with Esc."""
    pg.wait_for_timeout(2500)
    i = pg.evaluate("() => { const v=[...document.querySelectorAll('[data-i]')].filter(e=>+e.style.opacity>0.6)"
                    ".sort((a,b)=>+b.style.zIndex - +a.style.zIndex); return v.length ? +v[0].dataset.i : -1 }")
    if i < 0:
        return "no visible card"
    card = pg.locator(f"[data-i='{i}']")
    name = card.locator("h3, h2, .name").first.inner_text() if card.locator("h3, h2, .name").count() else ""
    # Click the card's name: Play Mix plays audio and View Work leaves for their own site.
    card.locator(".cat-name").first.click(force=True)
    dlg = pg.get_by_role("dialog")
    dlg.wait_for(timeout=5000)
    label = dlg.get_attribute("aria-label") or ""
    work = dlg.get_by_role("link", name="View Work")
    href = work.first.get_attribute("href") if work.count() else None
    stale = dlg.get_by_text("Full profile").count()
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(800)
    closed = pg.get_by_role("dialog").count() == 0
    if not label:
        return "dialog had no name"
    note = f"opened '{label}', View Work -> {href or 'none (no profile link)'}"
    if stale: note += " (Full profile button still there: NOT expected)"
    return note + ("" if closed else " (did NOT close)")

def check_music(pg):
    """Red Room: previews preload after the room loads, and Play Mix starts fast. Returns (ok, note)."""
    pg.wait_for_timeout(9000)  # let the background preload run
    buttons = pg.locator("[data-i] button", has_text="Play Mix")
    n = buttons.count()
    pre = pg.evaluate("() => performance.getEntriesByType('resource').filter(e => /dzcdn|deezer|preview/.test(e.name) && e.initiatorType !== 'fetch').length")
    if n == 0:
        return False, f"no Play Mix buttons ({pre} previews fetched)"
    t = pg.evaluate("""() => new Promise(res => {
        const b = [...document.querySelectorAll('[data-i]')].filter(e => +e.style.opacity > 0.6)
            .map(e => [...e.querySelectorAll('button')].find(x => x.textContent.includes('Play Mix'))).find(Boolean);
        if (!b) return res(-1);
        const t0 = performance.now(); b.click();
        const poll = () => b.getAttribute('aria-pressed') === 'true' ? res(Math.round(performance.now() - t0))
            : performance.now() - t0 > 8000 ? res(-2) : requestAnimationFrame(poll);
        poll();
    })""")
    if t < 0:
        return False, f"{n} Play Mix buttons, {pre} preloaded, but click did not start playback ({t})"
    pg.locator("[data-i] button[aria-pressed='true']").first.click(force=True)  # stop it again
    return t < 1000, f"{n} Play Mix buttons, {pre} previews preloaded, playing {t} ms after click"

def run_voice(pg, name, log):
    pg.get_by_role("button", name="Talk to the guide").click(force=True)
    heard_ai, turns, t0 = "", 0, time.time()
    while time.time() - t0 < 90:
        if "/room" in pg.url:
            break
        status = pg.locator("p.font-mono").first.inner_text().lower() if pg.locator("p.font-mono").count() else ""
        if status != getattr(run_voice, "last", None):
            run_voice.last = status; log.append(f"    [{time.time() - t0:4.1f}s] {status}")
        if status.startswith("voice is off") or pg.locator("text=voice line dropped").count():
            raise RuntimeError("voice error: " + pg.locator("main").last.inner_text()[:200])
        if status.startswith("listening") and turns < 3:
            ai = pg.locator("main p.display").first.inner_text()
            log.append(f"    guide: {ai.strip()[:150]}")
            turns += 1
            dur = pg.evaluate("(u) => window.__say(u)", f"{BASE}/__voice/{name}.wav")
            pg.wait_for_timeout(int(dur * 1000) + 2500)  # speech + the 1.5 s of quiet that ends the turn
            you = pg.locator("text=You said").locator("..").inner_text() if pg.locator("text=You said").count() else ""
            log.append(f"    heard: {you.replace('You said', '').strip()[:150]}")
            continue
        pg.wait_for_timeout(400)
    if "/room" not in pg.url:
        raise RuntimeError(f"never reached the room after {turns} answer(s); last screen: " + pg.locator("main").last.inner_text()[:200])
    log.append(f"    answers given: {turns}")

def main():
    fails = 0
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream",
                                    "--use-gl=angle", "--enable-unsafe-swiftshader"])
        for n, (kind, inp, want) in enumerate(CASES, 1):
            ctx = b.new_context(viewport={"width": 1440, "height": 900}, permissions=["microphone"])
            ctx.add_init_script(FAKE_MIC)
            ctx.route("**/__voice/*.wav", lambda r: r.fulfill(path=str(VOICE_DIR / r.request.url.rsplit("/", 1)[1]),
                                                             content_type="audio/wav"))
            pg = ctx.new_page()
            errs, bad_http = [], []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            # Third-party image/audio hosts drop connections now and then; what counts is that no card
            # shows a broken image (checked below) and that our own /api calls succeed.
            pg.on("console", lambda m: m.type == "error" and "Failed to load resource" not in m.text and errs.append(m.text[:160]))
            pg.on("response", lambda r: r.status >= 400 and "/api/" in r.url and bad_http.append(f"{r.status} {r.url}"))
            log = [f"[{n}] {kind}: {inp[:70]}"]
            t0 = time.time()
            try:
                pg.goto(BASE + "/")
                if kind == "voice":
                    run_voice(pg, inp, log)
                elif kind == "typed":
                    pg.get_by_role("button", name="Talk to the guide").click(force=True)
                    pg.get_by_label("Who you want to find and connect with").fill(inp)
                    pg.get_by_role("button", name="Show me the room →").click(force=True)
                else:
                    pg.get_by_role("button", name=inp).click(force=True)
                label = room_label(pg)
                q = parse_qs(urlparse(pg.url).query).get("q", [""])[0]
                cards = pg.locator("[data-i]").count()
                names = pg.evaluate("() => [...document.querySelectorAll('[data-i]')].slice(0,5).map(e => e.innerText.split('\\n').filter(Boolean).slice(0,3).join(' / '))")
                ok_room = any(w in label for w in want.split('|'))
                log.append(f"    q sent: {q[:150]}")
                log.append(f"    room:  {label.split(' · scroll')[0]}  ({'OK' if ok_room else 'WANTED ' + want})")
                for s in names: log.append(f"      - {s[:90]}")
                music_ok = True
                if "Red Room" in label:
                    music_ok, note = check_music(pg)
                    log.append(f"    music: {note}")
                broken = pg.evaluate("() => [...document.querySelectorAll('[data-i] img')].filter(i => i.complete && i.naturalWidth === 0).length")
                log.append(f"    broken images on cards: {broken}")
                card = check_card(pg)
                log.append(f"    card:  {card}")
                if shots: pg.screenshot(path=str(shots / f"{n}-{kind}.png"))
                ok = ok_room and music_ok and broken == 0 and cards >= 10 and card.startswith("opened") and "NOT" not in card and not errs and not bad_http
            except Exception as e:
                log.append(f"    ERROR: {e}")
                if shots: pg.screenshot(path=str(shots / f"{n}-{kind}-fail.png"))
                ok = False
            if errs: log.append(f"    console errors: {errs[:3]}")
            if bad_http: log.append(f"    api errors: {bad_http[:3]}")
            log.append(f"    {'PASS' if ok else 'FAIL'}  ({time.time() - t0:.1f} s)")
            fails += not ok
            print("\n".join(log), flush=True)
            ctx.close()
        b.close()
    print(f"\n{'FAIL ' + str(fails) if fails else 'OK'} / {len(CASES)} end-to-end cases")
    sys.exit(1 if fails else 0)

main()
