/*
 * A message from the game's settings (Зв'язок з розробником), passed on to
 * the developer's Telegram by a bot. A Vercel serverless function: the bot's
 * token and the chat to write to live in the project's environment variables
 * (TELEGRAM_TOKEN, TELEGRAM_CHAT_ID), never in the game's code.
 *
 * POST { text, contact, context: { nick, rank, lang, device, spot } }
 * → 200 { ok: true }, or an error: 400 (too short), 405, 429 (too soon), 502
 * (Telegram didn't take it), 503 (no bot set up).
 */

const LIMIT = { text: 1000, contact: 100, field: 40 };
// One message a half-minute from an address. Kept per running instance only,
// so it is a brake rather than a wall; the game itself waits a minute.
const GAP_MS = 30000;
const lastFrom = new Map();

const clean = (value, length) => String(value ?? "").trim().slice(0, length);

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const token = process.env.TELEGRAM_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return res.status(503).json({ error: "unconfigured" });

  let body = req.body ?? {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  const text = clean(body.text, LIMIT.text);
  if (text.length < 3) return res.status(400).json({ error: "short" });

  const from = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  if (now - (lastFrom.get(from) ?? 0) < GAP_MS) return res.status(429).json({ error: "soon" });
  lastFrom.set(from, now);
  if (lastFrom.size > 5000) lastFrom.clear();

  const contact = clean(body.contact, LIMIT.contact);
  const context = body.context && typeof body.context === "object" ? body.context : {};
  const about = ["nick", "rank", "lang", "device", "spot"]
    .map((key) => clean(context[key], LIMIT.field))
    .filter(Boolean)
    .join(" · ");
  // Plain text, no markup: whatever the player wrote arrives as it was.
  const lines = ["✉️ Доберега"];
  if (about) lines.push(about);
  lines.push(contact ? `Контакт: ${contact}` : "Контакт: не залишили", "", text);
  const message = lines.join("\n");

  try {
    const sent = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: message, disable_web_page_preview: true }),
    });
    if (!sent.ok) return res.status(502).json({ error: "telegram" });
  } catch {
    return res.status(502).json({ error: "telegram" });
  }
  return res.status(200).json({ ok: true });
};
