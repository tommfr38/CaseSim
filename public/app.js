/* ============================================================================
 * CaseSim — front end
 * ==========================================================================*/
"use strict";

/* ----------------------------- config ----------------------------------- */
const KEY_COST = 2.5; // a CS2 key
const ST_CHANCE = 0.1; // 10% StatTrak
const START_BALANCE = 1000;
const STORAGE_KEY = "casesim:v1";
// Game state lives in sessionStorage, so the balance resets every new session.
const store = window.sessionStorage;

// CS2 exterior bands by float, with rough market multipliers vs Field-Tested.
const WEARS = [
  { name: "Factory New", short: "FN", max: 0.07, mult: 1.55 },
  { name: "Minimal Wear", short: "MW", max: 0.15, mult: 1.22 },
  { name: "Field-Tested", short: "FT", max: 0.38, mult: 1.0 },
  { name: "Well-Worn", short: "WW", max: 0.45, mult: 0.82 },
  { name: "Battle-Scarred", short: "BS", max: 1.01, mult: 0.68 },
];

const TIER_LABEL = {
  "mil-spec": "Mil-Spec",
  restricted: "Restricted",
  classified: "Classified",
  covert: "Covert",
  gold: "Rare Special",
};
const TIER_ORDER = ["mil-spec", "restricted", "classified", "covert", "gold"];

/* ----------------------------- state ------------------------------------ */
const state = {
  cases: [],
  meta: null,
  byId: new Map(),
  current: null,
  fast: false,
  muted: false,
  balance: START_BALANCE,
  inventory: [], // currently-held drops
  stats: { opened: 0, spent: 0, unboxedValue: 0, best: null },
};

/* ----------------------------- helpers ---------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const round2 = (n) => Math.round(n * 100) / 100;
const usd = (n) =>
  "$" +
  Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const randInt = (max) => Math.floor(Math.random() * max);
const pick = (arr) => arr[randInt(arr.length)];

function wearFor(floatVal) {
  return WEARS.find((w) => floatVal < w.max) || WEARS[WEARS.length - 1];
}
function hasFinish(name) {
  return name.includes("|");
}
function currentMarket(item) {
  return item.price; // hard-coded real (Skinport) reference price
}

/* ------------------------- persistence ---------------------------------- */
function save() {
  const { balance, inventory, stats, fast, muted } = state;
  store.setItem(
    STORAGE_KEY,
    JSON.stringify({ balance, inventory, stats, fast, muted })
  );
}
function load() {
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    state.balance = d.balance ?? START_BALANCE;
    state.inventory = d.inventory ?? [];
    state.stats = d.stats ?? state.stats;
    state.fast = !!d.fast;
    state.muted = !!d.muted;
  } catch {
    /* corrupt storage — start fresh */
  }
}

/* ----------------------------- audio ------------------------------------ */
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx)
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}
function blip(freq, dur = 0.05, type = "triangle", gain = 0.07) {
  if (state.muted) return;
  try {
    const ctx = ensureAudio();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + dur);
  } catch {
    /* audio unavailable */
  }
}
const tick = () => blip(1200 + randInt(120), 0.03, "square", 0.04);
function revealSound(tier) {
  if (tier === "gold") {
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => blip(f, 0.5, "triangle", 0.09), i * 90)
    );
  } else if (tier === "covert") {
    [440, 660].forEach((f, i) =>
      setTimeout(() => blip(f, 0.35, "triangle", 0.08), i * 80)
    );
  } else if (tier === "classified") {
    blip(520, 0.3, "triangle", 0.07);
  } else {
    blip(330, 0.18, "sine", 0.05);
  }
}

/* ----------------------------- toast ------------------------------------ */
let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.innerHTML = `<div class="rounded-lg bg-ink-600 px-4 py-2 text-sm ring-1 ring-white/10 shadow-xl">${msg}</div>`;
  el.style.opacity = "1";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.style.opacity = "0"), 2200);
}

/* ============================ rolling logic ============================== */
function rollTier(c) {
  const r = Math.random();
  let acc = 0;
  for (const t of TIER_ORDER) {
    if (c.odds[t] == null) continue;
    acc += c.odds[t];
    if (r < acc) return t;
  }
  // floating-point safety net
  return TIER_ORDER.filter((t) => c.odds[t] != null).pop();
}

function rollDrop(c) {
  const tier = rollTier(c);
  const pool = tier === "gold" ? c.rareItems : c.items.filter((i) => i.tier === tier);
  const item = pick(pool);

  const finished = hasFinish(item.name);
  let floatVal = null;
  let wear = null;
  let pattern = null;

  if (finished) {
    floatVal = Math.random(); // 0 (best) → 1 (worst), uniform like real drops
    wear = wearFor(floatVal);
    pattern = randInt(1001); // paint seed 0–1000
  }

  // Gloves can't be StatTrak; everything else has a 10% chance.
  const stEligible = item.kind !== "glove";
  const stattrak = stEligible && Math.random() < ST_CHANCE;

  const price = variantPrice(item, floatVal, wear, stattrak);

  return {
    name: item.name,
    image: item.image,
    tier,
    color: item.color,
    kind: item.kind,
    rarityName: item.rarityName,
    paintIndex: item.paintIndex,
    phase: item.phase,
    float: floatVal,
    wearName: wear ? wear.name : "Vanilla",
    wearShort: wear ? wear.short : "★",
    pattern,
    stattrak,
    price,
    caseId: c.id,
    caseName: c.name,
    time: Date.now(),
  };
}

function variantPrice(item, floatVal, wear, stattrak) {
  // Real per-exterior (and StatTrak) price baked from Skinport at build time.
  const table = (stattrak && item.stPrices) || item.prices;
  const key = wear ? wear.short : "VN";
  const base = (table && table[key]) ?? item.price;
  // Small low-float premium within the exterior (lower float = a bit pricier).
  const floatFactor = floatVal == null ? 1 : 1 + 0.06 * (1 - floatVal);
  return round2(Math.max(0.03, base * floatFactor));
}

/* ============================ rendering ================================= */
function tierClass(tier) {
  return {
    "mil-spec": "tier-milspec",
    restricted: "tier-restricted",
    classified: "tier-classified",
    covert: "tier-covert",
    gold: "tier-gold",
  }[tier];
}

function renderHome() {
  $("#statCases").textContent = state.meta.caseCount;
  $("#statItems").textContent = state.meta.itemCount.toLocaleString();
  $("#statUpdated").textContent = new Date(
    state.meta.generatedAt
  ).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  $("#statBuild").textContent = "Skinport";
  renderCaseGrid("");
}

function renderCaseGrid(q) {
  const grid = $("#caseGrid");
  const term = q.trim().toLowerCase();
  const list = term
    ? state.cases.filter((c) => c.name.toLowerCase().includes(term))
    : state.cases;
  grid.innerHTML =
    list
      .map((c) => {
        const items = c.items.length + c.rareItems.length;
        return `
      <button data-case="${c.id}"
        class="group card-surface relative overflow-hidden p-3 text-left transition hover:-translate-y-0.5 hover:ring-amber-400/40 hover:shadow-glow hover:shadow-amber-500/10 animate-fade-in">
        <div class="aspect-[4/3] grid place-items-center rounded-lg bg-ink-900/60 p-2">
          <img loading="lazy" src="${c.image}" alt="${c.name}"
               class="max-h-full max-w-full object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.5)] transition group-hover:scale-105" />
        </div>
        <div class="mt-2 line-clamp-1 font-display text-sm font-600 text-slate-100">${c.name}</div>
        <div class="mt-0.5 flex items-center justify-between text-[11px] text-slate-500">
          <span>${items} items</span>
          <span class="text-amber-400/80">Open →</span>
        </div>
      </button>`;
      })
      .join("") ||
    `<p class="col-span-full py-10 text-center text-slate-500">No cases match “${q}”.</p>`;
}

function oddsBar(c) {
  const segs = TIER_ORDER.filter((t) => c.odds[t] != null)
    .map((t) => {
      const pct = c.odds[t] * 100;
      return `<div class="h-full" style="width:${pct}%;background:${
        { "mil-spec": "#4b69ff", restricted: "#8847ff", classified: "#d32ce6", covert: "#eb4b4b", gold: "#f4c20d" }[t]
      }" title="${TIER_LABEL[t]} — ${pct.toFixed(2)}%"></div>`;
    })
    .join("");
  const legend = TIER_ORDER.filter((t) => c.odds[t] != null)
    .map(
      (t) => `<span class="inline-flex items-center gap-1.5">
        <span class="h-2.5 w-2.5 rounded-sm" style="background:${
          { "mil-spec": "#4b69ff", restricted: "#8847ff", classified: "#d32ce6", covert: "#eb4b4b", gold: "#f4c20d" }[t]
        }"></span>
        <span class="text-slate-300">${TIER_LABEL[t]}</span>
        <span class="font-mono text-slate-500">${(c.odds[t] * 100).toFixed(2)}%</span>
      </span>`
    )
    .join("");
  return `
    <div class="h-2.5 w-full overflow-hidden rounded-full flex ring-1 ring-white/10">${segs}</div>
    <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">${legend}</div>`;
}

function itemPoolCard(item) {
  const cur = currentMarket(item);
  const finishNote = item.special
    ? `<span class="text-rarity-gold">★ ${item.kind}</span>`
    : "";
  return `
    <div class="item-card ${tierClass(item.tier)} group relative overflow-hidden rounded-lg p-2">
      <div class="aspect-[4/3] grid place-items-center">
        <img loading="lazy" src="${item.image}" alt="${item.name}"
             class="max-h-full max-w-full object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)]" />
      </div>
      <div class="mt-1 line-clamp-1 text-xs font-600 text-slate-100" title="${item.name}">${item.name}</div>
      <div class="flex items-center justify-between text-[11px]">
        <span class="font-mono text-emerald-400">${usd(cur)}</span>
        <span class="text-slate-500">${finishNote || "market"}</span>
      </div>
    </div>`;
}

function renderCase(c) {
  state.current = c;
  const view = $("#caseView");

  const tiers = TIER_ORDER.filter(
    (t) => t === "gold" ? c.rareItems.length : c.items.some((i) => i.tier === t)
  );
  const pool = tiers
    .map((t) => {
      const items = t === "gold" ? c.rareItems : c.items.filter((i) => i.tier === t);
      return `
      <div>
        <h4 class="mb-2 flex items-center gap-2 font-display text-sm font-600 tracking-wide">
          <span class="h-2.5 w-2.5 rounded-sm" style="background:${
            { "mil-spec": "#4b69ff", restricted: "#8847ff", classified: "#d32ce6", covert: "#eb4b4b", gold: "#f4c20d" }[t]
          }"></span>
          ${TIER_LABEL[t]}
          <span class="font-mono text-xs text-slate-500">${(c.odds[t] * 100).toFixed(2)}% · ${items.length} items</span>
        </h4>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          ${items.map(itemPoolCard).join("")}
        </div>
      </div>`;
    })
    .join("");

  view.innerHTML = `
    <button id="backBtn" class="btn-ghost mb-4 px-3 py-1.5 text-sm">← All cases</button>

    <div class="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div class="card-surface flex flex-col items-center p-6">
        <div class="aspect-square w-48 max-w-full grid place-items-center rounded-xl bg-ink-900/60 p-4">
          <img src="${c.image}" alt="${c.name}" class="max-h-full max-w-full object-contain drop-shadow-[0_10px_24px_rgba(0,0,0,0.6)]" />
        </div>
        <h3 class="mt-4 text-center font-display text-2xl font-700">${c.name}</h3>
        ${c.firstSaleDate ? `<p class="text-xs text-slate-500">Released ${c.firstSaleDate}</p>` : ""}

        <div class="mt-5 w-full">${oddsBar(c)}</div>

        <div class="mt-6 flex w-full flex-col gap-2">
          <button id="open1" class="btn-primary w-full text-base">
            Open Case — ${usd(KEY_COST)}
          </button>
          <div class="grid grid-cols-2 gap-2">
            <button id="open10" class="btn-ghost text-sm">Open ×10</button>
            <button id="fastToggle" class="btn-ghost text-sm">Fast: <span id="fastState">${state.fast ? "ON" : "OFF"}</span></button>
          </div>
          <p class="mt-1 text-center text-[11px] text-slate-500">
            Drop float is random (lower = better). 10% StatTrak. Prices reflect the exact wear you pull.
          </p>
        </div>
      </div>

      <div>
        <h3 class="mb-3 font-display text-lg font-600 tracking-wide text-slate-300">Contents & live market</h3>
        <div class="space-y-5">${pool}</div>
      </div>
    </div>`;

  $("#backBtn").onclick = goHome;
  $("#open1").onclick = () => openCase(1);
  $("#open10").onclick = () => openCase(10);
  $("#fastToggle").onclick = () => {
    state.fast = !state.fast;
    $("#fastState").textContent = state.fast ? "ON" : "OFF";
    save();
  };

  $("#homeView").classList.add("hidden");
  view.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

function goHome() {
  state.current = null;
  $("#caseView").classList.add("hidden");
  $("#homeView").classList.remove("hidden");
}

/* ============================ opening flow ============================== */
let opening = false;

function canAfford(n) {
  if (state.balance < KEY_COST * n) {
    toast(`Not enough balance — need ${usd(KEY_COST * n)}. Click “+ Funds”.`);
    return false;
  }
  return true;
}

function recordDrop(drop) {
  state.balance -= KEY_COST;
  state.stats.opened++;
  state.stats.spent = round2(state.stats.spent + KEY_COST);
  state.stats.unboxedValue = round2(state.stats.unboxedValue + drop.price);
  if (!state.stats.best || drop.price > state.stats.best.price) {
    state.stats.best = { name: drop.name, price: drop.price, color: drop.color };
  }
  state.inventory.unshift(drop);
}

async function openCase(n) {
  if (opening) return; // guards every path against rapid double-clicks
  const c = state.current;
  if (!canAfford(n)) return;
  opening = true;
  try {
    ensureAudio();
    if (n === 1 && !state.fast) {
      const drop = rollDrop(c);
      recordDrop(drop);
      updateChrome();
      save();
      await runReel(c, drop);
      showResult([drop]);
    } else {
      const drops = [];
      for (let i = 0; i < n; i++) {
        const d = rollDrop(c);
        recordDrop(d);
        drops.push(d);
      }
      updateChrome();
      save();
      revealSound(bestTier(drops));
      showResult(drops);
    }
  } finally {
    opening = false;
  }
}

function bestTier(drops) {
  let best = "mil-spec";
  for (const d of drops)
    if (TIER_ORDER.indexOf(d.tier) > TIER_ORDER.indexOf(best)) best = d.tier;
  return best;
}

/* ---------------------------- the reel ---------------------------------- */
function reelCard(item, tier) {
  return `
    <div class="reel-cell ${tierClass(tier)} mx-1 flex h-36 w-40 shrink-0 flex-col items-center justify-center rounded-lg p-2"
         style="background:linear-gradient(180deg,color-mix(in srgb,var(--tier) 25%,transparent),rgba(10,14,22,.25));border-bottom:3px solid var(--tier)">
      <img src="${item.image}" alt="" class="max-h-20 max-w-full object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,.5)]" />
      <span class="mt-1 line-clamp-1 w-full text-center text-[10px] text-slate-300">${item.name}</span>
    </div>`;
}

function weightedFiller(c) {
  // Mostly common fillers, occasional rare — just for show.
  const t = rollTier(c);
  const pool = t === "gold" ? c.rareItems : c.items.filter((i) => i.tier === t);
  const item = pick(pool);
  return { item, tier: t };
}

function runReel(c, drop) {
  return new Promise((resolve) => {
    const overlay = $("#openOverlay");
    const reel = $("#reel");
    $("#openCaseName").textContent = c.name;

    const WIN = 48;
    const TOTAL = 56;
    const cells = [];
    for (let i = 0; i < TOTAL; i++) {
      if (i === WIN) cells.push({ item: drop, tier: drop.tier });
      else cells.push(weightedFiller(c));
    }
    reel.innerHTML = cells.map((x) => reelCard(x.item, x.tier)).join("");

    overlay.style.display = "flex";
    reel.style.transition = "none";
    reel.style.transform = "translateX(0)";

    // measure after layout
    requestAnimationFrame(() => {
      const winEl = reel.children[WIN];
      const viewport = reel.parentElement; // the overflow-hidden wrapper
      const stride = reel.children[1].offsetLeft - reel.children[0].offsetLeft;
      const jitter = (Math.random() - 0.5) * (winEl.offsetWidth * 0.7);
      const target =
        winEl.offsetLeft + winEl.offsetWidth / 2 - viewport.clientWidth / 2 + jitter;

      // tick loop driven by real position
      let lastIdx = -1;
      let running = true;
      const startX = 0;
      function frame() {
        if (!running) return;
        const tx = currentTranslate(reel);
        const contentX = -tx + viewport.clientWidth / 2;
        const idx = Math.floor(contentX / stride);
        if (idx !== lastIdx) {
          lastIdx = idx;
          tick();
        }
        requestAnimationFrame(frame);
      }

      requestAnimationFrame(() => {
        reel.style.transition = "transform 6.2s cubic-bezier(0.08,0.75,0.12,1)";
        reel.style.transform = `translateX(${-target}px)`;
        requestAnimationFrame(frame);
      });

      const done = () => {
        running = false;
        reel.removeEventListener("transitionend", done);
        revealSound(drop.tier);
        setTimeout(() => {
          overlay.style.display = "none";
          resolve();
        }, 450);
      };
      reel.addEventListener("transitionend", done);
      // safety fallback if transitionend never fires
      setTimeout(() => running && done(), 7200);
    });
  });
}

function currentTranslate(el) {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  const m = t.match(/matrix.*\((.+)\)/);
  if (!m) return 0;
  const v = m[1].split(",").map(parseFloat);
  return t.startsWith("matrix3d") ? v[12] : v[4];
}

/* --------------------------- result modal ------------------------------- */
function dropArt(d, big) {
  const st = d.stattrak
    ? `<span class="rounded bg-orange-500/90 px-1.5 py-0.5 text-[10px] font-700 text-ink-900">ST™</span>`
    : "";
  const phase = d.phase ? ` <span class="text-slate-400">(${d.phase})</span>` : "";
  const size = big ? "h-40" : "h-20";
  return `
    <div class="grid place-items-center rounded-lg bg-ink-900/60 p-3">
      <img src="${d.image}" alt="${d.name}" class="${size} max-w-full object-contain drop-shadow-[0_8px_20px_rgba(0,0,0,.6)]" />
    </div>
    <div class="mt-2 flex items-center gap-2">
      ${st}
      <span class="line-clamp-1 font-600 ${big ? "text-lg" : "text-sm"} text-slate-100">${d.name}${phase}</span>
    </div>`;
}

function dropDetails(d) {
  const floatLine =
    d.float == null
      ? `<div class="flex justify-between"><span class="text-slate-500">Wear</span><span class="font-mono">Vanilla ★</span></div>`
      : `
      <div class="flex justify-between"><span class="text-slate-500">Exterior</span><span class="font-mono">${d.wearName} (${d.wearShort})</span></div>
      <div>
        <div class="flex justify-between"><span class="text-slate-500">Float</span><span class="font-mono">${d.float.toFixed(8)}</span></div>
        <div class="mt-1 h-1.5 w-full rounded-full bg-ink-900 ring-1 ring-white/10 overflow-hidden relative">
          <div class="absolute inset-y-0 left-0" style="width:${d.float * 100}%;background:linear-gradient(90deg,#34d399,#fbbf24,#f43f5e)"></div>
          <div class="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-white" style="left:${d.float * 100}%"></div>
        </div>
      </div>
      <div class="flex justify-between"><span class="text-slate-500">Pattern</span><span class="font-mono">#${d.pattern}</span></div>`;
  return `
    <div class="mt-3 space-y-1.5 text-sm">
      <div class="flex justify-between"><span class="text-slate-500">Rarity</span>
        <span class="font-600" style="color:${d.color}">${d.rarityName}</span></div>
      ${floatLine}
      <div class="flex justify-between"><span class="text-slate-500">StatTrak™</span><span class="font-mono ${d.stattrak ? "text-orange-400" : "text-slate-400"}">${d.stattrak ? "Yes" : "No"}</span></div>
      <div class="flex justify-between border-t border-white/5 pt-2"><span class="text-slate-500">Market value</span>
        <span class="font-mono text-lg text-emerald-400">${usd(d.price)}</span></div>
    </div>`;
}

function showResult(drops) {
  const modal = $("#resultModal");
  const card = $("#resultCard");
  const multi = drops.length > 1;
  const top = drops.reduce((a, b) => (b.price > a.price ? b : a));
  const totalValue = round2(drops.reduce((s, d) => s + d.price, 0));
  const spent = round2(drops.length * KEY_COST);
  const net = round2(totalValue - spent);
  const accent = top.color;

  if (TIER_ORDER.indexOf(top.tier) >= 3) {
    document.body.classList.add("animate-shake");
    setTimeout(() => document.body.classList.remove("animate-shake"), 600);
  }

  const header = `
    <div class="relative px-6 pt-6 text-center" style="background:radial-gradient(120% 80% at 50% 0,${accent}22,transparent 70%)">
      <div class="absolute inset-x-0 top-0 h-1" style="background:${accent}"></div>
      <p class="font-display text-sm uppercase tracking-widest" style="color:${accent}">
        ${multi ? `${drops.length} drops` : TIER_LABEL[top.tier] + (top.stattrak ? " · StatTrak™" : "")}
      </p>
    </div>`;

  let bodyHtml;
  if (!multi) {
    const d = drops[0];
    bodyHtml = `
      <div class="px-6 pb-6 animate-pop-in">
        ${dropArt(d, true)}
        ${dropDetails(d)}
        <p class="mt-3 text-center text-xs ${net >= 0 ? "text-emerald-400" : "text-rose-400"}">
          ${net >= 0 ? "Profit" : "Loss"} on this open: ${usd(Math.abs(net))}
        </p>
        <div class="mt-4 grid grid-cols-2 gap-2">
          <button id="sellBtn" class="btn-ghost">Sell ${usd(d.price)}</button>
          <button id="againBtn" class="btn-primary">Open again — ${usd(KEY_COST)}</button>
        </div>
      </div>`;
  } else {
    const grid = drops
      .map(
        (d) => `
      <div class="item-card ${tierClass(d.tier)} rounded-lg p-2 ${d.tier === "gold" ? "ring-2 ring-rarity-gold" : ""}">
        <div class="aspect-[4/3] grid place-items-center"><img src="${d.image}" class="max-h-16 max-w-full object-contain" alt="${d.name}" /></div>
        <div class="line-clamp-1 text-[11px] text-slate-200">${d.stattrak ? "ST™ " : ""}${d.name}</div>
        <div class="flex justify-between text-[10px]"><span class="text-slate-500">${d.wearShort}</span><span class="font-mono text-emerald-400">${usd(d.price)}</span></div>
      </div>`
      )
      .join("");
    bodyHtml = `
      <div class="px-6 pb-6">
        <div class="grid grid-cols-3 gap-2 sm:grid-cols-5 animate-fade-in">${grid}</div>
        <div class="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
          <div><div class="text-xs text-slate-500">Spent</div><div class="font-mono">${usd(spent)}</div></div>
          <div><div class="text-xs text-slate-500">Value</div><div class="font-mono text-emerald-400">${usd(totalValue)}</div></div>
          <div><div class="text-xs text-slate-500">Net</div><div class="font-mono ${net >= 0 ? "text-emerald-400" : "text-rose-400"}">${net >= 0 ? "+" : "−"}${usd(Math.abs(net))}</div></div>
        </div>
        <div class="mt-4 grid grid-cols-2 gap-2">
          <button id="sellAllBtn" class="btn-ghost">Sell all ${usd(totalValue)}</button>
          <button id="againBtn" class="btn-primary">Open ×10 again</button>
        </div>
      </div>`;
  }

  card.innerHTML = header + bodyHtml;
  modal.style.display = "flex";

  const close = () => (modal.style.display = "none");

  if (!multi) {
    $("#sellBtn").onclick = () => {
      sellDrop(drops[0]);
      close();
    };
    $("#againBtn").onclick = () => {
      close();
      openCase(1);
    };
  } else {
    $("#sellAllBtn").onclick = () => {
      drops.forEach(sellDrop);
      close();
    };
    $("#againBtn").onclick = () => {
      close();
      openCase(10);
    };
  }
}

function sellDrop(drop) {
  const idx = state.inventory.findIndex((d) => d.time === drop.time);
  if (idx === -1) return; // already sold
  state.inventory.splice(idx, 1);
  state.balance = round2(state.balance + drop.price);
  updateChrome();
  save();
  toast(`Sold ${drop.name} for ${usd(drop.price)}`);
}

/* --------------------------- inventory ---------------------------------- */
function renderInventory() {
  const stats = state.stats;
  const net = round2(stats.unboxedValue - stats.spent);
  $("#invStats").innerHTML = `
    <div><div class="text-xs text-slate-500">Opened</div><div class="font-mono text-lg">${stats.opened}</div></div>
    <div><div class="text-xs text-slate-500">Spent</div><div class="font-mono text-lg text-rose-300">${usd(stats.spent)}</div></div>
    <div><div class="text-xs text-slate-500">Net</div><div class="font-mono text-lg ${net >= 0 ? "text-emerald-400" : "text-rose-400"}">${net >= 0 ? "+" : "−"}${usd(Math.abs(net))}</div></div>`;

  const list = $("#invList");
  if (!state.inventory.length) {
    list.innerHTML = `<p class="py-10 text-center text-sm text-slate-500">No items yet. Go open a case!</p>`;
    return;
  }
  list.innerHTML = state.inventory
    .map(
      (d, i) => `
    <div class="item-card ${tierClass(d.tier)} flex items-center gap-3 rounded-lg p-2">
      <img src="${d.image}" class="h-12 w-16 shrink-0 object-contain" alt="${d.name}" />
      <div class="min-w-0 flex-1">
        <div class="line-clamp-1 text-sm font-600 text-slate-100">${d.stattrak ? '<span class="text-orange-400">ST™ </span>' : ""}${d.name}</div>
        <div class="text-[11px] text-slate-500">${d.wearShort}${d.float != null ? " · " + d.float.toFixed(4) : ""}${d.pattern != null ? " · #" + d.pattern : ""}</div>
      </div>
      <div class="text-right">
        <div class="font-mono text-sm text-emerald-400">${usd(d.price)}</div>
        <button data-sell="${i}" class="text-[11px] text-slate-400 underline hover:text-slate-200">sell</button>
      </div>
    </div>`
    )
    .join("");
  $$("[data-sell]", list).forEach((b) => {
    b.onclick = () => {
      sellDrop(state.inventory[+b.dataset.sell]);
      renderInventory();
    };
  });
}

function openInventory() {
  renderInventory();
  $("#inventoryDrawer").style.display = "block";
}

/* --------------------------- chrome / wallet ---------------------------- */
function updateChrome() {
  $("#balance").textContent = usd(state.balance);
  $("#invCount").textContent = state.inventory.length;
}

/* ============================ boot ===================================== */
async function boot() {
  load();
  try {
    const [cases, meta] = await Promise.all([
      fetch("./data/cases.json").then((r) => r.json()),
      fetch("./data/meta.json").then((r) => r.json()),
    ]);
    state.cases = cases;
    state.meta = meta;
    cases.forEach((c) => state.byId.set(c.id, c));
  } catch (e) {
    $("#caseGrid").innerHTML = `<p class="col-span-full py-10 text-center text-rose-300">
      Couldn't load case data. Run <code class="font-mono">npm run fetch</code> first.</p>`;
    return;
  }

  updateChrome();
  renderHome();

  // events
  $("#caseGrid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-case]");
    if (btn) renderCase(state.byId.get(btn.dataset.case));
  });
  $("#caseSearch").addEventListener("input", (e) => renderCaseGrid(e.target.value));
  $("#brandBtn").onclick = goHome;
  $("#inventoryBtn").onclick = openInventory;
  $$("[data-close-inv]").forEach(
    (el) => (el.onclick = () => ($("#inventoryDrawer").style.display = "none"))
  );
  $("#addFundsBtn").onclick = () => {
    state.balance = round2(state.balance + 100);
    updateChrome();
    save();
    toast("+ $100.00 added");
  };
  $("#resetBtn").onclick = () => {
    if (!confirm("Reset balance, inventory and stats?")) return;
    store.removeItem(STORAGE_KEY);
    state.balance = START_BALANCE;
    state.inventory = [];
    state.stats = { opened: 0, spent: 0, unboxedValue: 0, best: null };
    updateChrome();
    renderInventory();
    toast("Everything reset");
  };

  // close modals on backdrop / Esc
  $("#resultModal").addEventListener("click", (e) => {
    if (e.target.id === "resultModal") e.currentTarget.style.display = "none";
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      $("#resultModal").style.display = "none";
      $("#inventoryDrawer").style.display = "none";
    }
  });
}

boot();
