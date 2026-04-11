# 五子棋 · Liquid Glass（Gomoku）

**[English](README.en.md)** · 使用 **React 19、TypeScript、Vite** 实现的浏览器五子棋，深色 **Liquid Glass** 界面：人机对弈、本地历史、招式库与棋盘演示。

|------|------|
| **变更记录** | [CHANGELOG.md](CHANGELOG.md) |
| **在线试玩（GitHub Pages）** | [stianyu798-arch.github.io/Liquid-Glass-Gomoku](https://stianyu798-arch.github.io/Liquid-Glass-Gomoku/) |

---

## 项目简介

本项目是**纯前端**五子棋：无需安装客户端、无独立后端，数据保存在本机浏览器。界面采用Liquid Glass玻璃拟态与渐变，棋盘与侧栏随窗口自适应；窄屏下主内容纵向排布。

---

## 功能说明

### 人机对弈

- **棋盘**：标准 **15×15**，默认**你执黑、AI 执白**。
- **简单**：在必胜、必防等强制手段处理完后，对候选点按静态估值做 **softmax 温度抽样**，棋风有一定随机性；**仅此档**提供落子提示光与棋形评分命名。
- **普通**：**α-β 剪枝**搜索，叶节点采用**邻域启发**估值。
- **困难**：更深的 **α-β**，并在根节点结合 **蒙特卡洛 rollout**；叶节点可选用与文档一致的**全盘线型差分**、候选排序与邻域半径；对极强威胁保留必堵，其余更多交给搜索在**攻与守**之间权衡。**不含神经网络**。

### 对局辅助

- **招式板 / 本局走势（简单档）**：关键棋形会打分、命名（如活三、冲四等），侧栏展示过程。
- **落子提示（简单档）**：轮到你时可在推荐交叉点显示高亮。
- **胜负与连线**：连成五子判胜并高亮连线；终局后「重新开局」可有强调动效。

### 历史与招式库

- **历史查看**：对局保存在 **localStorage**，可按列表选择，支持步进或自动回放，并含累计对抗等展示。
- **招式大全**：内置棋形模板，带棋盘动画与右侧文字说明。
- **棋形导入续弈**：可将演示局面带入人机对弈；支持随机模拟至可匹配阵势后再行棋；若下一手为白方，会有「对方在下 / 轮到你」等提示。

### 界面与触控

- 棋盘随容器缩放；**窄屏**下限制最大边长、压缩顶栏占位，并略减玻璃内边距，使可用网格更大。
- 落子点与网格、十字参考线对齐；触控设备上在**不重叠**的前提下适当放大点按区域（详见 `App.css` 中 `.pt` 规则）。

---

## 技术栈

- **React 19**、**TypeScript**、**Vite 8**（`@vitejs/plugin-react`）
- **ESLint**（`typescript-eslint`、React Hooks）

### 架构要点

- **普通档 / 困难档**的 AI 在 **Web Worker**（[`src/ai/ai.worker.ts`](src/ai/ai.worker.ts)）中运行，避免长时间占用主线程导致界面卡顿；**简单档**仍在主线程。
- 搜索与估值的共享逻辑集中在 [`src/ai/engine.ts`](src/ai/engine.ts)。

### AI 行为摘要（延伸阅读）

| 档位 | 要点 |
|------|------|
| **简单** | 强制手段之后，对候选按估值 softmax 抽样（温度见源码 `EASY_SOFTMAX_TEMPERATURE`）。 |
| **普通** | `pickBestMoveMinimax(board, 3)`；叶估值略偏防守（对方好点 ×1.08）。 |
| **困难** | `pickBestMoveHardHybrid`：α-β 与根节点 MC rollout 等组合；可走全盘线型差分叶节点、quick 排序、候选半径 2 等路径。 |

**外部参考（与本仓库实现相互独立）**：[gomoku_rl](https://github.com/guokezhen999/gomoku_rl)（强化学习 / PyTorch）、[gobang](https://github.com/lihongxun945/gobang)（经典 α-β，JavaScript）。更多说明见应用内「关于本作」。

---

## 环境要求

- **Node.js** 建议 **20+**
- 现代浏览器（需 `backdrop-filter`、CSS Grid / Flex 等）

---

## 本地运行

```bash
npm install
npm run dev
```

终端会打印本地地址（常见为 `http://localhost:5173`）。

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发服务器（热更新） |
| `npm run build` | 类型检查 + 生产构建，输出到 `dist/` |
| `npm run preview` | 本地预览构建结果 |
| `npm run lint` | 运行 ESLint |

---

## 构建与部署

- 构建产物目录：**`dist/`**
- `vite.config.ts` 中 **`base: './'`**，资源为相对路径，适合托管在 **GitHub Pages** 等任意子路径。

仓库含 GitHub Actions（[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)）：推送到 **`main`** 或 **`master`** 时自动构建并部署。使用 Pages 时请在仓库 **Settings → Pages** 中将 **Source** 设为 **GitHub Actions**。

部署后的地址一般为：`https://<用户名>.github.io/<仓库名>/`

---

## 数据与隐私

历史对局仅保存在本机浏览器的 **localStorage**，**不会上传到任何服务器**。

---

## 目录结构（节选）

```text
gomoku-liquid-glass/
├── public/
├── src/
│   ├── ai/
│   │   ├── engine.ts       # 搜索与局面估值
│   │   └── ai.worker.ts    # 普通 / 困难档 Worker 入口
│   ├── App.tsx
│   ├── App.css
│   ├── main.tsx
│   └── index.css
├── index.html
├── vite.config.ts
├── .github/workflows/
├── CHANGELOG.md
├── README.md
├── README.en.md
└── package.json
```

---

## 许可

个人学习 / 展示用途；如需开源协议可自行添加 `LICENSE`。
