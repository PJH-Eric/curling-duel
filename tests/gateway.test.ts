import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomConfig, ServerMsg } from '../server/protocol'
import { RoomHub, type Conn } from '../server/rooms'
import { Gateway, makeOriginCheck } from '../server/session'

function conn(): Conn & { msgs: ServerMsg[]; closed: boolean } {
  const c = { msgs: [] as ServerMsg[], closed: false, send(m: ServerMsg) { c.msgs.push(m) }, close() { c.closed = true } }
  return c
}
const cfg: RoomConfig = { setup: { kind: 'standard', playersPerTeam: 1, timerSec: 45, standard: { stonesPerTeam: 8, ends: 1 } }, level: 'easy', public: true, maxSpectators: 2 }
const send = (g: Gateway, s: ReturnType<Gateway['open']>, m: object) => g.message(s, JSON.stringify(m))

describe('Gateway（Node 與 Cloudflare Worker 共用的訊息路由）', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('hello → create → list → join 全流程', () => {
    const g = new Gateway(new RoomHub())
    const a = conn(), b = conn()
    const sa = g.open(a), sb = g.open(b)
    send(g, sa, { t: 'hello', sid: 'sa', name: 'A' })
    send(g, sa, { t: 'create', name: 'A', config: cfg })
    const room = a.msgs.find((m) => m.t === 'room') as Extract<ServerMsg, { t: 'room' }>
    expect(room).toBeTruthy()
    send(g, sb, { t: 'hello', sid: 'sb', name: 'B' })
    send(g, sb, { t: 'list' })
    expect((b.msgs.find((m) => m.t === 'rooms') as Extract<ServerMsg, { t: 'rooms' }>).rooms).toHaveLength(1)
    send(g, sb, { t: 'join', code: room.room.code, name: 'B' })
    expect(b.msgs.some((m) => m.t === 'room' && m.you.role === 'player' && m.you.team === 1)).toBe(true)
  })

  it('未 hello 不能建房；壞 JSON、過大訊息、缺 t 欄位都回 invalid', () => {
    const g = new Gateway(new RoomHub())
    const c = conn()
    const s = g.open(c)
    send(g, s, { t: 'create', name: 'x', config: cfg })
    g.message(s, '{bad')
    g.message(s, JSON.stringify({ t: 'chat', text: 'x'.repeat(40_000) }))
    g.message(s, JSON.stringify({ nope: 1 }))
    expect(c.msgs.filter((m) => m.t === 'error' && m.code === 'invalid')).toHaveLength(4)
  })

  it('每秒超過 40 則訊息回 rate，下一秒恢復', () => {
    const g = new Gateway(new RoomHub())
    const c = conn()
    const s = g.open(c)
    for (let i = 0; i < 45; i++) send(g, s, { t: 'ping', n: i })
    expect(c.msgs.filter((m) => m.t === 'error' && m.code === 'rate')).toHaveLength(5)
    vi.advanceTimersByTime(1100)
    send(g, s, { t: 'ping', n: 99 })
    expect(c.msgs.at(-1)).toMatchObject({ t: 'pong', n: 99 })
  })

  it('舊連線的 close 不會把已重連的玩家標成離線', () => {
    const hub = new RoomHub()
    const g = new Gateway(hub)
    const c1 = conn(), c2 = conn()
    const s1 = g.open(c1)
    send(g, s1, { t: 'hello', sid: 'same', name: 'A' })
    send(g, s1, { t: 'create', name: 'A', config: cfg })
    const code = [...hub.rooms.keys()][0]
    const s2 = g.open(c2)
    send(g, s2, { t: 'hello', sid: 'same', name: 'A' })
    send(g, s2, { t: 'join', code, name: 'A' })
    g.close(s1) // 舊連線延遲才送出 close
    const m = [...hub.rooms.get(code)!.members.values()][0]
    expect(m.conn).toBe(c2)
    expect(m.offlineAt).toBeNull()
  })
})

describe('來源檢查', () => {
  it('官方 Pages 網域固定放行，其他來源預設拒絕', () => {
    const ok = makeOriginCheck(undefined, false)
    expect(ok('https://pjh-eric.github.io')).toBe(true)
    expect(ok('https://evil.example')).toBe(false)
    expect(ok('http://192.168.1.5:5173')).toBe(false)
    expect(ok(null)).toBe(true)
  })
  it('可擴充網域；allowPrivate 才放行區域網路', () => {
    const ok = makeOriginCheck('https://a.example, https://b.example', true)
    expect(ok('https://b.example')).toBe(true)
    expect(ok('http://192.168.1.5:5173')).toBe(true)
    expect(ok('http://localhost:5173')).toBe(true)
  })
})
