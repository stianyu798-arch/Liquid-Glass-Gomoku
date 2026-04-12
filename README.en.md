# Gomoku · Liquid Glass

**[简体中文](README.md)** · Browser **Gomoku** (five-in-a-row) built with **React 19**, **TypeScript**, and **Vite** — dark **Liquid Glass** UI, human vs AI, local history, a pattern encyclopedia, and board demos.

|  |  |
|--|--|
| **Changelog** | [CHANGELOG.md](CHANGELOG.md) |
| **Live demo (GitHub Pages)** | [stianyu798-arch.github.io/Liquid-Glass-Gomoku](https://stianyu798-arch.github.io/Liquid-Glass-Gomoku/) |

---

## Overview

This project is **frontend-only**: no standalone client and no separate backend—all game data stays in your browser. The UI uses Liquid Glass–style panels and gradients. The board and side panels scale with the window; on narrow viewports the main column stacks vertically.

---

## Features

### Human vs AI

- **Board**: standard **15×15**; by default **you play black**, the AI plays white.
- **Easy**: plays forced defenses seriously, but is more casual the rest of the time—sometimes surprising. Candidates are sampled with **softmax temperature** over static scores. **Only this mode** offers move hints and pattern naming in the side list.
- **Normal**: searches deeper than Easy, steadier and stickier on defense; no hints—good for practicing reads. **Alpha-beta** search with **neighborhood-based** leaf evaluation.
- **Hard**: explores multiple candidates to find strong moves; deeper **alpha-beta** plus root **Monte Carlo rollouts**; leaves can use a **full-board line-pattern diff**, ordering, and neighborhood radius. Severe threats may still be blocked; otherwise search balances **attack vs defense**. **No neural network.**

### In-game helpers

- **Move list / trend (easy)**: important shapes get scores and names (open three, rush four, etc.).
- **Hints (easy)**: optional highlight on the suggested intersection on your turn.
- **Win & line**: five in a row wins with a highlighted line; “New game” can pulse after the game.

### History & encyclopedia

- **History**: games stored in **`localStorage`**; pick a game, step or auto-replay, with aggregate stats.
- **Encyclopedia**: pattern templates with board animation and text on the right.
- **Pattern import**: bring a demo position into human vs AI; optional random simulation until a translatable match appears; prompts when the next player is white.

### Layout & touch

- The board scales with its container; on **narrow screens** max edge length, header chrome, and glass padding are tuned so the grid stays usable.
- Intersections align with the grid and cross guides; on **coarse pointers**, hit targets are enlarged **without letting adjacent stones overlap** (see `.pt` in `App.css`).

---

## Tech stack

- **React 19**, **TypeScript**, **Vite 8** (`@vitejs/plugin-react`)
- **ESLint** (`typescript-eslint`, React Hooks)

### Architecture

- **All three** difficulty levels run AI in a **Web Worker** ([`src/ai/ai.worker.ts`](src/ai/ai.worker.ts)) so long searches don’t freeze the UI; falls back to the main thread if the worker is unavailable.
- Shared search and evaluation logic lives in [`src/ai/engine.ts`](src/ai/engine.ts).

### AI summary

| Mode | Notes |
|------|--------|
| **Easy** | After forced moves, softmax sampling over candidates (temperature: `EASY_SOFTMAX_TEMPERATURE`). |
| **Normal** | `pickBestMoveMinimax(board, 3)`; leaf eval slightly favors defense (opponent best ×1.08). |
| **Hard** | `pickBestMoveHardHybrid`: alpha-beta plus root MC rollouts; optional doc-style full-board line diff, quick ordering, radius-2 candidates. |

More context on motivation and references: see **About this project** below and the in-app **About** dialog.

---

## Requirements

- **Node.js** 20+ recommended
- Modern browser (`backdrop-filter`, CSS Grid / Flex, etc.)

---

## Local run

```bash
npm install
npm run dev
```

Open the URL printed in the terminal (often `http://localhost:5173`).

| Command | Description |
|--------|-------------|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Typecheck + production build → `dist/` |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |

---

## Build & deploy

- Build output: **`dist/`**
- **`base: './'`** in `vite.config.ts` — relative asset URLs for **GitHub Pages** under any repo path.

This repo includes [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml): push to **`main`** or **`master`** triggers build and deploy. In **Settings → Pages**, set the source to **GitHub Actions**.

Typical URL: `https://<user>.github.io/<repo>/`

---

## Data & privacy

History is stored only in the browser’s **`localStorage`**. **Nothing is uploaded** to a server.

---

## About this project

### Motivation

I wanted a browser-based Gomoku UI with a **Liquid Glass** feel: frosted glass, soft lighting, and clear functional zones on a dark canvas, bringing human vs AI, history replay, and pattern study into one view. With simple rules, pattern recognition, multiple difficulty levels, and game replay should feel like a single, smooth workflow—also a hands-on exercise in modern CSS and React state management.

### AI implementation & references

- **Easy**: Defends losing positions seriously, but plays more casually otherwise—sometimes unexpected. This mode includes move hints with highlights—good for newcomers or relaxed games.
- **Normal**: Deeper and steadier than Easy, stickier on defense; no hints—you judge the position yourself; good for building intuition.
- **Hard**: Explores multiple candidates to find the best reply; strongest overall and toughest to beat; no hints—for players who want a challenge. See `src/ai/engine.ts`; computation runs in a **Web Worker** to keep the UI responsive.

For **deep reinforcement learning** Gomoku frameworks (MCTS, PPO, policy–value nets, etc.), the community project [guokezhen999/gomoku_rl](https://github.com/guokezhen999/gomoku_rl) (Python / PyTorch) is an independent reference from this repo’s front-end search stack.

Classic **alpha-beta** Gomoku AI and tutorials: [lihongxun945/gobang](https://github.com/lihongxun945/gobang) (JavaScript; traditional search, no neural nets—useful for comparison).

### Date

April 11, 2026

### Author

石天宇 (Shi Tianyu)

### Tools

Cursor, DeepSeek

---

## Repository layout (short)

```text
gomoku-liquid-glass/
├── public/
├── src/
│   ├── ai/
│   │   ├── engine.ts       # Search & board evaluation
│   │   └── ai.worker.ts    # Normal / hard off the main thread
│   ├── App.tsx
│   ├── App.css
│   ├── main.tsx
│   └── index.css
├── index.html
├── vite.config.ts
├── .github/workflows/
├── CHANGELOG.md
├── README.md               # Chinese
├── README.en.md            # This file
└── package.json
```

---

## License

For learning / demo use; add a `LICENSE` file if you want a formal open-source license.
