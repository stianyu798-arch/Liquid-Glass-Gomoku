import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from 'react'
import { createPortal } from 'react-dom'
import {
  chooseAIMove,
  evaluateBoardAt,
  evaluateBoardAtForUi,
  pickBestHumanHintMove,
  type ScoredMove,
} from './ai/engine'
import './App.css'

type Cell = 0 | 1 | 2 // 0 empty, 1 player (black), 2 AI (white)
type Player = 1 | 2

type Difficulty = 'easy' | 'normal' | 'hard'

/** 人机对弈招式积分倍率（简单略低、困难更高；仅影响本局 scoreDelta 与总评分展示） */
const DIFFICULTY_SCORE_MULTIPLIER: Record<Difficulty, number> = {
  easy: 0.75,
  normal: 1,
  hard: 1.35,
}

function difficultyLabel(d: Difficulty): string {
  return d === 'easy' ? '简单' : d === 'normal' ? '普通' : '困难'
}

function formatDifficultyScoreMultiplier(d: Difficulty): string {
  return `×${DIFFICULTY_SCORE_MULTIPLIER[d]}`
}

/** 顶栏 / 招式续弈处难度按钮的悬停说明（精简） */
const DIFFICULTY_BUTTON_TITLE: Record<Difficulty, string> = {
  easy: '必输局面认真防守，平时较随性；有落子提示与高亮，适合入门或轻松下',
  normal: '比简单算更深、更稳；无提示，适合认真练手感',
  hard: '多候选推演求最优，棋力最强；无提示，更多见「关于本作」',
}

/** 人机对弈侧栏：当前难度的完整说明 */
const DIFFICULTY_PLAY_SIDE_DESC: Record<Difficulty, string> = {
  easy:
    '简单：AI 会认真防守必输的局面，但平时下棋比较随性，偶尔走出一些意料之外的步子。这一档带有落子提示，推荐位置用高亮圈出，适合刚接触五子棋或者想轻松下两盘的时候。',
  normal:
    '普通：AI 比简单档算得更深，落子更稳，防守也更黏人。没有提示，需要自己判断局势，适合想认真练练手感的玩家。',
  hard:
    '困难：AI 会在多个候选位置之间反复推演，力求找到最优落点，整体棋力最强，比较难缠。同样没有提示，适合想挑战一下的玩家。更多细节可以在「关于本作」里看到。',
}

interface MoveRecord {
  index: number
  x: number
  y: number
  player: Player
  scoreDelta: number
  pattern: string
}

interface HistoryGame {
  id: string
  createdAt: number
  difficulty: Difficulty
  moves: MoveRecord[]
  winner: Player | 0
  winLine: [number, number][]
  totalScore: number
}

/** 从棋谱累加双方盘面评分（用于历史对抗展示） */
function scoresFromMoves(moves: MoveRecord[]): { you: number; ai: number } {
  let you = 0
  let ai = 0
  for (const m of moves) {
    if (m.player === 1) you += m.scoreDelta
    else ai += m.scoreDelta
  }
  return { you, ai }
}

const HISTORY_KEY = 'gomoku_history_v1'

/** 本地日历日 YYYY-MM-DD，用于历史按日筛选 */
function toLocalYMD(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const BOARD_SIZE = 15
const WIN_COUNT = 5

const DIRS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const

function createEmptyBoard(): Cell[] {
  return new Array(BOARD_SIZE * BOARD_SIZE).fill(0)
}

function boardFromMoves(moves: MoveRecord[], step: number): Cell[] {
  const b = createEmptyBoard()
  const upto = Math.max(0, Math.min(step, moves.length))
  for (let i = 0; i < upto; i++) {
    const m = moves[i]
    const x = clampCoord(m.x)
    const y = clampCoord(m.y)
    b[indexOf(x, y)] = m.player
  }
  return b
}

function boardsEqual(a: Cell[], b: Cell[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/** localStorage / JSON 可能把坐标存成字符串；与 number 混算会拼成错误索引，导致盘面与棋谱错位、无法反推五连 */
function clampCoord(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(BOARD_SIZE - 1, Math.round(v)))
}

function indexOf(x: number, y: number): number {
  return Number(y) * BOARD_SIZE + Number(x)
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE
}

function checkWin(board: Cell[], lastX: number, lastY: number, player: Player) {
  for (const [dx, dy] of DIRS) {
    let count = 1
    const line: [number, number][] = [[lastX, lastY]]
    // forward
    let x = lastX + dx
    let y = lastY + dy
    while (inBounds(x, y) && board[indexOf(x, y)] === player) {
      line.push([x, y])
      count++
      x += dx
      y += dy
    }
    // backward
    x = lastX - dx
    y = lastY - dy
    while (inBounds(x, y) && board[indexOf(x, y)] === player) {
      line.unshift([x, y])
      count++
      x -= dx
      y -= dy
    }
    if (count >= WIN_COUNT) {
      return { winner: player, line }
    }
  }
  return null
}

/** 终局棋盘上有胜者但 winLine 未存时，从盘面反推一条五连（用于旧存档或异常状态） */
function findWinningLineFromBoard(
  board: Cell[],
  player: Player,
): [number, number][] | null {
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[indexOf(x, y)] !== player) continue
      const w = checkWin(board, x, y, player)
      if (w) return w.line
    }
  }
  return null
}

/**
 * 反推五连：优先从「致胜最后一手」展开，避免棋多后扫描顺序先命中另一条五连导致画线错位或不画。
 */
function findWinningLineForPlayer(
  board: Cell[],
  player: Player,
  lastMove?: { x: number; y: number } | null,
): [number, number][] | null {
  const lx = lastMove ? clampCoord(lastMove.x) : NaN
  const ly = lastMove ? clampCoord(lastMove.y) : NaN
  if (
    lastMove &&
    Number.isFinite(lx) &&
    Number.isFinite(ly) &&
    inBounds(lx, ly) &&
    board[indexOf(lx, ly)] === player
  ) {
    const w = checkWin(board, lx, ly, player)
    if (w) return w.line
  }
  return findWinningLineFromBoard(board, player)
}

function normalizeWinLine(raw: unknown): [number, number][] {
  if (!Array.isArray(raw)) return []
  const out: [number, number][] = []
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) continue
    out.push([clampCoord(p[0]), clampCoord(p[1])])
  }
  return out
}

function winLineMatchesBoard(
  board: Cell[],
  player: Player,
  line: [number, number][],
): boolean {
  if (line.length < 2) return false
  for (const [x, y] of line) {
    if (!inBounds(x, y) || board[indexOf(x, y)] !== player) return false
  }
  return true
}

/** 侧栏胜负线：优先校验存档；无效则从终局盘面反推（避免旧存档空 winLine、坐标串化等导致「有时不画线」） */
function resolveDisplayWinLine(
  fullBoard: Cell[],
  winner: Player,
  lastMove: MoveRecord | null,
  savedRaw: unknown,
): [number, number][] {
  const saved = normalizeWinLine(savedRaw)
  if (saved.length >= 2 && winLineMatchesBoard(fullBoard, winner, saved)) {
    return saved
  }
  return (
    findWinningLineForPlayer(
      fullBoard,
      winner,
      lastMove && lastMove.player === winner ? lastMove : null,
    ) ?? []
  )
}

type PatternId =
  | '成五'
  | '活四'
  | '冲四'
  | '活三'
  | '跳三'
  | '眠三'
  | '潜在活三'
  | '活二'
  | '眠二'
  | '对手活四'
  | '对手冲四'
  | '对手活三'
  | '对手跳三'
  | '对手眠三'
  | '阻断活四'
  | '阻断冲四'
  | '阻断活三'
  | '交替争夺'
  | '黑白互扳'
  | '挡中带攻'
  | '对拉战线'
  | '攻防换手'
  | '要点接触战'
  | '势力纠缠'
  | '跳挡交手'
  | '正面对冲'
  | '月亮阵'
  | '四方阵'
  | '二字阵'
  | '斜三阵'
  | '梅花阵'
  | '八卦阵'
  | '燕阵'
  | '剑阵'
  | '长蛇阵'
  | '长勾阵'
  | '双四角阵'
  | '闪电阵'
  | '江口阵'
  | '梯形阵'
  | '辰月形'
  | '水月'
  | '流星'
  | '浦月'
  | '花月'
  | '寒星'
  | '瑞星'
  | '溪月'
  | '疏星'
  | '云月'
  | '峡月'
  | '恒星'
  | '雨月'
  | '松月'
  | '长连'
  | '死四'
  | '嵌五'
  | '奶龙阵'

/**
 * 招式大全分类（与 PATTERN_CATALOG_TAGS 一一对应）
 * — 连子与术语：直线连子 + 嵌五、死四、长连等术语
 * — 敌我态势：对方威胁棋形 + 我方阻断应手（对局中的「他方 / 我方」结构）
 * — 中盘交锋：双方纠缠、要点争夺类（含江口等）
 * — 开局星月：二十六路及常见星月前三手
 * — 阵法趣形：有名阵法与娱乐梗形
 * — 可续棋：满足续弈条件（非终局、子数合法等）的招式，由运行时筛选，见 catalogPatternCanContinue
 */
type CatalogFilterTag =
  | 'connect'
  | 'standoff'
  | 'midfight'
  | 'opening'
  | 'formation'
  | 'continue'

const CATALOG_FILTER_OPTIONS: { key: 'all' | CatalogFilterTag; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'connect', label: '连子与术语' },
  { key: 'standoff', label: '敌我态势' },
  { key: 'midfight', label: '中盘交锋' },
  { key: 'opening', label: '开局星月' },
  { key: 'formation', label: '阵法趣形' },
  { key: 'continue', label: '可续棋' },
]

/** 招式列表分数排序（在分类筛选结果上应用） */
type CatalogSortMode = 'default' | 'score_desc' | 'score_asc'

const CATALOG_SORT_OPTIONS: { key: CatalogSortMode; label: string }[] = [
  { key: 'default', label: '默认' },
  { key: 'score_desc', label: '分数从高到低' },
  { key: 'score_asc', label: '分数从低到高' },
]

/** 0 空 · 1 我方（黑）· 2 对手（白） */
type CatalogCell = 0 | 1 | 2

const PATTERN_CATALOG: {
  id: PatternId
  kind: '进攻' | '防守' | '对手' | '交手' | '开局'
  name: string
  scoreShow: number
  description: string
  template: CatalogCell[]
}[] = [
  {
    id: '成五',
    kind: '进攻',
    name: '成五',
    scoreShow: 2000,
    description: '五连成形，直接决定胜负。',
    template: [1, 1, 1, 1, 1],
  },
  {
    id: '活四',
    kind: '进攻',
    name: '活四',
    scoreShow: 450,
    description: '连续四子且两端均可延伸，下一手形成成五威胁极强。',
    template: [0, 1, 1, 1, 1],
  },
  {
    id: '冲四',
    kind: '进攻',
    name: '冲四',
    scoreShow: 220,
    description: '四子连成一端封口，另一端可下成五，逼迫对方应对。',
    template: [1, 1, 1, 1, 0],
  },
  {
    id: '活三',
    kind: '进攻',
    name: '活三',
    scoreShow: 140,
    description: '活三可延伸为活四/成五，是常见进攻骨架。',
    template: [0, 1, 1, 1, 0],
  },
  {
    id: '跳三',
    kind: '进攻',
    name: '跳三',
    scoreShow: 95,
    description: '中间有空位的三子结构，可发展为更强威胁。',
    template: [1, 1, 0, 1, 0],
  },
  {
    id: '眠三',
    kind: '进攻',
    name: '眠三',
    scoreShow: 60,
    description: '一端被挡的三子，需对方失误或你方连续施压才易成势。',
    template: [1, 1, 1, 0, 0],
  },
  {
    id: '潜在活三',
    kind: '进攻',
    name: '潜在活三',
    scoreShow: 80,
    description: '尚未定型但子力在一条线上，再进一手可转入活三体系。',
    template: [0, 1, 1, 0, 1],
  },
  {
    id: '活二',
    kind: '进攻',
    name: '活二',
    scoreShow: 35,
    description: '两子相连且两侧有空间，是构筑更大棋形的起点。',
    template: [0, 1, 1, 0, 0],
  },
  {
    id: '眠二',
    kind: '进攻',
    name: '眠二',
    scoreShow: 18,
    description: '一端被挡的二子，局部压力较小，多用于铺垫。',
    template: [1, 1, 0, 0, 0],
  },
  {
    id: '对手活四',
    kind: '对手',
    name: '对手活四（需防）',
    scoreShow: 520,
    description: '对方走出活四，下一手即可成五，通常必须立即封堵或反杀。',
    template: [0, 2, 2, 2, 2],
  },
  {
    id: '对手冲四',
    kind: '对手',
    name: '对手冲四（需防）',
    scoreShow: 220,
    description: '对方四连一端封口，另一端成五威胁，防守压力大。',
    template: [2, 2, 2, 2, 0],
  },
  {
    id: '对手活三',
    kind: '对手',
    name: '对手活三',
    scoreShow: 90,
    description: '对方活三正在成形，需抢占要点或牵制，避免其升为活四。',
    template: [0, 2, 2, 2, 0],
  },
  {
    id: '对手跳三',
    kind: '对手',
    name: '对手跳三',
    scoreShow: 56,
    description: '对方带跳的活三雏形，注意其转向与连冲。',
    template: [2, 2, 0, 2, 0],
  },
  {
    id: '对手眠三',
    kind: '对手',
    name: '对手眠三',
    scoreShow: 40,
    description: '对方眠三威胁相对软，但仍需防止其与其他子力连接。',
    template: [2, 2, 2, 0, 0],
  },
  {
    id: '阻断活四',
    kind: '防守',
    name: '阻断对方活四',
    scoreShow: 480,
    description: '在对方活四延伸点上落子（黑），直接化解成五威胁。',
    template: [1, 2, 2, 2, 0],
  },
  {
    id: '阻断冲四',
    kind: '防守',
    name: '阻断对方冲四',
    scoreShow: 260,
    description: '堵住对方冲四的成五点，典型“必应手”。',
    template: [2, 2, 2, 0, 1],
  },
  {
    id: '阻断活三',
    kind: '防守',
    name: '阻断对方活三',
    scoreShow: 120,
    description: '在对方活三一侧落子干扰其延展，争取先手或转入对攻。',
    template: [1, 0, 2, 2, 2],
  },
  {
    id: '交替争夺',
    kind: '交手',
    name: '交替争夺要点',
    scoreShow: 85,
    description:
      '黑白沿一线交替落子，争夺延伸权与先手；演示为序盘常见「你一手我一手」的接触战。',
    template: [1, 2, 1, 2, 1, 0, 0],
  },
  {
    id: '黑白互扳',
    kind: '交手',
    name: '黑白互扳',
    scoreShow: 72,
    description: '双方在空位两侧各成小块势力，互相牵制，谁抢先手谁占优。',
    template: [1, 2, 0, 1, 2],
  },
  {
    id: '挡中带攻',
    kind: '交手',
    name: '挡中带攻',
    scoreShow: 88,
    description: '在对方压力点旁落子既挡其发展，又保留己方反击线路，典型攻防一体。',
    template: [2, 1, 0, 2, 0, 1],
  },
  {
    id: '对拉战线',
    kind: '交手',
    name: '对拉战线',
    scoreShow: 70,
    description: '中间空档成为双方拉扯空间，黑先白应，战线在「拉」与「挡」之间移动。',
    template: [0, 1, 2, 1, 2, 1, 0],
  },
  {
    id: '攻防换手',
    kind: '交手',
    name: '攻防换手',
    scoreShow: 78,
    description: '空位隔开的多枚子力，体现一方进攻、对方应手后再转守为攻的节奏。',
    template: [1, 0, 2, 0, 1, 2, 1],
  },
  {
    id: '要点接触战',
    kind: '交手',
    name: '要点接触战',
    scoreShow: 92,
    description: '双方在一条线上多次接触，空点即「要点」：谁占到谁掌握局部主动。',
    template: [1, 2, 0, 0, 1, 2, 1, 0, 0],
  },
  {
    id: '势力纠缠',
    kind: '交手',
    name: '势力纠缠',
    scoreShow: 65,
    description: '黑白子力交错，尚未分出清晰外势，后续一手可能打破平衡。',
    template: [2, 2, 1, 0, 1, 1],
  },
  {
    id: '跳挡交手',
    kind: '交手',
    name: '跳挡与反击',
    scoreShow: 68,
    description: '利用空位跳挡对方，同时预留己方连接；常见于中盘纠缠。',
    template: [1, 0, 2, 1, 0, 2],
  },
  {
    id: '正面对冲',
    kind: '交手',
    name: '正面对冲',
    scoreShow: 75,
    description: '双方连续子力正面顶在一起，比的是下一手的速度与方向选择。',
    template: [1, 1, 2, 2, 1, 2],
  },
  {
    id: '月亮阵',
    kind: '进攻',
    name: '月亮阵（弯月）',
    scoreShow: 188,
    description:
      '弯月状子力带，凸出方向易形成连续威胁；民间流传甚广的进攻演示形。',
    template: [0, 1, 1, 0, 1, 1, 0],
  },
  {
    id: '四方阵',
    kind: '进攻',
    name: '四角阵（四方阵）',
    scoreShow: 158,
    description:
      '四子呈方形展开，易形成多路剑势；攻防焦点在夺先与反夺先。',
    template: [1, 0, 1, 0, 1, 0, 1],
  },
  {
    id: '二字阵',
    kind: '进攻',
    name: '二字阵',
    scoreShow: 102,
    description:
      '两段各二两子、中间蓄势；常由斜三阵演变为一字长蛇等长线攻法。',
    template: [1, 1, 0, 0, 1, 1],
  },
  {
    id: '斜三阵',
    kind: '进攻',
    name: '斜三阵',
    scoreShow: 132,
    description:
      '最基础的进攻母型之一，斜向三子为骨架，可化出半燕翼与多种变化。',
    template: [0, 1, 0, 1, 1, 0],
  },
  {
    id: '梅花阵',
    kind: '进攻',
    name: '梅花阵',
    scoreShow: 142,
    description:
      '子力如梅花五出，斜直相辅；攻强守弱，须防对方侧翼反击。',
    template: [1, 0, 1, 1, 0, 1],
  },
  {
    id: '八卦阵',
    kind: '防守',
    name: '八卦阵',
    scoreShow: 168,
    description:
      '子力如「日字」勾连，一线多有照应；偏防守牵制，令对方难下重手。',
    template: [1, 0, 0, 1, 0, 0, 1, 0, 1],
  },
  {
    id: '燕阵',
    kind: '进攻',
    name: '燕阵',
    scoreShow: 172,
    description:
      '象形飞燕：头、翅、尾呼应，变化极多；恒星、流星等开局常见脉络。',
    template: [1, 2, 0, 1, 0, 2, 1],
  },
  {
    id: '剑阵',
    kind: '进攻',
    name: '剑阵',
    scoreShow: 162,
    description:
      '黑白呈剑形相峙，交锋多在「剑柄」一带；花月、浦月等可见类似结构。',
    template: [1, 1, 2, 1, 0, 1, 1],
  },
  {
    id: '长蛇阵',
    kind: '进攻',
    name: '一字长蛇阵',
    scoreShow: 128,
    description:
      '四子沿一线延展，攻击面广；若不能持续施压，易被侧翼反击。',
    template: [1, 1, 1, 1, 0, 0, 0],
  },
  {
    id: '长勾阵',
    kind: '进攻',
    name: '长勾阵',
    scoreShow: 118,
    description:
      '一长一短两路呼应，易向梅花等强杀形演化，属斜三阵的重要分支。',
    template: [1, 1, 1, 0, 1, 0, 0],
  },
  {
    id: '双四角阵',
    kind: '交手',
    name: '双四角阵',
    scoreShow: 185,
    description:
      '双方四角阵交错，夺先与反夺先的典型，变化密、计算量大。',
    template: [1, 2, 1, 0, 1, 2, 1],
  },
  {
    id: '闪电阵',
    kind: '进攻',
    name: '闪电阵',
    scoreShow: 138,
    description:
      '子力疏密相间、节奏快，强调抢要点与连续威胁。',
    template: [1, 0, 1, 0, 1, 0, 1],
  },
  {
    id: '江口阵',
    kind: '交手',
    name: '江口（开口）形',
    scoreShow: 112,
    description:
      '一线开口待填，双方争夺「江口」要点，先手权极关键。',
    template: [1, 1, 0, 2, 0, 1, 1],
  },
  {
    id: '梯形阵',
    kind: '进攻',
    name: '梯形阵',
    scoreShow: 108,
    description:
      '子力前宽后窄如梯，利于一侧堆厚再转向延伸。',
    template: [0, 1, 1, 1, 0, 1, 0],
  },
  {
    id: '辰月形',
    kind: '开局',
    name: '辰月形',
    scoreShow: 124,
    description:
      '斜指类开局骨架：天元黑、白2 在斜邻，黑3 与白2 错开；与流星等同型不同路，争夺先手方向。',
    template: [1, 0, 1, 2, 1, 0, 1],
  },
  {
    id: '水月',
    kind: '开局',
    name: '水月（开局）',
    scoreShow: 130,
    description:
      '斜指二十六路之一：白2 与天元斜邻，黑3 在天元正下（第二格），属常见斜指连打。',
    template: [1, 1, 0, 2, 0, 1],
  },
  {
    id: '流星',
    kind: '开局',
    name: '流星（开局）',
    scoreShow: 136,
    description:
      '斜指开局：白2 斜邻，黑3 落在天元正下两格（与直指瑞星同形第三手，但白2 位置不同）。',
    template: [1, 0, 0, 1, 0, 2],
  },
  {
    id: '浦月',
    kind: '开局',
    name: '浦月（开局）',
    scoreShow: 132,
    description:
      '斜指经典：白2 斜邻，黑3 在天元横向第二格（连打），职业对局浦月系定式即由此展开。',
    template: [1, 1, 0, 2, 1],
  },
  {
    id: '花月',
    kind: '开局',
    name: '花月（开局）',
    scoreShow: 128,
    description:
      '直指开局：白2 在天元正上，黑3 在天元右侧一格（与寒星、溪月等同为直指前三手关系）。',
    template: [1, 2, 1, 0, 1, 0],
  },
  {
    id: '寒星',
    kind: '开局',
    name: '寒星（开局）',
    scoreShow: 124,
    description:
      '直指开局：白2 在天元正上，黑3 再向上一格，三子共线，为常见「直指」代表形。',
    template: [1, 0, 2, 0, 1],
  },
  {
    id: '瑞星',
    kind: '开局',
    name: '瑞星（开局）',
    scoreShow: 122,
    description:
      '直指开局：白2 正上，黑3 在天元正下两格，局面均衡感强；与斜指流星区分在於白2 为直邻。',
    template: [1, 0, 2, 1, 0, 1],
  },
  {
    id: '溪月',
    kind: '开局',
    name: '溪月（开局）',
    scoreShow: 126,
    description:
      '直指开局：白2 正上，黑3 在天元右上（与白2 斜邻），即溪月定式前三手关系。',
    template: [1, 0, 0, 0, 1, 2],
  },
  {
    id: '疏星',
    kind: '开局',
    name: '疏星（开局）',
    scoreShow: 118,
    description:
      '直指开局：白2 在天元正上，黑3 落在较远要点（常见谱为均衡、变化多的一路），职业二十六路开局之一；演示取经典前三手相对位置。',
    template: [1, 0, 2, 0, 0, 0, 1],
  },
  {
    id: '云月',
    kind: '开局',
    name: '云月（开局）',
    scoreShow: 125,
    description:
      '斜指开局：白2 与天元斜邻，黑3 在天元正右一格，属二十六路斜指名局之一（资料见连珠开局图谱与 RIF 开局介绍）。',
    template: [1, 0, 0, 2, 1],
  },
  {
    id: '峡月',
    kind: '开局',
    name: '峡月（开局）',
    scoreShow: 127,
    description:
      '斜指开局：黑3 常落在与白2 成「峡」状展开的一路，变化紧峭；与恒星、云月等并列斜指二十六路（可参考连珠网开局图）。',
    template: [1, 0, 0, 2, 0, 1],
  },
  {
    id: '恒星',
    kind: '开局',
    name: '恒星（开局）',
    scoreShow: 129,
    description:
      '斜指开局：黑3 与白2、天元构成偏「稳、厚」的展开，职业对局常见定式分支之一；二十六路斜指代表形。',
    template: [1, 0, 0, 2, 0, 0, 1],
  },
  {
    id: '雨月',
    kind: '开局',
    name: '雨月（开局）',
    scoreShow: 124,
    description:
      '直指开局：白2 正上，黑3 偏向一侧延伸（雨月系），与花月、溪月等同属直指二十六路；定式可参考《五子棋/连珠入门》与开局图谱。',
    template: [1, 0, 2, 0, 0, 1],
  },
  {
    id: '松月',
    kind: '开局',
    name: '松月（开局）',
    scoreShow: 120,
    description:
      '直指开局：黑3 常落在较远一路，局面偏松、变化多，属二十六路中「黑优势」类常见谱之一。',
    template: [1, 0, 2, 0, 0, 0, 1],
  },
  {
    id: '长连',
    kind: '进攻',
    name: '长连',
    scoreShow: 320,
    description:
      '一条线上连续六子或以上。连珠（有禁手）规则下黑棋「长连」为禁手判负；白棋长连在多数规则中仍算胜。无禁手五子棋则无禁手一说。术语见 RIF 规则与中文五子棋竞赛规则术语表。',
    template: [1, 1, 1, 1, 1, 1],
  },
  {
    id: '死四',
    kind: '进攻',
    name: '死四',
    scoreShow: 12,
    description:
      '四子连排但两端皆被对方堵死，无法再下成五，已失去进攻价值。与活四、冲四相对，属基础棋形术语（连珠入门教材常见）。',
    template: [2, 1, 1, 1, 1, 2],
  },
  {
    id: '嵌五',
    kind: '进攻',
    name: '嵌五（跳冲四）',
    scoreShow: 215,
    description:
      '冲四的一种：四子中有空点，再下一手可成五，术语中亦称「嵌五」「跳冲四」。与连冲四（VCF）等进攻手段常一起见于连珠教程。',
    template: [1, 1, 0, 1, 1],
  },
  {
    id: '奶龙阵',
    kind: '进攻',
    name: '奶龙阵',
    scoreShow: 233,
    description:
      '梗形共 7 手。记谱坐标：4×4 区域，列、行均为 1～4，左下为 (1,1)、右上为 (4,4)。黑 (1,1)(4,1)(1,4)(4,4)；白 (2,2)(2,3)(1,2)。非职业定式。',
    template: [1, 2, 1, 2, 1, 2, 1],
  },
]

/** 每条招式对应的筛选类（与 CATALOG_FILTER_OPTIONS 中 key 对应） */
const PATTERN_CATALOG_TAGS = {
  成五: 'connect',
  活四: 'connect',
  冲四: 'connect',
  活三: 'connect',
  跳三: 'connect',
  眠三: 'connect',
  潜在活三: 'connect',
  活二: 'connect',
  眠二: 'connect',
  嵌五: 'connect',
  长连: 'connect',
  死四: 'connect',
  对手活四: 'standoff',
  对手冲四: 'standoff',
  对手活三: 'standoff',
  对手跳三: 'standoff',
  对手眠三: 'standoff',
  阻断活四: 'standoff',
  阻断冲四: 'standoff',
  阻断活三: 'standoff',
  交替争夺: 'midfight',
  黑白互扳: 'midfight',
  挡中带攻: 'midfight',
  对拉战线: 'midfight',
  攻防换手: 'midfight',
  要点接触战: 'midfight',
  势力纠缠: 'midfight',
  跳挡交手: 'midfight',
  正面对冲: 'midfight',
  江口阵: 'midfight',
  月亮阵: 'formation',
  四方阵: 'formation',
  二字阵: 'formation',
  斜三阵: 'formation',
  梅花阵: 'formation',
  八卦阵: 'formation',
  燕阵: 'formation',
  剑阵: 'formation',
  长蛇阵: 'formation',
  长勾阵: 'formation',
  双四角阵: 'formation',
  闪电阵: 'formation',
  梯形阵: 'formation',
  奶龙阵: 'formation',
  辰月形: 'opening',
  水月: 'opening',
  流星: 'opening',
  浦月: 'opening',
  花月: 'opening',
  寒星: 'opening',
  瑞星: 'opening',
  溪月: 'opening',
  疏星: 'opening',
  云月: 'opening',
  峡月: 'opening',
  恒星: 'opening',
  雨月: 'opening',
  松月: 'opening',
} as const satisfies Record<PatternId, CatalogFilterTag>

/** 阵法：右侧详情里一句话点出「为何叫这名」 */
const FORMATION_NAME_CAPTION: Partial<Record<PatternId, string>> = {
  月亮阵: '子力弯成月牙状展开，故名「月亮阵」。',
  四方阵: '四枚紧挨成 2×2 方块（团角），利于厚势与转向，故称「四角/四方」阵。',
  二字阵: '两截各成「二」字块，中间留白蓄势，故名「二字阵」。',
  斜三阵: '三子沿斜向骨架排开（横线为投影），是斜三母型。',
  梅花阵: '五枚若梅花五瓣，中心与四向呼应，故名「梅花」。',
  八卦阵: '子距如马步/日字疏朗牵制，易守难破，民间附会「八卦」之名（示意非单线连排）。',
  燕阵: '两头展开若燕翅，中间为身，象形「飞燕」。',
  剑阵: '黑白交错如剑身、剑尖一线刺出，故称「剑阵」。',
  长蛇阵: '一路连排如长蛇蜿蜒，故名「一字长蛇」。',
  长勾阵: '一长一短若勾形回卷，由斜三演化而来。',
  双四角阵: '双方各成四角之势交错，夺先与反夺先的典型。',
  闪电阵: '疏密顿挫若闪电折线，强调节奏与要点连击。',
  梯形阵: '子力上宽下窄如梯形，一侧堆厚再转向。',
  奶龙阵: '梗形：4×4 记谱左下 (1,1)、右上 (4,4)，四角与腹中有纠缠，因梗得名。',
}

/** 招式演示：无二维布局时在中央横排落子；有 CATALOG_DEMO_GRID 时按栅格居中 */
const CATALOG_DEMO_Y = 7

type CatalogSlot = { x: number; y: number; player: Player }

function catalogDemoStartX(templateLen: number): number {
  if (templateLen <= 0) return 0
  const len = Math.min(templateLen, BOARD_SIZE)
  return Math.max(0, Math.round((BOARD_SIZE - len) / 2))
}

function catalogStoneSlots(template: CatalogCell[]): CatalogSlot[] {
  const startX = catalogDemoStartX(template.length)
  const slots: CatalogSlot[] = []
  for (let i = 0; i < template.length; i++) {
    const t = template[i]
    if (t === 1 || t === 2) {
      slots.push({ x: startX + i, y: CATALOG_DEMO_Y, player: t })
    }
  }
  return slots
}

/** 二维演示栅格；未写 playOrder 时动画按行优先扫格子，一般不等于真实对局手顺 */
type CatalogDemoGridDef = {
  w: number
  h: number
  cells: CatalogCell[]
  /** 演示落子顺序：cells 行优先下标（顶行 gy=0）。给出后动画才按对局先后播 */
  playOrder?: number[]
}

/**
 * 阵法 / 开局等：横线无法表达的，用居中二维小棋盘演示。
 * 未列出的招式仍用 template 横排（catalogStoneSlots）。
 */
const CATALOG_DEMO_GRID: Partial<Record<PatternId, CatalogDemoGridDef>> = {
  月亮阵: {
    w: 5,
    h: 3,
    cells: [0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0],
  },
  /* 四角阵：四枚呈 2×2 方块（非对角四点） */
  四方阵: { w: 4, h: 4, cells: [0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0] },
  二字阵: { w: 5, h: 2, cells: [1, 1, 0, 0, 0, 0, 0, 0, 1, 1] },
  斜三阵: {
    w: 4,
    h: 4,
    cells: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  },
  梅花阵: {
    w: 5,
    h: 5,
    cells: [
      0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0,
    ],
  },
  /* 八卦阵：马步/日字间距易守（示意疏朗牵制，非 X 形对角） */
  八卦阵: {
    w: 7,
    h: 5,
    cells: [
      1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
    ],
  },
  燕阵: {
    w: 5,
    h: 4,
    cells: [
      0, 2, 0, 2, 0, 1, 0, 1, 0, 1, 0, 2, 0, 1, 0, 1, 0, 2, 0, 0,
    ],
  },
  剑阵: {
    w: 5,
    h: 4,
    cells: [
      1, 1, 2, 1, 0, 0, 0, 1, 0, 0, 1, 2, 1, 1, 0, 0, 0, 0, 0, 0,
    ],
  },
  长蛇阵: { w: 7, h: 1, cells: [1, 1, 1, 1, 0, 0, 0] },
  长勾阵: {
    w: 4,
    h: 3,
    cells: [1, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0],
  },
  双四角阵: {
    w: 5,
    h: 5,
    cells: [
      1, 0, 1, 0, 2, 0, 2, 0, 2, 0, 1, 0, 1, 0, 2, 0, 2, 0, 2, 0, 1, 0, 1, 0, 2,
    ],
  },
  闪电阵: {
    w: 5,
    h: 3,
    cells: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
  },
  江口阵: {
    w: 5,
    h: 3,
    cells: [1, 1, 0, 2, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0],
  },
  梯形阵: {
    w: 5,
    h: 3,
    cells: [0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0],
  },
  /*
   * 奶龙阵：记谱 (列,行) 左下 (1,1)、右上 (4,4)。手顺：黑(1,1)→白(2,2)→黑(4,1)→白(2,3)→黑(1,4)→白(1,2)→黑(4,4)
   * playOrder 为 cells 行优先下标（w=4）。
   */
  奶龙阵: {
    w: 4,
    h: 4,
    cells: [1, 0, 0, 1, 0, 2, 0, 0, 2, 2, 0, 0, 1, 0, 0, 1],
    playOrder: [12, 9, 15, 5, 0, 8, 3],
  },
  /* 辰月形：斜指类骨架，黑3与白2错开一格，与流星等同型不同路 */
  辰月形: {
    w: 5,
    h: 5,
    cells: [
      0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    /** 手顺：天元黑 → 白2 → 黑3（行优先下标 gy*5+gx） */
    playOrder: [12, 8, 24],
  },
  /* 斜指：天元黑、白2 斜邻，黑3 依二十六路「水月」定式（相对天元向下两格） */
  水月: {
    w: 5,
    h: 5,
    cells: [
      0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
    ],
    playOrder: [12, 7, 17],
  },
  /* 斜指：黑3 在天元正下两格（流星打），与瑞星直指区分在於白2 位置 */
  流星: {
    w: 5,
    h: 5,
    cells: [
      0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0,
    ],
    playOrder: [12, 8, 22],
  },
  /* 斜指：黑3 在天元右侧两路（浦月连打经典形） */
  浦月: {
    w: 5,
    h: 5,
    cells: [
      0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    playOrder: [12, 7, 14],
  },
  /* 直指：白2 在天元正上，黑3 在天元右侧一格 */
  花月: {
    w: 5,
    h: 5,
    cells: [
      0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    playOrder: [12, 7, 13],
  },
  /* 直指：白2 正上，黑3 再上一格（寒星） */
  寒星: {
    w: 5,
    h: 5,
    cells: [
      0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    playOrder: [12, 7, 2],
  },
  /* 直指：白2 正上，黑3 在天元正下两格（均衡代表形） */
  瑞星: {
    w: 5,
    h: 5,
    cells: [
      0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0,
    ],
    playOrder: [12, 7, 22],
  },
  /* 直指：白2 正上，黑3 在天元右上（斜邻），即溪月 */
  溪月: {
    w: 5,
    h: 5,
    cells: [
      0, 0, 0, 0, 0, 0, 0, 2, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    playOrder: [12, 7, 8],
  },
  /* 直指：疏星——黑3 在远位（示意右上远点），均衡感强 */
  疏星: {
    w: 5,
    h: 5,
    cells: [
      0, 0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    playOrder: [12, 7, 4],
  },
  /* 斜指：云月——黑3 在天元正右 */
  云月: {
    w: 5,
    h: 5,
    cells: [
      0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    playOrder: [12, 8, 13],
  },
  /* 斜指：峡月——黑3 在下方偏右（与白2、天元成斜指峡状） */
  峡月: {
    w: 5,
    h: 5,
    cells: [
      0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0,
    ],
    playOrder: [12, 8, 23],
  },
  /* 斜指：恒星——黑3 在右下角远位 */
  恒星: {
    w: 5,
    h: 5,
    cells: [
      0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ],
    playOrder: [12, 8, 24],
  },
  /* 直指：雨月——黑3 在天元右下斜邻方向 */
  雨月: {
    w: 5,
    h: 5,
    cells: [
      0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
    ],
    playOrder: [12, 7, 18],
  },
  /* 直指：松月——黑3 在右下远位（与雨月、瑞星等直指区分） */
  松月: {
    w: 5,
    h: 5,
    cells: [
      0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0,
    ],
    playOrder: [12, 7, 23],
  },
}

function catalogGridToSlots(
  w: number,
  h: number,
  cells: CatalogCell[],
  playOrder?: number[],
): CatalogSlot[] {
  const slots: CatalogSlot[] = []
  const c = Math.floor((BOARD_SIZE - 1) / 2)
  const ox = c - Math.floor((w - 1) / 2)
  const oy = c - Math.floor((h - 1) / 2)
  const pushAt = (i: number) => {
    if (i < 0 || i >= cells.length) return
    const gx = i % w
    const gy = Math.floor(i / w)
    const v = cells[i]
    if (v === 1 || v === 2) {
      slots.push({ x: ox + gx, y: oy + gy, player: v })
    }
  }
  if (playOrder !== undefined && playOrder.length > 0) {
    for (const i of playOrder) pushAt(i)
    return slots
  }
  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      const v = cells[gy * w + gx]
      if (v === 1 || v === 2) {
        slots.push({ x: ox + gx, y: oy + gy, player: v })
      }
    }
  }
  return slots
}

function catalogAllSlots(patternId: PatternId, template: CatalogCell[]): CatalogSlot[] {
  const g = CATALOG_DEMO_GRID[patternId]
  if (g) return catalogGridToSlots(g.w, g.h, g.cells, g.playOrder)
  return catalogStoneSlots(template)
}

/** 将招式演示落子序转为可续弈的盘面与棋谱（用于「以此局面续弈」） */
function buildPlayStateFromCatalogSlots(
  slots: CatalogSlot[],
  difficulty: Difficulty,
): {
  board: Cell[]
  moves: MoveRecord[]
  winner: Player | 0
  winLine: [number, number][]
  nextPlayer: Player
} {
  let b = createEmptyBoard()
  const moves: MoveRecord[] = []
  const mult = DIFFICULTY_SCORE_MULTIPLIER[difficulty]
  for (let i = 0; i < slots.length; i++) {
    const { x, y, player } = slots[i]
    const evalMove = evaluateBoardAt(b, x, y, player)
    const uiScoreDelta = Math.round((evalMove.score / 100) * mult)
    moves.push({
      index: i + 1,
      x,
      y,
      player,
      scoreDelta: uiScoreDelta,
      pattern: evalMove.pattern || '棋形导入',
    })
    const nb = b.slice()
    nb[indexOf(x, y)] = player
    b = nb
  }
  let winner: Player | 0 = 0
  let winLine: [number, number][] = []
  if (slots.length > 0) {
    const last = slots[slots.length - 1]
    const win = checkWin(b, last.x, last.y, last.player)
    if (win) {
      winner = last.player
      winLine = win.line
    }
  }
  const nextPlayer: Player = slots.length === 0 ? 1 : slots[slots.length - 1].player === 1 ? 2 : 1
  return { board: b, moves, winner, winLine, nextPlayer }
}

/** 按手顺：下一手行棋方（黑先；末手黑则下为白，反之亦然）。与 buildPlayStateFromCatalogSlots 中 nextPlayer 一致 */
function nextPlayerFromMoves(moves: MoveRecord[]): Player {
  if (moves.length === 0) return 1
  return moves[moves.length - 1]!.player === 1 ? 2 : 1
}

/** 演示落满后的盘面是否已存在五连（任一方），此类棋形不再提供「以此局面续弈」 */
function catalogDemoBoardAlreadyWon(slots: CatalogSlot[]): boolean {
  if (slots.length === 0) return false
  const b = createEmptyBoard()
  for (const s of slots) {
    b[indexOf(s.x, s.y)] = s.player
  }
  return findWinningLineFromBoard(b, 1) !== null || findWinningLineFromBoard(b, 2) !== null
}

/** 导入续弈前：子数须可由「黑先、交替」形成，且敌我均须有子、非终局（有对弈意义） */
type CatalogImportBlock =
  | 'ok'
  | 'terminal'
  | 'occupied_twice'
  | 'bad_counts'
  | 'single_side'
  | 'empty'

function catalogImportStatus(slots: CatalogSlot[]): {
  canImport: boolean
  block: CatalogImportBlock
} {
  if (slots.length === 0) return { canImport: false, block: 'empty' }
  const seen = new Set<string>()
  for (const s of slots) {
    const k = `${s.x},${s.y}`
    if (seen.has(k)) return { canImport: false, block: 'occupied_twice' }
    seen.add(k)
  }
  let b = 0
  let w = 0
  for (const s of slots) {
    if (s.player === 1) b++
    else w++
  }
  if (b === 0 || w === 0) return { canImport: false, block: 'single_side' }
  if (!(b === w || b === w + 1)) return { canImport: false, block: 'bad_counts' }
  if (catalogDemoBoardAlreadyWon(slots)) return { canImport: false, block: 'terminal' }
  return { canImport: true, block: 'ok' }
}

function catalogImportBlockHint(block: CatalogImportBlock): string {
  switch (block) {
    case 'ok':
      return ''
    case 'terminal':
      return '盘面已形成五连，不提供续弈'
    case 'occupied_twice':
      return '演示中同一位置重复占位，不提供续弈'
    case 'bad_counts':
      return '黑白子数目须符合先黑后白交替（黑=白 或 黑=白+1），否则不提供续弈'
    case 'single_side':
      return '需棋盘上有黑子与白子双方子力，单方棋形不提供续弈'
    case 'empty':
      return '无子，不提供续弈'
    default:
      return '当前演示不满足续弈条件'
  }
}

/** 侧栏卡片是否可提供「以此局面续弈」 */
function catalogPatternCanContinue(patternId: PatternId, template: CatalogCell[]): boolean {
  const slots = catalogAllSlots(patternId, template)
  return catalogImportStatus(slots).canImport
}

/** 演示落子转为相对坐标（平移不变），用于在完整棋盘上匹配导入的「阵势」 */
function patternOffsetsFromSlots(slots: CatalogSlot[]): { dx: number; dy: number; player: Player }[] {
  if (slots.length === 0) return []
  const minX = Math.min(...slots.map((s) => s.x))
  const minY = Math.min(...slots.map((s) => s.y))
  return slots.map((s) => ({
    dx: s.x - minX,
    dy: s.y - minY,
    player: s.player,
  }))
}

function boardMatchesPatternOffsets(
  board: Cell[],
  ox: number,
  oy: number,
  offsets: { dx: number; dy: number; player: Player }[],
): boolean {
  for (const o of offsets) {
    const x = ox + o.dx
    const y = oy + o.dy
    if (!inBounds(x, y)) return false
    if (board[indexOf(x, y)] !== o.player) return false
  }
  return true
}

function boardContainsImportedPattern(
  board: Cell[],
  offsets: { dx: number; dy: number; player: Player }[],
): boolean {
  if (offsets.length === 0) return true
  for (let oy = 0; oy < BOARD_SIZE; oy++) {
    for (let ox = 0; ox < BOARD_SIZE; ox++) {
      if (boardMatchesPatternOffsets(board, ox, oy, offsets)) return true
    }
  }
  return false
}

function collectEmptyCells(board: Cell[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[indexOf(x, y)] === 0) out.push({ x, y })
    }
  }
  return out
}

function aggregateHistoryScores(games: HistoryGame[]): { you: number; ai: number } {
  let you = 0
  let ai = 0
  for (const g of games) {
    const s = scoresFromMoves(g.moves)
    you += s.you
    ai += s.ai
  }
  return { you, ai }
}

/** 侧栏详情：有 CATALOG_DEMO_GRID 时用二维栅格；否则横排线 + 流光（与旧版画风一致） */
function PatternPreview({
  template,
  patternId,
}: {
  template: CatalogCell[]
  patternId?: PatternId | null
}) {
  const gid = useId().replace(/:/g, '')
  const grid = patternId ? CATALOG_DEMO_GRID[patternId] : undefined

  if (grid) {
    const { w, h, cells } = grid
    const step = Math.min(18, Math.max(11, Math.floor(76 / Math.max(w, h, 1))))
    const ox = 12
    const oy = 12
    const innerW = (w - 1) * step
    const innerH = (h - 1) * step
    const vbW = innerW + ox * 2
    const vbH = innerH + oy * 2
    return (
      <div className="pattern-preview pattern-preview--grid" aria-hidden="true">
        <svg
          className="pattern-preview-svg"
          viewBox={`0 0 ${vbW} ${vbH}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <rect
            x={ox - 3}
            y={oy - 3}
            width={innerW + 6}
            height={innerH + 6}
            rx={8}
            fill="none"
            stroke="rgba(148, 163, 184, 0.22)"
            strokeWidth="1"
          />
          {cells.map((v, i) => {
            const gx = i % w
            const gy = Math.floor(i / w)
            const cx = ox + gx * step
            const cy = oy + gy * step
            if (v === 0) {
              return (
                <circle
                  key={`d-${i}`}
                  cx={cx}
                  cy={cy}
                  r={Math.max(2.5, step * 0.14)}
                  className="pattern-dot off"
                />
              )
            }
            return (
              <circle
                key={`d-${i}`}
                cx={cx}
                cy={cy}
                r={step * 0.3}
                className={
                  v === 1 ? 'pattern-dot on pattern-dot-black' : 'pattern-dot on pattern-dot-white'
                }
              />
            )
          })}
        </svg>
      </div>
    )
  }

  const n = Math.max(template.length, 1)
  const pad = 10
  const step =
    n <= 1 ? 0 : Math.min(20, Math.max(11, Math.floor(96 / Math.max(n - 1, 1))))
  const innerW = n <= 1 ? 0 : (n - 1) * step
  const vbW = Math.max(120, pad * 2 + innerW)
  const vbH = 52
  const lineY = 26
  const lineEnd = vbW - pad
  return (
    <div className="pattern-preview" aria-hidden="true">
      <svg
        className="pattern-preview-svg"
        viewBox={`0 0 ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id={`previewGrad-${gid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.45" />
          </linearGradient>
        </defs>
        <path
          className="pattern-sweep"
          d={`M${pad} ${lineY} H${lineEnd}`}
          stroke={`url(#previewGrad-${gid})`}
          strokeWidth="4"
          strokeLinecap="round"
          opacity={0.35}
        />
        {template.map((v, i) => {
          const cx = pad + (n <= 1 ? 0 : i * step)
          if (v === 0) {
            return (
              <circle key={i} cx={cx} cy={lineY} r={5} className="pattern-dot off" />
            )
          }
          return (
            <circle
              key={i}
              cx={cx}
              cy={lineY}
              r={7}
              className={v === 1 ? 'pattern-dot on pattern-dot-black' : 'pattern-dot on pattern-dot-white'}
            />
          )
        })}
      </svg>
    </div>
  )
}

function App() {
  type ViewMode = 'play' | 'history' | 'catalog'
  const historyDateFilterInputId = useId()
  const [viewMode, setViewMode] = useState<ViewMode>('play')

  const [board, setBoard] = useState<Cell[]>(() => createEmptyBoard())
  const [currentPlayer, setCurrentPlayer] = useState<Player>(1)
  const [difficulty, setDifficulty] = useState<Difficulty>('easy')
  const [winner, setWinner] = useState<Player | 0>(0)
  const [winLine, setWinLine] = useState<[number, number][]>([])
  const [moveHistory, setMoveHistory] = useState<MoveRecord[]>([])
  /** 每局人机对弈可用悔棋次数（重新开局时恢复为 3） */
  const [undosRemaining, setUndosRemaining] = useState(3)
  /** 悔棋：被提子先播退场再改局面 */
  const [undoStoneExit, setUndoStoneExit] = useState<
    null | { key: number; cells: { x: number; y: number; player: Player }[] }
  >(null)
  const undoAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 上一手失去「最后」标记后仍独立播完余晖光效，避免被下一手打断 */
  const [stoneAfterglowKeys, setStoneAfterglowKeys] = useState(() => new Set<string>())
  const playLastPosRef = useRef<{ x: number; y: number } | null>(null)
  /** 与棋谱一致累加，避免 AI 落子在 setTimeout 里时与独立 totalScore 状态不同步 */
  const totalScore = useMemo(
    () => moveHistory.reduce((sum, m) => sum + m.scoreDelta, 0),
    [moveHistory],
  )
  const [hintTarget, setHintTarget] = useState<{ x: number; y: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  const [boardKick, setBoardKick] = useState<0 | 1>(0)
  const boardWrapRef = useRef<HTMLDivElement | null>(null)
  /** 与 div.board 可视边长一致，用于同步 --boardPx（较 wrap 减 padding 更准确） */
  const boardMeasureRef = useRef<HTMLDivElement | null>(null)
  /** 左侧整列 section.board-zone，用于侧栏与栅格行同高（比只量 board-wrap 更贴近实际行盒） */
  const boardZoneRef = useRef<HTMLElement | null>(null)
  /** 棋盘+侧栏所在行，用于与左侧同高时吸收子像素行高 */
  const mainTopRowRef = useRef<HTMLDivElement | null>(null)
  /** 与 div.board 实际边长一致（board-wrap 减去 board-container 的 18px×2 padding） */
  const [boardPx, setBoardPx] = useState(640)
  /** 与左侧 .board-zone 同高（侧栏 height，与棋盘列底缘对齐） */
  const [boardWrapOuterHeight, setBoardWrapOuterHeight] = useState(0)
  const viewModeRef = useRef<ViewMode>(viewMode)
  viewModeRef.current = viewMode
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(null)
  const [resultFlash, setResultFlash] = useState<{ text: string; show: boolean } | null>(
    null,
  )
  /** 棋形导入：随机演示直至盘面出现可平移匹配的阵势，再交玩家行棋 */
  const [patternImportSession, setPatternImportSession] = useState<{
    patternId: PatternId
    phase: 'simulating' | 'ready'
  } | null>(null)
  /** 「取消棋形导入」：先播 dock 退场再 reset，避免硬切 */
  const [patternImportDockExiting, setPatternImportDockExiting] = useState(false)
  const patternImportSessionRef = useRef<typeof patternImportSession>(null)
  const importSnapshotRef = useRef<{
    board: Cell[]
    moves: MoveRecord[]
    nextPlayer: Player
  } | null>(null)
  type ImportSimState = {
    board: Cell[]
    moves: MoveRecord[]
    player: Player
    patternOffsets: { dx: number; dy: number; player: Player }[]
    baseBoard: Cell[]
    baseMoves: MoveRecord[]
    baseNext: Player
    stepCount: number
  }
  const importSimStateRef = useRef<ImportSimState | null>(null)
  const importSimTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  /** 仅「轮到你 / 对方在下」大字用；勿与随机模拟 effect 的 cleanup 共用，否则 phase 切到 ready 时会被误清 */
  const importPatternFlashTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const importSimActiveRef = useRef(false)
  /** 棋形导入续弈后若下一手为白（AI），先播「对方在下」大字，此期间不执行 AI 落子 */
  const [importOpponentIntro, setImportOpponentIntro] = useState(false)
  /** 仅「对方在下」后的第一手 AI 落子后再闪「轮到你」，非整盘每步都闪 */
  const pendingYourTurnFlashAfterAiRef = useRef(false)
  /** 简单档提示光：AI 落子后暂缓算 pickBestHumanHintMove，避免与白子 dropIn 动画（~0.42s）抢主线程帧 */
  const hintDeferAfterAiUntilRef = useRef(0)
  const difficultyRef = useRef(difficulty)
  difficultyRef.current = difficulty
  const aiWorkerRef = useRef<Worker | null>(null)
  const aiWorkerRequestIdRef = useRef(0)

  useEffect(() => {
    try {
      aiWorkerRef.current = new Worker(new URL('./ai/ai.worker.ts', import.meta.url), {
        type: 'module',
      })
    } catch {
      aiWorkerRef.current = null
    }
    return () => {
      aiWorkerRef.current?.terminate()
      aiWorkerRef.current = null
    }
  }, [])

  const clearImportFlashTimers = () => {
    importPatternFlashTimersRef.current.forEach((tid) => window.clearTimeout(tid))
    importPatternFlashTimersRef.current = []
  }

  const flashImportYourTurn = useCallback(() => {
    clearImportFlashTimers()
    setResultFlash({ text: '轮到你', show: true })
    const t1 = window.setTimeout(() => setResultFlash({ text: '轮到你', show: false }), 1400)
    const t2 = window.setTimeout(() => setResultFlash(null), 2100)
    importPatternFlashTimersRef.current = [t1, t2]
  }, [])

  const flashImportOpponentFirst = useCallback(() => {
    clearImportFlashTimers()
    setImportOpponentIntro(true)
    setResultFlash({ text: '对方在下', show: true })
    /* 短暂全显后渐隐（须保持 show→hide 两帧，勿与 null 同批）；结束 intro 略早于卸节点，便于 AI 落子 */
    const t1 = window.setTimeout(() => {
      setResultFlash((c) =>
        c?.text === '对方在下' ? { text: '对方在下', show: false } : c,
      )
    }, 480)
    const t2 = window.setTimeout(() => {
      setResultFlash((c) => (c?.text === '对方在下' ? null : c))
    }, 1100)
    const t3 = window.setTimeout(() => setImportOpponentIntro(false), 560)
    importPatternFlashTimersRef.current = [t1, t2, t3]
  }, [])

  const [aboutVisible, setAboutVisible] = useState(false)
  /** 棋形导入后顶栏改难度：待确认的目标档位（自绘弹窗，避免 window.confirm 被拦截或不出现） */
  const [pendingImportDifficulty, setPendingImportDifficulty] = useState<Difficulty | null>(null)
  const [aboutLeaving, setAboutLeaving] = useState(false)
  const aboutCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [aboutBtnPulse, setAboutBtnPulse] = useState(false)
  /** 普通/困难：Worker 算棋期间为 true，底栏可加强「思考中」表现 */
  const [aiWorkerBusy, setAiWorkerBusy] = useState(false)

  const [historyGames, setHistoryGames] = useState<HistoryGame[]>(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      const parsed = raw ? (JSON.parse(raw) as HistoryGame[]) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState<number>(-1)
  const [historySelectedIds, setHistorySelectedIds] = useState<string[]>([])
  /** 删除记录模式：显示多选框与工具条，卡片右移 */
  const [historyDeleteMode, setHistoryDeleteMode] = useState(false)
  /** 历史列表：按本地日期筛选（YYYY-MM-DD），空字符串表示不过滤 */
  const [historyDateFilter, setHistoryDateFilter] = useState('')
  const [historyPage, setHistoryPage] = useState(1)
  const [historyPageSize, setHistoryPageSize] = useState(8)
  /** 人机 / 历史 / 招式切换时主区动效 */
  const [viewSwitchAnim, setViewSwitchAnim] = useState(false)
  const [replayStep, setReplayStep] = useState<number>(0)
  const [replayPlaying, setReplayPlaying] = useState<boolean>(false)

  const [catalogDetailId, setCatalogDetailId] = useState<PatternId | null>(null)
  /** 取消选中后短暂保留 id，用于底部与卡片的退出动效播完再卸载 */
  const [catalogExitBuffer, setCatalogExitBuffer] = useState<PatternId | null>(null)
  /** 收起详情后：对应卡片 + 列表区 + 滚动条拇指「落稳」动效（恢复动画 0% 与退出末帧对齐，避免抖） */
  const [catalogRestoreTargetId, setCatalogRestoreTargetId] = useState<PatternId | null>(null)
  const catalogCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const catalogRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const catalogExitingForRestoreRef = useRef<PatternId | null>(null)
  const [catalogFilter, setCatalogFilter] = useState<'all' | CatalogFilterTag>('all')
  const [catalogSort, setCatalogSort] = useState<CatalogSortMode>('default')
  /** 招式主棋盘：按演示手顺逐子播放（与 slots 顺序一致） */
  const [catalogAnimFrame, setCatalogAnimFrame] = useState(0)
  const catalogListFiltered = useMemo(() => {
    const base =
      catalogFilter === 'all'
        ? PATTERN_CATALOG
        : catalogFilter === 'continue'
          ? PATTERN_CATALOG.filter((p) => catalogPatternCanContinue(p.id, p.template))
          : PATTERN_CATALOG.filter((p) => PATTERN_CATALOG_TAGS[p.id] === catalogFilter)
    if (catalogSort === 'default') return base
    const sorted = [...base].sort((a, b) => {
      const d = a.scoreShow - b.scoreShow
      if (d !== 0) return catalogSort === 'score_desc' ? -d : d
      return a.id.localeCompare(b.id, 'zh-Hans-CN')
    })
    return sorted
  }, [catalogFilter, catalogSort])

  const clearCatalogCloseTimer = useCallback(() => {
    if (catalogCloseTimerRef.current !== null) {
      window.clearTimeout(catalogCloseTimerRef.current)
      catalogCloseTimerRef.current = null
    }
    catalogExitingForRestoreRef.current = null
    if (catalogRestoreTimerRef.current !== null) {
      window.clearTimeout(catalogRestoreTimerRef.current)
      catalogRestoreTimerRef.current = null
    }
    setCatalogRestoreTargetId(null)
  }, [])

  const beginCatalogDetailClose = useCallback(() => {
    if (catalogDetailId === null) return
    clearCatalogCloseTimer()
    const id = catalogDetailId
    catalogExitingForRestoreRef.current = id
    setCatalogExitBuffer(id)
    setCatalogDetailId(null)
    /* 与 CSS 中 catalogDetailExit / catalogCardExitRipple 时长一致；恢复动效见 catalogCardRestoreIn / catalogScrollAreaRestore */
    catalogCloseTimerRef.current = window.setTimeout(() => {
      setCatalogExitBuffer(null)
      catalogCloseTimerRef.current = null
      const rid = catalogExitingForRestoreRef.current
      catalogExitingForRestoreRef.current = null
      if (rid !== null) {
        setCatalogRestoreTargetId(rid)
        catalogRestoreTimerRef.current = window.setTimeout(() => {
          setCatalogRestoreTargetId(null)
          catalogRestoreTimerRef.current = null
        }, 720)
      }
    }, 300)
  }, [catalogDetailId, clearCatalogCloseTimer])

  const catalogUiPatternId = catalogDetailId ?? catalogExitBuffer

  const catalogBoardSummary = useMemo(() => {
    if (viewMode !== 'catalog' || !catalogUiPatternId) return null
    const item = PATTERN_CATALOG.find((x) => x.id === catalogUiPatternId)
    if (!item) return null
    const slots = catalogAllSlots(catalogUiPatternId, item.template)
    let black = 0
    let white = 0
    for (const s of slots) {
      if (s.player === 1) black++
      else white++
    }
    const last = slots.length > 0 ? slots[slots.length - 1] : null
    const nextHint =
      last === null
        ? '黑方（你）先行'
        : last.player === 1
          ? '下一手为白方（AI）'
          : '下一手为黑方（你）'
    const { canImport, block } = catalogImportStatus(slots)
    return {
      name: item.name,
      black,
      white,
      total: slots.length,
      nextHint,
      canContinue: canImport,
      importBlock: block,
    }
  }, [viewMode, catalogUiPatternId])

  /** 从「不可续弈」卡片切到「可续弈」卡片时触发一次增强动效 */
  const [catalogContinueBoost, setCatalogContinueBoost] = useState(false)
  /** 「以此局面续弈」：先展开难度，再开局 */
  const [catalogContinuePickOpen, setCatalogContinuePickOpen] = useState(false)
  const catalogContinueLastRef = useRef<{ id: PatternId | null; canContinue: boolean }>({
    id: null,
    canContinue: false,
  })

  useEffect(() => {
    if (viewMode !== 'catalog') {
      catalogContinueLastRef.current = { id: null, canContinue: false }
      setCatalogContinueBoost(false)
      return
    }
    if (!catalogDetailId || !catalogBoardSummary) {
      if (!catalogDetailId) {
        catalogContinueLastRef.current = { id: null, canContinue: false }
        setCatalogContinueBoost(false)
      }
      return
    }

    const last = catalogContinueLastRef.current
    const nextCan = catalogBoardSummary.canContinue
    const switchedCard = last.id !== null && last.id !== catalogDetailId
    if (switchedCard && last.canContinue === false && nextCan === true) {
      setCatalogContinueBoost(true)
      const t = window.setTimeout(() => setCatalogContinueBoost(false), 920)
      catalogContinueLastRef.current = { id: catalogDetailId, canContinue: nextCan }
      return () => window.clearTimeout(t)
    }

    catalogContinueLastRef.current = { id: catalogDetailId, canContinue: nextCan }
  }, [viewMode, catalogDetailId, catalogBoardSummary])

  useEffect(() => {
    if (viewMode !== 'catalog') setCatalogContinuePickOpen(false)
  }, [viewMode])

  useEffect(() => {
    setCatalogContinuePickOpen(false)
  }, [catalogDetailId])

  const runContinuePlayFromCatalog = useCallback(
    (chosenDiff: Difficulty) => {
      if (catalogDetailId === null) return
      clearCatalogCloseTimer()
      const item = PATTERN_CATALOG.find((x) => x.id === catalogDetailId)
      if (!item) return
      const slots = catalogAllSlots(catalogDetailId, item.template)
      if (!catalogImportStatus(slots).canImport) return
      const { board: nb, moves, winner: w, nextPlayer: np } =
        buildPlayStateFromCatalogSlots(slots, chosenDiff)
      if (w !== 0) return
      setDifficulty(chosenDiff)
      setCatalogContinuePickOpen(false)
      importSnapshotRef.current = {
        board: nb.slice(),
        moves: moves.map((m) => ({ ...m })),
        nextPlayer: np,
      }
      setBoard(nb)
      setMoveHistory(moves)
      setWinner(0)
      setWinLine([])
      setCurrentPlayer(np)
      const last = slots[slots.length - 1]
      setFocus({ x: last.x, y: last.y })
      setHintTarget(null)
      setCatalogDetailId(null)
      setCatalogExitBuffer(null)
      setCatalogRestoreTargetId(null)
      setCatalogAnimFrame(0)
      setPatternImportSession({ patternId: catalogDetailId, phase: 'simulating' })
      setViewMode('play')
      setSessionId(String(Date.now()))
      savedForSessionRef.current = null
    },
    [catalogDetailId, clearCatalogCloseTimer],
  )

  useEffect(
    () => () => {
      if (catalogCloseTimerRef.current !== null) {
        window.clearTimeout(catalogCloseTimerRef.current)
        catalogCloseTimerRef.current = null
      }
      if (catalogRestoreTimerRef.current !== null) {
        window.clearTimeout(catalogRestoreTimerRef.current)
        catalogRestoreTimerRef.current = null
      }
      if (undoAnimTimerRef.current !== null) {
        window.clearTimeout(undoAnimTimerRef.current)
        undoAnimTimerRef.current = null
      }
    },
    [],
  )

  /** 离开对弈视图时中止悔棋退场（不提交局面变更） */
  useEffect(() => {
    if (viewMode === 'play') return
    if (undoAnimTimerRef.current !== null) {
      window.clearTimeout(undoAnimTimerRef.current)
      undoAnimTimerRef.current = null
    }
    setUndoStoneExit(null)
  }, [viewMode])

  useEffect(() => {
    if (viewMode !== 'play') {
      playLastPosRef.current = null
      setStoneAfterglowKeys(new Set())
      return
    }
    if (moveHistory.length === 0) {
      playLastPosRef.current = null
      setStoneAfterglowKeys(new Set())
      return
    }
    const lastMove = moveHistory[moveHistory.length - 1]
    const prev = playLastPosRef.current
    if (prev !== null && (prev.x !== lastMove.x || prev.y !== lastMove.y)) {
      const k = `${prev.x},${prev.y}`
      startTransition(() => {
        setStoneAfterglowKeys((s) => new Set(s).add(k))
      })
      window.setTimeout(() => {
        startTransition(() => {
          setStoneAfterglowKeys((s) => {
            const n = new Set(s)
            n.delete(k)
            return n
          })
        })
      }, 3300)
    }
    playLastPosRef.current = { x: lastMove.x, y: lastMove.y }
  }, [moveHistory, viewMode])

  const [sessionId, setSessionId] = useState(() => String(Date.now()))
  const savedForSessionRef = useRef<string | null>(null)
  const skipFirstViewSwitchAnimRef = useRef(true)

  const activeHistory: HistoryGame | null =
    viewMode === 'history' &&
    selectedHistoryIndex >= 0 &&
    selectedHistoryIndex < historyGames.length
      ? historyGames[selectedHistoryIndex]
      : null

  const replayMoves = activeHistory?.moves ?? []

  const historyTargetBoard = useMemo(() => {
    if (!activeHistory) return null
    return boardFromMoves(activeHistory.moves, replayStep)
  }, [activeHistory, replayStep])

  const historyTargetBoardRef = useRef<Cell[] | null>(null)
  historyTargetBoardRef.current = historyTargetBoard

  const [historyStableBoard, setHistoryStableBoard] = useState<Cell[] | null>(null)
  const [historyCrossfade, setHistoryCrossfade] = useState<{
    from: Cell[]
    to: Cell[]
    id: number
  } | null>(null)
  const historyCrossfadeSeqRef = useRef(0)
  /** 取消选中卡片时：短暂保留终局快照并播棋子退场，再清空 */
  const [historyExitAnim, setHistoryExitAnim] = useState<{ cells: Cell[]; id: number } | null>(null)
  const historyExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const historyExitSeqRef = useRef(0)

  useEffect(() => {
    if (viewMode !== 'history') {
      setHistoryExitAnim(null)
      if (historyExitTimerRef.current) {
        clearTimeout(historyExitTimerRef.current)
        historyExitTimerRef.current = null
      }
    }
  }, [viewMode])

  useEffect(() => {
    if (selectedHistoryIndex >= 0) {
      setHistoryExitAnim(null)
      if (historyExitTimerRef.current) {
        clearTimeout(historyExitTimerRef.current)
        historyExitTimerRef.current = null
      }
    }
  }, [selectedHistoryIndex])

  useEffect(() => {
    if (viewMode !== 'history') {
      setHistoryStableBoard(null)
      setHistoryCrossfade(null)
      return
    }
    if (!historyTargetBoard) {
      setHistoryStableBoard(null)
      setHistoryCrossfade(null)
      return
    }
    setHistoryStableBoard((stable) => {
      if (!stable) return historyTargetBoard.slice()
      /** 顺序重播：每步与 replayStep 局面严格一致，勿保留旧 stable，否则与 crossfade.to 叠出「未来」子 */
      if (replayPlaying) return historyTargetBoard.slice()
      return stable
    })
  }, [viewMode, historyTargetBoard, replayPlaying])

  /** 必须在绘制前挂上 crossfade，否则会先闪一帧「已是新局面」再播过渡 */
  useLayoutEffect(() => {
    if (viewMode !== 'history' || !historyTargetBoard || !historyStableBoard) return
    /** 顺序播放时不用叠子过渡，避免 to 滞后一帧仍画出未应手的子 */
    if (replayPlaying) {
      setHistoryCrossfade((cf) => (cf !== null ? null : cf))
      return
    }
    if (boardsEqual(historyStableBoard, historyTargetBoard)) {
      setHistoryCrossfade((cf) => (cf !== null ? null : cf))
      return
    }

    const toSnapshot = historyTargetBoard.slice()
    historyCrossfadeSeqRef.current += 1
    const cfId = historyCrossfadeSeqRef.current
    setHistoryCrossfade({ from: historyStableBoard, to: toSnapshot, id: cfId })
    /** 略长于 CSS 0.46s，避免最后一帧仍带 forwards 的叠层与静态子切换叠成闪点 */
    const tid = window.setTimeout(() => {
      const latest = historyTargetBoardRef.current
      if (latest) setHistoryStableBoard(latest.slice())
      setHistoryCrossfade(null)
    }, 480)
    return () => {
      window.clearTimeout(tid)
      /** 仅当目标局面已变（换卡/步进打断过渡）时把 stable 收到本次动画的 to；与 to 仍相同时跳过，避免 Strict Mode 双跑误伤 */
      const liveTarget = historyTargetBoardRef.current
      if (
        viewModeRef.current === 'history' &&
        liveTarget &&
        !boardsEqual(liveTarget, toSnapshot)
      ) {
        setHistoryStableBoard(toSnapshot.slice())
      }
      setHistoryCrossfade(null)
    }
  }, [viewMode, historyTargetBoard, historyStableBoard, replayPlaying])

  const duelScores = useMemo(() => {
    if (viewMode !== 'history') return scoresFromMoves(moveHistory)
    if (selectedHistoryIndex < 0) return aggregateHistoryScores(historyGames)
    const g = historyGames[selectedHistoryIndex]
    if (!g) return { you: 0, ai: 0 }
    return scoresFromMoves(g.moves.slice(0, replayStep))
  }, [viewMode, moveHistory, historyGames, selectedHistoryIndex, replayStep])

  /** 历史列表：可选按本地日过滤，新→旧 */
  const historyFilteredSorted = useMemo(() => {
    let arr = historyGames.map((g, originalIndex) => ({ g, originalIndex }))
    if (historyDateFilter) {
      arr = arr.filter(({ g }) => toLocalYMD(g.createdAt) === historyDateFilter)
    }
    arr.sort((a, b) => b.g.createdAt - a.g.createdAt)
    return arr
  }, [historyGames, historyDateFilter])

  const historyTotalPages = useMemo(
    () => Math.max(1, Math.ceil(historyFilteredSorted.length / historyPageSize)),
    [historyFilteredSorted.length, historyPageSize],
  )

  const historyPageSafe = Math.min(Math.max(1, historyPage), historyTotalPages)

  const historyPageSlice = useMemo(() => {
    const start = (historyPageSafe - 1) * historyPageSize
    return historyFilteredSorted.slice(start, start + historyPageSize)
  }, [historyFilteredSorted, historyPageSafe, historyPageSize])

  useEffect(() => {
    setHistoryPage(1)
  }, [historyDateFilter, historyPageSize])

  useEffect(() => {
    setHistoryPage((p) => Math.min(p, historyTotalPages))
  }, [historyTotalPages])

  const catalogDemoTemplate = useMemo(() => {
    if (viewMode !== 'catalog' || !catalogDetailId) return null
    return PATTERN_CATALOG.find((x) => x.id === catalogDetailId)?.template ?? null
  }, [viewMode, catalogDetailId])

  const catalogVisibleSlots = useMemo((): CatalogSlot[] => {
    if (!catalogDemoTemplate || !catalogDetailId) return []
    const ordered = catalogAllSlots(catalogDetailId, catalogDemoTemplate)
    const n = ordered.length
    const visibleCount =
      catalogAnimFrame === 0 ? 0 : Math.min(catalogAnimFrame, n)
    return ordered.slice(0, visibleCount)
  }, [catalogDetailId, catalogDemoTemplate, catalogAnimFrame])

  const gameOver = winner !== 0

  useEffect(() => {
    patternImportSessionRef.current = patternImportSession
  }, [patternImportSession])

  useEffect(() => {
    setMounted(true)
  }, [])

  const closeAbout = useCallback(() => {
    if (!aboutVisible || aboutLeaving) return
    if (aboutCloseTimerRef.current) {
      clearTimeout(aboutCloseTimerRef.current)
      aboutCloseTimerRef.current = null
    }
    setAboutLeaving(true)
    aboutCloseTimerRef.current = window.setTimeout(() => {
      aboutCloseTimerRef.current = null
      setAboutVisible(false)
      setAboutLeaving(false)
    }, 380)
  }, [aboutVisible, aboutLeaving])

  useEffect(() => {
    return () => {
      if (aboutCloseTimerRef.current) clearTimeout(aboutCloseTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!aboutVisible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAbout()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [aboutVisible, closeAbout])

  useEffect(() => {
    if (viewMode !== 'catalog') {
      clearCatalogCloseTimer()
      setCatalogExitBuffer(null)
      setCatalogDetailId(null)
    }
  }, [viewMode, clearCatalogCloseTimer])

  useEffect(() => {
    if (catalogFilter === 'all' || !catalogDetailId) return
    const item = PATTERN_CATALOG.find((x) => x.id === catalogDetailId)
    if (!item) {
      clearCatalogCloseTimer()
      setCatalogExitBuffer(null)
      setCatalogDetailId(null)
      return
    }
    const inFilter =
      catalogFilter === 'continue'
        ? catalogPatternCanContinue(item.id, item.template)
        : PATTERN_CATALOG_TAGS[catalogDetailId] === catalogFilter
    if (inFilter) return
    clearCatalogCloseTimer()
    setCatalogExitBuffer(null)
    setCatalogDetailId(null)
  }, [catalogFilter, catalogDetailId, clearCatalogCloseTimer])

  useEffect(() => {
    if (viewMode !== 'history') {
      setHistoryDeleteMode(false)
      setHistorySelectedIds([])
    }
  }, [viewMode])

  useEffect(() => {
    if (skipFirstViewSwitchAnimRef.current) {
      skipFirstViewSwitchAnimRef.current = false
      return
    }
    setViewSwitchAnim(true)
    const t = window.setTimeout(() => setViewSwitchAnim(false), 460)
    return () => window.clearTimeout(t)
  }, [viewMode])

  useEffect(() => {
    setCatalogAnimFrame(0)
  }, [catalogDetailId])

  useEffect(() => {
    if (viewMode !== 'catalog' || !catalogDetailId) return
    const item = PATTERN_CATALOG.find((x) => x.id === catalogDetailId)
    if (!item) return
    const n = catalogAllSlots(catalogDetailId, item.template).length
    if (n === 0) return
    const cycleEnd = 1 + n + 6
    const t = window.setInterval(() => {
      setCatalogAnimFrame((f) => (f >= cycleEnd ? 0 : f + 1))
    }, 360)
    return () => window.clearInterval(t)
  }, [viewMode, catalogDetailId])

  /** 棋盘像素 + 右侧玻璃高度：左侧 board-zone 与 main-top-row 行盒取 max，避免「r 比 h 大很多」时仍用偏小的 h 导致右侧矮一截 */
  const syncSidePanelHeight = () => {
    const vm = viewModeRef.current
    const zone = boardZoneRef.current
    if (!zone) return
    const bMeas = boardMeasureRef.current
    const wEl = boardWrapRef.current
    if (bMeas) {
      const d = Math.min(bMeas.clientWidth, bMeas.clientHeight)
      if (d > 0) setBoardPx(Math.floor(d))
    } else if (wEl) {
      const w = Math.min(wEl.offsetWidth, wEl.offsetHeight)
      const boardEdge = Math.floor(Math.max(0, w - 36))
      setBoardPx(boardEdge > 0 ? boardEdge : 640)
    }

    /*
     * 历史：勿给 aside 锁像素高。旧逻辑用 max(行盒, 棋盘) 会在长屏/栅格反馈下把行盒撑得极高，玻璃 height:100% 在对抗条下出现大块空白。
     * 改为高度 0 → 不施加行内 height，侧栏随内容结束在对抗条下方。
     * 招式大全：必须以左侧整列 section.board-zone 的外缘高度为准，与棋盘玻璃外框底边对齐，避免右栏偏矮裁切底部。
     */
    if (vm === 'history') {
      setBoardWrapOuterHeight(0)
      return
    }

    if (vm === 'catalog') {
      const wrapH = wEl ? wEl.offsetHeight : 0
      const zoneBox = zone.getBoundingClientRect()
      const zoneH = Math.max(zone.offsetHeight, Math.ceil(zoneBox.height))
      setBoardWrapOuterHeight(Math.max(0, zoneH, wrapH))
      return
    }

    const wrapH = wEl ? wEl.offsetHeight : 0

    // 人机对弈：侧栏高度仅与左侧 .board-wrap（内含 .board-container）外缘一致，底边与棋盘玻璃对齐。
    // 勿用 section.board-zone / 整行高度：招式列表等曾会把 zone 或行盒撑高，旧逻辑用 zone 与 wrap 的差值截断侧栏，反而与棋盘底缘错位。
    if (vm === 'play') {
      setBoardWrapOuterHeight(Math.max(0, wrapH))
      return
    }
  }

  // Responsive board size + 与侧栏同高（ResizeObserver 合并到每帧一次，避免落子后连续 layout 触发多次 setState）
  useEffect(() => {
    const wrap = boardWrapRef.current
    const zone = boardZoneRef.current
    const row = mainTopRowRef.current
    const boardEl = boardMeasureRef.current
    if (!wrap || !zone) return
    let roRaf = 0
    const scheduleSync = () => {
      cancelAnimationFrame(roRaf)
      roRaf = requestAnimationFrame(() => {
        roRaf = 0
        syncSidePanelHeight()
      })
    }
    const ro = new ResizeObserver(scheduleSync)
    ro.observe(zone)
    ro.observe(wrap)
    if (boardEl) ro.observe(boardEl)
    if (row) ro.observe(row)
    scheduleSync()
    return () => {
      cancelAnimationFrame(roRaf)
      ro.disconnect()
    }
  }, [viewMode])

  /** 切换对局 / 历史 / 招式后列宽变化，多帧再量一次避免与棋盘不齐 */
  useLayoutEffect(() => {
    let id2: number | undefined
    const id1 = requestAnimationFrame(() => {
      syncSidePanelHeight()
      id2 = requestAnimationFrame(() => syncSidePanelHeight())
    })
    return () => {
      cancelAnimationFrame(id1)
      if (id2 !== undefined) cancelAnimationFrame(id2)
    }
  }, [viewMode, catalogDetailId])

  // 无对局记录时清空选中，避免沿用旧索引误显示对抗条等
  useEffect(() => {
    if (historyGames.length > 0) return
    setSelectedHistoryIndex(-1)
    setReplayStep(0)
    setReplayPlaying(false)
  }, [historyGames.length])

  // 进入「历史查看」：无记录则清空；有记录时保留合法选中索引，否则为「未选中」以显示累计对抗
  useEffect(() => {
    if (viewMode !== 'history') {
      setReplayPlaying(false)
      return
    }
    if (historyGames.length === 0) {
      setSelectedHistoryIndex(-1)
      setReplayStep(0)
      setReplayPlaying(false)
      return
    }
    setSelectedHistoryIndex((prev) =>
      prev >= 0 && prev < historyGames.length ? prev : -1,
    )
  }, [viewMode, historyGames.length])

  // 历史列表勾选：删除对局后去掉已不存在的 id
  useEffect(() => {
    setHistorySelectedIds((prev) => prev.filter((id) => historyGames.some((g) => g.id === id)))
  }, [historyGames])

  // 播放到最后一手时自动暂停
  useEffect(() => {
    if (viewMode !== 'history' || !replayPlaying) return
    if (replayMoves.length === 0) return
    if (replayStep < replayMoves.length) return
    setReplayPlaying(false)
  }, [viewMode, replayPlaying, replayStep, replayMoves.length])

  // 历史播放：定时推进 replayStep（不依赖 replayStep，避免每步重置定时器）
  useEffect(() => {
    if (viewMode !== 'history') return
    if (!replayPlaying) return
    if (!activeHistory) return
    if (replayMoves.length === 0) return

    const t = window.setInterval(() => {
      setReplayStep((s) => {
        if (s >= replayMoves.length) return s
        return s + 1
      })
    }, 420)

    return () => window.clearInterval(t)
  }, [viewMode, replayPlaying, selectedHistoryIndex, replayMoves.length, activeHistory?.id])

  const allHistorySelected =
    historyGames.length > 0 && historySelectedIds.length === historyGames.length

  const toggleHistorySelect = (id: string) => {
    setHistorySelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const toggleSelectAllHistory = () => {
    setHistorySelectedIds((prev) =>
      prev.length === historyGames.length ? [] : historyGames.map((g) => g.id),
    )
  }

  const cancelHistoryDeleteMode = useCallback(() => {
    setHistoryDeleteMode(false)
    setHistorySelectedIds([])
  }, [])

  /** 取消选中历史卡片：回到「累计对抗」视图，并重置回放状态；棋盘先播退场再空 */
  const clearHistorySelection = useCallback(() => {
    setReplayPlaying(false)
    setReplayStep(0)
    const snap =
      viewMode === 'history' && selectedHistoryIndex >= 0
        ? historyTargetBoardRef.current
        : null
    if (historyExitTimerRef.current) {
      clearTimeout(historyExitTimerRef.current)
      historyExitTimerRef.current = null
    }
    setSelectedHistoryIndex(-1)
    if (snap) {
      historyExitSeqRef.current += 1
      const id = historyExitSeqRef.current
      setHistoryExitAnim({ cells: snap.slice(), id })
      historyExitTimerRef.current = window.setTimeout(() => {
        historyExitTimerRef.current = null
        setHistoryExitAnim(null)
      }, 420)
    } else {
      setHistoryExitAnim(null)
    }
  }, [viewMode, selectedHistoryIndex])

  const deleteSelectedHistoryGames = () => {
    if (historySelectedIds.length === 0) return
    const curId =
      selectedHistoryIndex >= 0 ? historyGames[selectedHistoryIndex]?.id : undefined
    const next = historyGames.filter((g) => !historySelectedIds.includes(g.id))
    setHistoryGames(next)
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
    } catch {
      // localStorage 失败不影响界面
    }
    setHistorySelectedIds([])
    setHistoryDeleteMode(false)
    setReplayPlaying(false)
    if (next.length === 0) {
      setSelectedHistoryIndex(-1)
      setReplayStep(0)
      return
    }
    let newIdx: number
    if (curId && next.some((g) => g.id === curId)) {
      newIdx = next.findIndex((g) => g.id === curId)
    } else {
      newIdx = next.length - 1
    }
    const g = next[newIdx]
    setSelectedHistoryIndex(newIdx)
    setReplayStep(g.moves.length)
  }

  const handleReset = () => {
    if (undoAnimTimerRef.current !== null) {
      window.clearTimeout(undoAnimTimerRef.current)
      undoAnimTimerRef.current = null
    }
    setUndoStoneExit(null)
    setPatternImportDockExiting(false)
    setPendingImportDifficulty(null)
    setViewMode('play')
    setBoard(createEmptyBoard())
    setCurrentPlayer(1)
    setWinner(0)
    setWinLine([])
    setMoveHistory([])
    setHintTarget(null)
    setFocus(null)
    setReplayStep(0)
    setReplayPlaying(false)
    setSessionId(String(Date.now()))
    savedForSessionRef.current = null
    setPatternImportSession(null)
    importSnapshotRef.current = null
    importSimStateRef.current = null
    if (importSimTimerRef.current !== null) {
      window.clearInterval(importSimTimerRef.current)
      importSimTimerRef.current = null
    }
    clearImportFlashTimers()
    setResultFlash(null)
    importSimActiveRef.current = false
    setImportOpponentIntro(false)
    pendingYourTurnFlashAfterAiRef.current = false
    setUndosRemaining(3)
  }

  const replayImportSamePosition = useCallback(() => {
    const snap = importSnapshotRef.current
    const sess = patternImportSessionRef.current
    if (!snap || !sess) return
    setBoard(snap.board.slice())
    setMoveHistory(snap.moves.map((m) => ({ ...m })))
    setWinner(0)
    setWinLine([])
    const np = snap.nextPlayer
    setCurrentPlayer(np)
    const last = snap.moves[snap.moves.length - 1]
    if (last) setFocus({ x: last.x, y: last.y })
    setHintTarget(null)
    setPatternImportSession({ patternId: sess.patternId, phase: 'ready' })
    setUndosRemaining(3)
    if (np === 2) {
      pendingYourTurnFlashAfterAiRef.current = true
      flashImportOpponentFirst()
    } else {
      pendingYourTurnFlashAfterAiRef.current = false
      setImportOpponentIntro(false)
      flashImportYourTurn()
    }
  }, [flashImportOpponentFirst, flashImportYourTurn])

  const restartImportRandomSimulation = useCallback(() => {
    const snap = importSnapshotRef.current
    const sess = patternImportSessionRef.current
    if (!snap || !sess) return
    clearImportFlashTimers()
    setResultFlash(null)
    setImportOpponentIntro(false)
    pendingYourTurnFlashAfterAiRef.current = false
    setBoard(snap.board.slice())
    setMoveHistory(snap.moves.map((m) => ({ ...m })))
    setWinner(0)
    setWinLine([])
    setCurrentPlayer(snap.nextPlayer)
    setPatternImportSession({ patternId: sess.patternId, phase: 'simulating' })
  }, [])

  const handleResetRef = useRef(handleReset)
  handleResetRef.current = handleReset

  const cancelPatternImport = () => {
    if (patternImportSession?.phase !== 'ready') return
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      handleReset()
      return
    }
    setPatternImportDockExiting(true)
  }

  useEffect(() => {
    if (!patternImportDockExiting) return
    const t = window.setTimeout(() => {
      handleResetRef.current()
    }, 440)
    return () => window.clearTimeout(t)
  }, [patternImportDockExiting])

  /**
   * 棋形导入后切换难度：按新倍率从导入局面「该局面重下」（清空导入后的额外手数）。
   */
  const applyImportDifficultyRestart = (newDiff: Difficulty) => {
    const sess = patternImportSessionRef.current
    if (!sess || !importSnapshotRef.current) {
      handleReset()
      return
    }
    const pid = sess.patternId
    const item = PATTERN_CATALOG.find((x) => x.id === pid)
    if (!item) {
      handleReset()
      return
    }
    const slots = catalogAllSlots(pid, item.template)
    if (slots.length === 0 || !catalogImportStatus(slots).canImport) {
      handleReset()
      return
    }

    clearImportFlashTimers()
    if (importSimTimerRef.current !== null) {
      window.clearInterval(importSimTimerRef.current)
      importSimTimerRef.current = null
    }
    importSimActiveRef.current = false
    setResultFlash(null)
    setImportOpponentIntro(false)
    pendingYourTurnFlashAfterAiRef.current = false

    const st = buildPlayStateFromCatalogSlots(slots, newDiff)
    importSnapshotRef.current = {
      board: st.board.slice(),
      moves: st.moves.map((m) => ({ ...m })),
      nextPlayer: st.nextPlayer,
    }
    setDifficulty(newDiff)
    setBoard(st.board)
    setMoveHistory(st.moves)
    setWinner(0)
    setWinLine([])
    const np = st.nextPlayer
    setCurrentPlayer(np)
    const last = slots[slots.length - 1]
    setFocus({ x: last.x, y: last.y })
    setHintTarget(null)
    setPatternImportSession({ patternId: pid, phase: 'ready' })
    setUndosRemaining(3)
    setSessionId(String(Date.now()))
    savedForSessionRef.current = null
    aiWorkerRequestIdRef.current += 1
    setBoardKick((k) => (k === 0 ? 1 : 0))

    if (np === 2) {
      pendingYourTurnFlashAfterAiRef.current = true
      flashImportOpponentFirst()
    } else {
      pendingYourTurnFlashAfterAiRef.current = false
      flashImportYourTurn()
    }
  }

  const confirmPendingImportDifficulty = () => {
    if (pendingImportDifficulty === null) return
    const d = pendingImportDifficulty
    setPendingImportDifficulty(null)
    applyImportDifficultyRestart(d)
  }

  useEffect(() => {
    if (pendingImportDifficulty === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingImportDifficulty(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingImportDifficulty])

  /** 顶栏难度：普通对局整盘重置；棋形导入时改难度须确认并从导入局面重下 */
  const applyDifficultyChange = (newDiff: Difficulty) => {
    if (newDiff === difficulty) return

    if (patternImportSession !== null && importSnapshotRef.current) {
      setPendingImportDifficulty(newDiff)
      return
    }

    setDifficulty(newDiff)
    handleReset()
  }

  /** 悔棋：轮到你且未终局时撤销「上一手黑 + 上一手白」共两步；轮到 AI 或终局时只撤销一步。每局共 3 次。 */
  const handleUndo = () => {
    if (viewMode !== 'play') return
    if (patternImportSession?.phase === 'simulating') return
    if (undosRemaining <= 0) return
    if (undoStoneExit) return

    const h = moveHistory
    const minLen =
      patternImportSession?.phase === 'ready' && importSnapshotRef.current
        ? importSnapshotRef.current.moves.length
        : 0
    if (h.length <= minLen) return

    const needTwo = winner === 0 && currentPlayer === 1
    const pops = needTwo ? 2 : 1
    if (h.length - pops < minLen) return

    const next = h.slice(0, h.length - pops).map((m, i) => ({ ...m, index: i + 1 }))
    const newBoard = boardFromMoves(next, next.length)
    const removed = h.slice(h.length - pops)

    const commitUndo = () => {
      if (undoAnimTimerRef.current !== null) {
        window.clearTimeout(undoAnimTimerRef.current)
        undoAnimTimerRef.current = null
      }
      setUndoStoneExit(null)

      aiWorkerRequestIdRef.current += 1

      clearImportFlashTimers()
      setResultFlash(null)
      setImportOpponentIntro(false)
      pendingYourTurnFlashAfterAiRef.current = false

      setUndosRemaining((u) => u - 1)
      setBoard(newBoard)
      setMoveHistory(next)
      setHintTarget(null)
      setBoardKick((k) => (k === 0 ? 1 : 0))

      if (next.length === 0) {
        setWinner(0)
        setWinLine([])
        setCurrentPlayer(1)
        setFocus(null)
        return
      }

      const last = next[next.length - 1]
      const w = checkWin(newBoard, last.x, last.y, last.player)
      if (w) {
        setWinner(last.player)
        setWinLine(w.line)
      } else {
        setWinner(0)
        setWinLine([])
      }
      const np: Player = next.length % 2 === 0 ? 1 : 2
      setCurrentPlayer(np)
      setFocus({ x: last.x, y: last.y })
    }

    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      commitUndo()
      return
    }

    if (undoAnimTimerRef.current !== null) {
      window.clearTimeout(undoAnimTimerRef.current)
      undoAnimTimerRef.current = null
    }
    setUndoStoneExit({
      key: Date.now(),
      cells: removed.map((m) => ({ x: m.x, y: m.y, player: m.player })),
    })
    undoAnimTimerRef.current = window.setTimeout(commitUndo, 400)
  }

  const handleCellClick = (x: number, y: number) => {
    if (viewMode === 'history') {
      clearHistorySelection()
      return
    }
    if (viewMode !== 'play') return
    if (patternImportSession?.phase === 'simulating') return
    if (gameOver || currentPlayer !== 1) return
    const idx = indexOf(x, y)
    if (board[idx] !== 0) return

    hintDeferAfterAiUntilRef.current = 0

    /* 「轮到你」大字：落子后渐隐（与 .result-flash.hide 过渡一致），并取消原自动关闭定时器 */
    if (resultFlash?.text === '轮到你' && resultFlash.show) {
      importPatternFlashTimersRef.current.forEach((tid) => window.clearTimeout(tid))
      importPatternFlashTimersRef.current = []
      setResultFlash({ text: '轮到你', show: false })
      const unmountT = window.setTimeout(() => {
        setResultFlash((c) => (c?.text === '轮到你' ? null : c))
      }, 540)
      importPatternFlashTimersRef.current.push(unmountT)
    }

    const nextBoard = board.slice()
    nextBoard[idx] = 1
    const evalMove = evaluateBoardAt(board, x, y, 1)
    const win = checkWin(nextBoard, x, y, 1)
    const mult = DIFFICULTY_SCORE_MULTIPLIER[difficulty]
    const uiScoreDelta = Math.round((evalMove.score / 100) * mult)

    const move: MoveRecord = {
      index: moveHistory.length + 1,
      x,
      y,
      player: 1,
      scoreDelta: uiScoreDelta,
      pattern: evalMove.pattern || '平稳一手',
    }

    setBoard(nextBoard)
    setMoveHistory((prev) => [...prev, move])
    setHintTarget(null)
    setBoardKick((k) => (k === 0 ? 1 : 0))
    setFocus({ x, y })

    if (win) {
      setWinner(1)
      setWinLine(win.line)
      return
    }
    setCurrentPlayer(2)
  }

  // Easy 模式提示：选点较重，放到 idle；AI 刚落子后须再延后，避免与白子落子 CSS 动画抢帧
  useEffect(() => {
    if (
      viewMode !== 'play' ||
      difficulty !== 'easy' ||
      gameOver ||
      currentPlayer !== 1 ||
      patternImportSession?.phase === 'simulating'
    ) {
      setHintTarget(null)
      return
    }
    let cancelled = false
    let deferTimer: ReturnType<typeof setTimeout> | null = null
    let runTimer: ReturnType<typeof setTimeout> | null = null
    const run = () => {
      if (cancelled) return
      const pt = pickBestHumanHintMove(board, difficulty)
      setHintTarget(pt)
    }
    const wait = Math.max(0, hintDeferAfterAiUntilRef.current - performance.now())
    deferTimer = window.setTimeout(() => {
      deferTimer = null
      if (cancelled) return
      runTimer = window.setTimeout(() => {
        runTimer = null
        run()
      }, 0)
    }, wait)
    return () => {
      cancelled = true
      if (deferTimer !== null) clearTimeout(deferTimer)
      if (runTimer !== null) clearTimeout(runTimer)
    }
  }, [board, currentPlayer, difficulty, gameOver, patternImportSession?.phase])

  // AI 落子：三档均在 Worker 中跑 chooseAIMove（简单档此前在主线程易卡顿）；Worker 不可用时回退主线程
  useEffect(() => {
    if (viewMode !== 'play' || gameOver || currentPlayer !== 2) return
    if (patternImportSession?.phase === 'simulating') return
    if (importOpponentIntro) return

    let cancelled = false
    let raf2 = 0
    const boardSnap = board
    const diff = difficulty

    const applyAiMove = (aiMove: ScoredMove) => {
      const idx = indexOf(aiMove.x, aiMove.y)
      const nextBoard = boardSnap.slice()
      nextBoard[idx] = 2
      const win = checkWin(nextBoard, aiMove.x, aiMove.y, 2)
      /** 侧栏分/棋形与黑方一致：用落子前局面 + evaluateBoardAtForUi（仅己方棋形），勿用 AI 搜索叶值（如 1e12）或「阻断」误标 */
      const evalForUi = evaluateBoardAtForUi(boardSnap, aiMove.x, aiMove.y, 2)
      const mult = DIFFICULTY_SCORE_MULTIPLIER[diff]
      const uiScoreDelta = Math.round((evalForUi.score / 100) * mult)
      const patternLabel = win ? '立即成五' : evalForUi.pattern || '稳健应对'

      setBoard(nextBoard)
      /** 须与 setBoard 同批提交：若延后 setMoveHistory，首帧 isLast 仍指黑子最后一手，白子暂无 .stone-last，下一帧再挂上会导致 drop 动画从 0% 重播，观感像倒放/闪一下 */
      setMoveHistory((prev) => {
        const move: MoveRecord = {
          index: prev.length + 1,
          x: aiMove.x,
          y: aiMove.y,
          player: 2,
          scoreDelta: uiScoreDelta,
          pattern: patternLabel,
        }
        return [...prev, move]
      })
      /** 勿在此处 setBoardKick：整盘 .board-kick-shell 的 transform/filter 过渡与白子 dropInAiLast 同层叠放易抽搐（人手黑子仍保留 kick） */
      setFocus({ x: aiMove.x, y: aiMove.y })
      if (win) {
        setWinner(2)
        setWinLine(win.line)
      } else {
        setCurrentPlayer(1)
      }
      hintDeferAfterAiUntilRef.current = performance.now() + 440
      if (!win) {
        if (pendingYourTurnFlashAfterAiRef.current) {
          pendingYourTurnFlashAfterAiRef.current = false
          queueMicrotask(() => flashImportYourTurn())
        }
      }
    }

    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return

        /** 简单 / 普通 / 困难 均走 Worker（与主线程解耦）；Worker 不可用时再回退主线程 */
        setAiWorkerBusy(true)
        const worker = aiWorkerRef.current
        const requestId = ++aiWorkerRequestIdRef.current

        const onWorkerMessage = (ev: MessageEvent<{ requestId: number; move: ScoredMove | null }>) => {
          if (cancelled || ev.data.requestId !== aiWorkerRequestIdRef.current) return
          setAiWorkerBusy(false)
          const aiMove = ev.data.move
          if (!aiMove) return
          applyAiMove(aiMove)
        }

        if (worker) {
          worker.addEventListener('message', onWorkerMessage, { once: true })
          worker.postMessage({
            requestId,
            board: boardSnap,
            difficulty: diff,
          })
        } else {
          setAiWorkerBusy(false)
          const aiMove = chooseAIMove(boardSnap, diff)
          if (!aiMove) return
          applyAiMove(aiMove)
        }
      })
    })
    return () => {
      cancelled = true
      setAiWorkerBusy(false)
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
    }
  }, [
    board,
    currentPlayer,
    difficulty,
    gameOver,
    patternImportSession?.phase,
    importOpponentIntro,
    flashImportYourTurn,
    viewMode,
  ])

  // Winner flash: big white text fade in/out
  useEffect(() => {
    if (viewMode !== 'play') return
    if (winner === 0) return
    const text = winner === 1 ? '您赢了' : '您输了'
    setResultFlash({ text, show: true })
    const t1 = window.setTimeout(() => setResultFlash({ text, show: false }), 1400)
    const t2 = window.setTimeout(() => setResultFlash(null), 2100)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [winner])

  // 棋形导入：双方随机落子直至盘面出现与导入棋型平移一致的阵势（或步数上限）
  useEffect(() => {
    importSimActiveRef.current = false
    if (viewMode !== 'play') {
      if (importSimTimerRef.current !== null) {
        window.clearInterval(importSimTimerRef.current)
        importSimTimerRef.current = null
      }
      importPatternFlashTimersRef.current.forEach((t) => window.clearTimeout(t))
      importPatternFlashTimersRef.current = []
      return
    }
    if (!patternImportSession || patternImportSession.phase !== 'simulating') {
      if (importSimTimerRef.current !== null) {
        window.clearInterval(importSimTimerRef.current)
        importSimTimerRef.current = null
      }
      return
    }

    const snap = importSnapshotRef.current
    const item = PATTERN_CATALOG.find((x) => x.id === patternImportSession.patternId)
    if (!snap || !item) {
      setPatternImportSession(null)
      importSnapshotRef.current = null
      return
    }

    const slots = catalogAllSlots(patternImportSession.patternId, item.template)
    const offsets = patternOffsetsFromSlots(slots)
    importSimStateRef.current = {
      board: snap.board.slice(),
      moves: snap.moves.map((m) => ({ ...m })),
      player: snap.nextPlayer,
      patternOffsets: offsets,
      baseBoard: snap.board.slice(),
      baseMoves: snap.moves.map((m) => ({ ...m })),
      baseNext: snap.nextPlayer,
      stepCount: 0,
    }

    const MAX_STEPS = 900
    const pid = patternImportSession.patternId
    importSimActiveRef.current = true

    const finishToReady = (st: ImportSimState) => {
      if (!importSimActiveRef.current) return
      importSimActiveRef.current = false
      importSimStateRef.current = null
      if (importSimTimerRef.current !== null) {
        window.clearInterval(importSimTimerRef.current)
        importSimTimerRef.current = null
      }
      const nextP = nextPlayerFromMoves(st.moves)
      setBoard(st.board.slice())
      setMoveHistory(st.moves.map((m) => ({ ...m })))
      setWinner(0)
      setWinLine([])
      setCurrentPlayer(nextP)
      importSnapshotRef.current = {
        board: st.board.slice(),
        moves: st.moves.map((m) => ({ ...m })),
        nextPlayer: nextP,
      }
      const last = st.moves[st.moves.length - 1]
      if (last) setFocus({ x: last.x, y: last.y })
      setPatternImportSession({ patternId: pid, phase: 'ready' })
      setUndosRemaining(3)
      /* 大字与 intro 定时器须排到本 effect cleanup 之后：否则 phase 从 simulating→ready 时 cleanup 会
       * 曾共用 importSimFlashTimersRef 时 cleanup 会清掉「对方在下」定时器 → AI 永不落子；大字现用 importPatternFlashTimersRef */
      window.setTimeout(() => {
        if (nextP === 1) {
          pendingYourTurnFlashAfterAiRef.current = false
          setImportOpponentIntro(false)
          flashImportYourTurn()
        } else {
          pendingYourTurnFlashAfterAiRef.current = true
          flashImportOpponentFirst()
        }
      }, 0)
    }

    const tick = () => {
      if (!importSimActiveRef.current) return
      const st = importSimStateRef.current
      if (!st) return

      if (boardContainsImportedPattern(st.board, st.patternOffsets)) {
        finishToReady(st)
        return
      }

      if (st.stepCount >= MAX_STEPS) {
        finishToReady({
          ...st,
          board: st.baseBoard.slice(),
          moves: st.baseMoves.map((m) => ({ ...m })),
          player: st.baseNext,
        })
        return
      }

      const empties = collectEmptyCells(st.board)
      if (empties.length === 0) {
        finishToReady({
          ...st,
          board: st.baseBoard.slice(),
          moves: st.baseMoves.map((m) => ({ ...m })),
          player: st.baseNext,
        })
        return
      }

      const pick = empties[Math.floor(Math.random() * empties.length)]!
      const p = st.player
      const nb = st.board.slice()
      nb[indexOf(pick.x, pick.y)] = p
      const evalMove = evaluateBoardAt(st.board, pick.x, pick.y, p)
      const mult = DIFFICULTY_SCORE_MULTIPLIER[difficultyRef.current]
      const uiScoreDelta = Math.round((evalMove.score / 100) * mult)
      const mv: MoveRecord = {
        index: st.moves.length + 1,
        x: pick.x,
        y: pick.y,
        player: p,
        scoreDelta: uiScoreDelta,
        pattern: evalMove.pattern || '模拟',
      }
      const win = checkWin(nb, pick.x, pick.y, p)
      if (win) {
        st.board = st.baseBoard.slice()
        st.moves = st.baseMoves.map((m) => ({ ...m }))
        st.player = st.baseNext
      } else {
        st.board = nb
        st.moves = [...st.moves, mv]
        st.player = p === 1 ? 2 : 1
      }
      st.stepCount += 1

      setBoard(st.board.slice())
      setMoveHistory(st.moves.map((m) => ({ ...m })))
      setCurrentPlayer(st.player)
      const lm = st.moves[st.moves.length - 1]
      if (lm) setFocus({ x: lm.x, y: lm.y })

      if (boardContainsImportedPattern(st.board, st.patternOffsets)) {
        finishToReady(st)
      }
    }

    importSimTimerRef.current = window.setInterval(tick, 48)
    tick()

    return () => {
      importSimActiveRef.current = false
      if (importSimTimerRef.current !== null) {
        window.clearInterval(importSimTimerRef.current)
        importSimTimerRef.current = null
      }
      /* 勿清 importPatternFlashTimersRef：finishToReady 里 setTimeout(0) 注册的大字渐隐与 intro 结束依赖它 */
    }
  }, [viewMode, patternImportSession, flashImportYourTurn, flashImportOpponentFirst])

  // 结束后：将本局写入历史（用于历史查看回放）
  useEffect(() => {
    if (viewMode !== 'play') return
    if (winner === 0) return
    if (patternImportSessionRef.current?.phase === 'simulating') return
    if (savedForSessionRef.current === sessionId) return
    if (!moveHistory.length) return

    const game: HistoryGame = {
      id: sessionId,
      createdAt: Date.now(),
      difficulty,
      moves: moveHistory,
      winner,
      winLine,
      totalScore,
    }

    setHistoryGames((prev) => {
      const next = [game, ...prev.filter((g) => g.id !== sessionId)].slice(0, 30)
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      } catch {
        // localStorage 失败不影响游戏本身
      }
      return next
    })
    savedForSessionRef.current = sessionId
  }, [winner, viewMode, sessionId, difficulty, moveHistory, winLine])

  const currentStatus = useMemo(() => {
    if (winner === 1) return '你赢了（黑方）'
    if (winner === 2) return 'AI 赢了（白方）'
    if (patternImportSession?.phase === 'simulating') return '随机对弈演示中…'
    if (importOpponentIntro) return '续弈：对方即将落子…'
    return currentPlayer === 1 ? '轮到你（黑子）' : 'AI 思考中…'
  }, [winner, currentPlayer, patternImportSession?.phase, importOpponentIntro])

  /** 人机对弈且轮到白方、等待落子时，底栏用高亮样式提示「AI 思考中」 */
  const playStatusAiThinking = useMemo(
    () =>
      viewMode === 'play' &&
      winner === 0 &&
      currentPlayer === 2 &&
      !importOpponentIntro &&
      patternImportSession?.phase !== 'simulating',
    [viewMode, winner, currentPlayer, importOpponentIntro, patternImportSession?.phase],
  )

  const viewModeSlideSlot = viewMode === 'play' ? '0' : viewMode === 'history' ? '1' : '2'

  /** 三列工作台各自棋盘/连线（与底栏滑轨同步横向滑动） */
  const getColumnDerived = (mode: ViewMode) => {
    if (mode === 'play') {
      /** 离开人机对弈时仅清空棋盘展示，不改动 board / moveHistory；回到对弈后仍显示原局面 */
      const playBoardCleared = viewMode !== 'play'
      const colBoard = playBoardCleared ? createEmptyBoard() : board
      const colDisplayWinLine: [number, number][] =
        playBoardCleared || winner === 0
          ? []
          : (() => {
              const last =
                moveHistory.length > 0 ? moveHistory[moveHistory.length - 1]! : null
              return resolveDisplayWinLine(board, winner, last, winLine)
            })()
      return {
        colBoard,
        colWinner: playBoardCleared ? 0 : winner,
        colDisplayWinLine,
        colActiveMoves: playBoardCleared ? [] : moveHistory,
        colFocusEffective: playBoardCleared ? null : focus,
        colActiveGameOver: playBoardCleared ? false : winner !== 0,
        histMoves: undefined as MoveRecord[] | undefined,
        histStep: undefined as number | undefined,
        histDuelScores: undefined as { you: number; ai: number } | undefined,
        histGame: undefined as HistoryGame | null | undefined,
        histDuelKind: undefined as 'aggregate' | 'single' | undefined,
      }
    }
    if (mode === 'history') {
      const fallbackGame =
        historyGames.length > 0 ? historyGames[historyGames.length - 1] : null
      const gVisible: HistoryGame | null =
        historyGames.length === 0
          ? null
          : viewMode === 'history'
            ? activeHistory
            : fallbackGame
      const moves = gVisible?.moves ?? []
      const step =
        viewMode === 'history' && selectedHistoryIndex >= 0 ? replayStep : moves.length
      const colBoard =
        viewMode === 'history' && selectedHistoryIndex < 0
          ? historyExitAnim
            ? historyExitAnim.cells
            : createEmptyBoard()
          : viewMode === 'history' && selectedHistoryIndex >= 0
            ? (historyTargetBoard ?? boardFromMoves(moves, step))
            : boardFromMoves(moves, step)
      const rw = gVisible?.winner ?? 0
      let colDisplayWinLine: [number, number][] = []
      if (rw !== 0 && step >= moves.length && gVisible) {
        const fb = boardFromMoves(moves, moves.length)
        const last = moves.length > 0 ? moves[moves.length - 1]! : null
        colDisplayWinLine = resolveDisplayWinLine(fb, rw, last, gVisible.winLine)
      }
      if (step < moves.length) colDisplayWinLine = []
      const colActiveMoves = moves.slice(0, step)
      const colFocusEffective =
        colActiveMoves.length > 0
          ? {
              x: colActiveMoves[colActiveMoves.length - 1].x,
              y: colActiveMoves[colActiveMoves.length - 1].y,
            }
          : null
      const histDuelKind: 'aggregate' | 'single' =
        viewMode === 'history' && selectedHistoryIndex < 0 ? 'aggregate' : 'single'
      const histDuelScores =
        viewMode === 'history' && selectedHistoryIndex < 0
          ? aggregateHistoryScores(historyGames)
          : gVisible
            ? scoresFromMoves(moves.slice(0, Math.min(step, moves.length)))
            : { you: 0, ai: 0 }
      return {
        colBoard,
        colWinner: rw,
        colDisplayWinLine,
        colActiveMoves,
        colFocusEffective,
        colActiveGameOver: rw !== 0,
        histMoves: moves,
        histStep: step,
        histDuelScores,
        histGame: viewMode === 'history' && selectedHistoryIndex < 0 ? null : gVisible,
        histDuelKind,
      }
    }
    return {
      colBoard: viewMode === 'play' ? board : createEmptyBoard(),
      colWinner: 0 as Player | 0,
      colDisplayWinLine: [] as [number, number][],
      colActiveMoves: viewMode === 'play' ? moveHistory : [],
      colFocusEffective:
        viewMode === 'catalog' && catalogVisibleSlots.length > 0
          ? catalogVisibleSlots[catalogVisibleSlots.length - 1]
          : null,
      colActiveGameOver: false,
      histMoves: undefined as MoveRecord[] | undefined,
      histStep: undefined as number | undefined,
      histDuelScores: undefined as { you: number; ai: number } | undefined,
      histGame: undefined as HistoryGame | null | undefined,
      histDuelKind: undefined as 'aggregate' | 'single' | undefined,
    }
  }

  return (
    <div className={`app-root ${mounted ? 'app-mounted' : ''}`}>
      <div className="bg-orbit" />

      <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <div className="brand-orb" aria-hidden="true">
            <span className="brand-mark" />
          </div>
          <div className="brand-text">
            <div className="brand-title">五子棋</div>
          </div>
        </div>
        <div className="top-controls">
          <div className="pill-toggle">
            <button
              className={`pill ${viewMode === 'play' ? 'active' : ''}`}
              onClick={() => setViewMode('play')}
            >
              人机对弈
            </button>
            <button
              className={`pill ${viewMode === 'history' ? 'active' : ''}`}
              onClick={() => setViewMode('history')}
            >
              历史查看
            </button>
            <button
              className={`pill ${viewMode === 'catalog' ? 'active' : ''}`}
              onClick={() => setViewMode('catalog')}
            >
              招式大全
            </button>
          </div>
          <div className="difficulty">
            <span className="difficulty-label">难度</span>
            <div
              className="difficulty-glass"
              data-difficulty={difficulty}
              role="group"
              aria-label="对局难度"
            >
              <div className="difficulty-glass-sheen" aria-hidden="true" />
              <div className="difficulty-glass-thumb" aria-hidden="true" />
              <div className="difficulty-glass-row">
                <button
                  type="button"
                  className={`difficulty-opt ${difficulty === 'easy' ? 'difficulty-opt--active' : ''}`}
                  onClick={() => applyDifficultyChange('easy')}
                  aria-pressed={difficulty === 'easy'}
                  title={DIFFICULTY_BUTTON_TITLE.easy}
                >
                  简单
                </button>
                <button
                  type="button"
                  className={`difficulty-opt ${difficulty === 'normal' ? 'difficulty-opt--active' : ''}`}
                  onClick={() => applyDifficultyChange('normal')}
                  aria-pressed={difficulty === 'normal'}
                  title={DIFFICULTY_BUTTON_TITLE.normal}
                >
                  普通
                </button>
                <button
                  type="button"
                  className={`difficulty-opt ${difficulty === 'hard' ? 'difficulty-opt--active' : ''}`}
                  onClick={() => applyDifficultyChange('hard')}
                  aria-pressed={difficulty === 'hard'}
                  title={DIFFICULTY_BUTTON_TITLE.hard}
                >
                  困难
                </button>
              </div>
            </div>
          </div>
          <button
            type="button"
            className={`about-info-btn ${aboutBtnPulse ? 'about-info-btn--pulse' : ''}`}
            onClick={() => {
              setAboutBtnPulse(true)
              if (aboutCloseTimerRef.current) {
                clearTimeout(aboutCloseTimerRef.current)
                aboutCloseTimerRef.current = null
              }
              setAboutLeaving(false)
              setAboutVisible(true)
              window.setTimeout(() => setAboutBtnPulse(false), 520)
            }}
            aria-label="关于本作"
            title="关于本作"
          >
            <span className="about-info-icon" aria-hidden="true">
              i
            </span>
          </button>
        </div>
      </header>

      <main
        className={`main-layout ${
          viewMode === 'history'
            ? 'view-history'
            : viewMode === 'catalog'
              ? 'view-catalog'
              : 'view-play'
        } ${viewSwitchAnim ? 'main-layout--view-switch' : ''}`}
      >
        {/* 横向滑轨：裁切只放在 view-mode-track-clip 上，勿给本壳固定 height+overflow，否则会切掉棋盘/侧栏底部圆角 */}
        <div className="view-mode-main-shell view-mode-footer-shell">
          <div className="view-mode-track-clip">
          <div className="view-mode-footer-track" data-slot={viewModeSlideSlot}>
            {(['play', 'history', 'catalog'] as const).map((colMode) => {
              const d = getColumnDerived(colMode)
              return (
                <div
                  key={colMode}
                  className={`view-mode-footer-panel${
                    viewMode === colMode ? ' view-mode-footer-panel--active' : ''
                  }`}
                  aria-hidden={viewMode !== colMode}
                >
                  <div
                    className="main-top-row"
                    ref={(el) => {
                      if (colMode === viewMode) mainTopRowRef.current = el
                    }}
                  >
                    <section
                      ref={(el) => {
                        if (colMode === viewMode) boardZoneRef.current = el
                      }}
                      className={`board-zone ${
                        colMode === 'catalog' && catalogDetailId ? 'board-zone--catalog-demo' : ''
                      } ${colMode === 'catalog' ? 'board-zone--catalog-row' : ''} ${
                        colMode === 'play' || colMode === 'history' ? 'board-zone--board-only-row' : ''
                      } ${
                        colMode === 'history' &&
                        viewMode === 'history' &&
                        historyCrossfade !== null &&
                        !replayPlaying
                          ? 'board-zone--history-crossfade'
                          : ''
                      }`}
                    >
                      <div
                        className="board-wrap"
                        ref={(el) => {
                          if (colMode === viewMode) boardWrapRef.current = el
                        }}
                      >
            <div className="board-container">
              <div className="board-shadow" />
              <div
                className="board"
                ref={(el) => {
                  if (colMode === viewMode) boardMeasureRef.current = el
                }}
                style={{
                  ['--boardPx' as never]: `${boardPx}px`,
                  ['--focusX' as never]: d.colFocusEffective
                    ? `${(d.colFocusEffective.x / (BOARD_SIZE - 1)) * 100}%`
                    : '50%',
                  ['--focusY' as never]: d.colFocusEffective
                    ? `${(d.colFocusEffective.y / (BOARD_SIZE - 1)) * 100}%`
                    : '50%',
                }}
              >
                <div className={`board-kick-shell board-kick-${boardKick}`}>
                <div className="board-sheen" aria-hidden="true" />
                <div className="board-grid" aria-hidden="true" />
                <div className="board-focus" aria-hidden="true" />
                <div className="board-vignette" aria-hidden="true" />

                {Array.from({ length: BOARD_SIZE }).map((_, y) =>
                  Array.from({ length: BOARD_SIZE }).map((__, x) => {
                    const idx = indexOf(x, y)
                    let cell = d.colBoard[idx]
                    if (
                      colMode === 'catalog' &&
                      catalogDetailId &&
                      catalogDemoTemplate
                    ) {
                      const ordered = catalogAllSlots(catalogDetailId, catalogDemoTemplate)
                      const n = ordered.length
                      const visibleCount =
                        catalogAnimFrame === 0 ? 0 : Math.min(catalogAnimFrame, n)
                      const k = ordered.findIndex((s) => s.x === x && s.y === y)
                      if (k >= 0) {
                        cell = k < visibleCount ? ordered[k].player : 0
                      }
                    }

                    const histCf =
                      colMode === 'history' &&
                      viewMode === 'history' &&
                      historyCrossfade !== null &&
                      !replayPlaying
                    const histFrom = histCf ? historyCrossfade.from[idx]! : null

                    const isCatalogStone =
                      colMode === 'catalog' &&
                      catalogDetailId &&
                      catalogVisibleSlots.some((s) => s.x === x && s.y === y)
                    const isOnWinLine =
                      colMode === 'catalog' && catalogDetailId
                        ? isCatalogStone
                        : d.colDisplayWinLine.some(([xx, yy]) => xx === x && yy === y)
                    const isHint =
                      colMode === 'play' &&
                      viewMode === 'play' &&
                      !gameOver &&
                      difficulty === 'easy' &&
                      currentPlayer === 1 &&
                      hintTarget?.x === x &&
                      hintTarget?.y === y
                    const isLast =
                      colMode === 'catalog' && catalogDetailId
                        ? catalogVisibleSlots.length > 0 &&
                          catalogVisibleSlots[catalogVisibleSlots.length - 1].x === x &&
                          catalogVisibleSlots[catalogVisibleSlots.length - 1].y === y
                        : d.colActiveMoves.length > 0 &&
                          d.colActiveMoves[d.colActiveMoves.length - 1].x === x &&
                          d.colActiveMoves[d.colActiveMoves.length - 1].y === y

                    const posKey = `${x},${y}`
                    const stoneAfterglowPlay =
                      colMode === 'play' &&
                      viewMode === 'play' &&
                      stoneAfterglowKeys.has(posKey) &&
                      !isLast

                    const undoVanishIdx =
                      colMode === 'play' && viewMode === 'play' && undoStoneExit
                        ? undoStoneExit.cells.findIndex((c) => c.x === x && c.y === y)
                        : -1
                    const undoVanish = undoVanishIdx >= 0
                    /** 历史非播放时不用 .stone-last：换卡/crossfade 再挂类会重复播 dropIn 而闪；自动播放 (replayPlaying) 时恢复落子动效 */
                    const historyStoneLastClass =
                      isLast &&
                      !undoVanish &&
                      !(
                        colMode === 'history' &&
                        viewMode === 'history' &&
                        !replayPlaying
                      )
                    const histDeselectExit =
                      colMode === 'history' &&
                      viewMode === 'history' &&
                      historyExitAnim !== null &&
                      cell !== 0

                    const inset = 18
                    const inner = Math.max(0, boardPx - inset * 2)
                    const cellPx = inner / (BOARD_SIZE - 1)
                    const left = inset + x * cellPx
                    const top = inset + y * cellPx

                    return (
                      <button
                        key={`${x}-${y}`}
                        className={`pt ${isOnWinLine ? 'pt-win' : ''} ${isHint ? 'pt-hint' : ''} ${
                          histCf && histFrom !== cell ? 'pt--history-cross' : ''
                        }`}
                        style={{ left, top }}
                        onClick={() => handleCellClick(x, y)}
                        disabled={colMode !== viewMode}
                        aria-label={`落子 (${x + 1}, ${y + 1})`}
                      >
                        <span className="pt-cross" aria-hidden="true" />
                        {histCf ? (
                          histFrom !== cell ? (
                            <span
                              className="history-stone-stack"
                              aria-hidden="true"
                              key={`hcf-${historyCrossfade!.id}-${x}-${y}`}
                            >
                              {histFrom !== 0 && (
                                <span
                                  key={`out-${historyCrossfade!.id}`}
                                  className={`stone stone-${
                                    histFrom === 1 ? 'black' : 'white'
                                  } history-stone-out`}
                                  aria-hidden="true"
                                />
                              )}
                              {cell !== 0 && (
                                <span
                                  key={`in-${historyCrossfade!.id}`}
                                  className={`stone stone-${
                                    cell === 1 ? 'black' : 'white'
                                  } history-stone-in`}
                                  aria-hidden="true"
                                />
                              )}
                            </span>
                          ) : cell !== 0 ? (
                            <span
                              className={`stone stone-${cell === 1 ? 'black' : 'white'} ${
                                historyStoneLastClass ? 'stone-last' : ''
                              } ${histDeselectExit ? 'history-deselect-stone-out' : ''}`}
                              aria-hidden="true"
                            />
                          ) : null
                        ) : cell !== 0 ? (
                          <span
                            className={`stone stone-${cell === 1 ? 'black' : 'white'} ${
                              historyStoneLastClass ? 'stone-last' : ''
                            } ${histDeselectExit ? 'history-deselect-stone-out' : ''} ${stoneAfterglowPlay ? 'stone-afterglow' : ''} ${
                              colMode === 'play' &&
                              viewMode === 'play' &&
                              isLast &&
                              cell === 2 &&
                              !undoVanish
                                ? 'stone-ai-drop'
                                : ''
                            } ${
                              colMode === 'history' &&
                              viewMode === 'history' &&
                              replayPlaying &&
                              isLast &&
                              cell === 2
                                ? 'stone-ai-drop'
                                : ''
                            } ${
                              colMode === 'catalog' &&
                              catalogDetailId &&
                              isLast
                                ? 'stone-catalog'
                                : ''
                            } ${undoVanish ? 'stone-undo-vanish' : ''}`}
                            style={
                              undoVanish
                                ? { animationDelay: `${undoVanishIdx * 68}ms` }
                                : undefined
                            }
                            aria-hidden="true"
                          />
                        ) : null}
                      </button>
                    )
                  }),
                )}

                {(() => {
                  if (d.colWinner === 0 || d.colDisplayWinLine.length < 2) return null
                  const inset = 18
                  const inner = Math.max(0, boardPx - inset * 2)
                  const cellPx = inner / (BOARD_SIZE - 1)
                  /* 未播至终局时 colDisplayWinLine 已为空；勿再用 replayStep 与 replayMoves 比较，避免与 step 不同步 */
                  const sx = inset + d.colDisplayWinLine[0][0] * cellPx
                  const sy = inset + d.colDisplayWinLine[0][1] * cellPx
                  const ex = inset + d.colDisplayWinLine[d.colDisplayWinLine.length - 1][0] * cellPx
                  const ey = inset + d.colDisplayWinLine[d.colDisplayWinLine.length - 1][1] * cellPx
                  const gradId = `win-grad-${colMode}`
                  /** 白方胜：连线叠在浅色白子上，仍用与 UI 一致的蓝紫靛色，略加深色相以保证可见 */
                  const gradOnLightId = `${gradId}-onlight`
                  const aiWin = d.colWinner === 2
                  const strokeMain = aiWin ? `url(#${gradOnLightId})` : `url(#${gradId})`
                  return (
                    <svg
                      className={`win-line-svg ${aiWin ? 'win-line-svg--white-win' : ''}`}
                      width={boardPx}
                      height={boardPx}
                      viewBox={`0 0 ${boardPx} ${boardPx}`}
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <defs>
                        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.95" />
                          <stop offset="55%" stopColor="#8b5cf6" stopOpacity="0.95" />
                          <stop offset="100%" stopColor="#e0e7ff" stopOpacity="0.95" />
                        </linearGradient>
                        {aiWin ? (
                          <linearGradient id={gradOnLightId} x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.98" />
                            <stop offset="52%" stopColor="#7c3aed" stopOpacity="0.98" />
                            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.98" />
                          </linearGradient>
                        ) : null}
                      </defs>
                      <line
                        x1={sx}
                        y1={sy}
                        x2={ex}
                        y2={ey}
                        stroke={strokeMain}
                        strokeWidth={7}
                        strokeLinecap="round"
                        opacity={aiWin ? 0.98 : 0.95}
                        className="win-line-main"
                      />
                      <line
                        x1={sx}
                        y1={sy}
                        x2={ex}
                        y2={ey}
                        stroke={strokeMain}
                        strokeWidth={aiWin ? 20 : 18}
                        strokeLinecap="round"
                        opacity={aiWin ? 0.22 : 0.16}
                        className="win-line-glow"
                      />
                    </svg>
                  )
                })()}
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside
          className="side-panel"
          style={
            boardWrapOuterHeight > 0
              ? {
                  height: boardWrapOuterHeight,
                  minHeight: boardWrapOuterHeight,
                  boxSizing: 'border-box',
                }
              : undefined
          }
        >
          <div className="side-panel-surface glass">
          {colMode === 'play' && (
            <div className="play-side">
              <header className="play-side-header">
                <div className="play-side-title">人机对弈</div>
                <div className="play-side-difficulty-row">
                  <span className="play-side-difficulty-label">难度</span>
                  <span
                    className={`play-side-difficulty-badge play-side-difficulty-badge--${difficulty}`}
                  >
                    {difficulty === 'easy'
                      ? '简单'
                      : difficulty === 'normal'
                        ? '普通'
                        : '困难'}
                  </span>
                  <span
                    className={`play-side-difficulty-badge play-side-difficulty-badge--${difficulty}`}
                    title="本局招式积分倍率（总评分 = 各手分数之和）"
                  >
                    {formatDifficultyScoreMultiplier(difficulty)}
                  </span>
                </div>
                <p className="play-side-desc">{DIFFICULTY_PLAY_SIDE_DESC[difficulty]}</p>
              </header>
              <div className="panel-section play-side-moves">
              <div className="panel-title panel-title--moves">招式板 / 本局走势</div>
              <div className="moves-list">
                {moveHistory.length === 0 ? (
                  <div className="empty">等待你的第一手棋…</div>
                ) : (
                  moveHistory
                    .slice()
                    .reverse()
                    .map((m) => (
                      <div
                        key={m.index}
                        className={`move-row ${m.index === moveHistory.length ? 'move-row-new' : ''}`}
                      >
                        <div className="move-meta">
                          <span
                            className={`badge badge-${m.player === 1 ? 'black' : 'white'}`}
                          >
                            {m.player === 1 ? '你' : 'AI'}
                          </span>
                          <span className="move-coord">
                            第 {m.index} 手 · ({m.x + 1}, {m.y + 1})
                          </span>
                        </div>
                        <div className="move-detail">
                          <span className="move-pattern">{m.pattern}</span>
                          {m.scoreDelta !== 0 && (
                            <span
                              className={`move-score ${
                                m.scoreDelta > 0 ? 'pos' : 'neg'
                              }`}
                            >
                              {m.scoreDelta > 0 ? '+' : ''}
                              {m.scoreDelta}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                )}
              </div>
              </div>
            </div>
          )}
          {colMode === 'history' && (
            <div
              className={`panel-section history-only ${
                historyDeleteMode ? 'history-only--delete-mode' : ''
              }`}
              onClick={(e) => {
                if (historyDeleteMode) return
                const el = e.target as HTMLElement
                if (
                  el.closest('button') ||
                  el.closest('input') ||
                  el.closest('label') ||
                  el.closest('select') ||
                  el.closest('.history-list-controls') ||
                  el.closest('.replay-controls') ||
                  el.closest('.replay-slider') ||
                  el.closest('.history-card') ||
                  el.closest('.history-duel-bar')
                ) {
                  return
                }
                clearHistorySelection()
              }}
            >
              <div className="history-header-row">
                  <div className="history-header-text">
                  <div className="panel-title">历史查看</div>
                  <div className="panel-sub">
                    未选卡片时对抗条为全部对局累计；点卡片看终局，拖条或播放看分数变化。可按日期筛选，列表支持分页。
                  </div>
                </div>
                {historyGames.length > 0 && (
                  <button
                    type="button"
                    className="history-delete-mode-btn"
                    onClick={() =>
                      historyDeleteMode
                        ? cancelHistoryDeleteMode()
                        : setHistoryDeleteMode(true)
                    }
                  >
                    {historyDeleteMode ? '取消删除' : '删除记录'}
                  </button>
                )}
              </div>

              <div
                className={`history-toolbar-slot ${
                  historyDeleteMode && historyGames.length > 0
                    ? 'history-toolbar-slot--open'
                    : ''
                }`}
              >
                <div className="history-toolbar-slot-inner">
                  <div className="history-toolbar">
                    <label className="history-toolbar-all">
                      <input
                        type="checkbox"
                        checked={allHistorySelected}
                        onChange={toggleSelectAllHistory}
                        aria-label="全选历史记录"
                      />
                      <span>全选</span>
                    </label>
                    <button
                      type="button"
                      className="pill history-delete-btn"
                      disabled={historySelectedIds.length === 0}
                      onClick={deleteSelectedHistoryGames}
                    >
                      删除所选
                    </button>
                  </div>
                </div>
              </div>

              {historyGames.length > 0 ? (
                <div
                  className="history-list-controls"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <div className="history-filter-row">
                    <label className="history-filter-label" htmlFor={historyDateFilterInputId}>
                      <span className="history-filter-text">按日期</span>
                      <input
                        id={historyDateFilterInputId}
                        type="date"
                        className="history-date-input"
                        value={historyDateFilter}
                        onChange={(e) => setHistoryDateFilter(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="pill history-filter-clear"
                      disabled={!historyDateFilter}
                      onClick={() => setHistoryDateFilter('')}
                    >
                      清除日期
                    </button>
                  </div>
                  <div className="history-pagination-row">
                    <label className="history-page-size-label">
                      <span>每页</span>
                      <select
                        className="history-page-size-select"
                        value={historyPageSize}
                        onChange={(e) => setHistoryPageSize(Number(e.target.value))}
                        aria-label="每页条数"
                      >
                        <option value={8}>8</option>
                        <option value={15}>15</option>
                        <option value={30}>30</option>
                      </select>
                    </label>
                    <div className="history-pagination-actions">
                      <button
                        type="button"
                        className="pill"
                        disabled={historyPageSafe <= 1}
                        onClick={() =>
                          setHistoryPage((p) => {
                            const cur = Math.min(Math.max(1, p), historyTotalPages)
                            return Math.max(1, cur - 1)
                          })
                        }
                        aria-label="上一页"
                      >
                        上一页
                      </button>
                      <span className="history-page-indicator" aria-live="polite">
                        第 {historyPageSafe} / {historyTotalPages} 页 · 共{' '}
                        {historyFilteredSorted.length} 条
                        {historyDateFilter ? `（已筛选 ${historyDateFilter}）` : ''}
                      </span>
                      <button
                        type="button"
                        className="pill"
                        disabled={historyPageSafe >= historyTotalPages}
                        onClick={() =>
                          setHistoryPage((p) => {
                            const cur = Math.min(Math.max(1, p), historyTotalPages)
                            return Math.min(historyTotalPages, cur + 1)
                          })
                        }
                        aria-label="下一页"
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="history-list">
                {historyGames.length === 0 ? (
                  <div className="empty">
                    暂无历史对局（完成一局后会自动保存）
                  </div>
                ) : historyFilteredSorted.length === 0 ? (
                  <div className="empty">
                    该日期暂无对局，请更换日期或清除筛选
                  </div>
                ) : (
                  historyPageSlice.map(({ g, originalIndex: realIdx }) => {
                    const selected =
                      selectedHistoryIndex >= 0 && realIdx === selectedHistoryIndex
                    const checked = historySelectedIds.includes(g.id)
                    const resultClass =
                      g.winner === 1
                        ? 'history-result--win'
                        : g.winner === 2
                          ? 'history-result--lose'
                          : 'history-result--draw'
                    const endScores = scoresFromMoves(g.moves)
                    return (
                      <div
                        key={g.id}
                        className={`history-card-row ${
                          selected ? 'history-card-row-selected' : ''
                        }`}
                      >
                        <div
                          className={`history-card-cb-shell ${
                            historyDeleteMode ? 'history-card-cb-shell--on' : ''
                          }`}
                          aria-hidden={!historyDeleteMode}
                        >
                          {historyDeleteMode ? (
                            <input
                              type="checkbox"
                              className="history-card-cb"
                              checked={checked}
                              onChange={() => toggleHistorySelect(g.id)}
                              aria-label={`选择记录 ${new Date(g.createdAt).toLocaleString()}`}
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className={`history-card ${
                            selected ? 'history-card-selected' : ''
                          }`}
                          onClick={() => {
                            if (selected) {
                              clearHistorySelection()
                              return
                            }
                            setSelectedHistoryIndex(realIdx)
                            setReplayStep(g.moves.length)
                            setReplayPlaying(false)
                          }}
                        >
                          <div className="history-card-top">
                            <span className="history-time">
                              {new Date(g.createdAt).toLocaleString()}
                            </span>
                            <span className={`history-result ${resultClass}`}>
                              {g.winner === 1
                                ? '您赢了'
                                : g.winner === 2
                                  ? '您输了'
                                  : '和局'}
                            </span>
                          </div>
                          <div className="history-card-sub">
                            难度：{g.difficulty} · 手数：{g.moves.length} · 你{' '}
                            {endScores.you} · AI {endScores.ai}
                          </div>
                        </button>
                      </div>
                    )
                  })
                )}
              </div>

              <div className="history-bottom-stack">
              <div className="replay-controls">
                <div className="replay-row">
                  <button
                    className="pill"
                    onClick={() => setReplayStep((s) => Math.max(0, s - 1))}
                    disabled={!activeHistory || replayStep <= 0}
                  >
                    ←
                  </button>
                  <button
                    className="pill active"
                    type="button"
                    onClick={() => {
                      if (!activeHistory || replayMoves.length === 0) return
                      if (replayStep >= replayMoves.length) {
                        setReplayStep(0)
                        setReplayPlaying(true)
                        return
                      }
                      setReplayPlaying((v) => !v)
                    }}
                    disabled={!activeHistory || replayMoves.length === 0}
                  >
                    {replayPlaying
                      ? '暂停'
                      : replayStep >= replayMoves.length && replayMoves.length > 0
                        ? '重播'
                        : '播放'}
                  </button>
                  <button
                    className="pill"
                    onClick={() =>
                      setReplayStep((s) =>
                        Math.min(replayMoves.length, s + 1),
                      )
                    }
                    disabled={
                      !activeHistory || replayStep >= replayMoves.length
                    }
                  >
                    →
                  </button>
                </div>

                <div className="replay-slider">
                  <input
                    type="range"
                    min={0}
                    max={replayMoves.length}
                    step={1}
                    value={replayStep}
                    onChange={(e) => setReplayStep(Number(e.target.value))}
                    disabled={!activeHistory}
                  />
                  <div className="replay-meta">
                    第 {replayStep} 手 / 共 {replayMoves.length} 手
                  </div>
                </div>
              </div>

              {colMode === 'history' && d.histDuelScores && (
                <div className="history-duel-bar">
                  <div className="history-duel-bar__head">
                    {d.histDuelKind === 'aggregate' ? (
                      <>
                        <span className="history-duel-bar__tag history-duel-bar__tag--agg">
                          全部对局
                        </span>
                        <span className="history-duel-bar__vs">·</span>
                        <span className="history-duel-bar__tag history-duel-bar__tag--agg">
                          累计评分
                        </span>
                      </>
                    ) : d.histGame ? (
                      <>
                        <span
                          className={`history-duel-bar__tag ${
                            d.histGame.winner === 1
                              ? 'history-duel-bar__tag--win'
                              : d.histGame.winner === 2
                                ? 'history-duel-bar__tag--dim'
                                : ''
                          }`}
                        >
                          你
                        </span>
                        <span className="history-duel-bar__vs">VS</span>
                        <span
                          className={`history-duel-bar__tag ${
                            d.histGame.winner === 2
                              ? 'history-duel-bar__tag--lose'
                              : d.histGame.winner === 1
                                ? 'history-duel-bar__tag--dim'
                                : ''
                          }`}
                        >
                          AI
                        </span>
                      </>
                    ) : null}
                  </div>
                  <div className="history-duel-bar__track" aria-hidden="true">
                    {(() => {
                      const ds = d.histDuelScores ?? { you: 0, ai: 0 }
                      const sum = ds.you + ds.ai
                      const pctYou = sum > 0 ? (ds.you / sum) * 100 : 50
                      return (
                        <>
                          <div
                            className="history-duel-bar__meter history-duel-bar__meter--you"
                            style={{ width: `${pctYou}%` }}
                          />
                          <div
                            className="history-duel-bar__meter history-duel-bar__meter--ai"
                            style={{ width: `${100 - pctYou}%` }}
                          />
                        </>
                      )
                    })()}
                  </div>
                  <div className="history-duel-bar__meta">
                    <div className="history-duel-bar__score-line">
                      <span className="history-duel-bar__score-group">
                        <span className="history-duel-bar__score-label">你</span>{' '}
                        <span className="history-duel-bar__score-num history-duel-bar__score-num--you">
                          {(d.histDuelScores ?? { you: 0, ai: 0 }).you}
                        </span>
                      </span>
                      <span className="history-duel-bar__score-vs-text">vs</span>
                      <span className="history-duel-bar__score-group">
                        <span className="history-duel-bar__score-label">AI</span>{' '}
                        <span className="history-duel-bar__score-num history-duel-bar__score-num--ai">
                          {(d.histDuelScores ?? { you: 0, ai: 0 }).ai}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              )}
              </div>
            </div>
          )}
          {colMode === 'catalog' && (
            <div className="panel-section catalog-only">
              {(() => {
                const catalogEffectiveId = catalogDetailId ?? catalogExitBuffer
                const catalogDetailPattern = catalogEffectiveId
                  ? PATTERN_CATALOG.find((x) => x.id === catalogEffectiveId)
                  : null
                const catalogIsExiting = catalogExitBuffer !== null && catalogDetailId === null
                const catalogFilterLabel = catalogDetailPattern
                  ? CATALOG_FILTER_OPTIONS.find(
                      (o) => o.key === PATTERN_CATALOG_TAGS[catalogDetailPattern.id],
                    )?.label ?? ''
                  : ''
                return (
                  <div
                    className={`catalog-panel ${catalogDetailId ? 'catalog-panel--selected' : ''} ${
                      catalogIsExiting ? 'catalog-panel--detail-exiting' : ''
                    } ${catalogContinueBoost ? 'catalog-panel--continue-boost' : ''}`}
                  >
                    <header className="catalog-header">
                      <div className="catalog-header-left">
                        <div className="panel-title">招式大全</div>
                        <div className="panel-sub catalog-header-sub">
                          共 {catalogListFiltered.length} 式 · 点选卡片看演示；非终局棋形可带入人机对弈续下
                        </div>
                      </div>
                      <div
                        className="catalog-header-filters"
                        role="toolbar"
                        aria-label="招式分类筛选"
                      >
                        <span className="catalog-sort-label">分类</span>
                        <div className="catalog-sort-chips">
                          {CATALOG_FILTER_OPTIONS.map(({ key, label }) => (
                            <button
                              key={key}
                              type="button"
                              className={`catalog-filter-chip ${
                                catalogFilter === key ? 'catalog-filter-chip--active' : ''
                              }`}
                              aria-pressed={catalogFilter === key}
                              onClick={() => setCatalogFilter(key)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div
                        className="catalog-header-sort"
                        role="toolbar"
                        aria-label="招式分数排序"
                      >
                        <span className="catalog-sort-label">排序</span>
                        <div className="catalog-sort-chips">
                          {CATALOG_SORT_OPTIONS.map(({ key, label }) => (
                            <button
                              key={key}
                              type="button"
                              className={`catalog-filter-chip catalog-sort-chip ${
                                catalogSort === key ? 'catalog-filter-chip--active' : ''
                              }`}
                              aria-pressed={catalogSort === key}
                              onClick={() => setCatalogSort(key)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </header>
                    <div className="catalog-body">
                      <div
                        className={`catalog-list catalog-list-scroll${
                          catalogRestoreTargetId !== null ? ' catalog-list-scroll--restore' : ''
                        }`}
                      >
                        {catalogListFiltered.length === 0 ? (
                          <div className="catalog-list-empty">
                            当前分类下暂无招式，请换一类或点「全部」。
                          </div>
                        ) : (
                          catalogListFiltered.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              data-can-continue={
                                catalogPatternCanContinue(p.id, p.template) ? 'true' : 'false'
                              }
                              className={`move-card ${
                                catalogDetailId === p.id ? 'move-card-selected' : ''
                              } ${
                                catalogDetailId === p.id && catalogContinueBoost
                                  ? 'move-card-continue-boost'
                                  : ''
                              } ${catalogIsExiting && catalogExitBuffer === p.id ? 'move-card-exit-out' : ''}${
                                catalogRestoreTargetId === p.id ? ' move-card-restore-in' : ''
                              }`}
                              onClick={() => {
                                clearCatalogCloseTimer()
                                if (
                                  catalogExitBuffer !== null &&
                                  catalogDetailId === null &&
                                  catalogExitBuffer === p.id
                                ) {
                                  setCatalogExitBuffer(null)
                                  setCatalogDetailId(p.id)
                                  return
                                }
                                if (catalogExitBuffer !== null) setCatalogExitBuffer(null)
                                if (catalogDetailId === p.id) {
                                  beginCatalogDetailClose()
                                } else {
                                  setCatalogDetailId(p.id)
                                }
                              }}
                              aria-label={`查看招式：${p.name}`}
                              aria-pressed={catalogDetailId === p.id}
                            >
                              <div className="move-card-name">{p.name}</div>
                              <div className="move-card-score">分数：+{p.scoreShow}</div>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                    <footer className="catalog-footer" aria-live="polite">
                      {catalogDetailPattern ? (
                        <div
                          className={`catalog-footer-summary catalog-detail-inner ${
                            catalogIsExiting ? 'catalog-footer-summary--exit' : ''
                          } ${
                            catalogContinueBoost && catalogBoardSummary?.canContinue
                              ? 'catalog-footer-summary--continue-boost'
                              : ''
                          }`}
                        >
                          <div className="catalog-footer-summary-top">
                            <div className="catalog-detail-head catalog-detail-head--footer">
                              <div className="catalog-detail-title">{catalogDetailPattern.name}</div>
                            </div>
                            <button
                              type="button"
                              className="pill catalog-detail-dismiss"
                              onClick={beginCatalogDetailClose}
                              disabled={catalogIsExiting}
                            >
                              收起说明
                            </button>
                          </div>
                          <div className="catalog-detail-meta">
                            {`${catalogDetailPattern.kind} · ${catalogFilterLabel} · 分数 +${catalogDetailPattern.scoreShow}`}
                          </div>
                          <div
                            className="catalog-detail-shape-preview catalog-detail-shape-preview--footer"
                            aria-hidden="true"
                          >
                            <PatternPreview
                              template={catalogDetailPattern.template}
                              patternId={catalogDetailPattern.id}
                            />
                          </div>
                          {FORMATION_NAME_CAPTION[catalogDetailPattern.id] && (
                            <p className="catalog-detail-name-why catalog-detail-name-why--footer">
                              <span className="catalog-detail-name-why__tag">命名由来</span>
                              {FORMATION_NAME_CAPTION[catalogDetailPattern.id]}
                            </p>
                          )}
                        </div>
                      ) : null}
                      <div
                        className={`catalog-detail-desc-bar ${
                          catalogIsExiting && catalogDetailPattern
                            ? 'catalog-detail-desc-bar--exit'
                            : ''
                        }`}
                      >
                        <div className="catalog-detail-section-label catalog-detail-section-label--desc">
                          招式说明
                        </div>
                        {catalogDetailPattern ? (
                          <p className="catalog-detail-desc catalog-detail-desc--in-bar">
                            {catalogDetailPattern.description}
                          </p>
                        ) : (
                          <p className="catalog-detail-desc-placeholder">
                            点选上方卡片查看招式；左侧棋盘同步演示。续弈须为黑先、黑白交替可达之局面且双方均有子、未成五连。
                          </p>
                        )}
                      </div>
                      {catalogDetailPattern &&
                      catalogBoardSummary?.canContinue &&
                      catalogDetailId &&
                      !catalogIsExiting ? (
                        <div
                          key={`continue-${catalogDetailId}`}
                          className={`catalog-continue-bar ${
                            catalogContinueBoost ? 'catalog-continue-bar--boost' : ''
                          }`}
                        >
                          {!catalogContinuePickOpen ? (
                            <button
                              type="button"
                              className="pill catalog-continue-btn"
                              onClick={() => setCatalogContinuePickOpen(true)}
                            >
                              以此局面续弈
                            </button>
                          ) : (
                            <div
                              className="catalog-continue-pick"
                              role="group"
                              aria-label="选择续弈难度后开局"
                            >
                              <span className="catalog-continue-pick-label">续弈难度</span>
                              <div className="catalog-continue-diff-row">
                                <button
                                  type="button"
                                  className={`catalog-continue-diff-opt${
                                    difficulty === 'easy' ? ' catalog-continue-diff-opt--preset' : ''
                                  }`}
                                  onClick={() => runContinuePlayFromCatalog('easy')}
                                  title={DIFFICULTY_BUTTON_TITLE.easy}
                                >
                                  简单
                                </button>
                                <button
                                  type="button"
                                  className={`catalog-continue-diff-opt${
                                    difficulty === 'normal' ? ' catalog-continue-diff-opt--preset' : ''
                                  }`}
                                  onClick={() => runContinuePlayFromCatalog('normal')}
                                  title={DIFFICULTY_BUTTON_TITLE.normal}
                                >
                                  普通
                                </button>
                                <button
                                  type="button"
                                  className={`catalog-continue-diff-opt${
                                    difficulty === 'hard' ? ' catalog-continue-diff-opt--preset' : ''
                                  }`}
                                  onClick={() => runContinuePlayFromCatalog('hard')}
                                  title={DIFFICULTY_BUTTON_TITLE.hard}
                                >
                                  困难
                                </button>
                              </div>
                              <button
                                type="button"
                                className="pill catalog-continue-cancel"
                                onClick={() => setCatalogContinuePickOpen(false)}
                              >
                                取消
                              </button>
                            </div>
                          )}
                          <span className="catalog-continue-hint" aria-live="polite">
                            {catalogContinuePickOpen
                              ? '点选难度后即进入人机对弈；与顶栏难度一致。'
                              : `${catalogBoardSummary.nextHint} · 共 ${catalogBoardSummary.total} 子（黑 ${catalogBoardSummary.black} · 白 ${catalogBoardSummary.white}）`}
                          </span>
                        </div>
                      ) : null}
                    </footer>
                  </div>
                )
              })()}
            </div>
          )}
          </div>
        </aside>
                  </div>
                </div>
              )
            })}
          </div>
          </div>
        </div>

        <div className="view-mode-footer-shell">
          <div className="view-mode-footer-track" data-slot={viewModeSlideSlot}>
            <div
              className={`view-mode-footer-panel${
                viewMode === 'play' ? ' view-mode-footer-panel--active' : ''
              }`}
              aria-hidden={viewMode !== 'play'}
            >
              <div
                className={`status-strip status-strip--under-board${
                  playStatusAiThinking ? ' status-strip--ai-thinking' : ''
                }${aiWorkerBusy && playStatusAiThinking ? ' status-strip--ai-worker-busy' : ''}`}
              >
                <div
                  className={`status-main${playStatusAiThinking ? ' status-main--ai-thinking' : ''}`}
                >
                  {currentStatus}
                </div>
                <div className="status-secondary">
                  总评分：<span className="score">{totalScore}</span>
                </div>
                <div className="status-strip-actions">
                  {(() => {
                    const importMin =
                      patternImportSession?.phase === 'ready' && importSnapshotRef.current
                        ? importSnapshotRef.current.moves.length
                        : 0
                    const pops = winner === 0 && currentPlayer === 1 ? 2 : 1
                    const canUndo =
                      viewMode === 'play' &&
                      patternImportSession?.phase !== 'simulating' &&
                      undosRemaining > 0 &&
                      moveHistory.length > importMin &&
                      moveHistory.length - pops >= importMin &&
                      !undoStoneExit
                    return (
                      <button
                        type="button"
                        className="pill undo-btn"
                        disabled={!canUndo}
                        onClick={handleUndo}
                        title={
                          canUndo
                            ? winner === 0 && currentPlayer === 1
                              ? '撤销上一手双方落子（黑+白）'
                              : '撤销上一手落子'
                            : '无法悔棋'
                        }
                      >
                        悔棋（{undosRemaining}）
                      </button>
                    )
                  })()}
                  <button
                    className={`pill reset-btn ${winner !== 0 ? 'reset-breathe' : ''}`}
                    onClick={handleReset}
                  >
                    重新开局
                  </button>
                </div>
              </div>
              {patternImportSession?.phase === 'ready' && (
                <div
                  className={`pattern-import-dock${
                    patternImportDockExiting ? ' pattern-import-dock--exit' : ''
                  }`}
                  role="group"
                  aria-label="棋形导入选项"
                >
                  <button
                    type="button"
                    className="pill pattern-import-dock__btn"
                    disabled={patternImportDockExiting}
                    onClick={replayImportSamePosition}
                  >
                    该局面重下
                  </button>
                  <button
                    type="button"
                    className="pill pattern-import-dock__btn"
                    disabled={patternImportDockExiting}
                    onClick={restartImportRandomSimulation}
                  >
                    重新随机以该棋型继续下
                  </button>
                  <button
                    type="button"
                    className="pill pattern-import-dock__btn"
                    disabled={patternImportDockExiting}
                    onClick={cancelPatternImport}
                  >
                    取消棋形导入
                  </button>
                </div>
              )}
            </div>
            <div
              className={`view-mode-footer-panel${
                viewMode === 'history' ? ' view-mode-footer-panel--active' : ''
              }`}
              aria-hidden={viewMode !== 'history'}
            >
              <div className="status-strip status-strip--under-board">
                <div className="status-main">
                  {activeHistory
                    ? `历史回放：第 ${replayStep} 手 / 共 ${replayMoves.length} 手`
                    : historyGames.length > 0
                      ? '历史查看 · 点卡片看单局；空白处取消选中'
                      : '历史查看'}
                </div>
                <div className="status-secondary">
                  {historyGames.length === 0 ? (
                    <>暂无对局记录</>
                  ) : selectedHistoryIndex < 0 ? (
                    <>
                      全部对局累计 · 你{' '}
                      <span className="score">{duelScores.you}</span> · AI{' '}
                      <span className="score">{duelScores.ai}</span>
                    </>
                  ) : activeHistory ? (
                    <>
                      胜负：
                      {activeHistory.winner === 1
                        ? '您赢了'
                        : activeHistory.winner === 2
                          ? '您输了'
                          : '和局'}
                      · 难度：<span className="score">{activeHistory.difficulty}</span>
                      {replayStep < replayMoves.length || replayPlaying ? (
                        <>
                          {' '}
                          · 进度：你 <span className="score">{duelScores.you}</span> · AI{' '}
                          <span className="score">{duelScores.ai}</span>
                        </>
                      ) : (
                        <>
                          {' '}
                          · 终局：你 <span className="score">{duelScores.you}</span> · AI{' '}
                          <span className="score">{duelScores.ai}</span>
                        </>
                      )}
                    </>
                  ) : (
                    <>—</>
                  )}
                </div>
                <button className="pill reset-btn" onClick={() => setViewMode('play')}>
                  返回对局
                </button>
              </div>
            </div>
            <div
              className={`view-mode-footer-panel${
                viewMode === 'catalog' ? ' view-mode-footer-panel--active' : ''
              }`}
              aria-hidden={viewMode !== 'catalog'}
            >
              <div className="status-strip status-strip--catalog-under-board">
                <div className="status-main">
                  {catalogBoardSummary
                    ? `「${catalogBoardSummary.name}」· 黑 ${catalogBoardSummary.black} · 白 ${catalogBoardSummary.white}`
                    : '招式大全 · 查阅各招式的含义与演示'}
                </div>
                <div className="status-secondary">
                  {catalogBoardSummary
                    ? catalogBoardSummary.canContinue
                      ? `${catalogBoardSummary.nextHint} · 侧栏「以此局面续弈」后可选难度开局`
                      : `${catalogBoardSummary.nextHint} · ${catalogImportBlockHint(catalogBoardSummary.importBlock)}`
                    : '点选侧栏卡片：棋盘演示与说明；可将演示局面带入人机对弈'}
                </div>
                <button className="pill reset-btn" onClick={() => setViewMode('play')}>
                  返回对局
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
      </div>

      {/* 胜负大字闪现 */}
      {resultFlash && viewMode === 'play' && (
        <div className={`result-flash ${resultFlash.show ? 'show' : 'hide'}`}>
          <div className="result-text">{resultFlash.text}</div>
        </div>
      )}

      {aboutVisible &&
        createPortal(
          <div
            className={`about-modal-root ${aboutLeaving ? 'about-modal-root--leave' : ''}`}
            role="presentation"
            onClick={closeAbout}
          >
            <div
              className={`about-modal-card ${
                aboutLeaving ? 'about-modal-card--leave' : 'about-modal-card--enter'
              }`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="about-modal-title"
              onClick={(e) => e.stopPropagation()}
              style={{
                boxSizing: 'border-box',
                flexShrink: 0,
                width: 'min(1280px, 94vw)',
                maxWidth: 1280,
              }}
            >
              <button
                type="button"
                className="about-modal-close"
                onClick={closeAbout}
                aria-label="关闭"
              >
                ×
              </button>
              <h2 id="about-modal-title" className="about-modal-title">
                关于本作
              </h2>
              <div className="about-modal-body">
                <h3 className="about-modal-subtitle">创作初衷</h3>
                <p className="about-modal-text">
                  我希望在浏览器中打造一个具有「Liquid Glass」质感的五子棋界面：深色背景上叠加磨砂玻璃、柔和光效与清晰的功能分区，将人机对弈、历史回放和招式学习集中呈现在同一块画布中。在规则简洁的前提下，把棋形识别、多档难度与棋谱复现做成顺手的一站式体验，同时这也是我练习现代 CSS 与 React 状态管理的一次实践。
                </p>
                <h3 className="about-modal-subtitle">AI 实现与参考</h3>
                <ul className="about-modal-list">
                  <li>
                    <strong>简单难度</strong>
                    ：AI 会认真防守必输的局面，但平时下棋比较随性，偶尔走出意料之外的步子。本档带有落子提示，推荐位置以高亮标出，适合刚接触五子棋或想轻松下两盘的用户。
                  </li>
                  <li>
                    <strong>普通难度</strong>
                    ：AI 比简单档算得更深，落子更稳，防守也更黏人；无提示，需自行判断局势，适合想认真练练手感的玩家。
                  </li>
                  <li>
                    <strong>困难难度</strong>
                    ：AI 会在多个候选位置之间反复推演，力求最优落点，整体棋力最强、较难缠；同样无提示，适合希望挑战自我的玩家。实现请参阅{' '}
                    <code>src/ai/engine.ts</code>
                    ；计算在 Web Worker 中进行，避免界面卡顿。
                  </li>
                </ul>
                <p className="about-modal-text">
                  若对基于深度强化学习的五子棋 AI 框架（MCTS、PPO、策略-价值网络等）感兴趣，可参考社区开源项目{' '}
                  <a href="https://github.com/guokezhen999/gomoku_rl" target="_blank" rel="noopener noreferrer">
                    guokezhen999/gomoku_rl
                  </a>
                  （Python / PyTorch，专注于深度学习方向）；它与本作的前端搜索实现相互独立，供算法与工程拓展参考。
                </p>
                <p className="about-modal-text">
                  经典的 α-β 剪枝五子棋 AI 与教程可参阅{' '}
                  <a href="https://github.com/lihongxun945/gobang" target="_blank" rel="noopener noreferrer">
                    lihongxun945/gobang
                  </a>
                  （JavaScript；作者说明为传统搜索、不含神经网络，适合对照学习）。
                </p>
                <dl className="about-meta">
                  <div className="about-meta-row">
                    <dt>创作时间</dt>
                    <dd>2026年4月11日</dd>
                  </div>
                  <div className="about-meta-row">
                    <dt>作者</dt>
                    <dd>石天宇</dd>
                  </div>
                  <div className="about-meta-row">
                    <dt>创作工具</dt>
                    <dd>Cursor、DeepSeek</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {pendingImportDifficulty !== null &&
        createPortal(
          <div
            className="about-modal-root"
            role="presentation"
            onClick={() => setPendingImportDifficulty(null)}
          >
            <div
              className="about-modal-card about-modal-card--confirm difficulty-confirm-card about-modal-card--enter"
              role="dialog"
              aria-modal="true"
              aria-labelledby="difficulty-confirm-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="difficulty-confirm-title" className="about-modal-title">
                切换对局难度
              </h2>
              <p className="about-modal-text difficulty-confirm-lead">
                将按新倍率从导入棋形局面<strong>重新开始本局</strong>（当前已下的手数将清空）。确认切换吗？
              </p>
              <p className="difficulty-confirm-switch" aria-live="polite">
                <span className="difficulty-confirm-from">{difficultyLabel(difficulty)}</span>
                <span className="difficulty-confirm-arrow" aria-hidden="true">
                  →
                </span>
                <span className="difficulty-confirm-to">
                  {difficultyLabel(pendingImportDifficulty)}
                </span>
              </p>
              <div className="difficulty-confirm-actions">
                <button
                  type="button"
                  className="pill difficulty-confirm-btn-cancel"
                  onClick={() => setPendingImportDifficulty(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="pill active difficulty-confirm-btn-ok"
                  onClick={confirmPendingImportDifficulty}
                >
                  确定并重下
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

export default App
