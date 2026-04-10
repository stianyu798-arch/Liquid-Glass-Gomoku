/**
 * 人机 AI 与局面估值（供主线程与 Web Worker 共用）。
 * 普通/简单等路径：叶节点用邻域单遍扫描（staticEvalForAI）；困难档搜索链可改用文档式**全盘线型差分**（evaluateGlobalDiff），二者见 minimaxAB 分支。
 *
 * 难度设计参考常见博弈 AI 文献与开源实践（如极小化极大 + α-β、静态估值指数权重、弱棋力下的随机策略）：
 * - 简单：必胜/必防后，对候选点按局面启发分做 **softmax 温度采样**（随机策略，类似带温度的策略分布，非均匀瞎走）。
 * - 普通：**α-β**，根下搜索深度介于入门与困难之间（见 pickBestMoveMinimax 层数）。
 * - 困难：参考「五子棋困难算法 Py」doc：α-β + 根 MC；叶节点可用 **全局线型评估**（evaluate 白 − evaluate 黑）；
 *   候选 **radius=2**、走子 **quick_score** 排序；仍保留必堵阈值与 MC。
 */

export type Cell = 0 | 1 | 2
export type Player = 1 | 2
export type Difficulty = 'easy' | 'normal' | 'hard'

export interface ScoredMove {
  x: number
  y: number
  score: number
  pattern: string
}

const BOARD_SIZE = 15
const WIN_COUNT = 5

const DIRS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const

const PATTERN_SCORES: { pattern: RegExp; self: number; opp: number; name: string }[] = [
  { pattern: /11111/, self: 200000, opp: 200000, name: '成五' },
  { pattern: /011110/, self: 42000, opp: 52000, name: '活四' },
  { pattern: /211110|011112/, self: 16000, opp: 24000, name: '冲四' },
  { pattern: /01110/, self: 7000, opp: 11000, name: '活三' },
  { pattern: /010110|011010/, self: 4200, opp: 6800, name: '跳三' },
  { pattern: /001112|211100|010112|211010|011012|210110/, self: 2000, opp: 4200, name: '眠三' },
  { pattern: /001110|011100|0101100|0010110/, self: 3200, opp: 5200, name: '潜在活三' },
]

function indexOf(x: number, y: number): number {
  return y * BOARD_SIZE + x
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE
}

function checkWin(board: Cell[], lastX: number, lastY: number, player: Player) {
  for (const [dx, dy] of DIRS) {
    let count = 1
    let x = lastX + dx
    let y = lastY + dy
    while (inBounds(x, y) && board[indexOf(x, y)] === player) {
      count++
      x += dx
      y += dy
    }
    x = lastX - dx
    y = lastY - dy
    while (inBounds(x, y) && board[indexOf(x, y)] === player) {
      count++
      x -= dx
      y -= dy
    }
    if (count >= WIN_COUNT) {
      return { winner: player, line: [] as [number, number][] }
    }
  }
  return null
}

function evaluateLine(line: Cell[], who: Player, opp: Player) {
  const s = line.map((c) => (c === who ? '1' : c === opp ? '2' : '0')).join('')
  let best = { score: 0, pattern: '' }
  for (const p of PATTERN_SCORES) {
    if (p.pattern.test(s)) {
      const score = p.self
      if (score > best.score) best = { score, pattern: p.name }
    }
  }
  const sOpp = line.map((c) => (c === opp ? '1' : c === who ? '2' : '0')).join('')
  for (const p of PATTERN_SCORES) {
    if (p.pattern.test(sOpp)) {
      const score = p.opp
      if (score > best.score) best = { score, pattern: '阻断 ' + p.name }
    }
  }
  return best
}

/* ---------- 困难档参考：文档 Python 版「整条线棋型 + 全局差分」评估（与邻域 max 点估值独立） ---------- */

/** 单条线字符串（1=该方，2=对方，0=空）按文档表给分 */
function evaluateLineDocStyle(strLine: string): number {
  if (strLine.includes('11111')) return 1_000_000
  if (strLine.includes('011110')) return 50_000
  let score = 0
  const patterns: [string, number][] = [
    ['11101', 8000],
    ['11011', 8000],
    ['10111', 8000],
    ['11110', 8000],
    ['01110', 2000],
    ['011010', 2000],
    ['010110', 2000],
    ['011100', 800],
    ['001110', 800],
    ['011000', 800],
    ['001100', 200],
    ['010100', 200],
    ['000100', 0],
  ]
  for (const [p, v] of patterns) {
    if (strLine.includes(p)) score += v
  }
  const blocked = ['211110', '011112', '211101', '210111', '211011']
  for (const p of blocked) {
    if (strLine.includes(p)) score += 4000
  }
  return score
}

function evaluateBoardForColor(board: Cell[], color: Player): number {
  const opponent: Player = color === 1 ? 2 : 1
  let total = 0

  for (let y = 0; y < BOARD_SIZE; y++) {
    const lineColor: number[] = []
    for (let x = 0; x < BOARD_SIZE; x++) {
      const c = board[indexOf(x, y)]
      lineColor.push(c === color ? 1 : c === opponent ? 2 : 0)
    }
    total += evaluateLineDocStyle(lineColor.join(''))
  }

  for (let x = 0; x < BOARD_SIZE; x++) {
    const lineColor: number[] = []
    for (let y = 0; y < BOARD_SIZE; y++) {
      const c = board[indexOf(x, y)]
      lineColor.push(c === color ? 1 : c === opponent ? 2 : 0)
    }
    total += evaluateLineDocStyle(lineColor.join(''))
  }

  for (let k = -BOARD_SIZE + 1; k < BOARD_SIZE; k++) {
    const lineColor: number[] = []
    for (let i = 0; i < BOARD_SIZE; i++) {
      const j = i - k
      if (j >= 0 && j < BOARD_SIZE) {
        const c = board[indexOf(i, j)]
        lineColor.push(c === color ? 1 : c === opponent ? 2 : 0)
      }
    }
    if (lineColor.length >= 5) total += evaluateLineDocStyle(lineColor.join(''))
  }

  for (let k = 0; k < 2 * BOARD_SIZE - 1; k++) {
    const lineColor: number[] = []
    for (let i = 0; i < BOARD_SIZE; i++) {
      const j = k - i
      if (j >= 0 && j < BOARD_SIZE) {
        const c = board[indexOf(i, j)]
        lineColor.push(c === color ? 1 : c === opponent ? 2 : 0)
      }
    }
    if (lineColor.length >= 5) total += evaluateLineDocStyle(lineColor.join(''))
  }

  return total
}

/** 文档 evaluate()：AI(2) 全盘得分 − 玩家(1) 全盘得分 */
function evaluateGlobalDiff(board: Cell[]): number {
  return evaluateBoardForColor(board, 2) - evaluateBoardForColor(board, 1)
}

const MM_WIN = 8_000_000
const MM_LOSS = -8_000_000

/** 与文档 quick_score_move 一致：落子后若胜则极大分，否则 evaluate_board(该方) */
function quickScoreMove(board: Cell[], x: number, y: number, player: Player): number {
  const idx = indexOf(x, y)
  if (board[idx] !== 0) return MM_LOSS
  const nb = board.slice()
  nb[idx] = player
  if (checkWin(nb, x, y, player)) return MM_WIN
  return evaluateBoardForColor(nb, player)
}

function sortMovesByQuickScore(moves: ScoredMove[], board: Cell[], player: Player): ScoredMove[] {
  return moves.slice().sort((a, b) => {
    const sa = quickScoreMove(board, a.x, a.y, player)
    const sb = quickScoreMove(board, b.x, b.y, player)
    return sb - sa
  })
}

/** 将全局差分压到与 MM 终端可比的数量级，避免叶值溢出剪枝比较 */
const DOC_GLOBAL_EVAL_SCALE = 1 / 96

export function evaluateBoardAt(board: Cell[], x: number, y: number, who: Player): ScoredMove {
  const idx = indexOf(x, y)
  if (board[idx] !== 0) return { x, y, score: -Infinity, pattern: '' }
  const temp = board.slice()
  temp[idx] = who
  const opp: Player = who === 1 ? 2 : 1
  let totalScore = 0
  let bestPattern = ''

  for (const [dx, dy] of DIRS) {
    const line: Cell[] = []
    /* 11 格窗口，减少「三连贴边」时线段过短导致棋形漏检 */
    for (let offset = -5; offset <= 5; offset++) {
      const xx = x + dx * offset
      const yy = y + dy * offset
      if (inBounds(xx, yy)) {
        line.push(temp[indexOf(xx, yy)])
      }
    }
    if (line.length >= 5) {
      const { score, pattern } = evaluateLine(line, who, opp)
      if (score > 0) {
        totalScore += score
        if (score > 0 && !bestPattern) bestPattern = pattern
      }
    }
  }

  const center = (BOARD_SIZE - 1) / 2
  const distCenter = Math.abs(x - center) + Math.abs(y - center)
  totalScore += Math.max(0, 10 - distCenter)

  return { x, y, score: totalScore, pattern: bestPattern }
}

function generateMoveCandidates(
  b: Cell[],
  who: Player,
  radius: number,
  limit: number,
): ScoredMove[] {
  let stoneCount = 0
  for (let i = 0; i < b.length; i++) if (b[i] !== 0) stoneCount++

  const res: ScoredMove[] = []
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const idx = indexOf(x, y)
      if (b[idx] !== 0) continue

      let hasNeighbor = false
      if (stoneCount === 0) {
        const c = (BOARD_SIZE - 1) / 2
        if (Math.abs(x - c) <= 1 && Math.abs(y - c) <= 1) hasNeighbor = true
      } else {
        for (let dy = -radius; dy <= radius && !hasNeighbor; dy++) {
          for (let dx = -radius; dx <= radius && !hasNeighbor; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = x + dx
            const ny = y + dy
            if (inBounds(nx, ny) && b[indexOf(nx, ny)] !== 0) {
              hasNeighbor = true
            }
          }
        }
      }
      if (!hasNeighbor) continue

      res.push(evaluateBoardAt(b, x, y, who))
    }
  }
  res.sort((a, b2) => b2.score - a.score)
  return res.slice(0, limit)
}

function emptyHasNeighborStone(
  b: Cell[],
  x: number,
  y: number,
  stoneCount: number,
  radius: number,
): boolean {
  if (stoneCount === 0) {
    const c = (BOARD_SIZE - 1) / 2
    return Math.abs(x - c) <= 1 && Math.abs(y - c) <= 1
  }
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx
      const ny = y + dy
      if (inBounds(nx, ny) && b[indexOf(nx, ny)] !== 0) return true
    }
  }
  return false
}

/**
 * 黑方（人）在某一空点落子时的静态分最高的一点，即对方当前最想占的位置；
 * 白棋应优先抢占以封堵连三、眠三、跳三及以上棋形（阈值见 HUMAN_THREAT_FORCE_BLOCK）。
 */
function findStrongestHumanThreatMove(board: Cell[]): ScoredMove | null {
  const human = 1 as Player
  let stoneCount = 0
  for (let i = 0; i < board.length; i++) if (board[i] !== 0) stoneCount++

  let best: ScoredMove | null = null
  const radius = 3
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[indexOf(x, y)] !== 0) continue
      if (!emptyHasNeighborStone(board, x, y, stoneCount, radius)) continue
      const ev = evaluateBoardAt(board, x, y, human)
      if (!best || ev.score > best.score) best = ev
    }
  }
  return best
}

/**
 * 若黑方「最佳应手点」静态分 ≥ 此阈值，白方直接占该点封堵（在「对方下一手成五」之后第二道防线）。
 * 困难档：阈值高于活三(~7000)，仅冲四/活四/成五等仍「一步封堵」；活三及以下交给 minimax 在攻守间取舍，避免只会堵。
 * 简易/普通仍积极挡三。
 */
const HUMAN_THREAT_FORCE_BLOCK: Record<Difficulty, number> = {
  easy: 2200,
  normal: 1500,
  hard: 12000,
}

/** 困难档叶节点：压低对方好点、抬高己方好点，使搜索更愿意做连续进攻 */
const HARD_MINIMAX_OPP_WEIGHT = 0.8
const HARD_MINIMAX_MY_BOOST = 1.12

/** 困难 hybrid：根下多搜一层，利于「先手连续」的规划感 */
const HARD_HYBRID_MINIMAX_DEPTH = 4

/**
 * 盘面子数 ≤ 此值时视为开局：困难档不用 hybrid（多候选 × 深搜 × 全盘叶值 + MC），
 * 改用浅层 minimax + 邻域静态叶值（与棋形评估同一套启发），空盘首应快、无需玩家去招式侧栏预选局面。
 */
const HARD_OPENING_FAST_MAX_STONES = 4

/** 叶节点：单遍邻域空点，同时算双方最强点，避免两次 generateMoveCandidates + 排序 */
function staticEvalForAI(
  b: Cell[],
  oppThreatWeight = 1.08,
  myScoreBoost = 1,
): number {
  const ai = 2 as Player
  const opp = 1 as Player
  let stoneCount = 0
  for (let i = 0; i < b.length; i++) if (b[i] !== 0) stoneCount++

  let myBest = 0
  let opBest = 0
  const radius = 3

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const idx = indexOf(x, y)
      if (b[idx] !== 0) continue
      if (!emptyHasNeighborStone(b, x, y, stoneCount, radius)) continue

      const em = evaluateBoardAt(b, x, y, ai)
      const eo = evaluateBoardAt(b, x, y, opp)
      if (em.score > myBest) myBest = em.score
      if (eo.score > opBest) opBest = eo.score
    }
  }
  /* 默认略提高对方威胁权重；困难档配合 myScoreBoost / 更小 oppThreatWeight 偏进攻 */
  return myBest * myScoreBoost - opBest * oppThreatWeight
}

function minimaxAB(
  b: Cell[],
  depth: number,
  aiTurn: boolean,
  alpha: number,
  beta: number,
  oppThreatWeight = 1.08,
  myScoreBoost = 1,
  useDocGlobalLeaf = false,
  candidateRadius = 3,
): number {
  if (depth === 0) {
    if (useDocGlobalLeaf) {
      const g = evaluateGlobalDiff(b)
      const v = g * DOC_GLOBAL_EVAL_SCALE
      return Math.max(MM_LOSS / 2, Math.min(MM_WIN / 2, v))
    }
    return staticEvalForAI(b, oppThreatWeight, myScoreBoost)
  }

  const player: Player = aiTurn ? 2 : 1
  const branch = depth >= 3 ? 9 : depth >= 2 ? 11 : 13
  let moves = generateMoveCandidates(b, player, candidateRadius, branch)
  if (useDocGlobalLeaf) moves = sortMovesByQuickScore(moves, b, player)
  if (!moves.length) {
    if (useDocGlobalLeaf) {
      const g = evaluateGlobalDiff(b)
      const v = g * DOC_GLOBAL_EVAL_SCALE
      return Math.max(MM_LOSS / 2, Math.min(MM_WIN / 2, v))
    }
    return staticEvalForAI(b, oppThreatWeight, myScoreBoost)
  }

  const tieDepth = (4 - depth) * 120

  if (aiTurn) {
    let maxEval = MM_LOSS
    for (const m of moves) {
      const nb = b.slice()
      const i = indexOf(m.x, m.y)
      nb[i] = player
      if (checkWin(nb, m.x, m.y, 2)) return MM_WIN - tieDepth
      const ev = minimaxAB(
        nb,
        depth - 1,
        false,
        alpha,
        beta,
        oppThreatWeight,
        myScoreBoost,
        useDocGlobalLeaf,
        candidateRadius,
      )
      maxEval = Math.max(maxEval, ev)
      alpha = Math.max(alpha, ev)
      if (beta <= alpha) break
    }
    return maxEval
  }

  let minEval = MM_WIN
  for (const m of moves) {
    const nb = b.slice()
    nb[indexOf(m.x, m.y)] = player
    if (checkWin(nb, m.x, m.y, 1)) return MM_LOSS + tieDepth
    const ev = minimaxAB(
      nb,
      depth - 1,
      true,
      alpha,
      beta,
      oppThreatWeight,
      myScoreBoost,
      useDocGlobalLeaf,
      candidateRadius,
    )
    minEval = Math.min(minEval, ev)
    beta = Math.min(beta, ev)
    if (beta <= alpha) break
  }
  return minEval
}

/** 与文档一致：只在已有子周围 2 格内扩候选，减少无效分支 */
const HARD_CANDIDATE_RADIUS = 2

function pickBestMoveMinimax(
  board: Cell[],
  plyDepth: number,
  oppThreatWeight = 1.08,
  myScoreBoost = 1,
  useDocGlobalLeaf = false,
  candidateRadius = 3,
): ScoredMove | null {
  const ai = 2 as Player
  let moves = generateMoveCandidates(board, ai, candidateRadius, 12)
  if (useDocGlobalLeaf) moves = sortMovesByQuickScore(moves, board, ai)
  if (!moves.length) return null
  let best: ScoredMove = moves[0]!
  let bestScore = MM_LOSS

  for (const m of moves) {
    const nb = board.slice()
    nb[indexOf(m.x, m.y)] = ai
    if (checkWin(nb, m.x, m.y, ai)) return { ...m, score: 1e12, pattern: '立即成五' }
    const sc = minimaxAB(
      nb,
      plyDepth - 1,
      false,
      MM_LOSS,
      MM_WIN,
      oppThreatWeight,
      myScoreBoost,
      useDocGlobalLeaf,
      candidateRadius,
    )
    if (sc > bestScore) {
      bestScore = sc
      best = m
    }
  }
  return best
}

/** 从「下一手方」开始随机走子至终局或步数上限；返回胜者 1/2，和棋或超长为 0 */
function playoutRandomOutcome(startBoard: Cell[], nextToMove: Player): 0 | 1 | 2 {
  const b = startBoard.slice()
  let p: Player = nextToMove
  const maxPlies = 240
  for (let step = 0; step < maxPlies; step++) {
    const cand = generateMoveCandidates(b, p, 3, 20)
    if (!cand.length) return 0
    const pick = cand[Math.floor(Math.random() * cand.length)]!
    const idx = indexOf(pick.x, pick.y)
    b[idx] = p
    if (checkWin(b, pick.x, pick.y, p)) return p
    p = p === 1 ? 2 : 1
  }
  return 0
}

/**
 * 困难档：先 α-β 得到若干强候选，再在根上做多局随机 rollout，按白方胜率加权选点（无网络，属 MCTS/自对弈中的 rollout 层）。
 */
function pickBestMoveHardHybrid(
  board: Cell[],
  oppThreatWeight = HARD_MINIMAX_OPP_WEIGHT,
  myScoreBoost = HARD_MINIMAX_MY_BOOST,
): ScoredMove | null {
  const ai = 2 as Player
  let moves = generateMoveCandidates(board, ai, HARD_CANDIDATE_RADIUS, 14)
  moves = sortMovesByQuickScore(moves, board, ai)
  if (!moves.length) return null

  const scored: { m: ScoredMove; sc: number }[] = []
  for (const m of moves) {
    const nb = board.slice()
    nb[indexOf(m.x, m.y)] = ai
    if (checkWin(nb, m.x, m.y, ai)) return { ...m, score: 1e12, pattern: '立即成五' }
    const sc = minimaxAB(
      nb,
      HARD_HYBRID_MINIMAX_DEPTH,
      false,
      MM_LOSS,
      MM_WIN,
      oppThreatWeight,
      myScoreBoost,
      true,
      HARD_CANDIDATE_RADIUS,
    )
    scored.push({ m, sc })
  }
  scored.sort((a, b) => b.sc - a.sc)

  const bestSc = scored[0]!.sc
  /** 与最优解接近的候选才做多局模拟；带宽略增以纳入更多「攻」型候选 */
  const band = 320_000
  const contenders = scored.filter((s) => s.sc >= bestSc - band).slice(0, 5)
  if (contenders.length <= 1) {
    return contenders[0]!.m
  }

  const rollouts = 18
  let pick = contenders[0]!.m
  let bestRate = -1
  for (const { m } of contenders) {
    const nb = board.slice()
    nb[indexOf(m.x, m.y)] = ai
    let wins = 0
    for (let r = 0; r < rollouts; r++) {
      const o = playoutRandomOutcome(nb, 1)
      if (o === 2) wins++
    }
    const rate = wins / rollouts
    if (rate > bestRate) {
      bestRate = rate
      pick = m
    } else if (rate === bestRate) {
      const scA = scored.find((x) => x.m.x === pick.x && x.m.y === pick.y)?.sc ?? MM_LOSS
      const scB = scored.find((x) => x.m.x === m.x && x.m.y === m.y)?.sc ?? MM_LOSS
      if (scB > scA) pick = m
    }
  }
  return { ...pick, pattern: pick.pattern ? `${pick.pattern} · MC` : 'MC 加权' }
}

/** 提示灯用 minimax 深度（略深于旧版，利于「跟灯可走成胜势」） */
const HUMAN_HINT_DEPTH = 4

/**
 * 对方若已有「下一手成五」的落点，玩家必须占该点，否则提示灯与必胜逻辑不一致。
 */
function findMandatoryBlockOpponentWin(
  board: Cell[],
  opp: Player,
): { x: number; y: number } | null {
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const idx = indexOf(x, y)
      if (board[idx] !== 0) continue
      const nb = board.slice()
      nb[idx] = opp
      if (checkWin(nb, x, y, opp)) return { x, y }
    }
  }
  return null
}

/**
 * 简单档提示灯：先必胜、再必防对方冲四/成五，再浅层 minimax + 静态分 tie-break（与旧版「简单只给静态第一名」不同，避免跟灯仍送死）。
 */
export function pickBestHumanHintMove(
  board: Cell[],
  _mode: Difficulty = 'normal',
): { x: number; y: number } | null {
  const human = 1 as Player
  const opp = 2 as Player
  let stoneCount = 0
  for (let i = 0; i < board.length; i++) if (board[i] !== 0) stoneCount++
  if (stoneCount === 0) {
    const c = Math.floor((BOARD_SIZE - 1) / 2)
    return { x: c, y: c }
  }

  const moves = generateMoveCandidates(board, human, 3, 22)
  if (!moves.length) {
    const c = Math.floor((BOARD_SIZE - 1) / 2)
    return { x: c, y: c }
  }

  for (const m of moves.slice(0, 32)) {
    const nb = board.slice()
    nb[indexOf(m.x, m.y)] = human
    if (checkWin(nb, m.x, m.y, human)) return { x: m.x, y: m.y }
  }

  const mustBlock = findMandatoryBlockOpponentWin(board, opp)
  if (mustBlock) return mustBlock

  let bestM: ScoredMove = moves[0]!
  let bestEv = MM_WIN
  let bestStatic = -Infinity

  for (const m of moves.slice(0, 16)) {
    const nb = board.slice()
    nb[indexOf(m.x, m.y)] = human
    if (checkWin(nb, m.x, m.y, human)) return { x: m.x, y: m.y }
    const ev = minimaxAB(nb, HUMAN_HINT_DEPTH - 1, true, MM_LOSS, MM_WIN)
    const st = evaluateBoardAt(board, m.x, m.y, human).score
    if (ev < bestEv || (ev === bestEv && st > bestStatic)) {
      bestEv = ev
      bestStatic = st
      bestM = m
    }
  }
  return { x: bestM.x, y: bestM.y }
}

/**
 * 简单档非强制阶段：对静态估值最高的若干候选做 softmax 抽样（温度 T）。
 * 与博弈/RL 中带温度策略、按 exp(score/T) 比例随机选子的做法一致，弱于总选 argmax，但强于均匀随机。
 */
const EASY_SOFTMAX_TEMPERATURE = 7200

function pickEasySoftmaxSample(candidates: ScoredMove[]): ScoredMove {
  const top = candidates.slice(0, 14)
  if (top.length <= 1) return top[0]!
  const maxS = top[0]!.score
  const weights = top.map((m) => Math.exp((m.score - maxS) / EASY_SOFTMAX_TEMPERATURE))
  const sumW = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * sumW
  for (let i = 0; i < top.length; i++) {
    r -= weights[i]!
    if (r <= 0) return top[i]!
  }
  return top[0]!
}

function countStones(board: Cell[]): number {
  let n = 0
  for (let i = 0; i < board.length; i++) if (board[i] !== 0) n++
  return n
}

export function chooseAIMove(board: Cell[], difficulty: Difficulty): ScoredMove | null {
  const ai = 2 as Player
  const opp = 1 as Player

  const candidates = generateMoveCandidates(board, ai, 3, 44)
  if (!candidates.length) {
    const c = Math.floor(BOARD_SIZE / 2)
    return evaluateBoardAt(board, c, c, ai)
  }

  for (const m of candidates.slice(0, 32)) {
    const tmp = board.slice()
    tmp[indexOf(m.x, m.y)] = ai
    const win = checkWin(tmp, m.x, m.y, ai)
    if (win) return { ...m, score: 1e12, pattern: '立即成五' }
  }

  const threatBlocks: ScoredMove[] = []
  for (const m of candidates.slice(0, 32)) {
    const tmp = board.slice()
    tmp[indexOf(m.x, m.y)] = opp
    const win = checkWin(tmp, m.x, m.y, opp)
    if (win) {
      threatBlocks.push({ ...m, score: m.score + 200000 })
    }
  }
  if (threatBlocks.length) {
    threatBlocks.sort((a, b) => b.score - a.score)
    return threatBlocks[0]
  }

  const humanBest = findStrongestHumanThreatMove(board)
  const blockThr = HUMAN_THREAT_FORCE_BLOCK[difficulty]
  if (humanBest && humanBest.score >= blockThr) {
    const i = indexOf(humanBest.x, humanBest.y)
    if (board[i] === 0) {
      const placed = evaluateBoardAt(board, humanBest.x, humanBest.y, ai)
      return {
        ...placed,
        score: placed.score + humanBest.score * 0.15,
        pattern: humanBest.pattern
          ? `封堵（${humanBest.pattern}）`
          : '封堵对方强点',
      }
    }
  }

  if (difficulty === 'easy') {
    return pickEasySoftmaxSample(candidates)
  }

  if (difficulty === 'normal') {
    /** 中等：比「仅 1 层应手」更深一层 α-β，接近常见「中等难度」 minimax 深度配置 */
    const pick = pickBestMoveMinimax(board, 3)
    return pick ?? candidates[0]
  }

  const stones = countStones(board)
  if (stones <= HARD_OPENING_FAST_MAX_STONES) {
    const pick = pickBestMoveMinimax(
      board,
      4,
      HARD_MINIMAX_OPP_WEIGHT,
      HARD_MINIMAX_MY_BOOST,
      false,
      HARD_CANDIDATE_RADIUS,
    )
    return pick ?? candidates[0]
  }

  const pick =
    pickBestMoveHardHybrid(board, HARD_MINIMAX_OPP_WEIGHT, HARD_MINIMAX_MY_BOOST) ??
    pickBestMoveMinimax(
      board,
      5,
      HARD_MINIMAX_OPP_WEIGHT,
      HARD_MINIMAX_MY_BOOST,
      true,
      HARD_CANDIDATE_RADIUS,
    )
  return pick ?? candidates[0]
}
