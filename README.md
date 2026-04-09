# 五子棋 · Liquid Glass（Gomoku）

**[English](README.en.md)** · 基于 **React 19 + TypeScript + Vite** 的浏览器五子棋，深色 **Liquid Glass** 风格：人机对弈、本地历史回放、招式大全与棋盘演示。

---

## 功能概览

| 模块 | 说明 |
|------|------|
| **人机对弈** | 15×15；你执黑、AI 执白；**简单 / 普通 / 困难**（启发式 + minimax，难度递增）。 |
| **评分与招式命名** | 简单模式下关键棋形打分、命名（活三、冲四、成五等），侧栏「招式板」展示本局走势。 |
| **落子提示（简单）** | 轮到你时可显示推荐点提示光（其他难度不提示）。 |
| **胜负与连线** | 五连判胜并高亮；终局后「重新开局」可呼吸高亮。 |
| **历史查看** | 对局写入 **localStorage**，列表选择、步进/自动回放。 |
| **招式大全** | 棋形模板 + 棋盘演示动画，右侧文字说明。 |
| **棋形导入续弈** | 在满足规则的前提下，可将演示局面带入人机对弈；支持随机模拟至可匹配阵势后再行棋；续弈时若下一手为白方，会先显示「对方在下」/「轮到你」等提示。 |
| **界面与布局** | 棋盘与网格随容器/视口**自适应缩放**；主区与侧栏**响应式间距**；视口不足时主区/侧栏可出现**纵向滚动**（`overflow-y: auto`）。 |

---

## 技术栈

- **React 19**、**TypeScript**、**Vite 8**（`@vitejs/plugin-react`）
- **ESLint**（`typescript-eslint`、React Hooks）

对局与 AI 为**纯前端**（棋形匹配、静态估值、minimax + α-β 等），无后端。**普通 / 困难** 档的 AI 思考在 **Web Worker**（`src/ai/ai.worker.ts`）中执行，避免长时间占用主线程导致界面卡顿；简单档仍在主线程（计算量小）。叶节点静态估值在 `src/ai/engine.ts` 中单遍计算，减轻搜索开销。

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
├── README.md
├── README.en.md
└── package.json
```

---

## 许可

个人学习 / 展示用；需要可自行在仓库中添加 `LICENSE`。
