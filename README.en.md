# Gomoku · Liquid Glass

**[简体中文](README.md)** · Browser **Gomoku** (five-in-a-row) with **React 19**, **TypeScript**, and **Vite** — dark liquid-glass UI, human vs AI, local history & replay, and a pattern encyclopedia with board demos.

**Changelog:** [CHANGELOG.md](CHANGELOG.md)

**Live demo (GitHub Pages):** [stianyu798-arch.github.io/Liquid-Glass-Gomoku](https://stianyu798-arch.github.io/Liquid-Glass-Gomoku/)

---

## Features

| Area | Description |
|------|-------------|
| **Play** | 15×15; you are black, AI is white; **easy** (after tactics, **softmax temperature** over heuristic scores); **normal** (**alpha-beta**); **hard** (deeper **α-β** + root **Monte Carlo rollouts**; forced blocks mainly for severe threats—open-three class threats are left to search to balance **attack vs defense**; **no** neural net). |
| **Scoring & names** | In **easy** mode, shapes are scored and named; moves show in the side move list. |
| **Hints (easy)** | Suggested intersection can be highlighted on your turn (other modes: no hint). |
| **Win & line** | Five in a row wins, line highlighted; “New game” can pulse after the game. |
| **History** | Games stored locally in the browser; select a game, step or auto-replay; aggregate duel bar and per-game replay. |
| **Encyclopedia** | Pattern templates with animated demos and text on the right. |
| **Pattern import** | Bring a demo position into human vs AI when rules allow; optional random simulation until a translatable match appears; prompts when the next player is white. |
| **UI** | Responsive layout; on narrow screens the main column stacks vertically; play view keeps the side column aligned with the board; history view lets the side panel end with its content (no huge empty glass on long screens). |

---

## Tech stack

- **React 19**, **TypeScript**, **Vite 8** (`@vitejs/plugin-react`)
- **ESLint** (`typescript-eslint`, React Hooks)

All game and AI logic runs **in the browser**. **No backend.** **Normal / hard** AI search runs in a **Web Worker** (`src/ai/ai.worker.ts`); **easy** stays on the main thread. Shared logic lives in `src/ai/engine.ts`: **normal** uses neighborhood-based leaf eval; **hard** can use full-board line-pattern diff plus move ordering / radius-2 candidates (see **Hard** above).

### AI notes & references

- **Easy**: After forced win/block, **softmax sampling** over candidates (temperature in `EASY_SOFTMAX_TEMPERATURE`).
- **Normal**: **Alpha-beta** with `pickBestMoveMinimax(board, 3)`; leaf eval slightly favors defense (opponent best point ×1.08).
- **Hard**: **Alpha-beta** (deeper) then root **Monte Carlo rollouts** (`pickBestMoveHardHybrid`); the hard search path can use a **doc-style full-board line pattern diff** at leaves, **move ordering** by quick post-move board score, and **candidate radius 2**, together with the existing **instant-block** threshold and weights. **No** neural net.
- **External refs**: [gomoku_rl](https://github.com/guokezhen999/gomoku_rl) (deep RL / PyTorch); [gobang](https://github.com/lihongxun945/gobang) (classic alpha-beta, JS). Independent of this frontend—see in-app **About**.

---

## Requirements

- **Node.js** 20+ recommended
- Modern browser (`backdrop-filter`, CSS grid/flex, etc.)

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
- **`base: './'`** in `vite.config.ts` — relative URLs, works on **GitHub Pages** under any repo path.

This repo includes a **GitHub Actions** workflow (`.github/workflows/deploy-pages.yml`) that builds and deploys on push to **`main`** or **`master`**. In **Settings → Pages**, set the source to **GitHub Actions** to match the workflow.

Typical site URL:

`https://<user>.github.io/<repo>/`

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
│   │   ├── engine.ts       # AI search & eval (neighborhood / hard global-line diff)
│   │   └── ai.worker.ts    # normal/hard off the main thread
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
