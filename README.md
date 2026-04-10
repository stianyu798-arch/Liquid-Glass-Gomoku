# 五子棋 · Liquid Glass（Gomoku）

**[English](README.en.md)** · 基于 **React 19 + TypeScript + Vite** 的浏览器五子棋，深色 **Liquid Glass** 风格：人机对弈、本地历史回放、招式大全与棋盘演示。

**迭代记录：** 见 [CHANGELOG.md](CHANGELOG.md)（建议每次推送 `main` 时追加一条）。

---

## 功能概览

| 模块 | 说明 |
|------|------|
| **人机对弈** | 15×15；你执黑、AI 执白；**简单**（必胜/必防后，候选点按估值 **softmax 温度**抽样）；**普通**（**α-β**，深度高于简单）；**困难**（更深 α-β + 根节点 **蒙特卡洛 rollout**；**非**神经网络）。 |
| **评分与招式命名** | 简单模式下关键棋形打分、命名（活三、冲四、成五等），侧栏「招式板」展示本局走势。 |
| **落子提示（简单）** | 轮到你时可显示推荐点提示光（其他难度不提示）。 |
| **胜负与连线** | 五连判胜并高亮；终局后「重新开局」可呼吸高亮。 |
| **历史查看** | 对局写入 **localStorage**，列表选择、步进/自动回放。 |
| **招式大全** | 棋形模板 + 棋盘演示动画，右侧文字说明。 |
| **棋形导入续弈** | 在满足规则的前提下，可将演示局面带入人机对弈；支持随机模拟至可匹配阵势后再行棋；续弈时若下一手为白方，会先显示「对方在下」/「轮到你」等提示。 |
| **界面与布局** | 棋盘与网格随容器/视口**自适应缩放**；主区与侧栏**响应式间距**；视口不足时主区/侧栏可出现**纵向滚动**（`overflow-y: auto`）。**人机**侧栏高度与棋盘外包（`.board-wrap`）对齐；**历史查看**右侧玻璃随内容结束于回放与「对抗条」之下，避免长屏下玻璃内部被无谓拉高。 |

---

## 技术栈

- **React 19**、**TypeScript**、**Vite 8**（`@vitejs/plugin-react`）
- **ESLint**（`typescript-eslint`、React Hooks）

对局与 AI 为**纯前端**（棋形匹配、静态估值、minimax + α-β 等），无后端。**普通 / 困难** 档的 AI 思考在 **Web Worker**（`src/ai/ai.worker.ts`）中执行，避免长时间占用主线程导致界面卡顿；简单档仍在主线程（计算量小）。叶节点静态估值在 `src/ai/engine.ts` 中单遍计算，减轻搜索开销。

### AI 说明与延伸阅读（困难模式 & 深度学习）

- **本作「简单」档**：在必胜、必防对方冲五之后，对 `generateMoveCandidates` 给出的候选按静态估值做 **softmax 抽样**（温度常数见 `EASY_SOFTMAX_TEMPERATURE`），属常见「带温度策略」弱棋力设计，而非固定名次瞎选。
- **本作「普通」档**：**α-β**（`pickBestMoveMinimax(board, 3)`），搜索深度高于简单档，接近常见「中等 minimax」配置。
- **本作「困难」档**：**启发式 + α-β** 得到若干强候选后，在根节点对每候选做多局 **随机 rollout** 至终局，按白方胜率加权选点（`pickBestMoveHardHybrid`，见 `src/ai/engine.ts`），与 AlphaZero/MCTS 中的**模拟**思想一致，**无**神经网络权重。
- **基于深度强化学习的五子棋 AI 框架（参考）**：社区开源 **[gomoku_rl](https://github.com/guokezhen999/gomoku_rl)**（Python / PyTorch）探索 **MCTS、PPO、策略–价值网络** 等，README 中自述为基于深度强化学习的五子棋 AI 方向，适合作为**算法与工程参考**；若要将模型接入 Web，通常需另行导出推理格式（如 ONNX）或自建服务，不在当前项目范围内。
- **经典 α-β 五子棋 AI（参考）**：[**gobang**](https://github.com/lihongxun945/gobang)（JavaScript）基于 **Alpha-Beta 剪枝**，作者说明**未使用神经网络**，附系列教程，可与本作搜索型实现对照阅读。

---

## 环境要求

- **Node.js** 建议 **20+**（与 CI 中 Node 22 一致即可）
- 现代浏览器（`backdrop-filter`、CSS 网格/flex 等）

---

## 本地开发

```bash
npm install
npm run dev
```

终端中的本地地址一般为 `http://localhost:5173`（端口以终端输出为准）。

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发服务器（热更新） |
| `npm run build` | 类型检查 + 生产构建 → `dist/` |
| `npm run preview` | 本地预览构建结果 |
| `npm run lint` | ESLint |

---

## 构建说明

- 输出目录：**`dist/`**
- `vite.config.ts` 中 **`base: './'`**，资源为相对路径，适合 **GitHub Pages** 任意仓库路径，一般**无需**因仓库改名改配置。

---

## 数据与隐私

- 历史对局保存在浏览器 **`localStorage`**（键名见源码 `HISTORY_KEY`），**不上传服务器**。

---

## 上传到 Git 仓库（首次）

**请在 `gomoku-liquid-glass` 文件夹内**初始化 Git（与 `package.json` 同级），不要把整个用户主目录当成仓库；若误在上级目录执行过 `git init`，可在本目录单独执行：

```bash
cd /path/to/gomoku-liquid-glass
git init
```

然后（将远程地址换成你的 GitHub 仓库）：

```bash
git add .
git commit -m "chore: initial commit — Gomoku Liquid Glass"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

若远程已存在：`git remote set-url origin <新地址>` 后再 `git push`。

**建议**：使用本仓库自带的 **`.gitignore`**（忽略 `node_modules/`、`dist/` 等），勿提交依赖或构建产物。

---

## 上线 GitHub Pages

仓库含 **GitHub Actions**（`.github/workflows/deploy-pages.yml`）：推送到 **`main`** 或 **`master`** 时执行 `npm ci` → `npm run build` → 发布到 Pages。

1. 将代码推送到 GitHub（见上一节）。
2. 仓库 **Settings → Pages**：**Build and deployment** 的 **Source** 选 **GitHub Actions**（使用本工作流时不要选 “Deploy from a branch”，除非你自行改部署方式）。
3. **Actions** 中等待 **Deploy to GitHub Pages** 成功（通常约 1～2 分钟）。

**项目站 URL** 一般为：

```text
https://<你的用户名>.github.io/<仓库名>/
```

改名仓库后，只需把 URL 中的路径改成新仓库名。

---

## 目录结构（简要）

```text
gomoku-liquid-glass/
├── public/
├── src/
│   ├── ai/
│   │   ├── engine.ts       # AI 搜索与局面估值（主线程与 Worker 共用）
│   │   └── ai.worker.ts    # 普通/困难档 minimax 在 Worker 中运行
│   ├── App.tsx             # 对局 / 历史 / 招式 / 棋形导入
│   ├── App.css
│   ├── main.tsx
│   └── index.css
├── index.html
├── vite.config.ts
├── .github/workflows/      # GitHub Pages 部署
├── CHANGELOG.md            # 迭代说明（建议每次推送时更新）
├── README.md
├── README.en.md
└── package.json
```

---

## 许可

个人学习 / 展示用；需要可自行在仓库中添加 `LICENSE`。
