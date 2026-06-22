#!/usr/bin/env node
/**
 * CaseSim data builder.
 *
 * 1. Pulls the real CS2 crate catalogue (cases, items, Steam CDN images, rarities,
 *    paint indexes, knife/glove finishes) from the open ByMykel/CSGO-API dataset.
 * 2. Pulls real current market prices from Skinport's public bulk API and bakes a
 *    hard-coded price for every item — per exterior (FN/MW/FT/WW/BS) and StatTrak —
 *    so the value you see reflects the exact wear you unbox.
 * 3. Where Skinport has no listing for an item, prices are filled from the nearest
 *    real wear (or modelled as a last resort) so nothing is ever blank.
 *
 * Output:
 *   public/data/cases.json  — the full catalogue used by the front end
 *   public/data/meta.json   — build metadata (generatedAt, counts, price coverage)
 *
 * Run with:  npm run fetch     (re-pulls fresh current prices)
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "public", "data");

const CRATES_URL =
  "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/crates.json";
const PRICES_URL =
  "https://api.skinport.com/v1/items?app_id=730&currency=USD";

/* Official CS2 case drop chances (per opening) — they sum to 100%. */
const TIER_ODDS = {
  "mil-spec": 0.7992,
  restricted: 0.1598,
  classified: 0.032,
  covert: 0.0064,
  gold: 0.0026,
};
const RARITY_TO_TIER = {
  "Mil-Spec Grade": "mil-spec",
  Restricted: "restricted",
  Classified: "classified",
  Covert: "covert",
};
const TIER_COLOR = {
  "mil-spec": "#4b69ff",
  restricted: "#8847ff",
  classified: "#d32ce6",
  covert: "#eb4b4b",
  gold: "#f4c20d",
};

/* Exteriors with rough relative value (used only to fill wears Skinport lacks). */
const WEARS = [
  ["FN", "Factory New", 1.55],
  ["MW", "Minimal Wear", 1.22],
  ["FT", "Field-Tested", 1.0],
  ["WW", "Well-Worn", 0.82],
  ["BS", "Battle-Scarred", 0.68],
];
const REF_PRIORITY = ["FT", "MW", "FN", "WW", "BS"];
const multOf = (short) => WEARS.find((w) => w[0] === short)[2];

/* Modelled fallback bands (USD) when an item isn't listed anywhere. */
const PRICE_BANDS = {
  "mil-spec": [0.08, 6],
  restricted: [0.4, 18],
  classified: [1.5, 75],
  covert: [6, 320],
  gloves: [45, 1900],
  knife: [70, 2400],
};

/* ----------------------------- helpers ---------------------------------- */
function hashUnit(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}
const logUniform = (lo, hi, u) =>
  Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * u);
const round2 = (n) => Math.round(n * 100) / 100;
const isGlove = (name) => /(Gloves|Hand Wraps|Wraps)/i.test(name);

/** Build the exact Steam/Skinport market_hash_name for a name + wear + StatTrak. */
function marketName(name, wearName, st) {
  let n = name;
  if (name.startsWith("★ ")) n = st ? "★ StatTrak™ " + name.slice(2) : name;
  else n = st ? "StatTrak™ " + name : name;
  return wearName ? `${n} (${wearName})` : n;
}

/* ------------------------------ fetch ----------------------------------- */
async function fetchJson(url, label) {
  const res = await fetch(url, { headers: { "user-agent": "CaseSim/1.0" } });
  if (!res.ok) throw new Error(`${label} fetch failed: HTTP ${res.status}`);
  return res.json();
}

async function fetchPriceMap() {
  const list = await fetchJson(PRICES_URL, "prices");
  const map = new Map();
  for (const e of list) {
    const v =
      e.suggested_price ?? e.min_price ?? e.median_price ?? e.mean_price;
    if (typeof v === "number" && v > 0) map.set(e.market_hash_name, round2(v));
  }
  return map;
}

/* ------------------------------ build ----------------------------------- */
let coverage = { real: 0, total: 0 };

function buildItem(raw, tier, prices) {
  const name = raw.name;
  const glove = tier === "gold" && isGlove(name);
  const kind = tier === "gold" ? (glove ? "glove" : "knife") : "weapon";
  const finished = name.includes("|");
  const stEligible = kind !== "glove";
  const sp = (mhn) => prices.get(mhn) ?? null;

  let priceMap = {};
  let stMap = stEligible ? {} : null;
  let estimated = false;
  let headline;

  if (finished) {
    const real = {};
    const realSt = {};
    for (const [short, wn] of WEARS) {
      real[short] = sp(marketName(name, wn, false));
      if (stEligible) realSt[short] = sp(marketName(name, wn, true));
    }

    let refShort = REF_PRIORITY.find((s) => real[s] != null);
    let refPrice;
    let refMult;
    if (refShort) {
      refPrice = real[refShort];
      refMult = multOf(refShort);
    } else {
      estimated = true;
      const band = tier === "gold" ? (glove ? "gloves" : "knife") : tier;
      const [lo, hi] = PRICE_BANDS[band];
      refShort = "FT";
      refMult = 1.0;
      refPrice = round2(logUniform(lo, hi, hashUnit("base:" + name)));
    }

    // StatTrak ratio: average of real ST/normal pairs, else a sensible default.
    let stRatio = kind === "weapon" ? 1.3 : 1.15;
    if (stEligible) {
      const r = [];
      for (const [short] of WEARS)
        if (real[short] && realSt[short]) r.push(realSt[short] / real[short]);
      if (r.length) stRatio = r.reduce((a, b) => a + b, 0) / r.length;
    }

    for (const [short, , mult] of WEARS) {
      const p = real[short] ?? round2(refPrice * (mult / refMult));
      priceMap[short] = Math.max(0.03, p);
      if (stEligible) {
        const ps = realSt[short] ?? round2(priceMap[short] * stRatio);
        stMap[short] = Math.max(0.03, ps);
      }
    }
    headline = priceMap[refShort];
  } else {
    // vanilla knife / item with no exterior
    let p = sp(marketName(name, null, false));
    let ps = stEligible ? sp(marketName(name, null, true)) : null;
    if (p == null) {
      estimated = true;
      const [lo, hi] = PRICE_BANDS[glove ? "gloves" : "knife"];
      p = round2(logUniform(lo, hi, hashUnit("base:" + name)));
    }
    priceMap = { VN: Math.max(0.03, p) };
    if (stEligible) stMap = { VN: Math.max(0.03, ps ?? round2(p * 1.15)) };
    headline = priceMap.VN;
  }

  coverage.total++;
  if (!estimated) coverage.real++;

  return {
    id: raw.id,
    name,
    image: raw.image,
    tier,
    rarityName: tier === "gold" ? "Rare Special Item" : raw.rarity?.name ?? "",
    color: TIER_COLOR[tier],
    paintIndex: raw.paint_index ?? null,
    phase: raw.phase ?? null,
    special: tier === "gold",
    kind,
    price: round2(headline),
    prices: priceMap,
    stPrices: stMap,
    estimated,
  };
}

async function main() {
  let crates;
  let prices;
  try {
    console.log("→ fetching real CS2 catalogue + current Skinport prices …");
    [crates, prices] = await Promise.all([
      fetchJson(CRATES_URL, "crates"),
      fetchPriceMap().catch((e) => {
        console.warn(`! prices unavailable (${e.message}); modelling prices.`);
        return new Map();
      }),
    ]);
  } catch (err) {
    console.warn(`! could not fetch catalogue (${err.message}).`);
    if (existsSync(join(OUT_DIR, "cases.json"))) {
      console.warn("  keeping the existing cached catalogue unchanged.");
      return;
    }
    throw new Error("No network and no cached data — connect once to build.");
  }

  const sourceCases = crates.filter((c) => c.type === "Case");
  const cases = sourceCases.map((c) => {
    const items = [];
    for (const it of c.contains ?? []) {
      const tier = RARITY_TO_TIER[it.rarity?.name];
      if (tier) items.push(buildItem(it, tier, prices));
    }
    const rareItems = (c.contains_rare ?? []).map((it) =>
      buildItem(it, "gold", prices)
    );

    const present = new Set(items.map((i) => i.tier));
    if (rareItems.length) present.add("gold");
    let total = 0;
    for (const t of present) total += TIER_ODDS[t];
    const odds = {};
    for (const t of present) odds[t] = TIER_ODDS[t] / total;

    return {
      id: c.id,
      name: c.name,
      image: c.image,
      description: c.description ?? "",
      firstSaleDate: c.first_sale_date ?? null,
      odds,
      items,
      rareItems,
    };
  });
  cases.sort((a, b) =>
    (b.firstSaleDate ?? "0").localeCompare(a.firstSaleDate ?? "0")
  );

  let commit = null;
  try {
    commit = execSync("git rev-parse --short HEAD", { cwd: ROOT })
      .toString()
      .trim();
  } catch {
    /* no commits yet */
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    commit,
    caseCount: cases.length,
    itemCount: coverage.total,
    priceSource: "Skinport (suggested price), USD",
    catalogueSource: "ByMykel/CSGO-API",
    priceCoverage: `${coverage.real}/${coverage.total} items priced from live listings`,
    odds: TIER_ODDS,
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "cases.json"), JSON.stringify(cases));
  await writeFile(join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2));

  console.log(
    `✓ ${cases.length} cases / ${coverage.total} items — ${coverage.real} priced from live Skinport listings`
  );
}

main().catch((err) => {
  console.error("✗ build failed:", err.message);
  process.exit(1);
});
