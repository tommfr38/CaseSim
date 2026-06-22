# ◈ CaseSim

A polished, free **CS2 case-opening simulator** built with **Tailwind CSS** and vanilla JS.
Open every Counter-Strike 2 case with real items, real Valve drop odds, true float
values, pattern seeds, StatTrak rolls — and a live market that re-prices on every push.

![cases](https://img.shields.io/badge/cases-42-amber) ![items](https://img.shields.io/badge/items-real-blue)

## Features

- **Every CS2 case** — catalogue, item images and rarities pulled live from the open
  [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API) dataset.
- **Real drop odds** — the official tier chances are applied per open:

  | Tier | Chance |
  |------|--------|
  | Mil-Spec (blue) | 79.92% |
  | Restricted (purple) | 15.98% |
  | Classified (pink) | 3.20% |
  | Covert (red) | 0.64% |
  | Rare Special — knife/glove (gold) | 0.26% |

- **Float & wear** — every drop rolls a uniform float `0.0` → `1.0` (lower = better),
  mapped to the correct exterior (FN/MW/FT/WW/BS). Vanilla knives have no float.
- **Pattern (paint) seed** — a `0–1000` seed on every finished skin.
- **StatTrak™** — 10% chance on everything except gloves.
- **Realistic effects** — the spinning roulette reel with real position-based tick
  sounds, rarity-coloured cards, reveal chimes, screen-shake on red/gold pulls.
- **Real, hard-coded prices** — every item's value is the current
  [Skinport](https://skinport.com) market price, baked in at build time **per exterior
  (FN/MW/FT/WW/BS) and StatTrak**. The price on a drop reflects the **exact wear, float
  and StatTrak** you pulled. Re-run `npm run fetch` to refresh to the latest prices.
- **Wallet & inventory** — start each session with **$1,000**; opening a case costs a
  $2.50 key, selling a drop pays out its market value. Lifetime profit/loss + best pull.
  The balance **resets every session** (state lives in `sessionStorage`).

> Prices are real, current Skinport "suggested" prices, fetched in bulk server-side at
> build time (Skinport's API has no CORS, so it can't be called from the browser — and
> Steam's market API is rate-limited with no CORS either, which is why prices are baked
> in rather than fetched live in-page). Everything else — cases, items, images, odds,
> floats, patterns — is real too.

## Quick start

```bash
npm install          # installs Tailwind
npm run build        # fetches real case data + builds tailwind.css
npm run serve        # http://localhost:4173
```

Or `npm run dev` to build and serve in one go. While styling, run
`npm run watch:css` in another terminal.

## Refreshing prices

Re-run the data builder any time to pull the latest current Skinport prices:

```bash
npm run fetch        # re-pulls catalogue + current market prices
```

To refresh **automatically on every commit/push**, install the git hook once:

```bash
npm run setup:hooks
```

This adds a `pre-commit` hook that re-fetches the catalogue + current prices, rebuilds
the CSS and stages the updated `public/data/*.json` + `styles.css` — so every commit
you push ships up-to-date prices.

## Project layout

```
src/input.css           Tailwind entry (directives + components)
tailwind.config.js      theme: rarity colours, fonts, animations
scripts/fetch-data.mjs  pulls real catalogue + builds the price model
scripts/serve.mjs       tiny dependency-free static server
scripts/setup-hooks.mjs installs the price-refresh git hook
public/index.html       app shell
public/app.js           all UI, rolling, reel animation, economy
public/data/*.json      generated catalogue + build metadata
public/assets/styles.css generated Tailwind output
```

## Deploy

It's a static site — point any static host (GitHub Pages, Netlify, Vercel, Cloudflare
Pages) at `public/`. Just run `npm run build` first so `data/` and `assets/` exist.

---

Fan-made, for entertainment. Not affiliated with Valve. No real money, no real items.
