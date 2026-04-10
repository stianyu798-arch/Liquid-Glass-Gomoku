/** 仅转发 `chooseAIMove`；困难档复杂搜索在 `engine.ts` 内完成（含文档式叶评估等）。 */
import { chooseAIMove, type Cell, type Difficulty } from './engine'

export type AiWorkerMessage = {
  requestId: number
  board: Cell[]
  difficulty: Difficulty
}

self.onmessage = (e: MessageEvent<AiWorkerMessage>) => {
  const { requestId, board, difficulty } = e.data
  const move = chooseAIMove(board, difficulty)
  postMessage({ requestId, move })
}
