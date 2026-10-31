import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIMITS, RoomHub, cleanName, type Conn } from '../server/rooms'
import type { RoomConfig, ServerMsg } from '../server/protocol'

function conn(): Conn & { msgs: ServerMsg[]; closed: boolean } {
  const c = { msgs: [] as ServerMsg[], closed: false, send(m: ServerMsg) { c.msgs.push(m) }, close() { c.closed = true } }
  return c
}
const cfg = (over: Partial<RoomConfig> = {}): RoomConfig => ({ setup: { kind: 'standard', playersPerTeam: 1, timerSec: 45, standard: { stonesPerTeam: 4, ends: 1 } }, level: 'easy', public: false, maxSpectators: 2, ...over })

describe('房間', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('名稱會被清理', () => {
    expect(cleanName('<b>Al"ice</b>')).toBe('bAlice/b')
    expect(cleanName('   ')).toBe('Guest')
    expect(cleanName('x'.repeat(50)).length).toBe(LIMITS.name)
  })

  it('邀請：範圍決定角色、撤銷後失效、過期失效', () => {
    const hub = new RoomHub()
    const room = hub.create(cfg())!
    const host = conn()
    room.join('s1', 'Host', host, 'player')
    const inv = room.createInvite('spectator')
    expect(room.checkInvite(inv.token)).toEqual({ ok: true, scope: 'spectator' })
    expect(room.checkInvite('nope')).toMatchObject({ ok: false, err: 'invalid' })
    room.revokeInvites()
    expect(room.checkInvite(inv.token)).toMatchObject({ ok: false, err: 'revoked' })
    const inv2 = room.createInvite('player')
    vi.setSystemTime(Date.now() + LIMITS.inviteTtlMs + 1)
    expect(room.checkInvite(inv2.token)).toMatchObject({ ok: false, err: 'expired' })
  })

  it('私人房不在公開列表；公開房在', () => {
    const hub = new RoomHub()
    const a = hub.create(cfg({ public: true }))!
    hub.create(cfg({ public: false }))!.join('x', 'P', conn(), 'player')
    a.join('y', 'Q', conn(), 'player')
    expect(hub.list().map((r) => r.code)).toEqual([a.code])
  })

  it('開始後空位補電腦；非法出手被拒、輪到電腦時房主不能投', () => {
    const hub = new RoomHub()
    const room = hub.create(cfg())!
    const c1 = conn()
    const r = room.join('s1', 'Host', c1, 'player')
    if ('err' in r) throw new Error('join')
    room.start()
    expect(room.phase).toBe('playing')
    expect(room.seatsPub().map((s) => s.kind)).toEqual(['human', 'ai'])
    // 第一手由非後手隊先投：hammer = 1，所以隊 0 先；確認房主是隊 0
    const before = JSON.stringify(room.g!.stones)
    room.handle(r.member.pid, { t: 'throw', spec: { angle: NaN, power: 0.5, spin: 1 }, taps: [] })
    expect(c1.msgs.some((m) => m.t === 'error' && m.code === 'invalid')).toBe(true)
    expect(JSON.stringify(room.g!.stones)).toBe(before)
    // 角度超出範圍會被夾住，仍是合法出手
    room.handle(r.member.pid, { t: 'throw', spec: { angle: 99, power: 0.5, spin: 1 }, taps: [] })
    expect(JSON.stringify(room.g!.stones)).not.toBe(before)
    // 現在輪到電腦，房主再投會被拒絕
    room.handle(r.member.pid, { t: 'throw', spec: { angle: 0, power: 0.5, spin: 1 }, taps: [] })
    expect(c1.msgs.some((m) => m.t === 'error' && m.code === 'forbidden')).toBe(true)
  })

  it('旁觀者不能投壺', () => {
    const hub = new RoomHub()
    const room = hub.create(cfg())!
    const h = conn()
    room.join('s1', 'Host', h, 'player')
    const sc = conn()
    const sr = room.join('s2', 'Watcher', sc, 'spectator')
    if ('err' in sr) throw new Error('join')
    room.start()
    room.handle(sr.member.pid, { t: 'throw', spec: { angle: 0, power: 0.5, spin: 1 }, taps: [] })
    expect(sc.msgs.some((m) => m.t === 'error')).toBe(true)
    expect(room.g!.k).toBe(0)
  })

  it('沒有任何真人時房間關閉並撤銷邀請', () => {
    const hub = new RoomHub()
    const room = hub.create(cfg({ public: true }))!
    const c = conn()
    const r = room.join('s1', 'Host', c, 'player')
    if ('err' in r) throw new Error('join')
    const inv = room.createInvite('player')
    room.leave(r.member.pid)
    expect(room.closed).toBe(true)
    expect(hub.get(room.code)).toBeUndefined()
    expect(room.checkInvite(inv.token)).toMatchObject({ ok: false, err: 'revoked' })
  })

  it('對局中斷線超過寬限期後關閉；期間重連保留座位', () => {
    const hub = new RoomHub()
    const room = hub.create(cfg())!
    const c = conn()
    const r = room.join('s1', 'Host', c, 'player')
    if ('err' in r) throw new Error('join')
    room.start()
    room.disconnect(r.member.pid)
    vi.advanceTimersByTime(5000)
    const c2 = conn()
    const r2 = room.join('s1', 'Host', c2, 'player')
    expect('member' in r2 && r2.member.pid).toBe(r.member.pid)
    expect(room.closed).toBe(false)
    room.disconnect(r.member.pid)
    vi.advanceTimersByTime(LIMITS.emptyGraceMs + 100)
    expect(room.closed).toBe(true)
  })

  it('斷線的玩家輪到時由電腦接管並繼續對局', () => {
    const hub = new RoomHub()
    const room = hub.create(cfg())!
    const a = conn()
    const r = room.join('s1', 'Host', a, 'player')
    const b = conn()
    room.join('s2', 'Guest', b, 'player')
    if ('err' in r) throw new Error('join')
    room.start()
    room.disconnect(r.member.pid)
    vi.advanceTimersByTime(LIMITS.takeoverMs + 6000)
    expect(room.g!.k).toBeGreaterThan(0)
  })

  it('聊天限速', () => {
    const hub = new RoomHub()
    const room = hub.create(cfg())!
    const c = conn()
    const r = room.join('s1', 'Host', c, 'player')
    if ('err' in r) throw new Error('join')
    room.handle(r.member.pid, { t: 'chat', text: 'hi' })
    room.handle(r.member.pid, { t: 'chat', text: 'hi2' })
    expect(c.msgs.filter((m) => m.t === 'chat' && m.kind === 'msg').length).toBe(1)
    expect(c.msgs.some((m) => m.t === 'error' && m.code === 'rate')).toBe(true)
  })

  it('觀戰席上限', () => {
    const hub = new RoomHub()
    const room = hub.create(cfg({ maxSpectators: 1 }))!
    room.join('h', 'H', conn(), 'player')
    expect('member' in room.join('a', 'A', conn(), 'spectator')).toBe(true)
    expect(room.join('b', 'B', conn(), 'spectator')).toEqual({ err: 'full' })
  })
})
