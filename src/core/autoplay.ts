import { chooseThrow, type AiLevel } from './ai'
import { advanceGame, createGame, isFinished, isRoundScored, playThrow, scoreLines, turnOf, type GameSetup, type GameState } from './game'
import { makeRng } from './rng'

export interface AutoResult {
  winner: number
  throws: number
  scores: number[]
  state: GameState
}

/** AI 對 AI 自動打完一整場（測試與平衡用）。levels[team] 為各隊 AI 難度。 */
export function autoPlay(setup: GameSetup, levels: [AiLevel, AiLevel], seed = 1): AutoResult {
  const g = createGame(setup)
  const rng = makeRng(seed)
  let throws = 0
  let guard = 0
  while (!isFinished(g) && guard++ < 2000) {
    if (isRoundScored(g)) {
      advanceGame(g)
      continue
    }
    const turn = turnOf(g)
    if (!turn) break
    const choice = chooseThrow(g, levels[turn.team] ?? 'normal', rng)
    playThrow(g, choice.spec, choice.taps)
    throws++
  }
  return { winner: 'winner' in g ? g.winner : -1, throws, scores: scoreLines(g).values, state: g }
}
