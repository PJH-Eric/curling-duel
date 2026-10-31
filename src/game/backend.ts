import { advanceGame, createGame, isFinished, playThrow, turnOf, type GameSetup, type GameState, type ThrowRecord, type TurnInfo } from '../core/game'
import { chooseThrow, type AiLevel } from '../core/ai'
import { makeRng, type Rng } from '../core/rng'
import type { ThrowSpec } from '../core/types'

/** 一個座位（玩家席）。 */
export interface SeatInfo {
  team: number
  player: number
  name: string
  kind: 'human' | 'ai'
  level?: AiLevel
  /** 這個座位是不是本機玩家 */
  local: boolean
}

export interface ChatLine {
  from: string
  text: string
  kind: 'msg' | 'sys' | 'spec'
}

/**
 * 對局後端：畫面只和這個介面講話。
 * 單機版（LocalBackend）在本機算規則；線上版（OnlineBackend）由伺服器算，並回傳同樣的 ThrowRecord。
 */
export interface Backend {
  readonly g: GameState
  readonly seats: SeatInfo[]
  readonly spectator: boolean
  readonly setup: GameSetup
  /** 隊名（顯示用） */
  teamNames: string[]
  /** 送出自己的投壺 */
  submit(spec: ThrowSpec, taps: number[]): void
  /** 畫面演完上一壺／結算後呼叫，後端才會推進下一步 */
  next(): void
  /** 結算看完，進入下一局／回合 */
  advance(): void
  /** 時間到：自動以目前設定出手 */
  onRecord(cb: (rec: ThrowRecord, byLocalLive: boolean) => void): void
  onTurn(cb: (turn: TurnInfo | null, thinking: SeatInfo | null) => void): void
  onChat(cb: (line: ChatLine) => void): void
  sendChat?(text: string): void
  onStatus?(cb: (s: 'online' | 'reconnecting' | 'offline', ping: number) => void): void
  /** 結算後的三個按鈕之一；online 版可決定是否可用 */
  canRoom(): boolean
  dispose(): void
}

export interface LocalOptions {
  setup: GameSetup
  level: AiLevel
  playerName: string
  seed?: number
}

export class LocalBackend implements Backend {
  readonly g: GameState
  readonly seats: SeatInfo[] = []
  readonly spectator = false
  teamNames: string[]
  private rng: Rng
  private level: AiLevel
  private recCb: (rec: ThrowRecord, live: boolean) => void = () => undefined
  private turnCb: (turn: TurnInfo | null, thinking: SeatInfo | null) => void = () => undefined
  private timer: number | null = null
  private disposed = false

  constructor(readonly opts: LocalOptions) {
    this.setup = opts.setup
    this.g = createGame(opts.setup)
    this.level = opts.level
    this.rng = makeRng(opts.seed ?? (Date.now() & 0xffffff))
    const ppt = opts.setup.kind === 'mission' ? 1 : (opts.setup.playersPerTeam ?? 1)
    const teams = opts.setup.kind === 'mission' ? 1 : 2
    for (let team = 0; team < teams; team++) {
      for (let p = 0; p < ppt; p++) {
        const human = team === 0 && p === 0
        this.seats.push({ team, player: p, name: human ? opts.playerName : `AI ${team === 0 ? 'A' : 'B'}${p + 1}`, kind: human ? 'human' : 'ai', level: human ? undefined : opts.level, local: human })
      }
    }
    this.teamNames = teams === 1 ? [opts.playerName] : ppt === 1 ? this.seats.map((s) => s.name) : ['A', 'B']
  }
  readonly setup: GameSetup

  seatOf(turn: TurnInfo): SeatInfo {
    return this.seats.find((s) => s.team === turn.team && s.player === turn.player) ?? this.seats[0]
  }

  onRecord(cb: (rec: ThrowRecord, live: boolean) => void): void {
    this.recCb = cb
  }
  onTurn(cb: (turn: TurnInfo | null, thinking: SeatInfo | null) => void): void {
    this.turnCb = cb
  }
  onChat(): void {
    /* 單機沒有聊天 */
  }
  canRoom(): boolean {
    return false
  }

  /** 由畫面在準備好之後呼叫一次，開始第一手。 */
  start(): void {
    this.next()
  }

  submit(spec: ThrowSpec, taps: number[]): void {
    if (this.disposed) return
    const rec = playThrow(this.g, spec, taps)
    this.recCb(rec, true)
  }

  next(): void {
    if (this.disposed) return
    const turn = turnOf(this.g)
    if (!turn) {
      this.turnCb(null, null)
      return
    }
    const seat = this.seatOf(turn)
    if (seat.kind === 'human') {
      this.turnCb(turn, null)
      return
    }
    this.turnCb(turn, seat)
    const delay = 700 + this.rng() * 700
    this.timer = window.setTimeout(() => {
      if (this.disposed) return
      const choice = chooseThrow(this.g, seat.level ?? this.level, this.rng)
      const rec = playThrow(this.g, choice.spec, choice.taps)
      this.recCb(rec, false)
    }, delay)
  }

  advance(): void {
    if (isFinished(this.g)) return
    advanceGame(this.g)
    this.next()
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== null) window.clearTimeout(this.timer)
  }
}
