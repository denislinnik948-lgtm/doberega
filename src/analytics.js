import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./cloud-config.js";

/**
 * Anonymous usage counts for the stats page (stats/index.html): a page open,
 * pressing Fish, the first catch, creating an account. Each event carries a
 * random device id (kept in this browser), where the visitor came from,
 * phone or computer, and whether the game was opened as a home-screen app.
 * No names, emails or IP addresses are stored. Nothing is sent from a local
 * copy (localhost) or a `?debug` session, so testing doesn't skew the numbers,
 * nor from a device where an admin has signed in (see markOwnDevice).
 */

const VISITOR_KEY = "doberega.visitor";
// Set on a device where an admin signed in: it no longer counts.
const OWN_KEY = "doberega.ownDevice";
const local = ["localhost", "127.0.0.1", "[::1]", ""].includes(location.hostname) || location.hostname.endsWith(".local");
const ownDevice = () => {
  try {
    return localStorage.getItem(OWN_KEY) === "1";
  } catch {
    return false;
  }
};
const enabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY) && !local && !new URLSearchParams(location.search).has("debug") && !ownDevice();

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
  if (!enabled || ownDevice() || (once && sent.has(type))) return;
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

/**
 * With an account signed in, ask whether it is an admin; if so this device is
 * the owner's: its events so far drop out of the stats (the server keeps a
 * list) and it stops sending new ones. Every home-screen install and browser
 * has its own device id, so this runs wherever an admin signs in.
 */
export async function markOwnDevice(client) {
  if (!client || local) return;
  const { data, error } = await client.rpc("exclude_my_device", { device_visitor: visitor });
  if (error || data !== true) return;
  try {
    localStorage.setItem(OWN_KEY, "1");
  } catch {
    // Without storage the server-side list still keeps this device out of the stats.
  }
}
