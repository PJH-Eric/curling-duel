import { chooseThrow, type AiLevel } from '../src/core/ai'
import { advanceGame, createGame, isFinished, isRoundScored, playThrow, turnOf, type GameSetup, type GameState } from '../src/core/game'
import { makeRng, type Rng } from '../src/core/rng'
import { sanitizeTaps, solveThrow } from '../src/core/sim'
import { SHEET, clamp, type ThrowSpec } from '../src/core/types'
import type { ClientMsg, ErrCode, RoomConfig, RoomListItem, RoomPub, SeatPub, ServerMsg } from './protocol'
import { randomBase64Url, randomBytes, randomHex, randomUint32 } from './rand'

export interface Conn {
  send(msg: ServerMsg): void
  close(): void
}

interface Member {
  pid: string
  sid: string
  name: string
  conn: Conn | null
  role: 'player' | 'spectator'
  team: number
  player: number
  lastChat: number
  ready: boolean
  /** 斷線時間（毫秒），null 表示在線 */
  offlineAt: number | null
}

interface Invite {
  token: string
  scope: 'player' | 'spectator'
  expires: number
  revoked: boolean
}

interface AiSeat {
  level: AiLevel
  name: string
}

export const LIMITS = { name: 12, chat: 80, rooms: 200, spectators: 20, inviteTtlMs: 60 * 60 * 1000, emptyGraceMs: 15_000, takeoverMs: 8_000, advanceMs: 8_000, aiDelayMs: [900, 1700] as [number, number], timerGraceMs: 4_000 }

export function cleanName(raw: unknown, fallback = 'Guest'): string {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').trim().slice(0, LIMITS.name)
  return s || fallback
}
export function cleanText(raw: unknown): string {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, LIMITS.chat)
}

type Timer = ReturnType<typeof setTimeout>

export class Room {
  readonly code: string
  config: RoomConfig
  phase: 'lobby' | 'playing' | 'over' = 'lobby'
  hostPid = ''
  members = new Map<string, Member>()
  aiSeats = new Map<string, AiSeat>()
  invites: Invite[] = []
  g: GameState | null = null
  seed = 1
  rng: Rng = makeRng(1)
  closed = false
  private timers = new Set<Timer>()
  private turnTimer: Timer | null = null
  private advanceVotes = new Set<string>()
  private advanceTimer: Timer | null = null

  constructor(code: string, config: RoomConfig, private onClose: (code: string) => void, private now: () => number = Date.now) {
    this.code = code
    this.config = sanitizeConfig(config)
  }

  /* ───── 座位工具 ───── */
  get teams(): number {
    return this.config.setup.kind === 'mission' ? 1 : 2
  }
  get ppt(): number {
    return this.config.setup.playersPerTeam ?? 1
  }
  private key(team: number, player: number): string {
    return `${team}:${player}`
  }
  private memberAt(team: number, player: number): Member | undefined {
    for (const m of this.members.values()) if (m.role === 'player' && m.team === team && m.player === player) return m
    return undefined
  }
  seatsPub(): SeatPub[] {
    const out: SeatPub[] = []
    for (let team = 0; team < this.teams; team++) {
      for (let player = 0; player < this.ppt; player++) {
        const m = this.memberAt(team, player)
        const ai = this.aiSeats.get(this.key(team, player))
        if (m) out.push({ team, player, kind: 'human', name: m.name, online: m.offlineAt === null, takeover: m.offlineAt !== null && this.phase === 'playing' && this.now() - m.offlineAt > LIMITS.takeoverMs, ready: m.ready, pid: m.pid })
        else if (ai) out.push({ team, player, kind: 'ai', name: ai.name, level: ai.level })
        else out.push({ team, player, kind: 'empty', name: '' })
      }
    }
    return out
  }
  pub(): RoomPub {
    const spectators = [...this.members.values()].filter((m) => m.role === 'spectator').map((m) => ({ pid: m.pid, name: m.name }))
    return { code: this.code, config: this.config, phase: this.phase, seats: this.seatsPub(), spectators, hostPid: this.hostPid }
  }
  listItem(): RoomListItem {
    const host = this.members.get(this.hostPid)
    const players = [...this.members.values()].filter((m) => m.role === 'player').length
    return { code: this.code, host: host?.name ?? '', kind: this.config.setup.kind, phase: this.phase, players, capacity: this.teams * this.ppt, spectators: [...this.members.values()].filter((m) => m.role === 'spectator').length }
  }
  humanCount(): number {
    return [...this.members.values()].filter((m) => m.offlineAt === null).length
  }
  /** 房內仍有真人（含寬限期內斷線者） */
  hasHumans(): boolean {
    return this.members.size > 0
  }

  broadcast(msg: ServerMsg, except?: string): void {
    for (const m of this.members.values()) if (m.conn && m.pid !== except) m.conn.send(msg)
  }
  sys(text: string): void {
    this.broadcast({ t: 'chat', from: '', text, kind: 'sys' })
  }
  sendRoom(): void {
    for (const m of this.members.values()) m.conn?.send({ t: 'room', room: this.pub(), you: { pid: m.pid, role: m.role, team: m.team, player: m.player } })
  }

  /* ───── 進出 ───── */
  freeSeat(): { team: number; player: number } | null {
    for (let team = 0; team < this.teams; team++) {
      for (let player = 0; player < this.ppt; player++) {
        if (!this.memberAt(team, player) && !this.aiSeats.has(this.key(team, player))) return { team, player }
      }
    }
    return null
  }

  /** 加入（或重連）。回傳 null 代表成功，否則錯誤碼。 */
  join(sid: string, name: string, conn: Conn, wantRole: 'player' | 'spectator'): { member: Member } | { err: ErrCode } {
    if (this.closed) return { err: 'notFound' }
    let m = [...this.members.values()].find((x) => x.sid === sid)
    if (m) {
      m.conn?.close()
      m.conn = conn
      m.offlineAt = null
      m.name = cleanName(name, m.name)
      this.sys(`${m.name} ⟳`)
    } else {
      let role: 'player' | 'spectator' = wantRole
      let seat = null as { team: number; player: number } | null
      if (role === 'player' && this.phase === 'lobby') {
        seat = this.freeSeat()
        if (!seat) role = 'spectator'
      } else role = 'spectator'
      if (role === 'spectator' && [...this.members.values()].filter((x) => x.role === 'spectator').length >= this.config.maxSpectators) return { err: 'full' }
      m = { pid: randomHex(6), sid, name: cleanName(name), conn, role, team: seat?.team ?? -1, player: seat?.player ?? -1, lastChat: 0, ready: false, offlineAt: null }
      this.members.set(m.pid, m)
      if (!this.hostPid || !this.members.has(this.hostPid)) this.hostPid = m.pid
      this.sys(`${m.name} +`)
    }
    conn.send({ t: 'welcome', pid: m.pid })
    this.sendRoom()
    if (this.g && this.phase !== 'lobby') {
      conn.send({ t: 'started', setup: this.config.setup, seed: this.seed })
      conn.send({ t: 'snapshot', g: this.g })
    }
    this.afterPresenceChange()
    return { member: m }
  }

  /** 連線中斷。傳入 conn 時，只有「仍是目前這條連線」才算離線（避免舊連線的 close 事件把剛重連的人踢成離線）。 */
  disconnect(pid: string, conn?: Conn): void {
    const m = this.members.get(pid)
    if (!m) return
    if (conn && m.conn !== conn) return
    m.conn = null
    m.offlineAt = this.now()
    if (m.role === 'spectator' || this.phase === 'lobby') {
      // 觀戰者與大廳中的玩家直接離開
      this.remove(pid, false)
      return
    }
    this.sendRoom()
    this.afterPresenceChange()
    this.schedule(LIMITS.takeoverMs + 50, () => this.maybeAdvanceTurn())
    this.schedule(LIMITS.emptyGraceMs, () => this.checkEmpty())
  }

  leave(pid: string): void {
    this.remove(pid, true)
  }

  private remove(pid: string, announce: boolean): void {
    const m = this.members.get(pid)
    if (!m) return
    this.members.delete(pid)
    if (announce) this.sys(`${m.name} -`)
    if (this.hostPid === pid) {
      const next = [...this.members.values()].find((x) => x.offlineAt === null && x.role === 'player') ?? [...this.members.values()].find((x) => x.offlineAt === null)
      this.hostPid = next?.pid ?? ''
    }
    this.advanceVotes.delete(pid)
    this.sendRoom()
    this.afterPresenceChange()
    this.checkEmpty()
    this.maybeAdvanceTurn()
  }

  /** 沒有任何在線真人時：寬限期後關房、撤銷全部邀請。 */
  private checkEmpty(): void {
    if (this.closed) return
    const online = [...this.members.values()].some((m) => m.offlineAt === null)
    if (online) return
    const graceOk = [...this.members.values()].every((m) => m.offlineAt !== null && this.now() - m.offlineAt >= LIMITS.emptyGraceMs)
    if (this.members.size === 0 || graceOk) this.close('empty')
  }

  close(reason: 'empty' | 'host' | 'kicked'): void {
    if (this.closed) return
    this.closed = true
    this.invites.forEach((i) => (i.revoked = true))
    this.broadcast({ t: 'closed', reason })
    for (const m of this.members.values()) m.conn?.close()
    this.members.clear()
    this.timers.forEach(clearTimeout)
    this.timers.clear()
    if (this.turnTimer) clearTimeout(this.turnTimer)
    if (this.advanceTimer) clearTimeout(this.advanceTimer)
    this.onClose(this.code)
  }

  private afterPresenceChange(): void {
    if (this.phase === 'lobby' || this.closed) return
    this.maybeAdvanceTurn()
  }

  private schedule(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t)
      if (!this.closed) fn()
    }, ms)
    this.timers.add(t)
  }

  /* ───── 邀請 ───── */
  createInvite(scope: 'player' | 'spectator'): Invite {
    const inv: Invite = { token: randomBase64Url(12), scope, expires: this.now() + LIMITS.inviteTtlMs, revoked: false }
    this.invites.push(inv)
    return inv
  }
  revokeInvites(): void {
    this.invites.forEach((i) => (i.revoked = true))
  }
  checkInvite(token: string | undefined): { ok: true; scope: 'player' | 'spectator' } | { ok: false; err: ErrCode } {
    if (!token) return { ok: false, err: 'private' }
    const inv = this.invites.find((i) => i.token === token)
    if (!inv) return { ok: false, err: 'invalid' }
    if (inv.revoked) return { ok: false, err: 'revoked' }
    if (inv.expires < this.now()) return { ok: false, err: 'expired' }
    return { ok: true, scope: inv.scope }
  }

  /* ───── 客戶端訊息 ───── */
  handle(pid: string, msg: ClientMsg): void {
    const m = this.members.get(pid)
    if (!m || this.closed) return
    const isHost = pid === this.hostPid
    const err = (code: ErrCode) => m.conn?.send({ t: 'error', code })
    switch (msg.t) {
      case 'config':
        if (!isHost || this.phase !== 'lobby') return err('forbidden')
        this.config = sanitizeConfig(msg.config)
        this.reseat()
        this.sendRoom()
        break
      case 'seat': {
        if (this.phase !== 'lobby') return err('state')
        const { team, player } = msg
        if (!(team >= 0 && team < this.teams && player >= 0 && player < this.ppt)) return err('invalid')
        if (this.memberAt(team, player)) return err('full')
        this.aiSeats.delete(this.key(team, player))
        m.role = 'player'
        m.team = team
        m.player = player
        m.ready = false
        this.sendRoom()
        break
      }
      case 'spectate':
        if (this.phase !== 'lobby') return
        if ([...this.members.values()].filter((x) => x.role === 'spectator').length >= this.config.maxSpectators) return err('full')
        m.role = 'spectator'
        m.team = m.player = -1
        this.sendRoom()
        break
      case 'addAi': {
        if (!isHost || this.phase !== 'lobby') return err('forbidden')
        if (this.memberAt(msg.team, msg.player)) return err('full')
        if (!(msg.team >= 0 && msg.team < this.teams && msg.player >= 0 && msg.player < this.ppt)) return err('invalid')
        const lv: AiLevel = ['easy', 'normal', 'hard'].includes(msg.level) ? msg.level : 'normal'
        this.aiSeats.set(this.key(msg.team, msg.player), { level: lv, name: `AI ${msg.team === 0 ? 'A' : 'B'}${msg.player + 1}` })
        this.sendRoom()
        break
      }
      case 'removeAi':
        if (!isHost || this.phase !== 'lobby') return err('forbidden')
        this.aiSeats.delete(this.key(msg.team, msg.player))
        this.sendRoom()
        break
      case 'kick': {
        if (!isHost) return err('forbidden')
        const k = this.members.get(msg.pid)
        if (!k || k.pid === pid) return
        k.conn?.send({ t: 'closed', reason: 'kicked' })
        k.conn?.close()
        this.remove(k.pid, true)
        break
      }
      case 'start':
        if (!isHost) return err('forbidden')
        this.start()
        break
      case 'throw':
        this.onThrow(m, msg.spec, msg.taps)
        break
      case 'advance':
        if (this.phase === 'playing' && this.g && isRoundScored(this.g)) {
          if (m.role === 'player') this.advanceVotes.add(pid)
          this.checkAdvance()
        }
        break
      case 'toLobby':
        if (this.phase !== 'over') return
        this.toLobby()
        if (msg.again && isHost) this.start()
        break
      case 'chat': {
        const text = cleanText(msg.text)
        const t = this.now()
        if (!text) return
        if (t - m.lastChat < 500) return err('rate')
        m.lastChat = t
        this.broadcast({ t: 'chat', from: m.name, text, kind: 'msg' })
        break
      }
      case 'invite': {
        if (!isHost) return err('forbidden')
        const inv = this.createInvite(msg.scope === 'spectator' ? 'spectator' : 'player')
        m.conn?.send({ t: 'invite', token: inv.token, scope: inv.scope, expires: inv.expires })
        break
      }
      case 'revoke': {
        if (!isHost) return err('forbidden')
        this.revokeInvites()
        const inv = this.createInvite('player')
        m.conn?.send({ t: 'invite', token: inv.token, scope: inv.scope, expires: inv.expires })
        break
      }
      case 'leave':
        this.leave(pid)
        break
      default:
        break
    }
  }

  private reseat(): void {
    // 設定變更後，超出座位範圍的人改為觀戰，多餘 AI 移除
    for (const m of this.members.values()) if (m.role === 'player' && (m.team >= this.teams || m.player >= this.ppt)) {
      const s = this.freeSeat()
      if (s) {
        m.team = s.team
        m.player = s.player
      } else {
        m.role = 'spectator'
        m.team = m.player = -1
      }
    }
    for (const k of [...this.aiSeats.keys()]) {
      const [a, b] = k.split(':').map(Number)
      if (a >= this.teams || b >= this.ppt) this.aiSeats.delete(k)
    }
  }

  /* ───── 對局 ───── */
  start(): void {
    if (this.phase !== 'lobby') return
    // 空位補電腦
    for (let team = 0; team < this.teams; team++) {
      for (let player = 0; player < this.ppt; player++) {
        if (!this.memberAt(team, player) && !this.aiSeats.has(this.key(team, player))) this.aiSeats.set(this.key(team, player), { level: this.config.level, name: `AI ${team === 0 ? 'A' : 'B'}${player + 1}` })
      }
    }
    if (![...this.members.values()].some((m) => m.role === 'player')) return
    this.seed = randomUint32() || 1
    this.rng = makeRng(this.seed)
    this.g = createGame(this.config.setup)
    this.phase = 'playing'
    this.advanceVotes.clear()
    this.sendRoom()
    this.broadcast({ t: 'started', setup: this.config.setup, seed: this.seed })
    this.broadcast({ t: 'snapshot', g: this.g })
    this.maybeAdvanceTurn()
  }

  private toLobby(): void {
    this.phase = 'lobby'
    this.g = null
    for (const m of this.members.values()) m.ready = false
    // 離線的玩家在回到房間時移除
    for (const m of [...this.members.values()]) if (m.offlineAt !== null) this.members.delete(m.pid)
    this.sendRoom()
    this.checkEmpty()
  }

  private currentSeat(): { kind: 'human'; m: Member } | { kind: 'ai'; ai: AiSeat } | { kind: 'takeover'; m: Member } | null {
    if (!this.g) return null
    const turn = turnOf(this.g)
    if (!turn) return null
    const m = this.memberAt(turn.team, turn.player)
    if (m) return m.offlineAt !== null && this.now() - m.offlineAt >= LIMITS.takeoverMs ? { kind: 'takeover', m } : { kind: 'human', m }
    const ai = this.aiSeats.get(this.key(turn.team, turn.player))
    return ai ? { kind: 'ai', ai } : null
  }

  /** 排定下一手：電腦思考、真人計時、斷線接管。 */
  maybeAdvanceTurn(): void {
    if (this.closed || this.phase !== 'playing' || !this.g) return
    if (this.turnTimer) clearTimeout(this.turnTimer)
    this.turnTimer = null
    if (this.g.status !== 'playing') return
    const seat = this.currentSeat()
    if (!seat) return
    if (seat.kind === 'ai' || seat.kind === 'takeover') {
      const level: AiLevel = seat.kind === 'ai' ? seat.ai.level : this.config.level
      const [a, b] = LIMITS.aiDelayMs
      // 客戶端需要先演完上一手，所以電腦延遲包含回放時間（約 3 秒）
      this.turnTimer = setTimeout(() => this.aiThrow(level), a + this.rng() * (b - a) + 2500)
    } else {
      const total = (this.g.kind === 'mission' ? 0 : this.g.config.timerSec) * 1000
      if (total > 0) this.turnTimer = setTimeout(() => this.timeoutThrow(), total + LIMITS.timerGraceMs + 2500)
      else this.turnTimer = null
      // 若真人在等待期間斷線，再檢查一次接管
      if (seat.m.offlineAt !== null) this.turnTimer = setTimeout(() => this.maybeAdvanceTurn(), LIMITS.takeoverMs - (this.now() - seat.m.offlineAt) + 50)
    }
  }

  private aiThrow(level: AiLevel): void {
    if (this.closed || !this.g || this.g.status !== 'playing') return
    const c = chooseThrow(this.g, level, this.rng)
    this.applyThrow(null, c.spec, c.taps)
  }

  private timeoutThrow(): void {
    if (this.closed || !this.g || this.g.status !== 'playing') return
    const spec = solveThrow(0, SHEET.teeY, 1)
    this.applyThrow(null, spec, [])
  }

  private onThrow(m: Member, spec: ThrowSpec, taps: number[]): void {
    if (!this.g || this.phase !== 'playing' || this.g.status !== 'playing') return m.conn?.send({ t: 'error', code: 'state' })
    const turn = turnOf(this.g)
    if (!turn || m.role !== 'player' || m.team !== turn.team || m.player !== turn.player) return m.conn?.send({ t: 'error', code: 'forbidden' })
    if (!spec || !Number.isFinite(spec.angle) || !Number.isFinite(spec.power) || (spec.spin !== 1 && spec.spin !== -1)) return m.conn?.send({ t: 'error', code: 'invalid' })
    const clean: ThrowSpec = { angle: clamp(spec.angle, -0.5, 0.5), power: clamp(spec.power, 0, 1), spin: spec.spin }
    this.applyThrow(m.pid, clean, sanitizeTaps(Array.isArray(taps) ? taps.slice(0, 200) : []))
  }

  private applyThrow(pid: string | null, spec: ThrowSpec, taps: number[]): void {
    if (!this.g) return
    const rec = playThrow(this.g, spec, taps)
    this.broadcast({ t: 'record', rec, pid: pid ?? '' })
    this.advanceVotes.clear()
    if (isFinished(this.g)) {
      this.phase = 'over'
      this.sendRoom()
    } else if (isRoundScored(this.g)) {
      if (this.advanceTimer) clearTimeout(this.advanceTimer)
      this.advanceTimer = setTimeout(() => this.doAdvance(), LIMITS.advanceMs + 4000)
    } else this.maybeAdvanceTurn()
    // 終局：房間狀態由 sendRoom 通知
  }

  private checkAdvance(): void {
    const players = [...this.members.values()].filter((m) => m.role === 'player' && m.offlineAt === null)
    if (players.length > 0 && players.every((p) => this.advanceVotes.has(p.pid))) this.doAdvance()
  }

  private doAdvance(): void {
    if (!this.g || !isRoundScored(this.g) || this.closed) return
    if (this.advanceTimer) clearTimeout(this.advanceTimer)
    advanceGame(this.g)
    this.advanceVotes.clear()
    this.broadcast({ t: 'advance' })
    if (isFinished(this.g)) {
      this.phase = 'over'
      this.sendRoom()
    } else this.maybeAdvanceTurn()
  }
}

export function sanitizeConfig(c: RoomConfig): RoomConfig {
  const s: GameSetup = c?.setup ?? { kind: 'standard' }
  const kind = (['standard', 'grid', 'hole'] as const).includes(s.kind as 'standard') ? (s.kind as 'standard' | 'grid' | 'hole') : 'standard'
  const ppt = ([1, 2, 3, 4] as const).find((n) => n === s.playersPerTeam) ?? 1
  const timer = [0, 30, 45, 60].includes(s.timerSec ?? 45) ? (s.timerSec ?? 45) : 45
  const stones = 8
  const ends = clamp(Math.round(s.standard?.ends ?? 4), 1, 10)
  const rounds = clamp(Math.round(s.grid?.rounds ?? s.hole?.rounds ?? 3), 1, 5)
  const level: AiLevel = ['easy', 'normal', 'hard'].includes(c?.level) ? c.level : 'normal'
  return {
    setup: { kind, playersPerTeam: ppt, timerSec: timer, standard: { stonesPerTeam: stones, ends }, grid: { rounds }, hole: { rounds } },
    level,
    public: !!c?.public,
    maxSpectators: clamp(Math.round(c?.maxSpectators ?? LIMITS.spectators), 0, LIMITS.spectators),
  }
}

/** 房間管理員：建立、查詢、列表。 */
export class RoomHub {
  rooms = new Map<string, Room>()
  constructor(private now: () => number = Date.now) {}

  private genCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    for (let i = 0; i < 50; i++) {
      let c = ''
      const b = randomBytes(5)
      for (let k = 0; k < 5; k++) c += chars[b[k] % chars.length]
      if (!this.rooms.has(c)) return c
    }
    throw new Error('no code')
  }

  create(config: RoomConfig): Room | null {
    if (this.rooms.size >= LIMITS.rooms) return null
    const code = this.genCode()
    const room = new Room(code, config, (c) => this.rooms.delete(c), this.now)
    this.rooms.set(code, room)
    return room
  }

  get(code: string): Room | undefined {
    return this.rooms.get(String(code ?? '').toUpperCase())
  }

  list(): RoomListItem[] {
    return [...this.rooms.values()].filter((r) => r.config.public && !r.closed && r.hasHumans()).map((r) => r.listItem())
  }
}
