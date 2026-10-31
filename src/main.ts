import './ui/style.css'
import { LocalBackend } from './game/backend'
import { mountGame } from './screens/game'
import { getSettings, loadSettings, onSettings } from './game/settings'
import { audio } from './audio/engine'
import { getLang, onLangChange, t } from './i18n'
import { homeScreen, howtoScreen, missionsScreen, recordsScreen, setupScreen, type MenuNav } from './screens/menu'
import { openSettings } from './screens/settings'
import type { GameKind, GameSetup } from './core/game'
import type { AiLevel } from './core/ai'
import { MISSIONS } from './core/missions'
import { toast } from './ui/kit'
import { loadModelOverrides } from './scene/models'
import { initAnalytics, pageView, track } from './analytics'
import { NetClient } from './net/client'
import { serverHttpUrl } from './net/config'
import { OnlineBackend } from './game/online'
import { errText, inviteScreen, lobbyScreen, roomScreen, defaultRoomConfig } from './screens/online'
import type { RoomListItem, RoomPub, ServerMsg } from '../server/protocol'
import { updateSettings } from './game/settings'
import type { GameSetup as GS, GameState } from './core/game'

loadSettings()
void loadModelOverrides()
const app = document.getElementById('app')!
let dispose: (() => void) | null = null
let rerender: (() => void) | null = null

function show(build: () => HTMLElement, screen?: string): void {
  if (screen) pageView(screen)
  dispose?.()
  dispose = null
  app.replaceChildren()
  rerender = () => {
    app.replaceChildren(build())
  }
  rerender()
}

const nav: MenuNav = {
  home: () => show(() => homeScreen(nav), 'home'),
  setup: (k: GameKind) => show(() => setupScreen(nav, k), 'setup'),
  missions: () => show(() => missionsScreen(nav), 'missions'),
  howto: () => show(() => howtoScreen(nav), 'howto'),
  records: () => show(() => recordsScreen(nav), 'records'),
  online: () => enterLobby(),
  settings: () => {
    openSettings()
  },
  startLocal(setup: GameSetup, level: AiLevel, modeLabel: string) {
    const play = () => {
      dispose?.()
      app.replaceChildren()
      rerender = null
      const be = new LocalBackend({ setup, level, playerName: getSettings().nickname || t('common.you') })
      dispose = mountGame(app, { backend: be, modeLabel, onHome: () => nav.home(), onAgain: play, onSettings: () => openSettings() })
    }
    play()
  },
  startMission(id: number) {
    const play = (mid: number) => {
      dispose?.()
      app.replaceChildren()
      rerender = null
      const be = new LocalBackend({ setup: { kind: 'mission', missionId: mid }, level: 'normal', playerName: getSettings().nickname || t('common.you') })
      const next = MISSIONS.find((m) => m.id === mid + 1)
      dispose = mountGame(app, { backend: be, modeLabel: t('mode.mission'), onHome: () => nav.missions(), onAgain: () => play(mid), onSettings: () => openSettings(), onNextMission: next ? () => play(mid + 1) : undefined })
    }
    play(id)
  },
}

/* ───────── 線上 ───────── */
const net = new NetClient()
type You = { pid: string; role: 'player' | 'spectator'; team: number; player: number }
let mode: 'menu' | 'lobby' | 'invite' | 'room' | 'game' = 'menu'
let rooms: RoomListItem[] = []
let curRoom: { room: RoomPub; you: You } | null = null
let pendingRoom: 'create' | 'join' | null = null
let pendingVia = 'lobby'
let chatLog: { from: string; text: string; kind: string }[] = []
let inviteInfo: { token: string; scope: string } | null = null
let pendingSetup: GS | null = null
let lobbyState: { connecting: boolean; failed: boolean } = { connecting: false, failed: false }
let inviteState: { code: string; token: string; host?: string; error?: string; checking: boolean } | null = null

const nick = () => getSettings().nickname.trim() || 'Guest'

async function enterLobby(): Promise<void> {
  if (!serverHttpUrl()) return void toast(t('online.noServer'), 'warn')
  mode = 'lobby'
  lobbyState = { connecting: true, failed: false }
  renderLobby()
  const ok = await net.connect(nick())
  if (mode !== 'lobby') return
  lobbyState = { connecting: false, failed: !ok }
  if (ok) net.send({ t: 'list' })
  renderLobby()
}

function renderLobby(): void {
  pageView('lobby')
  show(() => lobbyScreen(nav, net, (n) => updateSettings({ nickname: n }), {
    create: (cfg) => { pendingRoom = 'create'; void net.connect(nick()).then(() => net.send({ t: 'create', name: nick(), config: cfg })) },
    join: (code) => { if (!code) return; pendingRoom = 'join'; net.roomCode = code.toUpperCase(); void net.connect(nick()).then(() => net.send({ t: 'join', code, name: nick() })) },
    refresh: () => void enterLobby(),
    back: () => { net.close(); mode = 'menu'; nav.home() },
  }, rooms, lobbyState.connecting, lobbyState.failed))
}

function renderRoom(): void {
  if (!curRoom) return
  mode = 'room'
  const { room, you } = curRoom
  pageView('room')
  show(() => roomScreen(nav, {
    room, you, chat: chatLog, invite: inviteInfo, net,
    leave: () => { net.send({ t: 'leave' }); net.roomCode = null; curRoom = null; chatLog = []; inviteInfo = null; void enterLobby() },
    copyInvite: (u) => { void navigator.clipboard?.writeText(u).then(() => toast(t('common.copied'), 'ok'), () => toast(u)) },
    inviteUrl: (tok) => `${location.origin}${location.pathname}?room=${room.code}&invite=${encodeURIComponent(tok)}`,
  }))
}

function mountOnline(g: GameState, setup: GS): void {
  if (!curRoom) return
  mode = 'game'
  dispose?.()
  app.replaceChildren()
  rerender = null
  const be = new OnlineBackend(setup, g, curRoom.room, curRoom.you, net, () => undefined)
  dispose = mountGame(app, {
    backend: be, modeLabel: t(`mode.${setup.kind}` as 'mode.standard'),
    onHome: () => { net.send({ t: 'leave' }); net.close(); curRoom = null; chatLog = []; mode = 'menu'; nav.home() },
    onAgain: () => be.toLobby(true), onRoom: () => be.toLobby(false), onSettings: () => openSettings(),
  })
}

net.on((m: ServerMsg) => {
  switch (m.t) {
    case 'rooms':
      rooms = m.rooms
      if (mode === 'lobby') renderLobby()
      break
    case 'room': {
      if (pendingRoom) { track(`room_${pendingRoom}`, { mode: 'online', via: pendingVia }); pendingRoom = null; pendingVia = 'lobby' }
      curRoom = { room: m.room, you: m.you }
      net.roomCode = m.room.code
      if (mode === 'invite') history.replaceState(null, '', location.pathname)
      if (m.room.phase === 'lobby') renderRoom()
      break
    }
    case 'invite':
      inviteInfo = { token: m.token, scope: m.scope }
      if (mode === 'room') renderRoom()
      break
    case 'chat': {
      chatLog.push({ from: m.from, text: m.text, kind: m.kind })
      if (chatLog.length > 100) chatLog.shift()
      if (mode === 'room') {
        const box = document.querySelector('.room-chat .chat-msgs')
        if (box) {
          const d = document.createElement('div')
          d.className = `chat-msg ${m.kind === 'sys' ? 'sys' : ''}`
          if (m.kind !== 'sys') { const b = document.createElement('b'); b.textContent = m.from; d.append(b) }
          d.append(document.createTextNode(m.text))
          box.append(d)
          box.closest('.sa-viewport')?.scrollTo({ top: 1e6 })
        }
      }
      break
    }
    case 'started':
      pendingSetup = m.setup
      break
    case 'snapshot':
      if (pendingSetup && curRoom) mountOnline(m.g, pendingSetup)
      break
    case 'closed':
      toast(m.reason === 'kicked' ? t('online.failed') : t('online.roomClosed'), 'warn')
      net.roomCode = null
      curRoom = null
      chatLog = []
      void enterLobby()
      break
    case 'error':
      if (mode === 'invite' && inviteState) { inviteState = { ...inviteState, error: errText(m.code), checking: false }; renderInvite() } else toast(errText(m.code), 'warn')
      break
    case 'peek':
      if (inviteState) {
        inviteState = m.ok ? { ...inviteState, host: m.host, checking: false } : { ...inviteState, error: errText(m.reason ?? 'invalid'), checking: false }
        renderInvite()
      }
      break
    default:
      break
  }
})

function renderInvite(): void {
  if (!inviteState) return
  mode = 'invite'
  const st = inviteState
  pageView('invite')
  show(() => inviteScreen(nav, st, (name) => {
    updateSettings({ nickname: name })
    net.roomCode = null
    pendingRoom = 'join'; pendingVia = 'invite_link'
    void net.connect(name).then(() => net.send({ t: 'join', code: st.code, name, invite: st.token }))
  }, () => { history.replaceState(null, '', location.pathname); inviteState = null; net.close(); mode = 'menu'; nav.home() }))
}

async function handleInviteUrl(code: string, token: string): Promise<void> {
  if (!serverHttpUrl()) return void nav.home()
  inviteState = { code, token, checking: true }
  renderInvite()
  const ok = await net.connect(nick())
  if (!ok) { inviteState = { code, token, checking: false, error: t('online.failed') }; renderInvite(); return }
  net.send({ t: 'peek', code, invite: token })
}
void defaultRoomConfig
initAnalytics()

onLangChange(() => {
  document.title = getLang() === 'en' ? t('app.title') : `${t('app.title')} Ice Duel`
  rerender?.()
})
onSettings(() => undefined)
document.addEventListener('pointerdown', () => audio.unlock(), { once: true })

// 開發用：?kind=standard&ai=hard 直接進入對局
const q = new URLSearchParams(location.search)
if (import.meta.env.DEV && q.get('kind')) {
  nav.startLocal({ kind: q.get('kind') as GameKind, missionId: Number(q.get('m') ?? 1), playersPerTeam: (Math.min(4, Math.max(1, Number(q.get('ppt') ?? 1))) as 1 | 2 | 3 | 4) }, (q.get('ai') as AiLevel) ?? 'normal', q.get('kind')!)
} else if (q.get('room') && q.get('invite')) void handleInviteUrl(q.get('room')!.toUpperCase(), q.get('invite')!)
else nav.home()
