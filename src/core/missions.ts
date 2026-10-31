import { SlideSim } from './sim'
import { cloneStones, dist, SHEET, type SimEvent, type Stone, type ThrowSpec } from './types'
import { inFreeGuardZone } from './rules'

export interface MissionDef {
  id: number
  /** 玩家可投幾壺 */
  stones: number
  /** 力道上限（掃冰任務用） */
  maxPower?: number
  /** 預先擺好的障礙壺（隊伍 1） */
  obstacles: { x: number; y: number }[]
  /** 回傳 0–3 顆星（3 金、2 銀、1 銅） */
  evaluate: (mine: Stone[], others: Stone[], initial: { x: number; y: number }[]) => number
}

const tee = SHEET.teeY
const d = (s: Stone) => dist(s.x, s.y, 0, tee)
const bestDist = (mine: Stone[]) => Math.min(Infinity, ...mine.filter((s) => s.inPlay).map(d))

export const MISSIONS: MissionDef[] = [
  {
    id: 1,
    stones: 3,
    obstacles: [],
    evaluate: (mine) => {
      const b = bestDist(mine)
      return b <= 0.61 ? 3 : b <= 1.22 ? 2 : b <= SHEET.houseR ? 1 : 0
    },
  },
  {
    id: 2,
    stones: 3,
    obstacles: [{ x: 0, y: 12.6 }],
    evaluate: (mine, others, init) => {
      const b = bestDist(mine)
      const moved = others.some((o, i) => dist(o.x, o.y, init[i].x, init[i].y) > 0.05 || !o.inPlay)
      if (b > SHEET.houseR) return 0
      if (moved) return 1
      return b <= 0.61 ? 3 : 2
    },
  },
  {
    id: 3,
    stones: 3,
    obstacles: [{ x: 0.3, y: 16.5 }],
    evaluate: (mine, others) => {
      const out = others.every((o) => !o.inPlay)
      if (!out) return 0
      const stay = mine.some((s) => s.inPlay && d(s) <= SHEET.houseR)
      const red = mine.some((s) => s.inPlay && d(s) <= 0.61)
      return red ? 3 : stay ? 2 : 1
    },
  },
  {
    id: 4,
    stones: 3,
    obstacles: [],
    evaluate: (mine) => {
      const g = mine.filter((s) => s.inPlay && inFreeGuardZone(s))
      if (g.length === 0) return 0
      const near = g.some((s) => Math.abs(s.x) <= 0.5 && s.y <= 13.2)
      const mid = g.some((s) => Math.abs(s.x) <= 0.9)
      return near ? 3 : mid ? 2 : 1
    },
  },
  {
    id: 5,
    stones: 3,
    maxPower: 0.4,
    obstacles: [],
    evaluate: (mine) => {
      const b = bestDist(mine)
      return b <= 0.61 ? 3 : b <= 1.22 ? 2 : b <= SHEET.houseR ? 1 : 0
    },
  },
  {
    id: 6,
    stones: 4,
    obstacles: [
      { x: 0, y: 12.6 },
      { x: 0.55, y: 14.3 },
    ],
    evaluate: (mine, others, init) => {
      const b = bestDist(mine)
      const moved = others.some((o, i) => dist(o.x, o.y, init[i].x, init[i].y) > 0.05 || !o.inPlay)
      if (b > SHEET.houseR || moved) return 0
      return b <= 0.61 ? 3 : b <= 1.22 ? 2 : 1
    },
  },
  {
    id: 7,
    stones: 4,
    obstacles: [
      { x: -0.7, y: 16.2 },
      { x: 0.8, y: 16.5 },
    ],
    evaluate: (mine, others) => {
      const outs = others.filter((o) => !o.inPlay).length
      if (outs === 0) return 0
      const stay = mine.some((s) => s.inPlay && d(s) <= SHEET.houseR)
      if (outs === 1) return 1
      return stay ? 3 : 2
    },
  },
]

export interface MissionState {
  kind: 'mission'
  missionId: number
  k: number
  stones: Stone[]
  initial: { x: number; y: number }[]
  status: 'playing' | 'finished'
  stars: number
  winner: number
}

export function createMission(missionId: number): MissionState {
  const def = MISSIONS.find((m) => m.id === missionId)!
  const stones: Stone[] = []
  for (let n = 0; n < def.stones; n++) stones.push({ id: n, team: 0, x: 0, y: -2, vx: 0, vy: 0, spin: 1, inPlay: false, thrown: false })
  def.obstacles.forEach((o, i) => stones.push({ id: 100 + i, team: 1, x: o.x, y: o.y, vx: 0, vy: 0, spin: 1, inPlay: true, thrown: true }))
  return { kind: 'mission', missionId, k: 0, stones, initial: def.obstacles.map((o) => ({ ...o })), status: 'playing', stars: 0, winner: -1 }
}

export function missionThrow(m: MissionState, spec: ThrowSpec, taps: readonly number[]): { events: SimEvent[]; before: Stone[]; stoneId: number; taps: number[] } {
  const def = MISSIONS.find((x) => x.id === m.missionId)!
  const before = cloneStones(m.stones)
  const stoneId = m.k
  const safe = { ...spec, power: Math.min(spec.power, def.maxPower ?? 1) }
  const sim = new SlideSim(m.stones, stoneId, safe, {}).runToEnd(taps)
  m.stones = sim.stones
  m.k += 1
  const mine = m.stones.filter((s) => s.team === 0)
  const others = m.stones.filter((s) => s.team === 1)
  const stars = def.evaluate(mine, others, m.initial)
  m.stars = Math.max(m.stars, stars)
  if (m.k >= def.stones || stars >= 3) {
    m.status = 'finished'
    m.winner = m.stars > 0 ? 0 : 1
  }
  return { events: sim.events, before, stoneId, taps: sim.taps.slice() }
}
