import {
  createGrid, createHole, DEFAULT_GRID, DEFAULT_HOLE, gridAdvance, gridSimOpts, gridThrow, gridTurn, holeAdvance, holeSimOpts, holeThrow, holeTurn,
  type GridConfig, type GridState, type HoleConfig, type HoleState,
} from './variants'
import { createMission, missionThrow, type MissionState } from './missions'
import { advanceEnd, createMatch, currentTurn, DEFAULT_CONFIG, throwStone, type MatchConfig, type MatchState } from './rules'
import type { SimOptions } from './sim'
import type { SimEvent, Stone, ThrowSpec } from './types'
import { cloneStones } from './types'

export type GameKind = 'standard' | 'grid' | 'hole' | 'mission'
export type GameState = MatchState | GridState | HoleState | MissionState

export interface GameSetup {
  kind: GameKind
  standard?: Partial<MatchConfig>
  grid?: Partial<GridConfig>
  hole?: Partial<HoleConfig>
  missionId?: number
  /** 每位玩家人數（1 或 2），套用到所有雙方對戰模式 */
  playersPerTeam?: 1 | 2 | 3 | 4
  timerSec?: number
}

export interface TurnInfo {
  team: number
  player: number
  stoneId: number
  n: number
}

export interface ThrowRecord {
  stoneId: number
  team: number
  spec: ThrowSpec
  taps: number[]
  /** 投壺前的場面（重播起點） */
  before: Stone[]
  events: SimEvent[]
  /** 投壺後的場面（權威結果，重播結束後以此為準） */
  after: Stone[]
  fgzViolation: boolean
  /** 這一顆造成本局／本回合結算 */
  roundOver: boolean
}

export function createGame(setup: GameSetup): GameState {
  const ppt = setup.playersPerTeam ?? 1
  switch (setup.kind) {
    case 'standard':
      return createMatch({ ...DEFAULT_CONFIG, playersPerTeam: ppt, ...(setup.timerSec !== undefined ? { timerSec: setup.timerSec } : {}), ...setup.standard })
    case 'grid':
      return createGrid({ ...DEFAULT_GRID, playersPerTeam: ppt, ...(setup.timerSec !== undefined ? { timerSec: setup.timerSec } : {}), ...setup.grid })
    case 'hole':
      return createHole({ ...DEFAULT_HOLE, playersPerTeam: ppt, ...(setup.timerSec !== undefined ? { timerSec: setup.timerSec } : {}), ...setup.hole })
    case 'mission':
      return createMission(setup.missionId ?? 1)
  }
}

export function turnOf(g: GameState): TurnInfo | null {
  if (g.status !== 'playing') return null
  switch (g.kind) {
    case 'standard':
      return currentTurn(g)
    case 'grid':
      return gridTurn(g)
    case 'hole':
      return holeTurn(g)
    case 'mission':
      return { team: 0, player: 0, stoneId: g.k, n: g.k }
  }
}

export function simOptsOf(g: GameState): SimOptions {
  switch (g.kind) {
    case 'grid':
      return gridSimOpts()
    case 'hole':
      return holeSimOpts()
    default:
      return {}
  }
}

export function timerSecOf(g: GameState): number {
  if (g.kind === 'mission') return 0
  return g.config.timerSec
}

export function playersPerTeamOf(g: GameState): number {
  return g.kind === 'mission' ? 1 : g.config.playersPerTeam
}

export function teamCountOf(g: GameState): number {
  return g.kind === 'mission' ? 1 : 2
}

export function playThrow(g: GameState, spec: ThrowSpec, taps: readonly number[] = []): ThrowRecord {
  const turn = turnOf(g)
  if (!turn) throw new Error('game is not accepting throws')
  const team = turn.team
  switch (g.kind) {
    case 'standard': {
      const r = throwStone(g, spec, taps)
      return { stoneId: r.stoneId, team, spec, taps: r.taps, before: r.before, events: r.events, after: cloneStones(g.stones), fgzViolation: r.fgzViolation, roundOver: r.endSummary !== null }
    }
    case 'grid': {
      const r = gridThrow(g, spec, taps)
      return { stoneId: r.stoneId, team, spec, taps: r.taps, before: r.before, events: r.events, after: cloneStones(g.stones), fgzViolation: false, roundOver: g.status !== 'playing' }
    }
    case 'hole': {
      const r = holeThrow(g, spec, taps)
      return { stoneId: r.stoneId, team, spec, taps: r.taps, before: r.before, events: r.events, after: cloneStones(g.stones), fgzViolation: false, roundOver: g.status !== 'playing' }
    }
    case 'mission': {
      const r = missionThrow(g, spec, taps)
      return { stoneId: r.stoneId, team, spec, taps: r.taps, before: r.before, events: r.events, after: cloneStones(g.stones), fgzViolation: false, roundOver: g.status !== 'playing' }
    }
  }
}

/** 本局／本回合結算畫面看完後，進入下一局或終局。 */
export function advanceGame(g: GameState): void {
  if (g.kind === 'standard') advanceEnd(g)
  else if (g.kind === 'grid') gridAdvance(g)
  else if (g.kind === 'hole') holeAdvance(g)
}

export function isRoundScored(g: GameState): boolean {
  return g.status === 'endScored'
}

export function isFinished(g: GameState): boolean {
  return g.status === 'finished'
}

export function scoreLines(g: GameState): { label: string; values: number[] } {
  switch (g.kind) {
    case 'standard':
      return { label: 'ends', values: [g.scores[0].reduce((a, b) => a + b, 0), g.scores[1].reduce((a, b) => a + b, 0)] }
    case 'grid':
      return { label: 'wins', values: g.wins.slice() }
    case 'hole':
      return { label: 'points', values: g.scores.slice() }
    case 'mission':
      return { label: 'stars', values: [g.stars] }
  }
}

/** 還剩幾壺（每隊） */
export function stonesLeft(g: GameState, team: number): number {
  return g.stones.filter((s) => s.team === team && !s.thrown).length
}
