import type { ServerMsg, SeatPub, RoomPub } from '../../server/protocol'
import { advanceGame, isFinished, playThrow, turnOf, type GameSetup, type GameState, type ThrowRecord, type TurnInfo } from '../core/game'
import type { ThrowSpec } from '../core/types'
import type { NetClient, NetStatus } from '../net/client'
import type { Backend, ChatLine, SeatInfo } from './backend'

type Item = { k: 'rec'; rec: ThrowRecord; pid: string } | { k: 'adv' }

/** 線上對局後端：規則由伺服器算，這裡只照順序播放伺服器廣播的結果。 */
export class OnlineBackend implements Backend {
  g: GameState
  seats: SeatInfo[] = []
  spectator: boolean
  teamNames: string[] = ['A', 'B']
  private queue: Item[] = []
  private busy = true
  private turnEmitted = false
  private pendingLive = false
  private recCb: (rec: ThrowRecord, live: boolean) => void = () => undefined
  private turnCb: (t: TurnInfo | null, th: SeatInfo | null) => void = () => undefined
  private chatCb: (l: ChatLine) => void = () => undefined
  private statusCb: (s: 'online' | 'reconnecting' | 'offline', ping: number) => void = () => undefined
  private off: (() => void)[] = []

  constructor(readonly setup: GameSetup, g: GameState, private room: RoomPub, private me: { pid: string; role: 'player' | 'spectator' }, private net: NetClient, private onRoomMsg: (m: ServerMsg) => void) {
    this.g = g
    this.spectator = me.role === 'spectator'
    this.applyRoom(room, me)
    this.off.push(net.on((m) => this.onMsg(m)))
    this.off.push(net.onStatus((s, p) => this.statusCb(s === 'online' ? 'online' : s === 'offline' ? 'offline' : 'reconnecting', p)))
  }

  private seatInfo(s: SeatPub): SeatInfo {
    return { team: s.team, player: s.player, name: s.name || '—', kind: s.kind === 'ai' || (s.kind === 'human' && s.takeover) ? 'ai' : 'human', level: s.level, local: s.pid === this.me.pid }
  }

  private applyRoom(room: RoomPub, you: { pid: string; role: 'player' | 'spectator' }): void {
    this.room = room
    this.me = you
    this.spectator = you.role === 'spectator'
    this.seats = room.seats.filter((s) => s.kind !== 'empty').map((s) => this.seatInfo(s))
    const ppt = room.config.setup.playersPerTeam ?? 1
    this.teamNames = [0, 1].map((team) => {
      const names = room.seats.filter((s) => s.team === team).map((s) => s.name)
      return ppt === 1 ? names[0] || `${team + 1}` : names.join(' & ')
    })
  }

  private onMsg(m: ServerMsg): void {
    switch (m.t) {
      case 'room':
        this.applyRoom(m.room, m.you)
        this.onRoomMsg(m)
        break
      case 'record':
        this.queue.push({ k: 'rec', rec: m.rec, pid: m.pid })
        this.pump()
        break
      case 'advance':
        this.queue.push({ k: 'adv' })
        this.pump()
        break
      case 'chat':
        this.chatCb({ from: m.from, text: m.text, kind: m.kind === 'sys' ? 'sys' : 'msg' })
        break
      case 'snapshot':
        this.g = m.g
        break
      default:
        break
    }
  }

  onRecord(cb: (rec: ThrowRecord, live: boolean) => void): void {
    this.recCb = cb
  }
  onTurn(cb: (t: TurnInfo | null, th: SeatInfo | null) => void): void {
    this.turnCb = cb
  }
  onChat(cb: (l: ChatLine) => void): void {
    this.chatCb = cb
  }
  onStatus(cb: (s: 'online' | 'reconnecting' | 'offline', ping: number) => void): void {
    this.statusCb = cb
  }
  sendChat(text: string): void {
    this.net.send({ t: 'chat', text })
  }
  canRoom(): boolean {
    return true
  }
  start(): void {
    this.next()
  }

  submit(spec: ThrowSpec, taps: number[]): void {
    this.pendingLive = true
    this.net.send({ t: 'throw', spec, taps })
  }

  next(): void {
    this.busy = false
    this.pump()
  }

  advance(): void {
    this.net.send({ t: 'advance' })
    this.busy = false
    this.pump()
  }

  private pump(): void {
    if (this.busy) return
    const item = this.queue.shift()
    if (item) {
      this.turnEmitted = false
      if (item.k === 'adv') {
        if (this.g.status === 'endScored') advanceGame(this.g)
        this.pump()
        return
      }
      const rec = playThrow(this.g, item.rec.spec, item.rec.taps)
      void rec
      // 以伺服器結果為準（防止浮點誤差造成分歧）
      this.g.stones = item.rec.after.map((s) => ({ ...s }))
      this.busy = true
      const live = item.pid === this.me.pid && this.pendingLive
      if (live) this.pendingLive = false
      this.recCb(item.rec, live)
      return
    }
    if (this.turnEmitted) return
    this.turnEmitted = true
    if (isFinished(this.g) || this.g.status !== 'playing') {
      this.turnCb(null, null)
      return
    }
    const turn = turnOf(this.g)
    if (!turn) return this.turnCb(null, null)
    const seat = this.seats.find((s) => s.team === turn.team && s.player === turn.player) ?? null
    this.turnCb(turn, seat && seat.local && !this.spectator ? null : seat ?? ({ team: turn.team, player: turn.player, name: '…', kind: 'human', local: false } as SeatInfo))
  }

  toLobby(again: boolean): void {
    this.net.send({ t: 'toLobby', again })
  }

  dispose(): void {
    this.off.forEach((f) => f())
  }
}
