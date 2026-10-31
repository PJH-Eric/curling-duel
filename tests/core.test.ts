import { describe, expect, it } from 'vitest'
import {
  advanceEnd,
  createMatch,
  currentTurn,
  DEFAULT_CONFIG,
  newEndStones,
  predictPath,
  SHEET,
  scoreEnd,
  SlideSim,
  solveThrow,
  throwStone,
  sanitizeTaps,
  sweepStrength,
  type Stone,
} from '../src/core'

const blank = (): Stone[] => newEndStones(DEFAULT_CONFIG)

describe('滑行物理', () => {
  it('相同輸入得到完全相同結果（確定性）', () => {
    const spec = { angle: 0.01, power: 0.52, spin: 1 as const }
    const a = new SlideSim(blank(), 0, spec).runToEnd([1, 2, 3.1])
    const b = new SlideSim(blank(), 0, spec).runToEnd([1, 2, 3.1])
    expect(a.active.x).toBe(b.active.x)
    expect(a.active.y).toBe(b.active.y)
    expect(a.t).toBe(b.t)
  })

  it('順時針旋轉向右彎、逆時針向左彎', () => {
    const cw = predictPath({ angle: 0, power: 0.5, spin: 1 })
    const ccw = predictPath({ angle: 0, power: 0.5, spin: -1 })
    expect(cw.stop.x).toBeGreaterThan(0.3)
    expect(ccw.stop.x).toBeLessThan(-0.3)
    expect(cw.stop.x).toBeCloseTo(-ccw.stop.x, 6)
  })

  it('力道越大滑得越遠，約 0.5 力道可到大本營附近', () => {
    const lo = predictPath({ angle: 0, power: 0.3, spin: 1 }).stop.y
    const hi = predictPath({ angle: 0, power: 0.6, spin: 1 }).stop.y
    expect(hi).toBeGreaterThan(lo)
    const mid = predictPath({ angle: 0, power: 0.5, spin: 1 }).stop.y
    expect(Math.abs(mid - SHEET.teeY)).toBeLessThan(3)
  })

  it('完美掃冰讓壺滑得更遠，且彎度變小', () => {
    const spec = { angle: 0, power: 0.45, spin: 1 as const }
    const plain = new SlideSim(blank(), 0, spec).runToEnd([])
    const taps: number[] = []
    for (let t = 0; t < 14; t += 0.6) taps.push(t)
    const swept = new SlideSim(blank(), 0, spec).runToEnd(taps)
    expect(swept.active.y).toBeGreaterThan(plain.active.y + 0.5)
    expect(Math.abs(swept.active.x)).toBeLessThan(Math.abs(plain.active.x))
  })

  it('掃冰：不看時機，任何時間點擊都有完整效果，持續約 0.5 秒；連點不中斷；清理不合理的點擊', () => {
    expect(sweepStrength([0.6], 0.7)).toBe(1)
    expect(sweepStrength([0.3], 0.4)).toBe(1)
    expect(sweepStrength([0.3], 0.9)).toBe(0)
    expect(sweepStrength([0.3, 0.7, 1.1], 1.4)).toBe(1)
    expect(sanitizeTaps([1, 1.01, 1.05, NaN, -3, 99, 2]).length).toBe(2)
  })

  it('停在遠端 hog line 之前的壺被移出場外', () => {
    const sim = new SlideSim(blank(), 0, { angle: 0, power: 0.1, spin: 1 }).runToEnd()
    expect(sim.active.inPlay).toBe(false)
    expect(sim.events.some((e) => e.type === 'out' && e.reason === 'hog')).toBe(true)
  })

  it('超出 back line 的壺出界', () => {
    const sim = new SlideSim(blank(), 0, { angle: 0, power: 0.9, spin: 1 }).runToEnd()
    expect(sim.active.inPlay).toBe(false)
  })

  it('碰撞：高速擊出停在大本營的壺', () => {
    const stones = blank()
    stones[4].x = 0
    stones[4].y = SHEET.teeY
    stones[4].inPlay = true
    stones[4].thrown = true
    // 掃描一小段角度，找出能擊中目標的高速投壺（AI 也用同樣的方式找擊球）
    let best: SlideSim | null = null
    for (let a = -0.04; a <= 0.04; a += 0.002) {
      const sim = new SlideSim(stones, 0, { angle: a, power: 0.9, spin: 1 }).runToEnd()
      if (sim.events.some((e) => e.type === 'hit')) {
        best = sim
        break
      }
    }
    expect(best).not.toBeNull()
    const target = best!.stones.find((s) => s.id === 4)!
    expect(!target.inPlay || target.y > SHEET.teeY + 0.3).toBe(true)
  })

  it('solveThrow 可以解出大致命中目標的投壺', () => {
    for (const spin of [1, -1] as const) {
      const spec = solveThrow(0.4, 15.5, spin)
      const r = predictPath(spec)
      expect(Math.abs(r.stop.x - 0.4)).toBeLessThan(0.08)
      expect(Math.abs(r.stop.y - 15.5)).toBeLessThan(0.15)
    }
  })
})

describe('計分', () => {
  const at = (id: number, team: number, x: number, y: number): Stone => ({ id, team, x, y, vx: 0, vy: 0, spin: 1 as const, inPlay: true, thrown: true })
  it('最近的隊伍得到比對手最近壺更近的壺數', () => {
    const r = scoreEnd([at(0, 0, 0.1, SHEET.teeY), at(1, 0, 0.5, SHEET.teeY), at(4, 1, 0.8, SHEET.teeY), at(2, 0, 1.2, SHEET.teeY)])
    expect(r.team).toBe(0)
    expect(r.points).toBe(2)
  })
  it('大本營內沒有壺為空局', () => {
    const r = scoreEnd([at(0, 0, 0, SHEET.teeY + 5)])
    expect(r.team).toBe(-1)
    expect(r.points).toBe(0)
  })
})

describe('比賽流程', () => {
  it('回合順序：非後手先投，後手最後一壺；2 對 2 每人投一半', () => {
    const m = createMatch({ ...DEFAULT_CONFIG, playersPerTeam: 2 }, 1)
    const order: number[] = []
    const players: number[] = []
    for (let k = 0; k < 16; k++) {
      m.k = k
      const t = currentTurn(m)
      order.push(t.team)
      players.push(t.player)
    }
    expect(order).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1])
    expect(players.filter((p) => p === 0).length).toBe(8)
    m.k = 15
    expect(currentTurn(m).team).toBe(1)
  })

  it('完成一局後進入結算，再進下一局並重置冰面', () => {
    const m = createMatch(DEFAULT_CONFIG, 1)
    for (let i = 0; i < 16; i++) {
      const t = currentTurn(m)
      const spec = solveThrow(0.2 * (t.team ? 1 : -1), 16, t.team ? 1 : -1)
      throwStone(m, spec, [])
    }
    expect(m.status).toBe('endScored')
    expect(m.lastEnd).not.toBeNull()
    advanceEnd(m)
    expect(m.status).toBe('playing')
    expect(m.end).toBe(1)
    expect(m.k).toBe(0)
    expect(m.stones.every((s) => !s.thrown)).toBe(true)
  })

  it('守護區規則：前五壺不可把對手的守護壺打出場', () => {
    const m = createMatch(DEFAULT_CONFIG, 1)
    // 隊伍 0 先投，放一顆守護壺在守護區
    const guard = solveThrow(0, 12.5, 1)
    throwStone(m, guard, [])
    const g0 = m.stones.find((s) => s.id === 0)!
    expect(g0.inPlay).toBe(true)
    expect(g0.y).toBeGreaterThan(SHEET.hogY)
    // 隊伍 1 高速直接撞飛守護壺
    const hit = solveThrow(g0.x, g0.y, 1)
    const r = throwStone(m, { angle: hit.angle, power: 0.95, spin: 1 }, [])
    const g1 = m.stones.find((s) => s.id === 0)!
    if (r.fgzViolation) {
      expect(g1.inPlay).toBe(true)
      expect(g1.x).toBeCloseTo(g0.x, 6)
      expect(m.stones.find((s) => s.id === 4)!.inPlay).toBe(false)
    }
  })

  describe('五壺規則與違規懲罰', () => {
    /** 在守護區放對手（隊伍 0）的一顆壺，回到第 k 壺時由隊伍 1 高速直撞。 */
    function violateAt(k: number) {
      const m = createMatch(DEFAULT_CONFIG, 1)
      const turn0 = currentTurn(m)
      expect(turn0.team).toBe(0 === m.hammer ? 1 : 0)
      const guard = m.stones.find((s) => s.team === 0)!
      guard.x = 0.2
      guard.y = 12.5
      guard.thrown = true
      guard.inPlay = true
      m.k = k
      const turn = currentTurn(m)
      // 讓輪到的一定是隊伍 1（k 與後手決定隊伍），必要時改後手
      if (turn.team !== 1) m.hammer = 1 - m.hammer
      const t = currentTurn(m)
      const aim = { angle: Math.atan2(guard.x, guard.y - SHEET.releaseY) }
      const before = m.stones.map((s) => ({ ...s }))
      const r = throwStone(m, { angle: aim.angle, power: 1, spin: 1 }, [])
      return { m, r, before, t }
    }

    it('前 5 壺（第 5 壺含）撞出守護壺：違規、本壺移除、場面還原', () => {
      for (const k of [1, 3, 4]) {
        const { m, r, before, t } = violateAt(k)
        expect(r.fgzViolation).toBe(true)
        const guard = m.stones.find((s) => s.team === 0 && s.id === before.find((b) => b.team === 0 && b.y === 12.5)!.id)!
        expect(guard.inPlay).toBe(true)
        expect(guard.x).toBeCloseTo(0.2, 6)
        expect(guard.y).toBeCloseTo(12.5, 6)
        const thrown = m.stones.find((s) => s.id === t.stoneId)!
        expect(thrown.inPlay).toBe(false)
        expect(thrown.thrown).toBe(true)
        expect(m.k).toBe(k + 1)
      }
    })

    it('第 6 壺起可以把守護壺撞出場，不算違規', () => {
      const { m, r, before } = violateAt(5)
      expect(r.fgzViolation).toBe(false)
      const id = before.find((b) => b.team === 0 && b.y === 12.5)!.id
      expect(m.stones.find((s) => s.id === id)!.inPlay).toBe(false)
    })

    it('把守護壺撞到場內其他位置不算違規；自己的守護壺不受保護', () => {
      const m = createMatch(DEFAULT_CONFIG, 1)
      const mine = m.stones.find((s) => s.team === currentTurn(m).team)!
      mine.x = 0
      mine.y = 12.5
      mine.thrown = true
      mine.inPlay = true
      m.k = 2
      const t = currentTurn(m)
      expect(t.team).toBe(mine.team)
      const r = throwStone(m, { angle: 0, power: 1, spin: 1 }, [])
      expect(r.fgzViolation).toBe(false)
    })

    it('兩隊最近壺等距時該局不得分', () => {
      const a = { id: 0, team: 0, x: 0.5, y: 16, vx: 0, vy: 0, spin: 1 as const, inPlay: true, thrown: true }
      const b = { ...a, id: 8, team: 1, x: -0.5 }
      expect(scoreEnd([a, b]).team).toBe(-1)
    })
  })

  it('4 對 4：每位隊員投 2 壺，依序輪替', () => {
    const m = createMatch({ ...DEFAULT_CONFIG, playersPerTeam: 4 }, 1)
    const perTeam: Record<number, number[]> = { 0: [], 1: [] }
    for (let k = 0; k < 16; k++) {
      m.k = k
      const t = currentTurn(m)
      perTeam[t.team].push(t.player)
    }
    expect(perTeam[0]).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
    expect(perTeam[1]).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
  })

  it('預估路線不含大力道誤差，實際出手才含（誤差有上限）', () => {
    const spec = { angle: 0.03, power: 1, spin: 1 as const }
    const pred = predictPath(spec, 50).stop
    const real = new SlideSim([{ id: 3, team: 0, x: 0, y: 0, vx: 0, vy: 0, spin: 1, inPlay: true, thrown: false }], 3, spec, { noHog: true }).runToEnd([]).stones[0]
    expect(Math.abs(pred.x - real.x)).toBeLessThan(0.6)
    const low = predictPath({ ...spec, power: 0.6 }, 50).stop
    const lowReal = new SlideSim([{ id: 3, team: 0, x: 0, y: 0, vx: 0, vy: 0, spin: 1, inPlay: true, thrown: false }], 3, { ...spec, power: 0.6 }, { noHog: true }).runToEnd([]).stones[0]
    expect(lowReal.x).toBeCloseTo(low.x, 6)
  })
})

describe('九宮連線判定', () => {
  const mk = (id: number, team: number, x: number, y: number) => ({ id, team, x, y, vx: 0, vy: 0, spin: 1 as const, inPlay: true, thrown: true })
  it('壺心剛好在格線上只占一格', async () => {
    const { gridOwnership, gridCellCenter, GRID_CELL } = await import('../src/core/variants')
    const c = gridCellCenter(1, 1)
    const cells = gridOwnership([mk(0, 0, c.x + GRID_CELL / 2, c.y)])
    expect(cells.filter((v) => v === 0).length).toBe(1)
  })
  it('同格取離格心最近者；斜線連成三顆即成線', async () => {
    const { gridOwnership, gridCellCenter, gridLineFor } = await import('../src/core/variants')
    const p = (r: number, k: number) => gridCellCenter(r, k)
    const st = [mk(0, 0, p(0, 0).x, p(0, 0).y), mk(1, 0, p(1, 1).x + 0.05, p(1, 1).y), mk(2, 0, p(2, 2).x, p(2, 2).y), mk(3, 1, p(1, 1).x + 0.3, p(1, 1).y)]
    const cells = gridOwnership(st)
    expect(gridLineFor(cells, 0)).toEqual([0, 4, 8])
    st[3].x = p(1, 1).x
    st[3].y = p(1, 1).y
    expect(gridLineFor(gridOwnership(st), 0)).toBeNull()
  })
})
