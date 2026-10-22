import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../src/cloud-config.js";

/**
 * The stats page: sign in with an admin account of the game, then everything
 * comes from one call, dashboard_stats() in supabase/schema.sql, which only
 * answers admins. Charts are plain SVG with a hover readout.
 */

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
const $ = (selector) => document.querySelector(selector);
const number = new Intl.NumberFormat("uk-UA");
const percent = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");
const DEVICES = { mobile: "Телефон", tablet: "Планшет", desktop: "Комп'ютер", unknown: "Невідомо" };

let client = null;
let days = 30;

function element(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function svg(tag, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function show(view) {
  for (const id of ["gate", "notice", "board", "controls"]) $(`#${id}`).hidden = true;
  if (view === "board") $("#controls").hidden = false;
  if (view === "notice") $("#controls").hidden = false;
  $(`#${view}`).hidden = false;
}

function notice(html) {
  $("#notice").innerHTML = html;
  show("notice");
}

/* ---------- pieces ---------- */

function tile(value, label, sub = "") {
  return element("div", { className: "tile" }, [
    element("strong", { textContent: number.format(value ?? 0) }),
    element("span", { textContent: label }),
    sub ? element("small", { textContent: sub }) : "",
  ]);
}

/** Horizontal bars sharing one scale; `share` adds a percentage of `of`. */
function bars(container, rows, { of = null } = {}) {
  container.replaceChildren();
  if (!rows.length) {
    container.append(element("p", { className: "empty", textContent: "Ще немає даних" }));
    return;
  }
  const max = Math.max(1, ...rows.map((row) => row.value));
  for (const row of rows) {
    const fill = element("div", { className: "fill" });
    fill.style.width = `${(row.value / max) * 100}%`;
    container.append(element("div", { className: "bar-row" }, [
      element("span", { className: "label", textContent: row.label, title: row.label }),
      element("div", { className: "track" }, [fill]),
      element("span", { className: "value" }, [number.format(row.value), of !== null ? element("small", { textContent: percent(row.value, of) }) : ""]),
    ]));
  }
}

const dayLabel = (day) => new Date(`${day}T12:00:00`).toLocaleDateString("uk-UA", { day: "numeric", month: "short" });

/** Shared frame for the day charts: y gridlines with round ticks, a few date labels. */
function frame(container, series) {
  const width = Math.max(280, container.clientWidth);
  const height = container.clientHeight;
  const pad = { top: 10, right: 8, bottom: 24, left: 34 };
  const max = Math.max(1, ...series.map((point) => point.value));
  const step = Math.max(1, Math.ceil(max / 4));
  const top = step * Math.ceil(max / step);
  const x = (index) => pad.left + (series.length <= 1 ? 0 : (index / (series.length - 1)) * (width - pad.left - pad.right));
  const y = (value) => height - pad.bottom - (value / top) * (height - pad.top - pad.bottom);
  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });
  for (let value = 0; value <= top; value += step) {
    root.append(svg("line", { class: "gridline", x1: pad.left, x2: width - pad.right, y1: y(value), y2: y(value) }));
    const label = svg("text", { class: "axis", x: pad.left - 6, y: y(value) + 5, "text-anchor": "end" });
    label.textContent = number.format(value);
    root.append(label);
  }
  const every = Math.max(1, Math.ceil(series.length / 6));
  let previous = -Infinity;
  series.forEach((point, index) => {
    const last = index === series.length - 1;
    // Regular ticks, plus the last day, unless it would crowd the tick before it.
    if (!last && index % every) return;
    // The last label hangs left of its day, the one before is centred: keep them clear of each other.
    if (last && index % every && x(index) - previous < 96) return;
    previous = x(index);
    const label = svg("text", { class: "axis", x: x(index), y: height - 4, "text-anchor": index === 0 ? "start" : index === series.length - 1 ? "end" : "middle" });
    label.textContent = dayLabel(point.day);
    root.append(label);
  });
  container.replaceChildren(root);
  return { root, x, y, width, height, pad };
}

function tooltip(event, title, text) {
  const tip = $("#tooltip");
  tip.replaceChildren(element("strong", { textContent: title }), text);
  tip.hidden = false;
  const left = Math.min(window.innerWidth - tip.offsetWidth - 8, event.clientX + 14);
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${event.clientY - tip.offsetHeight - 12}px`;
}

const hideTooltip = () => { $("#tooltip").hidden = true; };

/** Visitors per day: a line over a soft area, with a crosshair readout. */
function lineChart(container, series, unit) {
  const { root, x, y, height, pad } = frame(container, series);
  const points = series.map((point, index) => `${x(index)},${y(point.value)}`);
  root.append(svg("path", { class: "area", d: `M${x(0)},${y(0)} L${points.join(" L")} L${x(series.length - 1)},${y(0)} Z` }));
  root.append(svg("path", { class: "line", d: `M${points.join(" L")}` }));
  const cross = svg("line", { class: "cross", y1: pad.top, y2: height - pad.bottom, visibility: "hidden" });
  const dot = svg("circle", { class: "dot", r: 5, visibility: "hidden" });
  root.append(cross, dot);
  root.addEventListener("pointermove", (event) => {
    const box = root.getBoundingClientRect();
    const scale = box.width / root.viewBox.baseVal.width;
    const px = (event.clientX - box.left) / scale;
    let index = 0;
    series.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(index) - px)) index = i; });
    const point = series[index];
    cross.setAttribute("x1", x(index));
    cross.setAttribute("x2", x(index));
    dot.setAttribute("cx", x(index));
    dot.setAttribute("cy", y(point.value));
    cross.setAttribute("visibility", "visible");
    dot.setAttribute("visibility", "visible");
    tooltip(event, dayLabel(point.day), `${number.format(point.value)} ${unit}`);
  });
  root.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
    hideTooltip();
  });
}

/** Counts per day as thin bars, each with its own hover readout. */
function barChart(container, series, unit) {
  const { root, x, y, width, pad } = frame(container, series);
  const slot = (width - pad.left - pad.right) / Math.max(1, series.length);
  const barWidth = Math.max(2, Math.min(18, slot - 2));
  series.forEach((point, index) => {
    const cx = x(index);
    if (point.value > 0) {
      const top = y(point.value);
      const r = Math.min(4, barWidth / 2);
      const left = cx - barWidth / 2;
      const bottom = y(0);
      // Rounded at the data end, square on the baseline.
      root.append(svg("path", { class: "bar", d: `M${left},${bottom} V${top + r} Q${left},${top} ${left + r},${top} H${left + barWidth - r} Q${left + barWidth},${top} ${left + barWidth},${top + r} V${bottom} Z` }));
    }
    // A hit target the full height of the slot, wider than the bar.
    const hit = svg("rect", { x: cx - slot / 2, y: pad.top, width: slot, height: y(0) - pad.top, fill: "transparent" });
    hit.addEventListener("pointermove", (event) => tooltip(event, dayLabel(point.day), `${number.format(point.value)} ${unit}`));
    hit.addEventListener("pointerleave", hideTooltip);
    root.append(hit);
  });
}

/* ---------- data ---------- */

function render(stats) {
  // Shown first: the charts are drawn to the size their boxes have.
  show("board");
  const p = stats.period;
  const a = stats.allTime;
  $("#period-title").textContent = `За ${days} днів`;
  $("#period-tiles").replaceChildren(
    tile(p.visitors, "Відвідувачів", `${number.format(p.visits)} відкриттів`),
    tile(p.fishers, "Почали рибалити", percent(p.fishers, p.visitors)),
    tile(p.catchers, "Упіймали рибу", percent(p.catchers, p.visitors)),
    tile(p.signups, "Зареєструвались", percent(p.signups, p.visitors)),
    tile(p.appVisitors, "Відкривали з іконки", percent(p.appVisitors, p.visitors)),
    tile(p.returning, "Повертались", "у різні дні"),
  );
  $("#all-tiles").replaceChildren(
    tile(a.users, "Акаунтів"),
    tile(a.active7, "Заходили за 7 днів"),
    tile(a.visitors, "Відвідувачів"),
    tile(a.fishCaught, "Риб упіймано", "гравцями з акаунтом"),
    tile(a.trophies, "Трофеїв"),
    tile(a.saves, "Збережень у хмарі"),
  );
  bars($("#funnel"), [
    { label: "Відкрили сайт", value: p.visitors },
    { label: "Почали рибалити", value: p.fishers },
    { label: "Упіймали рибу", value: p.catchers },
    { label: "Зареєструвались", value: p.signups },
  ], { of: p.visitors });
  const daily = stats.daily ?? [];
  lineChart($("#visitors-chart"), daily.map((d) => ({ day: d.day, value: d.visitors })), "відвідувачів");
  barChart($("#signups-chart"), daily.map((d) => ({ day: d.day, value: d.signups })), "реєстрацій");
  barChart($("#catch-chart"), daily.map((d) => ({ day: d.day, value: d.catchers })), "з уловом");
  bars($("#sources"), stats.sources.map((s) => ({ label: s.name === "direct" ? "Напряму" : s.name, value: s.visitors })), { of: p.visitors });
  bars($("#devices"), stats.devices.map((d) => ({ label: DEVICES[d.name] ?? d.name, value: d.visitors })), { of: p.visitors });
  const when = (stamp) => (stamp ? new Date(stamp).toLocaleDateString("uk-UA", { day: "numeric", month: "short" }) : "–");
  $("#recent").replaceChildren(
    element("thead", {}, [element("tr", {}, [element("th", { textContent: "Гравець" }), element("th", { textContent: "Створено" }), element("th", { textContent: "Заходив" })])]),
    element("tbody", {}, stats.recentUsers.length
      ? stats.recentUsers.map((user) => element("tr", {}, [element("td", { textContent: user.name }), element("td", { textContent: when(user.created_at) }), element("td", { textContent: when(user.last_sign_in_at) })]))
      : [element("tr", {}, [element("td", { className: "empty", colSpan: 3, textContent: "Ще немає акаунтів" })])]),
  );
  $("#updated").textContent = `Оновлено о ${new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}`;
  window.lastStats = stats;
}

async function load() {
  $("#refresh").disabled = true;
  const { data, error } = await client.rpc("dashboard_stats", { period_days: days });
  $("#refresh").disabled = false;
  if (!error) {
    render(data);
    return;
  }
  if (error.code === "42501" || /not allowed/i.test(error.message)) {
    notice("Цей акаунт не адмін. Додайте його в Supabase → SQL Editor:<br><code>insert into public.admins (user_id) select id from auth.users where email = 'ВАША ПОШТА';</code>");
  } else if (error.code === "PGRST202" || /could not find the function/i.test(error.message)) {
    notice("Функції статистики ще немає в базі. Запустіть оновлений <code>supabase/schema.sql</code> у Supabase → SQL Editor.");
  } else {
    notice(`Не вдалося завантажити: ${error.message}`);
  }
}

/** `?demo`: made-up numbers, clearly marked, to check the layout without a database. */
function demo() {
  const today = new Date();
  const daily = Array.from({ length: days }, (_, i) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - 1 - i));
    const visitors = Math.round(20 + 15 * Math.sin(i / 3) + i * 1.5);
    return { day: date.toISOString().slice(0, 10), visitors, catchers: Math.round(visitors * 0.45), signups: i % 3 ? Math.round(visitors * 0.08) : 0 };
  });
  const sum = (key) => daily.reduce((total, d) => total + d[key], 0);
  render({
    days,
    period: { visitors: sum("visitors"), visits: Math.round(sum("visitors") * 1.6), fishers: Math.round(sum("visitors") * 0.7), catchers: sum("catchers"), signups: sum("signups"), appVisitors: Math.round(sum("visitors") * 0.2), returning: Math.round(sum("visitors") * 0.3) },
    allTime: { visitors: 2140, users: 186, active7: 42, saves: 180, fishCaught: 9312, trophies: 57 },
    daily,
    sources: [{ name: "direct", visitors: 610 }, { name: "t.me", visitors: 240 }, { name: "instagram.com", visitors: 180 }, { name: "google.com", visitors: 64 }],
    devices: [{ name: "mobile", visitors: 820 }, { name: "desktop", visitors: 260 }, { name: "tablet", visitors: 14 }],
    recentUsers: [{ name: "Окунь", created_at: today.toISOString(), last_sign_in_at: today.toISOString() }, { name: "an***@gmail.com", created_at: today.toISOString(), last_sign_in_at: null }],
  });
  $("#updated").textContent = "Демо-дані: це не справжня статистика.";
}

async function start() {
  if (new URLSearchParams(location.search).has("demo")) {
    $("#period").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-days]");
      if (!button) return;
      days = Number(button.dataset.days);
      for (const other of $("#period").children) other.setAttribute("aria-pressed", String(other === button));
      demo();
    });
    demo();
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    notice("Supabase не підключено (src/cloud-config.js).");
    return;
  }
  const { createClient } = await import(SUPABASE_JS);
  // The same storage as the game: signed in there means signed in here.
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data } = await client.auth.getSession();
  if (data.session) load();
  else show("gate");

  $("#login").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $("#login-message");
    message.className = "note";
    message.textContent = "Хвилинку…";
    const { error } = await client.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
    if (error) {
      message.className = "note is-bad";
      message.textContent = /invalid login/i.test(error.message) ? "Невірна пошта або пароль." : error.message;
      return;
    }
    message.textContent = "";
    load();
  });
  $("#period").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-days]");
    if (!button) return;
    days = Number(button.dataset.days);
    for (const other of $("#period").children) other.setAttribute("aria-pressed", String(other === button));
    load();
  });
  $("#refresh").addEventListener("click", load);
  $("#sign-out").addEventListener("click", async () => {
    await client.auth.signOut();
    show("gate");
  });
  // Charts are drawn to the width they have; redraw when it changes.
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (window.lastStats && !$("#board").hidden) render(window.lastStats); }, 150);
  });
}

start();
