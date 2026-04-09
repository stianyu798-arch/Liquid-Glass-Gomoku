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
