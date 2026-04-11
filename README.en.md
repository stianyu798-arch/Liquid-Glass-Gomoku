# Gomoku · Liquid Glass

**[简体中文](README.md)** · Browser **Gomoku** (five-in-a-row) built with **React 19**, **TypeScript**, and **Vite** — dark liquid-glass UI, human vs AI, local history & replay, and a pattern encyclopedia with board demos.

|  |  |
|--|--|
| **Changelog** | [CHANGELOG.md](CHANGELOG.md) |
| **Live demo (GitHub Pages)** | [stianyu798-arch.github.io/Liquid-Glass-Gomoku](https://stianyu798-arch.github.io/Liquid-Glass-Gomoku/) |

---

## Overview

This project is **frontend-only**: no native app and no separate backend; data stays in your browser. The UI uses glass-style panels and gradients. The board and side panels scale with the window; on narrow viewports the main column stacks vertically, and in play mode the sidebar lines up with the board height to avoid large empty areas.

---

## Features

### Human vs AI

- **Board**: standard **15×15**; by default **you play black**, the AI plays white.
- **Easy**: after forced tactics (must-win / must-block, etc.), candidate moves are sampled with **softmax temperature** over static scores — varied play. **Only this mode** offers move hints and pattern naming in the side list.
- **Normal**: **alpha-beta** search with **neighborhood-based** leaf evaluation.
- **Hard**: deeper **alpha-beta** plus **Monte Carlo rollouts** at the root; leaves can use a **full-board line-pattern diff** aligned with the project docs, move ordering, and a neighborhood radius; severe threats may still be blocked instantly, while lighter threats are left to search to balance **attack vs defense**. **No neural network.**

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

- **Normal / hard** AI runs in a **Web Worker** ([`src/ai/ai.worker.ts`](src/ai/ai.worker.ts)) so long searches don’t freeze the UI; **easy** stays on the main thread.
- Shared search and evaluation logic lives in [`src/ai/engine.ts`](src/ai/engine.ts).

### AI summary

| Mode | Notes |
|------|--------|
| **Easy** | After forced moves, softmax sampling over candidates (temperature: `EASY_SOFTMAX_TEMPERATURE`). |
| **Normal** | `pickBestMoveMinimax(board, 3)`; leaf eval slightly favors defense (opponent best ×1.08). |
| **Hard** | `pickBestMoveHardHybrid`: alpha-beta plus root MC rollouts; optional doc-style full-board line diff, quick ordering, radius-2 candidates. |

**External references** (independent of this repo): [gomoku_rl](https://github.com/guokezhen999/gomoku_rl) (deep RL / PyTorch), [gobang](https://github.com/lihongxun945/gobang) (classic alpha-beta, JS). See in-app **About** for more.

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
