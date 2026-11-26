/** 將大廳與每個房間的 WebSocket 路由到各自的 Durable Object。 */
import { DurableObject } from 'cloudflare:workers'
import type { RoomListItem, ServerMsg } from '../server/protocol'
import { ROOM_CODE_PATTERN, RoomHub } from '../server/rooms'
import { Gateway, makeOriginCheck, type Session } from '../server/session'
import { RoomDirectory } from './room-directory'

export interface Env {
  HUB: DurableObjectNamespace<GameHub>
  GAME_ALLOWED_ORIGIN?: string
  ALLOW_PRIVATE_ORIGINS?: string
}

const DO_VERSION = 'v2'
const INDEX_NAME = `lobby-${DO_VERSION}`
const ROOM_PREFIX = `room-${DO_VERSION}-`
const RESERVATIONS = '/room-reservations'
const GENERATION_HEADER = 'x-ice-room-generation'
const CREATE_HEADER = 'x-ice-room-create'

function hubStub(env: Env, name: string) {
  const id = env.HUB.idFromName(name)
  return env.HUB.get(id, { locationHint: 'apac' })
}

async function measure(req: Request, stub: DurableObjectStub<GameHub>, forwarded = req): Promise<Response> {
  const started = performance.now()
  const response = await stub.fetch(forwarded)
  const rtt = performance.now() - started
  const headers = new Headers(response.headers)
  headers.set('x-do-rtt-ms', rtt.toFixed(1))
  const colo = req.cf?.colo
  headers.set('x-edge-colo', typeof colo === 'string' ? colo : 'unknown')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
    webSocket: response.webSocket,
  })
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const origin = req.headers.get('Origin')
    const originOk = makeOriginCheck(env.GAME_ALLOWED_ORIGIN, env.ALLOW_PRIVATE_ORIGINS === '1')
    const cors = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' })
    if (origin && originOk(origin)) {
      cors.set('Access-Control-Allow-Origin', origin)
      cors.set('Access-Control-Expose-Headers', 'x-do-rtt-ms, x-edge-colo')
    }

    if (url.pathname === '/health' || url.pathname === RESERVATIONS) {
      if (url.pathname === RESERVATIONS) {
        if (!originOk(origin)) return new Response('Forbidden origin', { status: 403 })
        if (req.method === 'GET') return Response.json({ roomRouting: true }, { headers: cors })
        if (req.method !== 'POST') return new Response(null, { status: 405, headers: cors })
      }
      try {
        const response = await measure(req, hubStub(env, INDEX_NAME))
        for (const [key, value] of cors) response.headers.set(key, value)
        return response
      } catch (error) {
        console.error('lobby_request_failed', error)
        if (url.pathname === '/health') return Response.json({ ok: true, rooms: null }, { headers: cors })
        return new Response(null, { status: 503, headers: cors })
      }
    }

    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response(null, { status: 404, headers: cors })
    if (!originOk(origin)) return new Response('Forbidden origin', { status: 403 })

    const code = url.searchParams.get('room')?.toUpperCase()
    const token = url.searchParams.get('reservation')
    const lobby = hubStub(env, INDEX_NAME)
    const headers = new Headers(req.headers)
    headers.delete(GENERATION_HEADER)
    headers.delete(CREATE_HEADER)
    url.searchParams.delete('reservation')
    if (code && ROOM_CODE_PATTERN.test(code)) {
      const entry = await lobby.lookupRoom(code)
      if (entry) {
        headers.set(GENERATION_HEADER, entry.token)
        if (!entry.active && token === entry.token) headers.set(CREATE_HEADER, '1')
        return measure(req, hubStub(env, ROOM_PREFIX + code), new Request(url, { headers }))
      }
    }
    return measure(req, lobby, new Request(url, { headers }))
  },
} satisfies ExportedHandler<Env>

export class GameHub extends DurableObject<Env> {
  private directory?: RoomDirectory
  private hub: RoomHub
  private gateway: Gateway
  private code?: string
  private canCreate = new WeakSet<Session>()
  private generation = ''
  private leaseTimer?: ReturnType<typeof setInterval>
  private lastSummary = ''
  private publication = Promise.resolve()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    const name = ctx.id.name
    this.code = name?.startsWith(ROOM_PREFIX) ? name.slice(ROOM_PREFIX.length) : undefined
    if (!this.code) this.directory = new RoomDirectory(ctx.storage)

    this.hub = new RoomHub(Date.now, this.code ? { code: this.code, changed: () => this.publishRoom() } : undefined)
    this.gateway = new Gateway(this.hub, Date.now, {
      listRooms: () => this.directory?.list() ?? [],
      canCreate: (session) => this.canCreate.delete(session),
    })

    ctx.blockConcurrencyWhile(async () => {
      await this.directory?.load()
      if (await ctx.storage.get('creationLogged')) return
      await ctx.storage.put('creationLogged', true)
      console.log('durable_object_created', { id: ctx.id.toString(), version: DO_VERSION, role: this.code ? 'room' : 'lobby' })
    })
  }

  lookupRoom(code: string) {
    return this.directory?.lookup(code)
  }

  async updateRoom(code: string, token: string, state: { summary: RoomListItem | null } | null, announce: boolean): Promise<void> {
    if (!await this.directory?.update(code, token, state)) return
    this.gateway.pushRooms()
    if (announce && state?.summary) this.gateway.announceRoom(state.summary)
  }

  private publishRoom(renew = false): void {
    const code = this.code
    if (!code) return
    const room = this.hub.get(code)
    const state = room ? { summary: room.config.public && room.hasHumans() ? room.listItem() : null } : null
    const previous = this.lastSummary
    const next = JSON.stringify(state)
    if (room) this.leaseTimer ??= setInterval(() => this.publishRoom(true), 30_000)
    else if (this.leaseTimer !== undefined) {
      clearInterval(this.leaseTimer)
      this.leaseTimer = undefined
    }
    if (!renew && next === previous) return
    this.lastSummary = next
    const generation = this.generation
    const announce = (previous === '' || previous === 'null') && !!state?.summary
    this.publication = this.publication
      .then(() => hubStub(this.env, INDEX_NAME).updateRoom(code, generation, state, announce))
      .catch((error) => console.error('room_directory_update_failed', error))
    this.ctx.waitUntil(this.publication)
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/health') return Response.json({ ok: true, rooms: this.directory?.count() ?? this.hub.rooms.size })
    if (url.pathname === RESERVATIONS && this.directory && req.method === 'POST') {
      const reservation = await this.directory.reserve()
      return reservation ? Response.json(reservation) : Response.json({ error: 'full' }, { status: 409 })
    }
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 })

    if (this.code) {
      const generation = req.headers.get(GENERATION_HEADER)
      if (!generation) return new Response('Room not found', { status: 404 })
      if (generation !== this.generation) {
        if (this.hub.rooms.size) return new Response('Room not found', { status: 404 })
        this.generation = generation
        this.canCreate = new WeakSet()
      }
    }
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    // 房間計時器與對局狀態留在各自的 DO 記憶體，使用一般 WebSocket。
    server.accept()
    const session = this.gateway.open({
      send: (message: ServerMsg) => {
        if (server.readyState === WebSocket.OPEN) server.send(JSON.stringify(message))
      },
      close: () => {
        if (server.readyState === WebSocket.OPEN) server.close(1000, 'closed')
      },
    })
    if (this.code && req.headers.get(CREATE_HEADER) === '1') this.canCreate.add(session)
    server.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data === 'string') this.gateway.message(session, event.data)
    })
    const gone = () => this.gateway.close(session)
    server.addEventListener('close', gone)
    server.addEventListener('error', gone)
    return new Response(null, { status: 101, webSocket: client })
  }
}
