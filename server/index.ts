import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ClientMsg, ErrCode, ServerMsg } from './protocol'
import { cleanName, Room, RoomHub, sanitizeConfig, type Conn } from './rooms'

const PORT = Number(process.env.PORT ?? 3090)
const ORIGIN_ENV = process.env.GAME_ALLOWED_ORIGIN
const ORIGINS = (ORIGIN_ENV ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean)
// 沒有指定 GAME_ALLOWED_ORIGIN（本機／區域網路使用）時，額外放行同一個 Wi-Fi 內的私有網段，其他裝置才連得進來
const PRIVATE_ORIGIN = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/

/** 本機的區域網路 IPv4 位址（同一個 Wi-Fi 的裝置用它連進來）。 */
function lanAddresses(): string[] {
  const out: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list ?? []) if (n.family === 'IPv4' && !n.internal) out.push(n.address)
  }
  return out
}

const hub = new RoomHub()

function originOk(origin: string | undefined): boolean {
  if (!origin) return true // 非瀏覽器（測試腳本）
  return ORIGINS.includes('*') || ORIGINS.includes(origin) || (ORIGIN_ENV === undefined && PRIVATE_ORIGIN.test(origin))
}

const http = createServer((req, res) => {
  const origin = req.headers.origin
  const cors: Record<string, string> = origin && originOk(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors })
    res.end(JSON.stringify({ ok: true, rooms: hub.rooms.size }))
    return
  }
  res.writeHead(404, cors)
  res.end()
})

const wss = new WebSocketServer({ server: http, maxPayload: 32 * 1024, verifyClient: (info: { origin: string }) => originOk(info.origin) })

interface Session {
  sid: string
  name: string
  pid: string
  room: Room | null
  conn: Conn
  msgs: number
  windowStart: number
}

wss.on('connection', (ws: WebSocket) => {
  const send = (m: ServerMsg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m))
  }
  const s: Session = { sid: '', name: 'Guest', pid: '', room: null, conn: { send, close: () => ws.close() }, msgs: 0, windowStart: Date.now() }
  const err = (code: ErrCode) => send({ t: 'error', code })

  ws.on('message', (data) => {
    const now = Date.now()
    if (now - s.windowStart > 1000) {
      s.windowStart = now
      s.msgs = 0
    }
    if (++s.msgs > 40) return err('rate')
    let msg: ClientMsg
    try {
      msg = JSON.parse(String(data)) as ClientMsg
    } catch {
      return err('invalid')
    }
    if (!msg || typeof msg.t !== 'string') return err('invalid')
    try {
      route(s, msg, err)
    } catch (e) {
      console.error('handler error', e)
      err('invalid')
    }
  })
  ws.on('close', () => {
    if (s.room && s.pid) s.room.disconnect(s.pid)
  })
})

function route(s: Session, msg: ClientMsg, err: (c: ErrCode) => void): void {
  const send = s.conn.send
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

http.listen(PORT, () => {
  console.log(`[ice-duel] server listening on :${PORT}, origins=${ORIGINS.join(',')}${ORIGIN_ENV === undefined ? ' + 區域網路' : ''}`)
  if (ORIGIN_ENV === undefined) {
    const ips = lanAddresses()
    console.log('\n  同一個 Wi-Fi 的手機／平板／電腦，用瀏覽器開下面任一網址就能一起玩：')
    if (ips.length) for (const ip of ips) console.log(`    http://${ip}:5173`)
    else console.log('    （偵測不到區域網路 IP，請確認已連上 Wi-Fi）')
    console.log('  若連不上，請在 Windows 防火牆允許 Node.js 的「私人網路」連線（3090、5173 連接埠）。\n')
  }
})
