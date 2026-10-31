import type { RoomConfig, RoomListItem, RoomPub, SeatPub } from '../../server/protocol'
import type { AiLevel } from '../core/ai'
import type { NetClient } from '../net/client'
import { t, type Key } from '../i18n'
import { h } from '../ui/dom'
import { icon } from '../ui/icons'
import { Button, IconButton, LangMenu, ScrollArea, Segmented, Select, TextField, Toggle, toast } from '../ui/kit'
import { getSettings, TEAM_COLORS, updateSettings } from '../game/settings'
import type { MenuNav } from './menu'

function bar(nav: MenuNav, title: Key, back: () => void, extra?: Node): HTMLElement {
  return h('header', { class: 'topbar' }, IconButton('back', t('common.back'), back), h('div', { class: 'brand' }, t(title)), h('div', { class: 'spacer' }), extra ?? null, LangMenu((l) => updateSettings({ lang: l })), IconButton('gear', t('common.settings'), () => nav.settings()))
}
function shell(top: HTMLElement, ...content: Node[]): HTMLElement {
  const sa = ScrollArea({ label: '' }, h('div', { class: 'wrap' }, ...content))
  return h('div', { class: 'screen' }, top, h('div', { class: 'page' }, sa.el))
}
function shellFooter(top: HTMLElement, footer: Node, ...content: Node[]): HTMLElement {
  const sa = ScrollArea({ label: '' }, h('div', { class: 'wrap' }, ...content))
  return h('div', { class: 'screen' }, top, h('div', { class: 'page' }, sa.el), h('div', { class: 'footbar' }, footer))
}
export function pingTag(net: NetClient): HTMLElement {
  const el = h('span', { class: 'ping' }, h('i', { class: 'net-dot' }), h('span'))
  const upd = () => {
    const dot = el.querySelector('i')!
    const label = el.querySelector('span')!
    const ok = net.status === 'online'
    dot.className = `net-dot${ok ? (net.ping > 300 ? ' bad' : net.ping > 120 ? ' mid' : '') : ' bad'}`
    label.textContent = ok ? (net.ping ? t('net.ping', { n: net.ping }) : t('net.online')) : net.status === 'reconnecting' ? t('net.reconnecting') : t('net.offline')
  }
  upd()
  net.onStatus(upd)
  return el
}

export function errText(code: string): string {
  const map: Record<string, Key> = { notFound: 'online.roomMissing', expired: 'online.inviteExpired', revoked: 'online.inviteRevoked', invalid: 'online.inviteInvalid', private: 'online.inviteInvalid', full: 'room.spectatorsFull', rate: 'err.generic' }
  return t(map[code] ?? 'err.generic')
}

export function defaultRoomConfig(): RoomConfig {
  return { setup: { kind: 'standard', playersPerTeam: 1, timerSec: 45, standard: { stonesPerTeam: 8, ends: 4 }, grid: { rounds: 3 }, hole: { rounds: 2 } }, level: 'normal', public: true, maxSpectators: 20 }
}

/** 大廳：暱稱、建立房間、房號加入、公開房間列表。 */
export function lobbyScreen(nav: MenuNav, net: NetClient, onNick: (n: string) => void, actions: { create(cfg: RoomConfig): void; join(code: string): void; refresh(): void; back(): void }, rooms: RoomListItem[], connecting: boolean, failed: boolean): HTMLElement {
  let nick = getSettings().nickname
  const fallbackName = t('online.defaultName', { n: String(1000 + Math.floor(Math.random() * 9000)) })
  const useName = (): void => { if (!nick.trim()) { nick = fallbackName; onNick(fallbackName) } }
  const nameField = TextField({ label: t('online.nickname'), value: nick, maxLength: 12, placeholder: fallbackName, onInput: (v) => { nick = v; onNick(v) } })
  let code = ''
  const codeField = TextField({ label: t('online.joinCode'), maxLength: 5, onInput: (v) => { code = v.toUpperCase() }, onEnter: () => actions.join(code) })
  const list = rooms.length === 0 ? h('div', { class: 'empty card', style: { clipPath: 'none', minHeight: '0' }, text: t('online.noRooms') }) : h('div', { class: 'stack' }, ...rooms.map((r) => h('div', { class: 'room-row' },
    h('div', { class: 'grow' }, h('b', { text: `${r.code} · ${t(`mode.${r.kind}` as Key)}` }), h('div', { class: 'muted', text: `${r.host} · ${r.players}/${r.capacity} · ${t('common.spectator')} ${r.spectators}` })),
    Button({ label: r.phase === 'lobby' ? t('online.join') : t('common.spectator'), variant: 'primary', onClick: () => actions.join(r.code) }))))
  const status = connecting ? h('div', { class: 'loading', style: { position: 'static', background: 'none' } }, h('div', {}, h('div', { class: 'spinner' }), h('div', { text: t('online.waking') }))) : failed ? h('div', { class: 'card', style: { clipPath: 'none' } }, h('b', { text: t('online.failed') }), Button({ label: t('common.retry'), onClick: () => actions.refresh() })) : null
  const body = h('div', { class: 'stack' }, status,
    h('div', { class: 'grid grid-2' },
      h('div', { class: 'card', style: { clipPath: 'none' } }, nameField.el, Button({ label: t('online.createRoom'), icon: 'plus', variant: 'primary', size: 'lg', disabled: connecting || failed, onClick: () => { useName(); actions.create(defaultRoomConfig()) } })),
      h('div', { class: 'card', style: { clipPath: 'none' } }, codeField.el, Button({ label: t('online.join'), icon: 'users', disabled: connecting || failed, onClick: () => { useName(); actions.join(code) } }))),
    h('div', { class: 'row' }, h('b', { text: t('online.rooms') }), Button({ label: t('online.refresh'), icon: 'refresh', size: 'sm', onClick: () => actions.refresh() })), list)
  return shell(bar(nav, 'online.title', actions.back, pingTag(net)), body)
}

/** 邀請連結：不會自動入房，先顯示並確認暱稱。 */
export function inviteScreen(nav: MenuNav, state: { code: string; host?: string; error?: string; checking: boolean }, onJoin: (name: string) => void, onBack: () => void): HTMLElement {
  let nick = getSettings().nickname
  const body = h('div', { class: 'card', style: { clipPath: 'none', maxWidth: '480px', margin: '20px auto' } })
  if (state.checking) body.append(h('div', { class: 'spinner' }), h('div', { class: 'center', text: t('online.connecting') }))
  else if (state.error) body.append(h('h3', { text: state.error }), Button({ label: t('online.backLobby'), onClick: onBack }))
  else {
    const fallbackName = t('online.defaultName', { n: String(1000 + Math.floor(Math.random() * 9000)) })
    const tf = TextField({ label: t('online.nickname'), value: nick, maxLength: 12, placeholder: fallbackName, onInput: (v) => { nick = v }, hint: t('online.inviteName'), onEnter: () => go() })
    const go = () => onJoin(nick.trim() || fallbackName)
    body.append(h('h3', { text: t('online.invited', { code: state.code }) }), h('div', { class: 'muted', text: state.host ? `${t('common.host')}：${state.host}` : '' }), tf.el, Button({ label: t('online.joinInvite'), variant: 'primary', size: 'lg', onClick: go }), Button({ label: t('common.cancel'), variant: 'ghost', onClick: onBack }))
  }
  return shell(bar(nav, 'online.title', onBack), body)
}

export interface RoomCtx {
  room: RoomPub
  you: { pid: string; role: 'player' | 'spectator'; team: number; player: number }
  chat: { from: string; text: string; kind: string }[]
  invite: { token: string; scope: string } | null
  net: NetClient
  leave(): void
  copyInvite(url: string): void
  inviteUrl(token: string): string
}

/** 房間：座位、設定、邀請連結、聊天、開始。 */
let autoInviteFor = ''

export function roomScreen(nav: MenuNav, c: RoomCtx): HTMLElement {
  const { room, you, net } = c
  const host = you.pid === room.hostPid
  const send = net.send.bind(net)
  const colors = [TEAM_COLORS[getSettings().teamColor].hex, TEAM_COLORS[(getSettings().teamColor + 1) % 4].hex]
  const seatEl = (s: SeatPub) => {
    const mine = s.pid === you.pid
    let label = t('room.empty')
    if (s.kind === 'human') label = s.name + (mine ? ` ${t('room.you')}` : '') + (s.pid === room.hostPid ? ' ★' : '')
    else if (s.kind === 'ai') label = t('room.aiSeat', { level: t(`ai.${s.level ?? 'normal'}` as Key) })
    const acts = h('div', { class: 'row' })
    if (s.kind === 'empty') {
      acts.append(Button({ label: t('room.takeSeat'), size: 'sm', onClick: () => send({ t: 'seat', team: s.team, player: s.player }) }))
      if (host) acts.append(Button({ label: t('room.addAi'), size: 'sm', icon: 'plus', onClick: () => send({ t: 'addAi', team: s.team, player: s.player, level: room.config.level }) }))
    } else if (s.kind === 'ai' && host) {
      acts.append(Button({ label: t('room.removeAi'), size: 'sm', variant: 'ghost', onClick: () => send({ t: 'removeAi', team: s.team, player: s.player }) }))
    } else if (s.kind === 'human' && host && !mine) {
      acts.append(Button({ label: t('room.kick'), size: 'sm', variant: 'danger', onClick: () => send({ t: 'kick', pid: s.pid! }) }))
    }
    return h('div', { class: 'seat', style: { ['--seat' as string]: colors[s.team] } }, h('span', { class: 'name', text: label }), acts)
  }
  const teamCol = (team: number) => h('div', { class: 'stack' }, h('b', { text: team === 0 ? t('room.teamA') : t('room.teamB') }), ...room.seats.filter((s) => s.team === team).map(seatEl))
  const seats = h('div', { class: 'room-grid' }, teamCol(0), room.config.setup.kind === 'mission' ? null : teamCol(1))
  const specs = h('div', { class: 'stack' }, h('b', { text: `${t('room.spectators')} (${room.spectators.length}/${room.config.maxSpectators})` }),
    ...room.spectators.map((s) => h('div', { class: 'seat' }, h('span', { class: 'name', text: s.name + (s.pid === you.pid ? ` ${t('room.you')}` : '') }), host && s.pid !== you.pid ? Button({ label: t('room.kick'), size: 'sm', variant: 'danger', onClick: () => send({ t: 'kick', pid: s.pid }) }) : null)),
    you.role === 'player' ? Button({ label: t('room.toSpectate'), size: 'sm', icon: 'eye', onClick: () => send({ t: 'spectate' }) }) : null)
  const upd = (patch: Partial<RoomConfig['setup']> & { level?: AiLevel; public?: boolean }) => {
    const cfg: RoomConfig = JSON.parse(JSON.stringify(room.config))
    if (patch.kind) cfg.setup.kind = patch.kind
    if (patch.playersPerTeam) cfg.setup.playersPerTeam = patch.playersPerTeam
    if (patch.timerSec !== undefined) cfg.setup.timerSec = patch.timerSec
    if (patch.level) cfg.level = patch.level
    if (patch.public !== undefined) cfg.public = patch.public
    send({ t: 'config', config: cfg })
  }
  const settings = host ? h('div', { class: 'stack' }, h('b', { text: t('room.settings') }),
    Segmented({ label: t('room.pickMode'), value: room.config.setup.kind, options: [{ value: 'standard', label: t('mode.standard') }, { value: 'grid', label: t('mode.grid') }, { value: 'hole', label: t('mode.hole') }], onChange: (v) => upd({ kind: v as 'standard' }) }),
    Segmented({ label: t('setup.teams'), value: room.config.setup.playersPerTeam ?? 1, options: [{ value: 1, label: t('setup.t1') }, { value: 2, label: t('setup.t2') }, { value: 3, label: t('setup.t3') }, { value: 4, label: t('setup.t4') }], onChange: (v) => upd({ playersPerTeam: v as 1 }) }),
    Segmented({ label: t('setup.ai'), value: room.config.level, options: [{ value: 'easy', label: t('setup.ai.easy') }, { value: 'normal', label: t('setup.ai.normal') }, { value: 'hard', label: t('setup.ai.hard') }], onChange: (v) => upd({ level: v as AiLevel }) }),
    Select({ label: t('room.timer'), value: room.config.setup.timerSec ?? 45, options: [30, 45, 60, 0].map((v) => ({ value: v, label: v === 0 ? t('setup.timer.unlimited') : t('setup.seconds', { n: v }) })), onChange: (v) => upd({ timerSec: v as number }) }),
    Toggle({ label: t('room.public'), value: room.config.public, onChange: (v) => upd({ public: v }) }))
    : h('div', { class: 'stack' }, h('b', { text: t('room.settings') }), h('div', { class: 'muted', text: `${t(`mode.${room.config.setup.kind}` as Key)} · ${room.config.setup.playersPerTeam === 2 ? t('setup.t2') : t('setup.t1')} · ${t('ai.' + room.config.level as Key)}` }))
  // 房主進房就自動產生一條玩家邀請連結，網址一開始就顯示，不用先按按鈕
  if (host && !c.invite && autoInviteFor !== room.code) { autoInviteFor = room.code; send({ t: 'invite', scope: 'player' }) }
  const inviteBox = host ? h('div', { class: 'stack' }, h('b', { text: t('room.inviteLink') }),
    h('div', { class: 'row' },
      Button({ label: `${t('common.player')}`, size: 'sm', icon: 'link', onClick: () => send({ t: 'invite', scope: 'player' }) }),
      Button({ label: `${t('common.spectator')}`, size: 'sm', icon: 'eye', onClick: () => send({ t: 'invite', scope: 'spectator' }) }),
      Button({ label: t('room.revoke'), size: 'sm', variant: 'danger', onClick: () => send({ t: 'revoke' }) })),
    c.invite ? h('div', { class: 'invite-box' }, h('span', { style: { flex: '1' }, text: `${c.invite.scope === 'spectator' ? t('common.spectator') : t('common.player')}｜${c.inviteUrl(c.invite.token)}` }), Button({ label: t('room.copyInvite'), icon: 'copy', size: 'sm', onClick: () => c.copyInvite(c.inviteUrl(c.invite!.token)) })) : null) : null
  const msgs = h('div', { class: 'chat-msgs' }, ...c.chat.map((l) => h('div', { class: `chat-msg ${l.kind === 'sys' ? 'sys' : ''}` }, l.kind === 'sys' ? null : h('b', { text: l.from }), l.text)))
  const chatSA = ScrollArea({ class: 'room-chat', label: t('chat.title') }, msgs)
  chatSA.el.style.height = 'clamp(130px, 24vh, 220px)'
  const quick = h('div', { class: 'quick' }, ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => h('button', { attrs: { type: 'button' }, text: t(`chat.q${i}` as Key), on: { click: () => send({ t: 'chat', text: t(`chat.q${i}` as Key) }) } })))
  const tf = TextField({ label: t('chat.title'), placeholder: t('chat.placeholder'), maxLength: 80, onEnter: (v) => { if (v.trim()) { send({ t: 'chat', text: v }); tf.input.value = '' } } })
  const chat = h('div', { class: 'stack' }, h('b', { text: t('chat.title') }), chatSA.el, quick, h('div', { class: 'chat-send' }, tf.el, Button({ icon: 'send', ariaLabel: t('chat.send'), variant: 'primary', onClick: () => { if (tf.input.value.trim()) { send({ t: 'chat', text: tf.input.value }); tf.input.value = '' } } })))
  setTimeout(() => chatSA.scrollToBottom(), 0)
  const startBtn = host ? Button({ label: t('room.startGame'), icon: 'play', variant: 'primary', size: 'lg', onClick: () => send({ t: 'start' }) }) : h('div', { class: 'muted', text: t('result.waitHost') })
  const panel = (...k: Node[]) => h('div', { class: 'card', style: { clipPath: 'none' } }, ...k)
  void icon
  return shellFooter(bar(nav, 'online.title', c.leave, pingTag(net)), h('div', { class: 'row room-foot', style: { flex: '1' } }, Button({ label: t('chat.title'), icon: 'chat', variant: 'secondary', class: 'room-chat-jump', onClick: () => document.getElementById('room-chat')?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }), startBtn),
    h('div', { class: 'stack' },
      h('h2', { text: t('room.title', { code: room.code }) }),
      // 寬螢幕：左欄＝座位（上）＋聊天室（左下角），右欄＝房間設定＋邀請連結；窄螢幕依序：座位 → 設定 → 聊天室（最底），頁尾左下有「聊天」捷徑
      h('div', { class: 'room-cols' },
        h('div', { class: 'room-seats' }, panel(h('b', { text: t('room.seats') }), seats, specs, h('div', { class: 'muted', text: t('room.empty.hint') }))),
        h('div', { class: 'room-right' }, panel(settings, inviteBox ?? h('div'))),
        h('div', { class: 'room-chatbox', attrs: { id: 'room-chat' } }, panel(chat)))))
}
