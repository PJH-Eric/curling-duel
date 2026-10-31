import type { AiLevel } from '../src/core/ai'
import type { GameSetup, GameState, ThrowRecord } from '../src/core/game'
import type { ThrowSpec } from '../src/core/types'

/** 座位在房間中的公開資訊（不含 session 私密資料）。 */
export interface SeatPub {
  team: number
  player: number
  kind: 'empty' | 'human' | 'ai'
  name: string
  level?: AiLevel
  /** 真人是否在線 */
  online?: boolean
  /** 是否由電腦暫代（斷線接管） */
  takeover?: boolean
  ready?: boolean
  /** 座位上的 pid（公開代號，用來判斷「這是不是我」） */
  pid?: string
}

export interface RoomConfig {
  setup: GameSetup
  level: AiLevel
  public: boolean
  maxSpectators: number
}

export interface RoomPub {
  code: string
  config: RoomConfig
  phase: 'lobby' | 'playing' | 'over'
  seats: SeatPub[]
  spectators: { pid: string; name: string }[]
  hostPid: string
}

export interface RoomListItem {
  code: string
  host: string
  kind: string
  phase: string
  players: number
  capacity: number
  spectators: number
}

export type ClientMsg =
  | { t: 'hello'; sid: string; name: string }
  | { t: 'list' }
  | { t: 'create'; name: string; config: RoomConfig }
  | { t: 'join'; code: string; name: string; invite?: string }
  | { t: 'peek'; code: string; invite?: string }
  | { t: 'config'; config: RoomConfig }
  | { t: 'seat'; team: number; player: number }
  | { t: 'spectate' }
  | { t: 'addAi'; team: number; player: number; level: AiLevel }
  | { t: 'removeAi'; team: number; player: number }
  | { t: 'kick'; pid: string }
  | { t: 'start' }
  | { t: 'throw'; spec: ThrowSpec; taps: number[] }
  | { t: 'advance' }
  | { t: 'toLobby'; again?: boolean }
  | { t: 'chat'; text: string }
  | { t: 'invite'; scope: 'player' | 'spectator' }
  | { t: 'revoke' }
  | { t: 'leave' }
  | { t: 'ping'; n: number }

export type ServerMsg =
  | { t: 'welcome'; pid: string }
  | { t: 'rooms'; rooms: RoomListItem[] }
  | { t: 'peek'; ok: boolean; reason?: ErrCode; code?: string; host?: string; role?: 'player' | 'spectator' }
  | { t: 'room'; room: RoomPub; you: { pid: string; role: 'player' | 'spectator'; team: number; player: number } }
  | { t: 'invite'; token: string; scope: 'player' | 'spectator'; expires: number }
  | { t: 'started'; setup: GameSetup; seed: number }
  | { t: 'snapshot'; g: GameState }
  | { t: 'record'; rec: ThrowRecord; pid: string }
  | { t: 'advance' }
  | { t: 'chat'; from: string; text: string; kind: 'msg' | 'sys' }
  | { t: 'closed'; reason: 'empty' | 'host' | 'kicked' }
  | { t: 'error'; code: ErrCode }
  | { t: 'pong'; n: number }

export type ErrCode = 'invalid' | 'notFound' | 'expired' | 'revoked' | 'full' | 'forbidden' | 'private' | 'state' | 'rate'
