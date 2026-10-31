import { MISSIONS } from '../core/missions'
import seoConfig from '../../seo.config.json'
import type { AiLevel } from '../core/ai'
import type { GameKind, GameSetup } from '../core/game'
import { getSettings, loadMissionStars, loadRecords, TEAM_COLORS, updateSettings, type CatStyle } from '../game/settings'
import { t, type Key } from '../i18n'
import { h } from '../ui/dom'
import { icon, type IconName } from '../ui/icons'
import { Button, IconButton, LangMenu, ScrollArea, Segmented, Select, Stepper, TextField } from '../ui/kit'
import { audio } from '../audio/engine'
import { howtoArt } from '../ui/howtoArt'

export interface MenuNav {
  home(): void
  setup(kind: GameKind): void
  missions(): void
  howto(): void
  records(): void
  online(): void
  settings(): void
  startLocal(setup: GameSetup, level: AiLevel, modeLabel: string): void
  startMission(id: number): void
}

function topbar(nav: MenuNav, opts: { back?: () => void; title?: Key; lobby?: boolean } = {}): HTMLElement {
  const lobbyLink = opts.lobby
    ? h('a', { class: 'home-lobby-link', attrs: { href: seoConfig.lobbyUrl, 'aria-label': t('home.lobby'), title: t('home.lobby') } }, icon('back'), h('span', { class: 'home-lobby-label', text: t('home.lobby') }))
    : null
  return h('header', { class: 'topbar' },
    lobbyLink,
    opts.back ? IconButton('back', t('common.back'), opts.back) : null,
    opts.title ? h('div', { class: 'brand' }, t(opts.title)) : h('div', { class: 'brand' }, t('app.title'), h('small', { text: t('app.subtitle') })),
    h('div', { class: 'spacer' }), LangMenu((l) => updateSettings({ lang: l })), IconButton('gear', t('common.settings'), () => nav.settings()))
}

function screen(nav: MenuNav, bar: HTMLElement, ...content: Node[]): HTMLElement {
  void nav
  const sa = ScrollArea({ label: '' }, h('div', { class: 'wrap' }, ...content))
  return h('div', { class: 'screen' }, bar, h('div', { class: 'page' }, sa.el))
}

/** 底部固定列：主要動作（開始對戰）永遠看得到，不會被捲到畫面外。 */
function screenWithFooter(bar: HTMLElement, footer: Node, ...content: Node[]): HTMLElement {
  const sa = ScrollArea({ label: '' }, h('div', { class: 'wrap' }, ...content))
  return h('div', { class: 'screen' }, bar, h('div', { class: 'page' }, sa.el), h('div', { class: 'footbar' }, footer))
}

/** 首頁 */
export function homeScreen(nav: MenuNav): HTMLElement {
  const btn = (label: Key, desc: Key, ic: IconName, fn: () => void, variant: 'primary' | 'secondary' = 'secondary') =>
    h('div', {}, Button({ label: t(label), icon: ic, variant, size: 'lg', onClick: () => { audio.unlock(); audio.play('click'); fn() }, class: 'home-btn' }), h('div', { class: 'muted', style: { fontSize: '12.5px', margin: '2px 0 0 4px', color: '#dbe8ff' }, text: t(desc) }))
  const hero = h('div', { class: 'hero' },
    h('div', { class: 'hero-copy' }, h('p', { text: t('app.tagline') }),
      h('div', { class: 'menu-btns' },
        btn('home.local', 'home.localDesc', 'play', () => nav.setup('standard'), 'primary'),
        btn('home.online', 'home.onlineDesc', 'users', () => nav.online()),
        btn('home.tutorial', 'home.tutorialDesc', 'target', () => nav.missions()))),
    h('div', { class: 'hero-art', attrs: { 'aria-hidden': 'true' } }, iceDuelArt()))
  const foot = h('div', { class: 'row home-foot', style: { marginTop: '14px' } }, Button({ label: t('home.howto'), icon: 'info', onClick: () => nav.howto() }), Button({ label: t('home.records'), icon: 'list', onClick: () => nav.records() }))
  return screen(nav, topbar(nav, { lobby: true }), hero, foot)
}

function iceDuelArt(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 320 260')
  svg.innerHTML = `<defs><linearGradient id="ic" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4fbff"/><stop offset="1" stop-color="#cfe6fb"/></linearGradient></defs>
  <path d="M60 250 L110 20 H210 L260 250 Z" fill="url(#ic)" stroke="#1c2540" stroke-width="6"/>
  <ellipse cx="160" cy="70" rx="62" ry="22" fill="#2c6fe0" stroke="#1c2540" stroke-width="4"/><ellipse cx="160" cy="70" rx="40" ry="14" fill="#fff"/><ellipse cx="160" cy="70" rx="20" ry="7" fill="#e23b3b"/>
  <g transform="translate(150 185)"><ellipse cx="0" cy="28" rx="34" ry="10" fill="rgba(0,0,0,.2)"/><path d="M-30 20 L-30 0 Q0 -22 30 0 L30 20 Q0 34 -30 20Z" fill="#e23b3b" stroke="#1c2540" stroke-width="5"/><path d="M-26 -4 L-20 -26 L-6 -12 Z M26 -4 L20 -26 L6 -12 Z" fill="#e23b3b" stroke="#1c2540" stroke-width="5" stroke-linejoin="round"/><circle cx="-10" cy="6" r="3.5" fill="#1c2540"/><circle cx="10" cy="6" r="3.5" fill="#1c2540"/><path d="M-6 14 Q0 19 6 14" fill="none" stroke="#1c2540" stroke-width="3" stroke-linecap="round"/></g>
  <g transform="translate(205 130) scale(.8)"><ellipse cx="0" cy="28" rx="34" ry="10" fill="rgba(0,0,0,.2)"/><path d="M-30 20 L-30 0 Q0 -22 30 0 L30 20 Q0 34 -30 20Z" fill="#f2c230" stroke="#1c2540" stroke-width="5"/><path d="M-26 -4 L-20 -26 L-6 -12 Z M26 -4 L20 -26 L6 -12 Z" fill="#f2c230" stroke="#1c2540" stroke-width="5" stroke-linejoin="round"/><circle cx="-10" cy="6" r="3.5" fill="#1c2540"/><circle cx="10" cy="6" r="3.5" fill="#1c2540"/></g>`
  return svg
}

/** 開局設定（單機） */
export function setupScreen(nav: MenuNav, initial: GameKind): HTMLElement {
  let kind: GameKind = initial
  let level: AiLevel = 'normal'
  let ppt: 1 | 2 | 3 | 4 = 1
  let ends = 4
  let timer = 45
  let rounds = 3
  const s0 = getSettings()
  let name = s0.nickname
  const root = h('div', { class: 'stack' })
  const kinds: { k: GameKind; key: Key; desc: Key; ic: IconName }[] = [
    { k: 'standard', key: 'mode.standard', desc: 'mode.standardDesc', ic: 'target' },
    { k: 'grid', key: 'mode.grid', desc: 'mode.gridDesc', ic: 'list' },
    { k: 'hole', key: 'mode.hole', desc: 'mode.holeDesc', ic: 'crown' },
  ]
  const render = () => {
    const s = getSettings()
    const cards = h('div', { class: 'grid grid-3' }, ...kinds.map((m) => {
      const c = h('button', { class: `card${kind === m.k ? ' selected' : ''}`, attrs: { type: 'button', 'aria-pressed': kind === m.k } }, icon(m.ic, 'card-ico'), h('h3', { text: t(m.key) }), h('p', { text: t(m.desc) }))
      c.addEventListener('click', () => { kind = m.k; render() })
      return c
    }))
    const form = h('div', { class: 'stack' })
    form.append(
      Segmented({ label: t('setup.teams'), value: ppt, options: [{ value: 1, label: t('setup.t1') }, { value: 2, label: t('setup.t2') }, { value: 3, label: t('setup.t3') }, { value: 4, label: t('setup.t4') }], onChange: (v) => { ppt = v as 1 | 2 | 3 | 4 } }),
      Segmented({ label: t('setup.ai'), value: level, options: [{ value: 'easy', label: t('setup.ai.easy') }, { value: 'normal', label: t('setup.ai.normal') }, { value: 'hard', label: t('setup.ai.hard') }], onChange: (v) => { level = v as AiLevel } }),
    )
    if (kind === 'standard') {
      form.append(
        Stepper({ label: t('setup.ends'), min: 1, max: 10, value: ends, onChange: (v) => { ends = v } }))
    } else {
      form.append(Stepper({ label: t('setup.rounds'), min: 1, max: 5, value: rounds, onChange: (v) => { rounds = v } }))
    }
    form.append(Select({ label: t('setup.timer'), value: timer, options: [30, 45, 60, 0].map((v) => ({ value: v, label: v === 0 ? t('setup.timer.unlimited') : t('setup.seconds', { n: v }) })), onChange: (v) => { timer = v as number } }))
    const nameField = TextField({ label: t('setup.name'), value: name, maxLength: 12, onInput: (v) => { name = v } })
    const colors = h('div', { class: 'row' }, ...TEAM_COLORS.map((c) => {
      const b = h('button', { class: `card${s.teamColor === c.id ? ' selected' : ''}`, style: { minHeight: '0', padding: '8px 12px', flexDirection: 'row', alignItems: 'center', gap: '8px' }, attrs: { type: 'button', 'aria-pressed': s.teamColor === c.id } }, h('span', { class: 'swatch', style: { background: c.hex }, attrs: { 'data-team': c.id % 2 } }), h('span', { text: t(c.key) }))
      b.addEventListener('click', () => { updateSettings({ teamColor: c.id }); render() })
      return b
    }))
    const catSel = (field: keyof CatStyle, label: Key, opts: [string, Key][]) =>
      Segmented({ label: t(label), value: s.cat[field] as string, options: opts.map(([v, k]) => ({ value: v, label: t(k) })), onChange: (v) => updateSettings({ cat: { ...getSettings().cat, [field]: v } as CatStyle }) })
    const look = h('div', { class: 'stack' }, h('b', { text: t('setup.teamColor') }), colors,
      catSel('pattern', 'cat.pattern', [['plain', 'cat.p.plain'], ['stripe', 'cat.p.stripe'], ['spot', 'cat.p.spot']]),
      catSel('ears', 'cat.ears', [['point', 'cat.e.point'], ['round', 'cat.e.round'], ['fold', 'cat.e.fold']]),
      catSel('face', 'cat.face', [['smile', 'cat.f.smile'], ['cool', 'cat.f.cool'], ['sleepy', 'cat.f.sleepy']]))
    const start = Button({ label: t('setup.start'), icon: 'play', variant: 'primary', size: 'lg', onClick: () => {
      const nick = (name || '').trim() || t('common.you')
      updateSettings({ nickname: (name || '').trim() })
      const setup: GameSetup = { kind, playersPerTeam: ppt, timerSec: timer, standard: { stonesPerTeam: 8, ends }, grid: { rounds }, hole: { rounds } }
      void nick
      nav.startLocal(setup, level, t(kinds.find((x) => x.k === kind)!.key))
    } })
    root.replaceChildren(cards, h('div', { class: 'grid grid-2' }, h('div', { class: 'card', style: { clipPath: 'none' } }, form, nameField.el), h('div', { class: 'card', style: { clipPath: 'none' } }, look)))
    footHost.replaceChildren(start)
  }
  const footHost = h('div', { class: 'row', style: { justifyContent: 'flex-end', flex: '1' } })
  render()
  return screenWithFooter(topbar(nav, { back: () => nav.home(), title: 'setup.title' }), footHost, root)
}

/** 任務教學 */
export function missionsScreen(nav: MenuNav): HTMLElement {
  const stars = loadMissionStars()
  const cards = MISSIONS.map((m, i) => {
    const locked = i > 0 && !(stars[MISSIONS[i - 1].id] > 0)
    const got = stars[m.id] ?? 0
    const st = h('span', { class: 'stars' }, ...[0, 1, 2].map((n) => icon(n < got ? 'star' : 'starO', n < got ? 'icon' : 'icon off')))
    const c = h('button', { class: 'card mission-card', attrs: { type: 'button', disabled: locked, 'aria-label': `${t(`mission.${m.id}.title` as Key)}${locked ? ' ' + t('tutorial.locked') : ''}` } }, icon(locked ? 'lock' : 'target', 'card-ico'), h('h3', { text: `${m.id}. ${t(`mission.${m.id}.title` as Key)}` }), h('p', { text: locked ? t('tutorial.locked') : t(`mission.${m.id}.goal` as Key) }), st)
    if (!locked) c.addEventListener('click', () => nav.startMission(m.id))
    return c
  })
  return screen(nav, topbar(nav, { back: () => nav.home(), title: 'tutorial.title' }), h('div', { class: 'grid grid-2' }, ...cards))
}

type HowtoCard = { art: number | string; key: string; icon: IconName }
const HOWTO_TABS: { id: 'std' | 'grid' | 'hole'; cards: HowtoCard[] }[] = [
  { id: 'std', cards: [
    { art: 1, key: '1', icon: 'target' }, { art: 2, key: '2', icon: 'cw' }, { art: 3, key: '3', icon: 'broom' },
    { art: 5, key: '5', icon: 'eye' }, { art: 6, key: '6', icon: 'close' }, { art: 7, key: '7', icon: 'users' },
    { art: 4, key: '4', icon: 'crown' }, { art: 's2', key: 's2', icon: 'eye' }, { art: 's3', key: 's3', icon: 'list' }, { art: 'm', key: 'm', icon: 'play' },
  ] },
  { id: 'grid', cards: [{ art: 'g1', key: 'g1', icon: 'target' }, { art: 'g2', key: 'g2', icon: 'crown' }, { art: 'g3', key: 'g3', icon: 'close' }, { art: 's4', key: 's4', icon: 'users' }] },
  { id: 'hole', cards: [{ art: 's5', key: 's5', icon: 'target' }, { art: 'h2', key: 'h2', icon: 'close' }, { art: 'h3', key: 'h3', icon: 'users' }] },
]

export function howtoScreen(nav: MenuNav): HTMLElement {
  let tab: 'std' | 'grid' | 'hole' = 'std'
  const steps = h('div', { class: 'steps' })
  const bar = h('div', { class: 'howto-tabs', attrs: { role: 'tablist' } })
  const tabBtns = HOWTO_TABS.map((tb) => {
    const b = h('button', { class: 'howto-tab', attrs: { type: 'button', role: 'tab' } }, icon(({ std: 'target', grid: 'list', hole: 'crown' } as const)[tb.id], 'icon howto-tab-ico'), h('span', { text: t(`mode.${tb.id === 'std' ? 'standard' : tb.id}` as Key) }))
    b.addEventListener('click', () => { tab = tb.id; render() })
    bar.appendChild(b)
    return b
  })
  const render = () => {
    tabBtns.forEach((b, i) => { const on = HOWTO_TABS[i].id === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)) })
    const cur = HOWTO_TABS.find((x) => x.id === tab)!
    steps.replaceChildren(...cur.cards.map((c, i) => h('article', { class: 'step' },
      (() => { const art = h('div', { class: 'step-art' }); art.innerHTML = howtoArt(c.art); return art })(),
      h('div', { class: 'step-head' }, h('span', { class: 'step-no', text: String(i + 1), attrs: { 'aria-hidden': 'true' } }), h('b', { text: t(`howto.${c.key}.t` as Key) }), icon(c.icon, 'icon step-ico')),
      h('p', { text: t(`howto.${c.key}.d` as Key) }))))
  }
  render()
  return screen(nav, topbar(nav, { back: () => nav.home(), title: 'howto.title' }), bar, steps, h('p', { class: 'howto-note', text: t('howto.latency') }))
}

export function recordsScreen(nav: MenuNav): HTMLElement {
  const list = loadRecords()
  const w = list.filter((r) => r.result === 'win').length
  const l = list.filter((r) => r.result === 'lose').length
  const d = list.length - w - l
  const body = list.length === 0 ? h('div', { class: 'card empty', style: { clipPath: 'none' }, text: t('records.empty') }) : h('div', { class: 'stack' },
    h('b', { text: t('records.summary', { n: list.length, w, l, d }) }), h('b', { text: t('records.recent') }),
    ...list.map((r) => h('div', { class: 'room-row' }, h('div', { class: 'grow' }, h('b', { text: r.mode }), h('div', { class: 'muted', text: `${new Date(r.at).toLocaleString()} · ${r.vs}` })), h('span', { text: r.score }), h('span', { class: `tag ${r.result === 'win' ? 'tag-ok' : ''}`, text: t(r.result === 'win' ? 'result.win' : r.result === 'lose' ? 'result.lose' : 'result.draw') }))))
  return screen(nav, topbar(nav, { back: () => nav.home(), title: 'records.title' }), body)
}
