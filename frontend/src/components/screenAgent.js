// What the voice coach can do on the learner's page. The worker calls these as LiveKit RPC
// methods (voice_agent/coach_voice.py: read_screen, scroll_page, click_on_screen).
//
// Policy (AB's choice): navigate and read only. The coach can scroll, read, open links, tabs and
// lessons, and press "Mark as completed", but never picks a quiz answer or submits a form.

const SKIP = ".coach-panel, .coach-mini, .coach-launcher, script, style, noscript, [hidden], [aria-hidden='true']";
const ALLOWED_BUTTONS = /^(mark as completed|complete and continue|next|previous|back to course|show|hide|open|expand|collapse)/i;

const clean = (t) => (t || "").replace(/\s+/g, " ").trim();
const visible = (el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
};
const onScreen = (el) => {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight;
};
const labelOf = (el) => clean(el.getAttribute("aria-label") || el.innerText || el.textContent || el.title || el.value);

/** Why the coach may not press this element, or "" if it may. */
export function refusal(el) {
  if (el.closest("fieldset") || el.matches("input, select, textarea, label, .option")) return "Quiz answers and form fields are for the learner to fill in.";
  if (el.matches("button[type='submit'], input[type='submit']") || (el.matches("button") && el.closest("form") && el.getAttribute("type") !== "button"))
    return "Submitting is for the learner to do.";
  if (el.matches("button, [role='button']") && !el.matches("[aria-expanded], [role='tab']") && !ALLOWED_BUTTONS.test(labelOf(el)))
    return "That button changes something, so the learner should press it.";
  return "";
}

function actionable() {
  return [...document.querySelectorAll("a[href], button, [role='button'], [role='tab'], summary")]
    .filter((el) => !el.closest(SKIP) && visible(el) && labelOf(el) && !el.disabled);
}

export function readScreen() {
  const main = document.querySelector("main") || document.body;
  const blocks = [];
  let chars = 0;
  for (const el of main.querySelectorAll("h1, h2, h3, h4, p, li, td, th, blockquote, pre, figcaption, [role='status'], .notice")) {
    if (el.closest(SKIP) || !visible(el) || el.parentElement?.closest("p, li, td, th, blockquote")) continue;
    const text = clean(el.innerText);
    if (!text) continue;
    const head = /^H\d$/.test(el.tagName);
    blocks.push({ text: head ? `# ${text}` : text, onScreen: onScreen(el) });
    chars += text.length;
    if (chars > 5000) break;
  }
  const seen = new Set();
  const actions = actionable()
    .map((el) => ({ label: labelOf(el).slice(0, 80), kind: el.matches("a") ? "link" : "button", allowed: !refusal(el), onScreen: onScreen(el) }))
    .filter((a) => !seen.has(a.label) && seen.add(a.label))
    .slice(0, 40);
  const doc = document.documentElement;
  return {
    title: document.title,
    path: location.pathname,
    scroll: { percent: Math.round((100 * window.scrollY) / Math.max(1, doc.scrollHeight - window.innerHeight)), atBottom: window.innerHeight + window.scrollY >= doc.scrollHeight - 4 },
    onScreenNow: blocks.filter((b) => b.onScreen).map((b) => b.text),
    restOfPage: blocks.filter((b) => !b.onScreen).map((b) => b.text).slice(0, 30),
    actions,
  };
}

export function scrollPage(direction = "down") {
  const d = String(direction).toLowerCase();
  const top = d === "top" ? 0 : d === "bottom" ? document.documentElement.scrollHeight
    : window.scrollY + (d === "up" ? -0.8 : 0.8) * window.innerHeight;
  window.scrollTo({ top, behavior: "smooth" });
  return { ok: true, direction: d };
}

/** Best match for a spoken label: exact, then starts-with, then contains (case-insensitive). */
export function findAction(label) {
  const want = clean(label).toLowerCase();
  if (!want) return null;
  const els = actionable();
  const score = (el) => {
    const l = labelOf(el).toLowerCase();
    return l === want ? 3 : l.startsWith(want) ? 2 : l.includes(want) || want.includes(l) ? 1 : 0;
  };
  return els.map((el) => [score(el), onScreen(el), el]).filter(([s]) => s)
    .sort((a, b) => b[0] - a[0] || Number(b[1]) - Number(a[1]))[0]?.[2] || null;
}

const SECTION = "li, section, article, .card, fieldset, tr";

/** The page section whose heading or text best matches a spoken name, e.g. "Voice AI basics". */
export function findSection(text) {
  const want = clean(text).toLowerCase();
  if (!want) return null;
  const main = document.querySelector("main") || document.body;
  let best = null, bestScore = 0;
  for (const el of main.querySelectorAll("h1, h2, h3, h4, legend, strong, p")) {
    if (el.closest(SKIP) || !visible(el)) continue;
    const t = clean(el.innerText).toLowerCase();
    const score = t === want ? 3 : t.startsWith(want) ? 2 : t.includes(want) ? 1 : 0;
    if (score > bestScore) { best = el; bestScore = score; }
  }
  return best ? best.closest(SECTION) || best : null;
}

let lit = null;
/** Scrolls a section to the middle of the screen and outlines it until the next highlight. */
export function highlightSection(text) {
  const el = findSection(text);
  if (!el) return { ok: false, error: `No section called "${text}" on this page. Read the screen again for the headings.` };
  lit?.classList.remove("coach-highlight");
  el.classList.add("coach-highlight");
  lit = el;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  return { ok: true, highlighted: clean(el.innerText).slice(0, 80) };
}

export function clickOnScreen(label) {
  const el = findAction(label);
  if (!el) return { ok: false, error: `Nothing called "${label}" on this page. Read the screen again for the labels.` };
  const why = refusal(el);
  if (why) return { ok: false, refused: true, error: why };
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.click();
  return { ok: true, clicked: labelOf(el) };
}

/** Registers the screen actions on a LiveKit room; onAction(text) notes what happened. */
export function registerScreenActions(room, onAction) {
  const lp = room.localParticipant;
  if (!lp.registerRpcMethod) return;
  const wrap = (fn) => async ({ payload }) => {
    let args = {};
    try { args = JSON.parse(payload || "{}"); } catch { /* empty */ }
    try { return JSON.stringify(fn(args)); } catch (e) { return JSON.stringify({ ok: false, error: e.message }); }
  };
  lp.registerRpcMethod("screen.read", wrap(() => { onAction?.("Reading your screen"); return readScreen(); }));
  lp.registerRpcMethod("screen.scroll", wrap(({ direction }) => { onAction?.(`Scrolling ${direction || "down"}`); return scrollPage(direction); }));
  lp.registerRpcMethod("screen.highlight", wrap(({ text }) => {
    const r = highlightSection(text);
    onAction?.(r.ok ? `Showing "${text}"` : `Couldn't find "${text}"`);
    return r;
  }));
  lp.registerRpcMethod("screen.click", wrap(({ label }) => {
    const r = clickOnScreen(label);
    onAction?.(r.ok ? `Opened "${r.clicked}"` : r.refused ? `Left "${label}" for you to press` : `Couldn't find "${label}"`);
    return r;
  }));
}
