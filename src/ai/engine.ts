/**
 * 人机 AI 与局面估值（供主线程与 Web Worker 共用）。
 * 叶节点估值已做单遍扫描优化，避免 staticEval 重复 generateMoveCandidates。
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
  { pattern: /211110|011112/, self: 16000, opp: 22000, name: '冲四' },
  { pattern: /01110/, self: 7000, opp: 9000, name: '活三' },
  { pattern: /010110|011010/, self: 4200, opp: 5600, name: '跳三' },
  { pattern: /001112|211100|010112|211010|011012|210110/, self: 2000, opp: 2600, name: '眠三' },
  { pattern: /001110|011100|0101100|0010110/, self: 3200, opp: 4200, name: '潜在活三' },
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
    for (let offset = -4; offset <= 4; offset++) {
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

/** 叶节点：单遍邻域空点，同时算双方最强点，避免两次 generateMoveCandidates + 排序 */
function staticEvalForAI(b: Cell[]): number {
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

      const em = evaluateBoardAt(b, x, y, ai)
      const eo = evaluateBoardAt(b, x, y, opp)
      if (em.score > myBest) myBest = em.score
      if (eo.score > opBest) opBest = eo.score
    }
  }
  return myBest - opBest * 0.99
}

const MM_WIN = 8_000_000
const MM_LOSS = -8_000_000

function minimaxAB(
  b: Cell[],
  depth: number,
  aiTurn: boolean,
  alpha: number,
  beta: number,
): number {
  if (depth === 0) return staticEvalForAI(b)

  const player: Player = aiTurn ? 2 : 1
  const branch = depth >= 3 ? 9 : depth >= 2 ? 11 : 13
  const moves = generateMoveCandidates(b, player, 3, branch)
  if (!moves.length) return staticEvalForAI(b)

  const tieDepth = (4 - depth) * 120

  if (aiTurn) {
    let maxEval = MM_LOSS
    for (const m of moves) {
      const nb = b.slice()
      const i = indexOf(m.x, m.y)
      nb[i] = player
      if (checkWin(nb, m.x, m.y, 2)) return MM_WIN - tieDepth
      const ev = minimaxAB(nb, depth - 1, false, alpha, beta)
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
    const ev = minimaxAB(nb, depth - 1, true, alpha, beta)
    minEval = Math.min(minEval, ev)
    beta = Math.min(beta, ev)
    if (beta <= alpha) break
  }
  return minEval
}

function pickBestMoveMinimax(board: Cell[], plyDepth: number): ScoredMove | null {
  const ai = 2 as Player
  const moves = generateMoveCandidates(board, ai, 3, 12)
  if (!moves.length) return null
  let best: ScoredMove = moves[0]!
  let bestScore = MM_LOSS

  for (const m of moves) {
    const nb = board.slice()
    nb[indexOf(m.x, m.y)] = ai
    if (checkWin(nb, m.x, m.y, ai)) return { ...m, score: 1e12, pattern: '立即成五' }
    const sc = minimaxAB(nb, plyDepth - 1, false, MM_LOSS, MM_WIN)
    if (sc > bestScore) {
      bestScore = sc
      best = m
    }
  }
  return best
}

const HUMAN_HINT_DEPTH = 3

export function pickBestHumanHintMove(board: Cell[]): { x: number; y: number } | null {
  const human = 1 as Player
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

function pickEasyNonForced(candidates: ScoredMove[]): ScoredMove {
  const top = candidates.slice(0, 8)
  if (top.length <= 1) return top[0]!
  const r = Math.random()
  if (r < 0.52) return top[0]!
  if (r < 0.8) return top[1] ?? top[0]!
  if (r < 0.92) return top[2] ?? top[0]!
  const k = 3 + Math.floor(Math.random() * Math.min(5, top.length - 3))
  return top[k] ?? top[0]!
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

  if (difficulty === 'easy') {
    return pickEasyNonForced(candidates)
  }

  if (difficulty === 'normal') {
    const pick = pickBestMoveMinimax(board, 2)
    return pick ?? candidates[0]
  }

  const pick = pickBestMoveMinimax(board, 4)
  return pick ?? candidates[0]
}
