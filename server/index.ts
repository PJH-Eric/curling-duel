/** 本機／區域網路用的 Node 伺服器（npm run server）。正式環境改由 worker/index.ts（Cloudflare Worker）提供，兩邊共用 server/session.ts 的訊息路由。 */
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ServerMsg } from './protocol'
import { RoomHub } from './rooms'
import { DEFAULT_ORIGINS, Gateway, MAX_PAYLOAD, makeOriginCheck } from './session'

const PORT = Number(process.env.PORT ?? 3090)
const ORIGIN_ENV = process.env.GAME_ALLOWED_ORIGIN
// 沒有指定 GAME_ALLOWED_ORIGIN（本機／區域網路使用）時，額外放行 localhost:5173 與同一個 Wi-Fi 內的私有網段，其他裝置才連得進來
const originOk = makeOriginCheck(ORIGIN_ENV ?? 'http://localhost:5173', ORIGIN_ENV === undefined)
const ORIGINS = [...new Set([...DEFAULT_ORIGINS, ...(ORIGIN_ENV ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean)])]

/** 本機的區域網路 IPv4 位址（同一個 Wi-Fi 的裝置用它連進來）。 */
function lanAddresses(): string[] {
  const out: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list ?? []) if (n.family === 'IPv4' && !n.internal) out.push(n.address)
  }
  return out
}

const hub = new RoomHub()
const gateway = new Gateway(hub)
/* 房間狀態也會因倒數、斷線逾時改變：每秒檢查一次，有變化才推新的房間列表給大廳 */
setInterval(() => gateway.tick(), 1000).unref()

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

const wss = new WebSocketServer({ server: http, maxPayload: MAX_PAYLOAD, verifyClient: (info: { origin: string }) => originOk(info.origin) })

wss.on('connection', (ws: WebSocket) => {
  const send = (m: ServerMsg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m))
  }
  const s = gateway.open({ send, close: () => ws.close() })
  ws.on('message', (data) => gateway.message(s, String(data)))
  ws.on('close', () => gateway.close(s))
})

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
