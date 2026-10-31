import { SlideSim, type SimOptions } from './sim'
import { cloneStones, dist, SHEET, STONE_R, type SimEvent, type Stone, type ThrowSpec } from './types'

export interface MatchConfig {
  /** 每隊人數：1 對 1 或 2 對 2 */
  playersPerTeam: 1 | 2 | 3 | 4
  /** 每隊每局投幾顆壺（快速 4、標準 8） */
  stonesPerTeam: number
  /** 局數 */
  ends: number
  /** 每壺秒數，0 為無限 */
  timerSec: number
  freeGuard: boolean
}

export const DEFAULT_CONFIG: MatchConfig = {
  playersPerTeam: 1,
  stonesPerTeam: 8,
  ends: 4,
  timerSec: 45,
  freeGuard: true,
}

export const MAX_EXTRA_ENDS = 2

export interface EndSummary {
  end: number
  scoringTeam: number | -1
  points: number
  /** 各隊在大本營內最近壺的距離（沒有則為 null） */
  nearest: (number | null)[]
}

export interface MatchState {
  kind: 'standard'
  config: MatchConfig
  /** 目前第幾局（0 起算） */
  end: number
  totalEnds: number
  /** 局內第幾壺（0 起算） */
  k: number
  hammer: number
  /** scores[team][end] */
  scores: number[][]
  stones: Stone[]
  status: 'playing' | 'endScored' | 'finished'
  lastEnd: EndSummary | null
  /** finished 後：0/1 勝方，-1 平手 */
  winner: number
}

export interface ThrowResult {
  state: MatchState
  /** 這次投壺使用的規格（用於重播） */
  spec: ThrowSpec
  taps: number[]
  stoneId: number
  /** 投壺前的石頭位置（重播起點） */
  before: Stone[]
  events: SimEvent[]
  /** 守護區違規：已還原場面並移除本壺 */
  fgzViolation: boolean
  endSummary: EndSummary | null
}

export function newEndStones(cfg: MatchConfig): Stone[] {
  const out: Stone[] = []
  for (let team = 0; team < 2; team++) {
    for (let n = 0; n < cfg.stonesPerTeam; n++) {
      out.push({ id: team * cfg.stonesPerTeam + n, team, x: 0, y: -2, vx: 0, vy: 0, spin: 1, inPlay: false, thrown: false })
    }
  }
  return out
}

export function createMatch(config: MatchConfig = DEFAULT_CONFIG, firstHammer = 1): MatchState {
  return {
    kind: 'standard',
    config,
    end: 0,
    totalEnds: config.ends,
    k: 0,
    hammer: firstHammer,
    scores: [[], []],
    stones: newEndStones(config),
    status: 'playing',
    lastEnd: null,
    winner: -1,
  }
}

export function teamOfStone(state: MatchState, k: number = state.k): number {
  return k % 2 === 0 ? 1 - state.hammer : state.hammer
}

export interface Turn {
  team: number
  /** 該隊內第幾位玩家 */
  player: number
  stoneId: number
  /** 該隊本局第幾壺（0 起算） */
  n: number
}

export function currentTurn(state: MatchState): Turn {
  const N = state.config.stonesPerTeam
  const team = teamOfStone(state)
  const n = Math.floor(state.k / 2)
  const player = Math.min(state.config.playersPerTeam - 1, Math.floor((n * state.config.playersPerTeam) / N))
  return { team, player, stoneId: team * N + n, n }
}

export function totalScore(state: MatchState, team: number): number {
  return state.scores[team].reduce((a, b) => a + b, 0)
}

/** 守護區：遠端 hog line 與 tee line 之間、且不在大本營內。 */
export function inFreeGuardZone(s: Stone): boolean {
  if (!s.inPlay) return false
  if (s.y - STONE_R < SHEET.hogY || s.y > SHEET.teeY) return false
  return dist(s.x, s.y, 0, SHEET.teeY) > SHEET.houseR + STONE_R
}

/** 單局計分：最靠近圓心的隊伍，得到「比對手最近壺更近」的壺數。 */
export function scoreEnd(stones: readonly Stone[]): { team: number | -1; points: number; nearest: (number | null)[] } {
  const inHouse = stones
    .filter((s) => s.inPlay && dist(s.x, s.y, 0, SHEET.teeY) <= SHEET.houseR + STONE_R)
    .map((s) => ({ team: s.team, d: dist(s.x, s.y, 0, SHEET.teeY) }))
    .sort((a, b) => a.d - b.d)
  const nearest: (number | null)[] = [null, null]
  for (const s of inHouse) if (nearest[s.team] === null) nearest[s.team] = s.d
  if (inHouse.length === 0) return { team: -1, points: 0, nearest }
  // 兩隊最近壺距離相同（無法分出勝負）：該局不得分
  if (inHouse.length > 1 && inHouse[0].team !== inHouse[1].team && Math.abs(inHouse[0].d - inHouse[1].d) < 1e-6) return { team: -1, points: 0, nearest }
  const team = inHouse[0].team
  const other = team === 0 ? 1 : 0
  const limit = nearest[other] ?? Infinity
  const points = inHouse.filter((s) => s.team === team && s.d < limit).length
  return { team, points, nearest }
}

export function defaultThrow(): ThrowSpec {
  return { angle: 0, power: 0.5, spin: 1 }
}

/** 執行一次投壺並更新場面。`state` 會被就地修改並回傳於結果中。 */
/** 五壺規則：一局前 5 顆壺（雙方合計）不可把對手守護區的壺撞出場外。 */
export const FIVE_ROCK = 5

export function throwStone(state: MatchState, spec: ThrowSpec, taps: readonly number[] = [], simOpts: SimOptions = {}): ThrowResult {
  if (state.status !== 'playing') throw new Error('match is not in playing status')
  const turn = currentTurn(state)
  const before = cloneStones(state.stones)
  const sim = new SlideSim(state.stones, turn.stoneId, spec, simOpts).runToEnd(taps)
  const usedTaps = sim.taps.slice()
  let after = sim.stones
  let fgz = false
  const events = sim.events.slice()

  if (state.config.freeGuard && state.k < FIVE_ROCK) {
    for (const prev of before) {
      if (prev.team !== turn.team && inFreeGuardZone(prev)) {
        const now = after.find((s) => s.id === prev.id)!
        if (!now.inPlay) fgz = true
      }
    }
    if (fgz) {
      after = cloneStones(before)
      const me = after.find((s) => s.id === turn.stoneId)!
      me.inPlay = false
      me.thrown = true
      me.vx = me.vy = 0
    }
  }
  state.stones = after
  state.k += 1

  let endSummary: EndSummary | null = null
  if (state.k >= state.config.stonesPerTeam * 2) {
    const r = scoreEnd(state.stones)
    state.scores[0][state.end] = r.team === 0 ? r.points : 0
    state.scores[1][state.end] = r.team === 1 ? r.points : 0
    endSummary = { end: state.end, scoringTeam: r.team, points: r.points, nearest: r.nearest }
    state.lastEnd = endSummary
    state.status = 'endScored'
    // 得分隊失去後手；空局保留
    if (r.team !== -1) state.hammer = 1 - r.team
  }
  return { state, spec, taps: usedTaps, stoneId: turn.stoneId, before, events, fgzViolation: fgz, endSummary }
}

/** 結算顯示完畢後進入下一局或結束比賽。 */
export function advanceEnd(state: MatchState): void {
  if (state.status !== 'endScored') return
  state.end += 1
  if (state.end >= state.totalEnds) {
    const a = totalScore(state, 0)
    const b = totalScore(state, 1)
    if (a === b && state.totalEnds < state.config.ends + MAX_EXTRA_ENDS) {
      state.totalEnds += 1
    } else {
      state.status = 'finished'
      state.winner = a === b ? -1 : a > b ? 0 : 1
      return
    }
  }
  state.k = 0
  state.stones = newEndStones(state.config)
  state.status = 'playing'
}
