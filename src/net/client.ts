import type { ClientMsg, ServerMsg } from '../../server/protocol'
import { storageGet, storageSet } from '../game/settings'
import { serverHttpUrl, serverWsUrl } from './config'

declare global {
  interface Window {
    GameBackend?: {
      createSocket(address: string): WebSocket
      pinInvite(address: string): string
    }
  }
}

export type NetStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline'
type RoomRequest = Extract<ClientMsg, { t: 'create' | 'join' | 'peek' }>

function sid(): string {
  let s = storageGet('iceduel.sid')
  if (!s) {
    s = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')
    storageSet('iceduel.sid', s)
  }
  return s
}

/** WebSocket 連線：自動重連、心跳、重連後重新加入房間。 */
export class NetClient {
  private ws: WebSocket | null = null
  private address: string | null = null
  private retryTimer: number | null = null
  private roomRouting = false
  private action = 0
  private handlers = new Set<(m: ServerMsg) => void>()
  private statusHandlers = new Set<(s: NetStatus, ping: number) => void>()
  status: NetStatus = 'idle'
  ping = 0
  name = 'Guest'
  roomCode: string | null = null
  private wantOpen = false
  private retry = 0
  private pingTimer: number | null = null
  private sentAt = 0
  private openWaiters: ((ok: boolean) => void)[] = []

  on(fn: (m: ServerMsg) => void): () => void {
    this.handlers.add(fn)
    return () => this.handlers.delete(fn)
  }
  onStatus(fn: (s: NetStatus, ping: number) => void): () => void {
    this.statusHandlers.add(fn)
    return () => this.statusHandlers.delete(fn)
  }
  private setStatus(s: NetStatus): void {
    this.status = s
    this.statusHandlers.forEach((f) => f(s, this.ping))
  }

  /** 連線。免費主機睡眠時可能要等約一分鐘，所以逾時較長。 */
  connect(name: string): Promise<boolean> {
    ++this.action
    return this.connectTo(name, serverWsUrl())
  }

  async requestRoom(name: string, message: RoomRequest): Promise<boolean> {
    const action = ++this.action
    const origin = serverHttpUrl()
    if (!origin) return false
    let code = message.t === 'create' ? undefined : message.code
    let reservation: string | undefined
    if (!this.roomRouting) {
      try {
        const response = await fetch(new URL('/room-reservations', origin), { signal: AbortSignal.timeout(3000) })
        if (response.ok && response.headers.get('Content-Type')?.includes('application/json')) {
          this.roomRouting = (await response.json()).roomRouting === true
        }
      } catch { /* 本機 Node 伺服器沿用既有連線方式。 */ }
    }
    if (this.action !== action) return false
    if (this.roomRouting && message.t === 'create') {
      try {
        const response = await fetch(new URL('/room-reservations', origin), { method: 'POST', signal: AbortSignal.timeout(5000) })
        if (this.action !== action) return false
        if (response.status === 409) {
          this.handlers.forEach((fn) => fn({ t: 'error', code: 'full' }))
          return true
        }
        if (!response.ok) return false
        const room = await response.json() as { code: string; token: string }
        code = room.code
        reservation = room.token
      } catch { return false }
    }
    if (this.action !== action) return false
    const ok = await this.connectTo(name, this.roomRouting ? serverWsUrl(code, reservation) : serverWsUrl())
    if (!ok || this.action !== action) return false
    this.send(message)
    return true
  }

  confirmRoom(code: string): void {
    this.roomCode = code
    if (this.roomRouting) this.address = serverWsUrl(code)
  }

  private connectTo(name: string, url: string | null): Promise<boolean> {
    this.name = name
    if (!url) return Promise.resolve(false)
    if (this.address !== url) {
      this.stopSocket()
      this.address = url
    }
    if (this.status === 'online') {
      this.send({ t: 'hello', sid: sid(), name })
      return Promise.resolve(true)
    }
    this.wantOpen = true
    return new Promise((res) => {
      this.openWaiters.push(res)
      if (!this.ws && this.retryTimer === null) this.open(url)
    })
  }

  private open(url: string): void {
    this.setStatus(this.retry > 0 ? 'reconnecting' : 'connecting')
    let ws: WebSocket
    try {
      ws = window.GameBackend?.createSocket(url) ?? new WebSocket(url)
    } catch {
      this.fail()
      return
    }
    this.ws = ws
    const timeout = window.setTimeout(() => ws.close(), 70_000)
    ws.onopen = () => {
      window.clearTimeout(timeout)
      if (this.ws !== ws) return
      this.retry = 0
      this.send({ t: 'hello', sid: sid(), name: this.name })
      if (this.roomCode) this.send({ t: 'join', code: this.roomCode, name: this.name })
      this.setStatus('online')
      this.openWaiters.splice(0).forEach((f) => f(true))
      this.startPing()
    }
    ws.onmessage = (e) => {
      if (this.ws !== ws) return
      let m: ServerMsg
      try {
        m = JSON.parse(String(e.data)) as ServerMsg
      } catch {
        return
      }
      if (m.t === 'pong') {
        this.ping = Math.round(performance.now() - this.sentAt)
        this.statusHandlers.forEach((f) => f(this.status, this.ping))
        return
      }
      this.handlers.forEach((f) => f(m))
    }
    ws.onclose = () => {
      window.clearTimeout(timeout)
      if (this.ws !== ws) return
      this.stopPing()
      this.ws = null
      if (this.wantOpen) this.fail()
    }
    ws.onerror = () => undefined
  }

  private fail(): void {
    this.retry += 1
    if (this.retry > 6) {
      this.setStatus('offline')
      this.openWaiters.splice(0).forEach((f) => f(false))
      this.retry = 0
      return
    }
    this.setStatus('reconnecting')
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null
      if (this.wantOpen && this.address) this.open(this.address)
    }, Math.min(8000, 800 * this.retry))
  }

  private startPing(): void {
    this.stopPing()
    this.pingTimer = window.setInterval(() => {
      this.sentAt = performance.now()
      this.send({ t: 'ping', n: 1 })
    }, 5000)
  }
  private stopPing(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  send(m: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m))
  }

  private stopSocket(): void {
    this.stopPing()
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.openWaiters.splice(0).forEach((resolve) => resolve(false))
    this.ws?.close()
    this.ws = null
    this.retry = 0
    this.ping = 0
    this.setStatus('idle')
  }

  close(): void {
    ++this.action
    this.wantOpen = false
    this.roomCode = null
    this.address = null
    this.stopSocket()
  }
}
