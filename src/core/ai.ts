import { BEAT, SlideSim, solveThrow, type SimOptions } from './sim'
import { turnOf, simOptsOf, type GameState } from './game'
import { gridLineFor, gridOwnership, GRID_CELL, gridCellCenter, HOLES } from './variants'
import { FIVE_ROCK, inFreeGuardZone, scoreEnd } from './rules'
import { gaussian, type Rng } from './rng'
import { clamp, cloneStones, dist, SHEET, STONE_R, type Spin, type Stone, type ThrowSpec } from './types'

export type AiLevel = 'easy' | 'normal' | 'hard'

export interface AiChoice {
  spec: ThrowSpec
  taps: number[]
  /** 偵錯用：本次評估了幾個候選 */
  candidates: number
}

/** 各難度：執行誤差、搜尋範圍、是否規劃掃冰、是否預判對手回應。 */
export const AI_PROFILE: Record<AiLevel, { angleSigma: number; powerSigma: number; density: number; sweep: 'none' | 'sloppy' | 'plan'; lookahead: boolean; topPick: number }> = {
  easy: { angleSigma: 0.013, powerSigma: 0.055, density: 0.15, sweep: 'sloppy', lookahead: false, topPick: 6 },
  normal: { angleSigma: 0.005, powerSigma: 0.022, density: 0.5, sweep: 'plan', lookahead: false, topPick: 2 },
  hard: { angleSigma: 0.0012, powerSigma: 0.006, density: 1, sweep: 'plan', lookahead: true, topPick: 1 },
}

const solveCache = new Map<string, ThrowSpec>()
function solveCached(tx: number, ty: number, spin: Spin): ThrowSpec {
  const key = `${tx.toFixed(2)}|${ty.toFixed(2)}|${spin}`
  let v = solveCache.get(key)
  if (!v) {
    v = solveThrow(tx, ty, spin)
    solveCache.set(key, v)
  }
  return v
}

interface Ctx {
  g: GameState
  team: number
  stoneId: number
  stones: Stone[]
  opts: SimOptions
  k: number
}

type Scorer = (stones: readonly Stone[], team: number, k: number, extra: { sinkPoints: number }) => number

// ───────── 評分函式（站在 team 的角度）─────────

/**
 * 標準冰壺評分。依規則調整：
 * - 前 5 壺（五壺規則）守護壺不會被撞出場，價值較高；之後守護壺容易被擊出，價值降低。
 * - 有後手（最後一壺）的隊伍想保持中央空曠、靠最後一壺拿分，守護壺價值打折；
 *   沒有後手的隊伍則多放守護壺、阻擋對手的路線。
 */
function standardScorer(hammer: number): Scorer {
  return (stones, team, k) => {
    const r = scoreEnd(stones)
    let v = 0
    if (r.team !== -1) v += (r.team === team ? 1 : -1) * r.points * 10
    const guardW = (k <= FIVE_ROCK ? 1 : 0.35) * (hammer === team ? 0.7 : 1.2)
    for (const s of stones) {
      if (!s.inPlay) continue
      const sign = s.team === team ? 1 : -1
      const d = dist(s.x, s.y, 0, SHEET.teeY)
      if (d <= SHEET.houseR + STONE_R) v += sign * clamp(1.5 - d / SHEET.houseR, 0, 1.5) * 2
      else if (inFreeGuardZone(s)) v += sign * (Math.abs(s.x) < 1.1 ? 1.1 : 0.4) * guardW
    }
    return v
  }
}

const evalGrid: Scorer = (stones, team) => {
  const cells = gridOwnership(stones)
  const opp = 1 - team
  if (gridLineFor(cells, team) && !gridLineFor(cells, opp)) return 1000
  if (gridLineFor(cells, opp) && !gridLineFor(cells, team)) return -1000
  let v = 0
  v += (cells.filter((c) => c === team).length - cells.filter((c) => c === opp).length) * 3
  for (const l of [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]) {
    const mine = l.filter((i) => cells[i] === team).length
    const theirs = l.filter((i) => cells[i] === opp).length
    if (theirs === 0) v += mine * mine
    if (mine === 0) v -= theirs * theirs * 1.3
  }
  return v
}

const evalHole: Scorer = (_s, _t, _k, extra) => extra.sinkPoints

function scorerFor(g: GameState): Scorer {
  if (g.kind === 'grid') return evalGrid
  if (g.kind === 'hole') return evalHole
  return standardScorer('hammer' in g ? g.hammer : -1)
}

// ───────── 候選產生 ─────────

function drawCandidates(ctx: Ctx, density: number): ThrowSpec[] {
  const out: ThrowSpec[] = []
  const spins: Spin[] = [1, -1]
  const add = (x: number, y: number) => {
    for (const sp of spins) out.push(solveCached(x, y, sp))
  }
  const g = ctx.g
  if (g.kind === 'standard') {
    const step = density >= 1 ? 0.35 : density >= 0.5 ? 0.7 : 1.4
    for (let x = -1.4; x <= 1.401; x += step) {
      for (const y of [SHEET.teeY + 1, SHEET.teeY, SHEET.teeY - 1.2, SHEET.teeY - 2.4]) add(x, y)
    }
    for (const y of [11, 12.2, 13.5]) for (const x of density >= 1 ? [-1, -0.5, 0, 0.5, 1] : [-0.8, 0, 0.8]) add(x, y)
  } else if (g.kind === 'grid') {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const p = gridCellCenter(r, c)
      add(p.x, p.y)
      if (density >= 1) {
        add(p.x + 0.12, p.y)
        add(p.x - 0.12, p.y)
      }
    }
  } else if (g.kind === 'hole') {
    for (const h of HOLES) {
      add(h.x, h.y)
      if (density >= 0.5) {
        add(h.x, h.y - 0.15)
        add(h.x + 0.1, h.y)
        add(h.x - 0.1, h.y)
      }
    }
  } else {
    add(0, SHEET.teeY)
  }
  return out
}

function takeoutCandidates(ctx: Ctx, density: number): ThrowSpec[] {
  const out: ThrowSpec[] = []
  const targets = ctx.stones.filter((s) => s.inPlay && s.team !== ctx.team && s.y > SHEET.hogY - 0.5)
  const deltas = density >= 1 ? [-0.02, -0.015, -0.01, -0.005, 0, 0.005, 0.01, 0.015, 0.02] : density >= 0.5 ? [-0.012, 0, 0.012] : [0]
  const powers = density >= 1 ? [0.72, 0.85, 0.95, 1] : [0.85]
  for (const t of targets.slice(0, density >= 1 ? 5 : 3)) {
    const base = Math.atan2(t.x, t.y)
    for (const d of deltas) for (const p of powers) for (const sp of [1, -1] as Spin[]) out.push({ angle: base + d, power: p, spin: sp })
  }
  return out
}

function runOutcome(ctx: Ctx, spec: ThrowSpec, taps: readonly number[]): { stones: Stone[]; sink: number; time: number } {
  const sim = new SlideSim(ctx.stones, ctx.stoneId, spec, ctx.opts).runToEnd(taps)
  // 五壺規則：前 5 壺把對手守護區的壺撞出場即違規，本壺被移除、場面還原（與 throwStone 一致）
  if (ctx.g.kind === 'standard' && ctx.g.config.freeGuard && ctx.k < FIVE_ROCK) {
    const violated = ctx.stones.some((prev) => prev.team !== ctx.team && prev.inPlay && inFreeGuardZone(prev) && !sim.stones.find((x) => x.id === prev.id)!.inPlay)
    if (violated) {
      const restored = cloneStones(ctx.stones)
      const me = restored.find((x) => x.id === ctx.stoneId)!
      me.inPlay = false
      me.thrown = true
      me.vx = me.vy = 0
      return { stones: restored, sink: 0, time: sim.t }
    }
  }
  let sink = 0
  for (const e of sim.events) if (e.type === 'sink') sink += e.points
  return { stones: sim.stones, sink, time: sim.t }
}

function beatTaps(from: number, to: number): number[] {
  const out: number[] = []
  const start = Math.ceil(from / BEAT) * BEAT
  for (let t = start; t < to; t += BEAT) out.push(Number(t.toFixed(4)))
  return out
}

/** 對手最佳回應後的局面價值（站在 team 的角度），困難 AI 的一步預判。 */
function valueAfterReply(ctx: Ctx, stonesAfter: Stone[], score: Scorer): number {
  const g = ctx.g
  if (g.kind !== 'standard' && g.kind !== 'grid') return score(stonesAfter, ctx.team, ctx.k + 1, { sinkPoints: 0 })
  const nextK = ctx.k + 1
  const limit = g.kind === 'standard' ? g.config.stonesPerTeam * 2 : g.config.stonesPerTeam * 2
  if (nextK >= limit) return score(stonesAfter, ctx.team, nextK, { sinkPoints: 0 })
  const oppTeam = 1 - ctx.team
  const nextStone = stonesAfter.find((s) => s.team === oppTeam && !s.thrown)
  if (!nextStone) return score(stonesAfter, ctx.team, nextK, { sinkPoints: 0 })
  const oppCtx: Ctx = { ...ctx, team: oppTeam, stoneId: nextStone.id, stones: stonesAfter, k: nextK }
  const replies = [...drawCandidates(oppCtx, 0.5), ...takeoutCandidates(oppCtx, 0.5)]
  let worst = Infinity
  for (const sp of replies) {
    const r = runOutcome(oppCtx, sp, [])
    const v = score(r.stones, ctx.team, nextK + 1, { sinkPoints: 0 })
    if (v < worst) worst = v
  }
  return worst === Infinity ? score(stonesAfter, ctx.team, nextK, { sinkPoints: 0 }) : worst
}

export function chooseThrow(g: GameState, level: AiLevel, rng: Rng): AiChoice {
  const turn = turnOf(g)
  if (!turn) throw new Error('not AI turn')
  const prof = AI_PROFILE[level]
  const score = scorerFor(g)
  const k = 'k' in g ? g.k : 0
  const ctx: Ctx = { g, team: turn.team, stoneId: turn.stoneId, stones: g.stones, opts: simOptsOf(g), k }
  const cands = [...drawCandidates(ctx, prof.density), ...takeoutCandidates(ctx, prof.density)]
  const scored = cands.map((spec) => {
    const r = runOutcome(ctx, spec, [])
    let v = score(r.stones, ctx.team, k + 1, { sinkPoints: r.sink })
    // 冰洞：自己得分已在 sink；其他模式略微偏好穩定的力道（避免出界）
    v += (spec.power > 0.97 ? -0.2 : 0)
    return { spec, v, time: r.time, stones: r.stones }
  })
  scored.sort((a, b) => b.v - a.v)
  let pool = scored.slice(0, Math.max(1, prof.topPick))
  if (prof.lookahead) {
    pool = pool.slice(0, 5).map((c) => ({ ...c, v: valueAfterReply(ctx, c.stones, score) + c.v * 0.05 }))
    pool.sort((a, b) => b.v - a.v)
  }
  const pickIdx = prof.topPick > 1 ? Math.floor(rng() * pool.length) : 0
  const chosen = pool[pickIdx] ?? scored[0]

  // 掃冰規劃
  let taps: number[] = []
  if (prof.sweep === 'plan') {
    const plans = [[], beatTaps(0, chosen.time + 1), beatTaps(chosen.time * 0.5, chosen.time + 1), beatTaps(0, chosen.time * 0.5)]
    let bestV = -Infinity
    for (const p of plans) {
      const r = runOutcome(ctx, chosen.spec, p)
      const v = score(r.stones, ctx.team, k + 1, { sinkPoints: r.sink }) - (p.length ? 0.001 : 0)
      if (v > bestV + 1e-9) {
        bestV = v
        taps = p
      }
    }
  } else if (prof.sweep === 'sloppy' && rng() < 0.35) {
    const start = rng() * chosen.time * 0.6
    for (let i = 0; i < 6; i++) taps.push(Number((start + i * (0.3 + rng() * 0.5)).toFixed(3)))
  }

  const spec: ThrowSpec = {
    angle: chosen.spec.angle + gaussian(rng) * prof.angleSigma,
    power: clamp(chosen.spec.power + gaussian(rng) * prof.powerSigma, 0, 1),
    spin: chosen.spec.spin,
  }
  return { spec, taps, candidates: cands.length }
}

export { GRID_CELL }
