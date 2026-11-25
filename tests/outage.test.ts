import { describe, expect, it } from 'vitest'
import { createOutageWatcher, OUTAGE_WAIT_MS } from '../src/net/outage'
import { en } from '../src/i18n/en'
import { zh } from '../src/i18n/zh-TW'
import { zhCN } from '../src/i18n/zh-CN'

function setup(eligible = true) {
  let now = 0
  let next = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  const state = { shown: 0, eligible }
  const w = createOutageWatcher({
    eligible: () => state.eligible,
    show: () => { state.shown += 1 },
    setTimer: (fn, ms) => { const id = ++next; timers.set(id, { at: now + ms, fn }); return id },
    clearTimer: (id) => { timers.delete(id) },
  })
  const tick = (ms: number) => { now += ms; for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn() } }
  return { w, state, tick }
}

describe('伺服器暫停提示', () => {
  it('連續 30 秒連不上才提示，且同一次故障只提示一次', () => {
    const s = setup()
    s.w.onStatus('connecting')
    s.tick(OUTAGE_WAIT_MS - 1000)
    expect(s.state.shown).toBe(0)
    s.tick(1500)
    expect(s.state.shown).toBe(1)
    s.w.onStatus('reconnecting'); s.tick(60_000)
    expect(s.state.shown).toBe(1)
  })
  it('連上會取消；之後再次故障可再提示', () => {
    const s = setup()
    s.w.onStatus('connecting'); s.tick(20_000); s.w.onStatus('online'); s.tick(60_000)
    expect(s.state.shown).toBe(0)
    s.w.onStatus('reconnecting'); s.tick(31_000)
    expect(s.state.shown).toBe(1)
  })
  it('不在線上大廳／房間時不提示；離開線上會取消', () => {
    const s = setup(false)
    s.w.onStatus('connecting'); s.tick(40_000)
    expect(s.state.shown).toBe(0)
    const t = setup()
    t.w.onStatus('connecting'); t.w.onStatus('idle'); t.tick(40_000)
    expect(t.state.shown).toBe(0)
  })
  it('重試用盡（offline）時立即提示', () => {
    const s = setup()
    s.w.onStatus('connecting'); s.tick(5000); s.w.onStatus('offline')
    expect(s.state.shown).toBe(1)
  })
  it('三語系文案', () => {
    expect(zh['outage.title']).toBe('目前伺服器過載休息中')
    expect(zh['outage.body']).toBe('歡迎贊助升級')
    expect(zhCN['outage.title']).toBe('目前服务器过载休息中')
    expect(en['outage.body']).toBe('Sponsorships to help us upgrade are welcome')
  })
})
