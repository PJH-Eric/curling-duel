import { describe, expect, it } from 'vitest'
import { autoPlay, chooseThrow, createGame, makeRng, playThrow, turnOf, type AiLevel } from '../src/core'

describe('AI 與完整對局', () => {
  it('標準冰壺：AI 互打可以完整打完一場', () => {
    const r = autoPlay({ kind: 'standard', standard: { ends: 2, stonesPerTeam: 4 } }, ['normal', 'normal'], 3)
    expect(r.state.status).toBe('finished')
    expect(r.throws).toBeGreaterThanOrEqual(16)
  })

  it('九宮連線與冰洞挑戰可以完整打完', () => {
    const a = autoPlay({ kind: 'grid' }, ['normal', 'normal'], 5)
    expect(a.state.status).toBe('finished')
    const b = autoPlay({ kind: 'hole' }, ['normal', 'normal'], 5)
    expect(b.state.status).toBe('finished')
    expect(b.scores[0] + b.scores[1]).toBeGreaterThan(0)
  })

  it('三種難度的 AI 都在合理時間內回應', () => {
    for (const level of ['easy', 'normal', 'hard'] as AiLevel[]) {
      const g = createGame({ kind: 'standard' })
      const t0 = Date.now()
      for (let i = 0; i < 3; i++) {
        const c = chooseThrow(g, level, makeRng(i + 1))
        playThrow(g, c.spec, c.taps)
      }
      expect(Date.now() - t0).toBeLessThan(15000)
      expect(turnOf(g)).not.toBeNull()
    }
  })

  it('困難 AI 勝過簡單 AI（多場、雙方互換先後）', () => {
    let hardWins = 0
    let easyWins = 0
    const games = 6
    for (let i = 0; i < games; i++) {
      const hardFirst = i % 2 === 0
      const levels: [AiLevel, AiLevel] = hardFirst ? ['hard', 'easy'] : ['easy', 'hard']
      const r = autoPlay({ kind: 'standard', standard: { ends: 2, stonesPerTeam: 4 } }, levels, 100 + i)
      const hardTeam = hardFirst ? 0 : 1
      if (r.winner === hardTeam) hardWins++
      else if (r.winner === 1 - hardTeam) easyWins++
    }
    expect(hardWins).toBeGreaterThan(easyWins)
  }, 120000)

  it('AI 會遵守五壺規則：前 5 壺不主動撞出對手的守護壺', () => {
    let violations = 0
    let throws = 0
    for (let i = 0; i < 4; i++) {
      const g = createGame({ kind: 'standard', standard: { ends: 1, stonesPerTeam: 4 } })
      const rng = makeRng(77 + i)
      for (let guard = 0; guard < 20 && turnOf(g); guard++) {
        const ch = chooseThrow(g, 'hard', rng)
        const rec = playThrow(g, ch.spec, ch.taps)
        throws++
        if (rec.fgzViolation) violations++
      }
    }
    expect(throws).toBeGreaterThan(20)
    expect(violations).toBe(0)
  }, 120000)
})
