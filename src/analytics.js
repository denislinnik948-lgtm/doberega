import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./cloud-config.js";

/**
 * Anonymous usage counts for the stats page (stats/index.html): a page open,
 * pressing Fish, the first catch, creating an account. Each event carries a
 * random device id (kept in this browser), where the visitor came from,
 * phone or computer, and whether the game was opened as a home-screen app.
 * No names, emails or IP addresses are stored. Nothing is sent from a local
 * copy (localhost) or a `?debug` session, so testing doesn't skew the numbers.
 */

const VISITOR_KEY = "doberega.visitor";
const local = ["localhost", "127.0.0.1", "[::1]", ""].includes(location.hostname) || location.hostname.endsWith(".local");
const enabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY) && !local && !new URLSearchParams(location.search).has("debug");

const randomId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

const visitor = (() => {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return randomId();
  }
})();
const session = randomId();
const sent = new Set();

/** Where the visit came from: a ?utm_source / ?ref tag, else the referring site, else "direct". */
function source() {
  const params = new URLSearchParams(location.search);
  const tag = params.get("utm_source") || params.get("ref");
  if (tag) return tag.slice(0, 60);
  try {
    const from = document.referrer && new URL(document.referrer).hostname.replace(/^www\./, "");
    if (from && from !== location.hostname) return from;
  } catch {
    // An unreadable referrer counts as direct.
  }
  return "direct";
}

function device() {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const short = Math.min(screen.width, screen.height);
  if (!coarse) return "desktop";
  return short >= 600 ? "tablet" : "mobile";
}

const installed = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

/**
 * Record an event: "visit", "fish", "catch" or "signup". `once` keeps it to
 * one per page session (pressing Fish again later isn't a new visitor action).
 */
export function track(type, { once = true } = {}) {
  if (!enabled || (once && sent.has(type))) return;
  sent.add(type);
  fetch(`${SUPABASE_URL}/rest/v1/events`, {
    method: "POST",
    keepalive: true,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      visitor,
      session,
      type,
      source: type === "visit" ? source() : null,
      device: device(),
      app: installed(),
      lang: (navigator.language || "").slice(0, 8),
    }),
  }).catch(() => {
    // Counting is best effort; the game never waits on it or complains.
  });
}
