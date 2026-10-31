import { clamp, cloneStones, dist, SHEET, STONE_R, type SimEvent, type Spin, type Stone, type ThrowSpec } from './types'

/** 固定時間步長（確定性的關鍵）。 */
export const DT = 1 / 120

const A0 = 0.3 // 基礎摩擦減速度 m/s²
const SWEEP_FRICTION = 0.3 // 完美掃冰最多減少的摩擦比例
const CURL_K = 0.055 // 旋轉造成的側向加速度
const CURL_SWEEP = 0.45 // 掃冰減少的彎度比例
const V_STOP = 0.03
const RESTITUTION = 0.7 // 較低：正面撞擊後自己的壺會再滑一段，不會「黏」在原位
/** 力道超過此值開始出現出手誤差（越大力越難控制） */
export const WILD_POWER = 0.75
const WILD_ANGLE = 0.008 // 滿力道時的最大方向誤差（弧度）
const MAX_TIME = 45

/** 掃冰：每次點擊持續 TAP_LEN 秒；一直點（或按住）就一直有效，不看時機。BEAT 只給 AI 規劃連續掃冰用。 */
export const BEAT = 0.4
export const TAP_LEN = 0.5
export const TAP_MIN_GAP = 0.12
export const MAX_TAPS = 400

/** 大力道的出手誤差：由出手參數決定的固定值（伺服器與客戶端結果一致），範圍 -1..1。 */
export function wildJitter(spec: ThrowSpec, id: number): number {
  let h = (Math.round(spec.angle * 1e5) * 73856093) ^ (Math.round(spec.power * 1e4) * 19349663) ^ ((spec.spin * 31 + 7) * 83492791) ^ (id * 2654435761)
  h = Math.imul(h ^ (h >>> 15), 2246822519)
  h = Math.imul(h ^ (h >>> 13), 3266489917)
  h ^= h >>> 16
  return ((h >>> 0) / 4294967295) * 2 - 1
}

export function wildAngleError(spec: ThrowSpec, id: number): number {
  const over = Math.max(0, (clamp(spec.power, 0, 1) - WILD_POWER) / (1 - WILD_POWER))
  return over === 0 ? 0 : wildJitter(spec, id) * WILD_ANGLE * over * over
}

export function powerToSpeed(p: number): number {
  const q = clamp(p, 0, 1)
  return 1.6 + 1.5 * q + 3.4 * q * q
}

/** 掃冰點擊品質：不看時機，每次點擊都是完整效果。 */
export function tapQuality(_t: number): number {
  return 1
}

/** 伺服器與客戶端共用：清理點擊清單，避免亂填。 */
export function sanitizeTaps(taps: readonly number[] | undefined): number[] {
  if (!taps) return []
  const list = taps.filter((t) => Number.isFinite(t) && t >= 0 && t <= MAX_TIME).sort((a, b) => a - b)
  const out: number[] = []
  for (const t of list) {
    if (out.length >= MAX_TAPS) break
    if (out.length === 0 || t - out[out.length - 1] >= TAP_MIN_GAP) out.push(t)
  }
  return out
}

export function sweepStrength(taps: readonly number[], t: number): number {
  let s = 0
  for (let i = 0; i < taps.length; i++) {
    const tp = taps[i]
    if (tp > t) break
    if (t < tp + TAP_LEN) {
      const q = tapQuality(tp)
      if (q > s) s = q
    }
  }
  return s
}

export interface Hole {
  x: number
  y: number
  r: number
  points: number
  maxSpeed: number
}

export interface SimOptions {
  /** 變體：四周有牆會反彈（冰洞挑戰）。 */
  walls?: { backY: number; restitution: number }
  holes?: Hole[]
  /** 九宮與冰洞不套用 hog line 規則。 */
  noHog?: boolean
  /** 預測用：不套用大力道的出手誤差 */
  noWild?: boolean
}

/** 單一壺的滑行模擬。可逐步前進（畫面播放用）或一次算到結束（伺服器／AI 用）。 */
export class SlideSim {
  stones: Stone[]
  active: Stone
  t = 0
  taps: number[] = []
  events: SimEvent[] = []
  done = false
  private passedHog = false
  private touched = false
  private opts: SimOptions

  constructor(stones: readonly Stone[], activeId: number, spec: ThrowSpec, opts: SimOptions = {}) {
    this.stones = cloneStones(stones)
    this.opts = opts
    const st = this.stones.find((s) => s.id === activeId)
    if (!st) throw new Error(`stone ${activeId} not found`)
    this.active = st
    const v = powerToSpeed(spec.power)
    st.x = 0
    st.y = SHEET.releaseY
    const ang = opts.noWild ? spec.angle : spec.angle + wildAngleError(spec, activeId)
    st.vx = v * Math.sin(ang)
    st.vy = v * Math.cos(ang)
    st.spin = spec.spin
    st.inPlay = true
    st.thrown = true
  }

  /** 即時加入一次掃冰點擊（目前時間）。回傳這次點擊的品質。 */
  tap(): number {
    const last = this.taps[this.taps.length - 1]
    if (last !== undefined && this.t - last < TAP_MIN_GAP) return 0
    if (this.taps.length >= MAX_TAPS) return 0
    this.taps.push(this.t)
    return tapQuality(this.t)
  }

  setTaps(taps: readonly number[]): void {
    this.taps = sanitizeTaps(taps)
  }

  sweepNow(): number {
    return this.done ? 0 : sweepStrength(this.taps, this.t)
  }

  private anyMoving(): boolean {
    for (const s of this.stones) if (s.inPlay && (s.vx !== 0 || s.vy !== 0)) return true
    return false
  }

  step(dt: number = DT): void {
    if (this.done) return
    const { stones } = this
    const opts = this.opts
    for (const s of stones) {
      if (!s.inPlay) continue
      const sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy)
      if (sp === 0) continue
      if (sp < V_STOP) {
        s.vx = 0
        s.vy = 0
        this.events.push({ type: 'stop', t: this.t, id: s.id })
        continue
      }
      const sw = s === this.active ? sweepStrength(this.taps, this.t) : 0
      const a = A0 * (1 - SWEEP_FRICTION * sw)
      const nsp = Math.max(0, sp - a * dt)
      const dx = s.vx / sp
      const dy = s.vy / sp
      let nvx = dx * nsp
      let nvy = dy * nsp
      if (s === this.active) {
        const lat = s.spin * CURL_K * clamp(1 - sp / 4.5, 0.08, 1) * (1 - CURL_SWEEP * sw)
        nvx += dy * lat * dt
        nvy += -dx * lat * dt
        const m = Math.sqrt(nvx * nvx + nvy * nvy)
        if (m > 0) {
          nvx = (nvx / m) * nsp
          nvy = (nvy / m) * nsp
        }
      }
      s.vx = nvx
      s.vy = nvy
      s.x += s.vx * dt
      s.y += s.vy * dt
    }
    this.t += dt

    // 碰撞
    const n = stones.length
    for (let i = 0; i < n; i++) {
      const a = stones[i]
      if (!a.inPlay) continue
      for (let j = i + 1; j < n; j++) {
        const b = stones[j]
        if (!b.inPlay) continue
        if (a.vx === 0 && a.vy === 0 && b.vx === 0 && b.vy === 0) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d2 = dx * dx + dy * dy
        const min = 2 * STONE_R
        if (d2 >= min * min) continue
        const d = Math.sqrt(d2) || 1e-6
        const nx = dx / d
        const ny = dy / d
        const va = a.vx * nx + a.vy * ny
        const vb = b.vx * nx + b.vy * ny
        const rel = va - vb
        if (rel > 0) {
          const j2 = ((1 + RESTITUTION) / 2) * rel
          a.vx -= j2 * nx
          a.vy -= j2 * ny
          b.vx += j2 * nx
          b.vy += j2 * ny
          this.events.push({ type: 'hit', t: this.t, a: a.id, b: b.id, speed: rel, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
          if (a === this.active || b === this.active) this.touched = true
        }
        const push = (min - d) / 2 + 1e-6
        a.x -= nx * push
        a.y -= ny * push
        b.x += nx * push
        b.y += ny * push
      }
    }

    // 邊界、牆、冰洞、hog
    const hw = SHEET.halfWidth
    for (const s of stones) {
      if (!s.inPlay) continue
      if (s === this.active && s.y - STONE_R >= SHEET.hogY) this.passedHog = true
      if (opts.walls) {
        const lim = hw - STONE_R
        if (s.x > lim) {
          s.x = lim
          s.vx = -Math.abs(s.vx) * opts.walls.restitution
        } else if (s.x < -lim) {
          s.x = -lim
          s.vx = Math.abs(s.vx) * opts.walls.restitution
        }
        const by = opts.walls.backY - STONE_R
        if (s.y > by) {
          s.y = by
          s.vy = -Math.abs(s.vy) * opts.walls.restitution
        }
        if (s.y < STONE_R && s.vy < 0) {
          s.y = STONE_R
          s.vy = Math.abs(s.vy) * opts.walls.restitution
        }
      } else {
        if (Math.abs(s.x) + STONE_R > hw) {
          this.out(s, 'side')
          continue
        }
        if (s.y - STONE_R > SHEET.backY) {
          this.out(s, 'back')
          continue
        }
        if (s.y < -1 && (s.vx !== 0 || s.vy !== 0)) {
          this.out(s, 'back')
          continue
        }
      }
      if (opts.holes) {
        for (let h = 0; h < opts.holes.length; h++) {
          const hole = opts.holes[h]
          const sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy)
          if (dist(s.x, s.y, hole.x, hole.y) < hole.r * 0.8 && sp < hole.maxSpeed) {
            s.inPlay = false
            s.vx = 0
            s.vy = 0
            s.x = hole.x
            s.y = hole.y
            this.events.push({ type: 'sink', t: this.t, id: s.id, hole: h, points: hole.points })
            break
          }
        }
      }
    }

    if (!this.anyMoving() || this.t >= MAX_TIME) this.finish()
  }

  private out(s: Stone, reason: 'side' | 'back' | 'hog' | 'wall'): void {
    s.inPlay = false
    s.vx = 0
    s.vy = 0
    this.events.push({ type: 'out', t: this.t, id: s.id, reason })
  }

  private finish(): void {
    if (this.done) return
    this.done = true
    for (const s of this.stones) {
      if (s.inPlay) {
        s.vx = 0
        s.vy = 0
      }
    }
    if (!this.opts.noHog && this.active.inPlay && !this.passedHog && !this.touched) {
      this.out(this.active, 'hog')
    }
  }

  runToEnd(taps: readonly number[] = []): this {
    this.setTaps(taps)
    let guard = 0
    while (!this.done && guard++ < 200000) this.step()
    return this
  }
}

/** 空冰面預測（不含掃冰）：畫面用來顯示預估停點與路徑。 */
export function predictPath(spec: ThrowSpec, sampleEvery = 6): { path: { x: number; y: number }[]; stop: { x: number; y: number }; time: number } {
  const blank: Stone = { id: 0, team: 0, x: 0, y: 0, vx: 0, vy: 0, spin: spec.spin, inPlay: true, thrown: false }
  const sim = new SlideSim([blank], 0, spec, { noHog: true, noWild: true })
  const path: { x: number; y: number }[] = [{ x: sim.active.x, y: sim.active.y }]
  let i = 0
  while (!sim.done && i < 100000) {
    sim.step()
    i++
    if (i % sampleEvery === 0) path.push({ x: sim.active.x, y: sim.active.y })
  }
  path.push({ x: sim.active.x, y: sim.active.y })
  return { path, stop: { x: sim.active.x, y: sim.active.y }, time: sim.t }
}

/** 解出「停在指定距離」的力道（二分搜尋，不含掃冰）。 */
export function solvePowerForY(targetY: number, angle: number, spin: Spin): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2
    const r = predictPath({ angle, power: mid, spin }, 1000)
    if (r.stop.y < targetY) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** 給定目標停點，解出方向與力道（不含掃冰、不含其他壺）。 */
export function solveThrow(tx: number, ty: number, spin: Spin): ThrowSpec {
  let angle = Math.atan2(tx, Math.max(ty, 1))
  let power = 0.5
  for (let i = 0; i < 8; i++) {
    power = solvePowerForY(ty, angle, spin)
    const r = predictPath({ angle, power, spin }, 1000)
    const err = tx - r.stop.x
    angle += Math.atan2(err, Math.max(r.stop.y, 1)) * 0.9
    if (Math.abs(err) < 0.01) break
  }
  power = solvePowerForY(ty, angle, spin)
  return { angle, power, spin }
}
