import { SlideSim, type Hole, type SimOptions } from './sim'
import { cloneStones, dist, SHEET, STONE_R, type SimEvent, type Stone, type ThrowSpec } from './types'

// ───────────────────────── 九宮連線 ─────────────────────────

export const GRID_CELL = 0.9
export const GRID_CENTER = { x: 0, y: SHEET.teeY }

export function gridCellCenter(row: number, col: number): { x: number; y: number } {
  return { x: (col - 1) * GRID_CELL + GRID_CENTER.x, y: (row - 1) * GRID_CELL + GRID_CENTER.y }
}

export interface GridConfig {
  stonesPerTeam: number
  /** 局數（先贏過半者勝） */
  rounds: number
  playersPerTeam: 1 | 2 | 3 | 4
  timerSec: number
}

export const DEFAULT_GRID: GridConfig = { stonesPerTeam: 5, rounds: 3, playersPerTeam: 1, timerSec: 45 }

export interface GridState {
  kind: 'grid'
  config: GridConfig
  round: number
  k: number
  firstTeam: number
  wins: number[]
  stones: Stone[]
  /** 九宮格目前持有者，-1 為空 */
  cells: number[]
  status: 'playing' | 'endScored' | 'finished'
  lastRound: { winner: number; line: number[] | null } | null
  winner: number
}

export const LINES: number[][] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]

export function gridOwnership(stones: readonly Stone[]): number[] {
  const cells: number[] = Array(9).fill(-1)
  const best: number[] = Array(9).fill(Infinity)
  for (const s of stones) {
    if (!s.inPlay) continue
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const ctr = gridCellCenter(r, c)
        // 半開區間：壺心剛好落在格線上時只算進一格，不會同時占到相鄰的格
        const dx = s.x - ctr.x
        const dy = s.y - ctr.y
        const h = GRID_CELL / 2
        if (dx >= -h && dx < h && dy >= -h && dy < h) {
          const d = dist(s.x, s.y, ctr.x, ctr.y)
          const i = r * 3 + c
          if (d < best[i]) {
            best[i] = d
            cells[i] = s.team
          }
        }
      }
    }
  }
  return cells
}

export function gridLineFor(cells: readonly number[], team: number): number[] | null {
  for (const l of LINES) if (l.every((i) => cells[i] === team)) return l
  return null
}

function newGridStones(cfg: GridConfig): Stone[] {
  const out: Stone[] = []
  for (let team = 0; team < 2; team++) {
    for (let n = 0; n < cfg.stonesPerTeam; n++) out.push({ id: team * cfg.stonesPerTeam + n, team, x: 0, y: -2, vx: 0, vy: 0, spin: 1, inPlay: false, thrown: false })
  }
  return out
}

export function createGrid(config: GridConfig = DEFAULT_GRID): GridState {
  return {
    kind: 'grid',
    config,
    round: 0,
    k: 0,
    firstTeam: 0,
    wins: [0, 0],
    stones: newGridStones(config),
    cells: Array(9).fill(-1),
    status: 'playing',
    lastRound: null,
    winner: -1,
  }
}

export function gridSimOpts(): SimOptions {
  return { noHog: true }
}

export function gridTurn(g: GridState): { team: number; player: number; stoneId: number; n: number } {
  const team = g.k % 2 === 0 ? g.firstTeam : 1 - g.firstTeam
  const n = Math.floor(g.k / 2)
  const N = g.config.stonesPerTeam
  const player = Math.min(g.config.playersPerTeam - 1, Math.floor((n * g.config.playersPerTeam) / N))
  return { team, player, stoneId: team * N + n, n }
}

export function gridThrow(g: GridState, spec: ThrowSpec, taps: readonly number[]): { events: SimEvent[]; before: Stone[]; stoneId: number; taps: number[] } {
  const turn = gridTurn(g)
  const before = cloneStones(g.stones)
  const sim = new SlideSim(g.stones, turn.stoneId, spec, gridSimOpts()).runToEnd(taps)
  g.stones = sim.stones
  g.k += 1
  g.cells = gridOwnership(g.stones)
  const a = gridLineFor(g.cells, 0)
  const b = gridLineFor(g.cells, 1)
  let winner: number | null = null
  let line: number[] | null = null
  if (a && !b) {
    winner = 0
    line = a
  } else if (b && !a) {
    winner = 1
    line = b
  } else if (a && b) {
    winner = -1
  } else if (g.k >= g.config.stonesPerTeam * 2) {
    const ca = g.cells.filter((c) => c === 0).length
    const cb = g.cells.filter((c) => c === 1).length
    winner = ca === cb ? -1 : ca > cb ? 0 : 1
  }
  if (winner !== null) {
    if (winner >= 0) g.wins[winner] += 1
    g.lastRound = { winner, line }
    g.status = 'endScored'
  }
  return { events: sim.events, before, stoneId: turn.stoneId, taps: sim.taps.slice() }
}

export function gridAdvance(g: GridState): void {
  if (g.status !== 'endScored') return
  g.round += 1
  const need = Math.floor(g.config.rounds / 2) + 1
  const maxRounds = g.config.rounds + 2
  if (g.wins[0] >= need || g.wins[1] >= need || g.round >= g.config.rounds) {
    if (g.wins[0] === g.wins[1] && g.round < maxRounds) {
      // 平手加賽
    } else {
      g.status = 'finished'
      g.winner = g.wins[0] === g.wins[1] ? -1 : g.wins[0] > g.wins[1] ? 0 : 1
      return
    }
  }
  g.k = 0
  g.firstTeam = 1 - g.firstTeam
  g.stones = newGridStones(g.config)
  g.cells = Array(9).fill(-1)
  g.status = 'playing'
}

// ───────────────────────── 冰洞挑戰 ─────────────────────────

export const HOLE_BACK_Y = SHEET.teeY + 3.4
export const HOLES: Hole[] = [
  { x: -1.1, y: 12.4, r: 0.6, points: 10, maxSpeed: 2.3 },
  { x: 1.05, y: 14.6, r: 0.48, points: 20, maxSpeed: 2.1 },
  { x: -0.85, y: 16.4, r: 0.4, points: 40, maxSpeed: 1.9 },
  { x: 0.75, y: 18.4, r: 0.32, points: 50, maxSpeed: 1.7 },
]

export interface HoleConfig {
  stonesPerTeam: number
  playersPerTeam: 1 | 2 | 3 | 4
  /** 局數：每局先手輪替 */
  rounds: number
  timerSec: number
}

export const DEFAULT_HOLE: HoleConfig = { stonesPerTeam: 6, playersPerTeam: 1, rounds: 2, timerSec: 45 }

export interface HoleState {
  kind: 'hole'
  config: HoleConfig
  round: number
  k: number
  firstTeam: number
  /** scores[team] 累計 */
  scores: number[]
  stones: Stone[]
  status: 'playing' | 'endScored' | 'finished'
  lastSink: { team: number; points: number } | null
  winner: number
}

export function holeSimOpts(): SimOptions {
  return { noHog: true, walls: { backY: HOLE_BACK_Y, restitution: 0.55 }, holes: HOLES }
}

function newHoleStones(cfg: HoleConfig): Stone[] {
  const out: Stone[] = []
  for (let team = 0; team < 2; team++) {
    for (let n = 0; n < cfg.stonesPerTeam; n++) out.push({ id: team * cfg.stonesPerTeam + n, team, x: 0, y: -2, vx: 0, vy: 0, spin: 1, inPlay: false, thrown: false })
  }
  return out
}

export function createHole(config: HoleConfig = DEFAULT_HOLE): HoleState {
  return { kind: 'hole', config, round: 0, k: 0, firstTeam: 0, scores: [0, 0], stones: newHoleStones(config), status: 'playing', lastSink: null, winner: -1 }
}

export function holeTurn(g: HoleState): { team: number; player: number; stoneId: number; n: number } {
  const team = g.k % 2 === 0 ? g.firstTeam : 1 - g.firstTeam
  const n = Math.floor(g.k / 2)
  const N = g.config.stonesPerTeam
  const player = Math.min(g.config.playersPerTeam - 1, Math.floor((n * g.config.playersPerTeam) / N))
  return { team, player, stoneId: team * N + n, n }
}

export function holeThrow(g: HoleState, spec: ThrowSpec, taps: readonly number[]): { events: SimEvent[]; before: Stone[]; stoneId: number; taps: number[] } {
  const turn = holeTurn(g)
  const before = cloneStones(g.stones)
  const sim = new SlideSim(g.stones, turn.stoneId, spec, holeSimOpts()).runToEnd(taps)
  g.stones = sim.stones
  g.k += 1
  g.lastSink = null
  for (const e of sim.events) {
    if (e.type === 'sink') {
      g.scores[turn.team] += e.points
      g.lastSink = { team: turn.team, points: e.points }
    }
  }
  if (g.k >= g.config.stonesPerTeam * 2) g.status = 'endScored'
  return { events: sim.events, before, stoneId: turn.stoneId, taps: sim.taps.slice() }
}

export function holeAdvance(g: HoleState): void {
  if (g.status !== 'endScored') return
  g.round += 1
  if (g.round >= g.config.rounds) {
    g.status = 'finished'
    g.winner = g.scores[0] === g.scores[1] ? -1 : g.scores[0] > g.scores[1] ? 0 : 1
    return
  }
  g.k = 0
  g.firstTeam = 1 - g.firstTeam
  g.stones = newHoleStones(g.config)
  g.status = 'playing'
}

// 方便 UI 判斷「這顆壺是否算進場內」
export function stoneInHouse(s: Stone): boolean {
  return s.inPlay && dist(s.x, s.y, 0, SHEET.teeY) <= SHEET.houseR + STONE_R
}
