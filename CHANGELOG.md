# 迭代说明（Changelog）

面向发布与协作的变更摘要。**建议在每次将 `main` 推送到 GitHub 时追加一条**（可只写「文档 / AI / UI」等你关心的类别），便于对照线上版本与源码。

格式：日期标题下按类别列出要点；英文仓库可同时维护英文段落或保持中文为主。

---

## 2026-04-10

### 文档

- 同步 [README.md](README.md) / [README.en.md](README.en.md)：人机三档 AI 行为说明（softmax、α-β、困难档蒙特卡洛 rollout）、延伸阅读与参考仓库链接。
- 新增本文件作为固定迭代说明载体。

### 人机 AI（`src/ai/engine.ts`）

- **简单**：非强制阶段使用 `pickEasySoftmaxSample`，对若干强候选按静态估值做 softmax 温度抽样（`EASY_SOFTMAX_TEMPERATURE`）。
- **普通**：`pickBestMoveMinimax` 搜索深度为 3。
- **困难**：`pickBestMoveHardHybrid` — 先 α-β 得到强候选，再在根节点做多局随机 rollout，按白方胜率加权选点（无神经网络）。
- **提示光（简单）**：`pickBestHumanHintMove` 在简单档下按静态估值优先候选给出提示。

### 界面与布局（`App.tsx` / `App.css`）

- **人机对弈**：侧栏高度仅与左侧 `.board-wrap`（棋盘外包）对齐；栅格内 `align-self: start`，避免行盒被异常撑高导致与棋盘底缘不齐。
- **历史查看**：不再对侧栏施加与行盒同步的超大固定像素高；右侧玻璃层 `height: auto`，功能区域在列表、回放控件与「对抗条」下方结束，修复长屏/移动端下玻璃内部在对抗条下方被拉成长条空白的问题。
