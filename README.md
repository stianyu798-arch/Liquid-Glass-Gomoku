# 五子棋 · Liquid Glass（Gomoku）

**[English](README.en.md)** · 基于 **React 19 + TypeScript + Vite** 的浏览器五子棋，深色 **Liquid Glass** 风格：人机对弈、本地历史回放、招式大全与棋盘演示。

**变更记录：** [CHANGELOG.md](CHANGELOG.md)

**在线试玩（GitHub Pages）：** [stianyu798-arch.github.io/Liquid-Glass-Gomoku](https://stianyu798-arch.github.io/Liquid-Glass-Gomoku/)

---

## 功能概览

| 模块 | 说明 |
|------|------|
| **人机对弈** | 15×15；你执黑、AI 执白；**简单**（必胜/必防后，候选点按估值 **softmax 温度**抽样）；**普通**（**α-β**）；**困难**（更深 **α-β** + 根节点 **蒙特卡洛 rollout**；必堵仅针对对方极强点，活三及以下更多交给搜索在**攻与守**间取舍；**非**神经网络）。 |
| **评分与招式命名** | 简单模式下关键棋形打分、命名（活三、冲四、成五等），侧栏「招式板」展示本局走势。 |
| **落子提示（简单）** | 轮到你时可显示推荐点提示光（其他难度不提示）。 |
| **胜负与连线** | 五连判胜并高亮；终局后「重新开局」可呼吸高亮。 |
| **历史查看** | 对局保存在本机浏览器，列表选择、步进/自动回放；支持累计对抗条与单局回放。 |
| **招式大全** | 棋形模板 + 棋盘演示动画，右侧文字说明。 |
| **棋形导入续弈** | 可将演示局面带入人机对弈；支持随机模拟至可匹配阵势后再行棋；续弈时若下一手为白方，会显示「对方在下」/「轮到你」等提示。 |
| **界面与布局** | 棋盘随窗口自适应；窄屏下主区纵向排布；人机侧栏与棋盘同高对齐；历史页侧栏随内容结束，避免长屏下出现大块空白。 |

---

## 技术栈

- **React 19**、**TypeScript**、**Vite 8**（`@vitejs/plugin-react`）
- **ESLint**（`typescript-eslint`、React Hooks）

对局与 AI 为**纯前端**（棋形匹配、静态估值、minimax + α-β 等），无后端。**普通 / 困难** 档的 AI 在 **Web Worker**（`src/ai/ai.worker.ts`）中运行，避免长时间阻塞界面；简单档仍在主线程。叶节点估值在 `src/ai/engine.ts` 中单遍计算。

### AI 说明与延伸阅读

- **简单档**：必胜/必防之后，对候选点按静态估值做 **softmax 抽样**（温度见源码 `EASY_SOFTMAX_TEMPERATURE`）。
- **普通档**：**α-β**（`pickBestMoveMinimax(board, 3)`），叶节点估值略偏防守（对方好点 ×1.08）。
- **困难档**：强候选经 **α-β**（加深）筛选后，在根节点做多局 **随机 rollout**（`pickBestMoveHardHybrid`）；搜索链上**降低对方威胁权重、略抬高己方好点**，且**仅对对方冲四级以上**仍「一步必堵」，避免过度封堵、便于连续进攻；**无**神经网络。
- **参考仓库**：[gomoku_rl](https://github.com/guokezhen999/gomoku_rl)（深度强化学习方向，Python/PyTorch）；[gobang](https://github.com/lihongxun945/gobang)（经典 α-β，JavaScript）。与本作前端实现独立，见应用内「关于本作」。

---

## 环境要求

- **Node.js** 建议 **20+**
- 现代浏览器（需支持 `backdrop-filter`、CSS Grid/Flex 等）

---

## 本地运行

```bash
npm install
npm run dev
```

浏览器打开终端里提示的地址（常见为 `http://localhost:5173`）。

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发服务器（热更新） |
| `npm run build` | 类型检查 + 生产构建 → `dist/` |
| `npm run preview` | 本地预览构建结果 |
| `npm run lint` | ESLint |

---

## 构建与部署说明

- 构建输出目录：**`dist/`**
- `vite.config.ts` 中 **`base: './'`**，静态资源为相对路径，便于托管在 **GitHub Pages** 等任意子路径下。

本仓库含 GitHub Actions（`.github/workflows/deploy-pages.yml`）：推送到 **`main`** 或 **`master`** 时自动执行构建并部署。使用 Pages 时请在仓库 **Settings → Pages** 中将 **Source** 设为 **GitHub Actions**（与工作流一致）。部署完成后，站点地址一般为：

`https://<用户名>.github.io/<仓库名>/`

（Fork 或自建远程后，将用户名、仓库名换成你的即可。）

---

## 数据与隐私

历史对局仅保存在本机浏览器的 **localStorage** 中，**不会上传到任何服务器**。

---

## 目录结构（简要）

```text
gomoku-liquid-glass/
├── public/
├── src/
│   ├── ai/
│   │   ├── engine.ts       # AI 搜索与局面估值（主线程与 Worker 共用）
│   │   └── ai.worker.ts    # 普通/困难档在 Worker 中运行
│   ├── App.tsx             # 对局 / 历史 / 招式 / 棋形导入
│   ├── App.css
│   ├── main.tsx
│   └── index.css
├── index.html
├── vite.config.ts
├── .github/workflows/      # GitHub Pages 部署
├── CHANGELOG.md
├── README.md
├── README.en.md
└── package.json
```

---

## 许可

个人学习 / 展示用；需要可自行在仓库中添加 `LICENSE`。
