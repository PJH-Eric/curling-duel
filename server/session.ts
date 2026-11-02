/** 與平台無關的連線層：Node（ws）與 Cloudflare Worker（Durable Object）共用同一份訊息路由。 */
import type { ClientMsg, ErrCode, ServerMsg } from './protocol'
import { cleanName, sanitizeConfig, type Conn, type Room, type RoomHub } from './rooms'

export const DEFAULT_ORIGINS = ['https://pjh-eric.github.io']
export const MAX_PAYLOAD = 32 * 1024
const PRIVATE_ORIGIN = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/

/**
 * 建立來源檢查。官方 GitHub Pages 網域固定放行；extra（逗號分隔）用來擴充其他前端網域。
 * allowPrivate：放行 localhost 與區域網路私有網段（本機／Wi-Fi 試玩用，正式環境不要開）。
 */
export function makeOriginCheck(extra: string | undefined, allowPrivate: boolean): (origin: string | null | undefined) => boolean {
  const list = [...new Set([...DEFAULT_ORIGINS, ...(extra ?? '').split(',').map((s) => s.trim()).filter(Boolean)])]
  return (origin) => {
    if (!origin) return true // 非瀏覽器（測試腳本）
    return list.includes('*') || list.includes(origin) || (allowPrivate && PRIVATE_ORIGIN.test(origin))
  }
}

export interface Session {
  sid: string
  name: string
  pid: string
  room: Room | null
  conn: Conn
  msgs: number
  windowStart: number
}

export class Gateway {
  constructor(readonly hub: RoomHub, private now: () => number = Date.now) {}

  open(conn: Conn): Session {
    return { sid: '', name: 'Guest', pid: '', room: null, conn, msgs: 0, windowStart: this.now() }
  }

  close(s: Session): void {
    if (s.room && s.pid) s.room.disconnect(s.pid, s.conn)
  }

  /** 處理一則原始文字訊息（含頻率限制與大小限制）。 */
  message(s: Session, raw: string): void {
    const err = (code: ErrCode) => s.conn.send({ t: 'error', code })
    const now = this.now()
    if (now - s.windowStart > 1000) {
      s.windowStart = now
      s.msgs = 0
    }
    if (++s.msgs > 40) return err('rate')
    if (raw.length > MAX_PAYLOAD) return err('invalid')
    let msg: ClientMsg
    try {
      msg = JSON.parse(raw) as ClientMsg
    } catch {
      return err('invalid')
    }
    if (!msg || typeof msg.t !== 'string') return err('invalid')
    try {
      this.route(s, msg, err)
    } catch (e) {
      console.error('handler error', e)
      err('invalid')
    }
  }

  private route(s: Session, msg: ClientMsg, err: (c: ErrCode) => void): void {
    const send = s.conn.send
    const hub = this.hub
    switch (msg.t) {
      case 'hello':
        s.sid = String(msg.sid ?? '').slice(0, 64)
        s.name = cleanName(msg.name)
        if (!s.sid) return err('invalid')
        return
      case 'ping':
        return send({ t: 'pong', n: Number(msg.n) || 0 })
      case 'list':
        return send({ t: 'rooms', rooms: hub.list() })
      case 'peek': {
        const room = hub.get(msg.code)
        if (!room || room.closed) return send({ t: 'peek', ok: false, reason: 'notFound' })
        const chk = room.checkInvite(msg.invite)
        if (chk.ok) return send({ t: 'peek', ok: true, code: room.code, host: room.members.get(room.hostPid)?.name ?? '', role: chk.scope })
        if (room.config.public) return send({ t: 'peek', ok: true, code: room.code, host: room.members.get(room.hostPid)?.name ?? '', role: 'player' })
        return send({ t: 'peek', ok: false, reason: chk.err })
      }
      case 'create': {
        if (!s.sid) return err('invalid')
        if (s.room) s.room.leave(s.pid)
        const room = hub.create(sanitizeConfig(msg.config))
        if (!room) return err('full')
        const r = room.join(s.sid, cleanName(msg.name, s.name), s.conn, 'player')
        if ('err' in r) return err(r.err)
        s.room = room
        s.pid = r.member.pid
        return
      }
      case 'join': {
        if (!s.sid) return err('invalid')
        const room = hub.get(msg.code)
        if (!room || room.closed) return err('notFound')
        // 邀請連結不會自動入房：必須由使用者確認暱稱後送出 join；角色一律由伺服器依邀請範圍決定
        let role: 'player' | 'spectator' = 'player'
        const existing = [...room.members.values()].find((m) => m.sid === s.sid)
        if (!existing) {
          if (msg.invite) {
            const chk = room.checkInvite(msg.invite)
            if (!chk.ok) return err(chk.err)
            role = chk.scope
          } else if (!room.config.public) return err('private')
          else role = room.phase === 'lobby' ? 'player' : 'spectator'
        }
        if (s.room && s.room !== room) s.room.leave(s.pid)
        const r = room.join(s.sid, cleanName(msg.name, s.name), s.conn, role)
        if ('err' in r) return err(r.err)
        s.room = room
        s.pid = r.member.pid
        return
      }
      default:
        if (!s.room || !s.pid) return err('state')
        s.room.handle(s.pid, msg)
        if (msg.t === 'leave') {
          s.room = null
          s.pid = ''
        }
    }
  }
}
