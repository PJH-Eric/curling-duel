import { pageView, trackGameStart, trackGameEnd, resetGameTracking } from '../analytics'
import { DT, predictPath, SlideSim, solvePowerForY, tapQuality } from '../core/sim'
import { isFinished, isRoundScored, scoreLines, simOptsOf, stonesLeft, timerSecOf, turnOf, type GameState, type ThrowRecord, type TurnInfo } from '../core/game'
import { MISSIONS } from '../core/missions'
import { FIVE_ROCK } from '../core/rules'
import { GRID_CELL, gridCellCenter, HOLES } from '../core/variants'
import { SHEET, STONE_R, clamp, type Spin, type Stone, type ThrowSpec } from '../core/types'
import type { Backend, ChatLine, SeatInfo } from '../game/backend'
import { addRecord, getSettings, saveMissionStars, TEAM_COLORS } from '../game/settings'
import { audio } from '../audio/engine'
import { t } from '../i18n'
import { Arena } from '../scene/arena'
import { h, clear } from '../ui/dom'
import { icon } from '../ui/icons'
import { Button, IconButton, PowerGauge, ScrollArea, TextField, isModalOpen, toast } from '../ui/kit'

export interface GameScreenOpts {
  backend: Backend
  /** 模式顯示名稱，用於戰績 */
  modeLabel: string
  onHome: () => void
  onAgain: () => void
  onRoom?: () => void
  onSettings: () => void
  onNextMission?: () => void
}

const MINI_Y0 = 9.4
const MINI_W = 300

type Phase = 'idle' | 'aim' | 'live' | 'replay' | 'hold' | 'over'

export function teamHexes(): [string, string] {
  const s = getSettings()
  const mine = TEAM_COLORS[s.teamColor] ?? TEAM_COLORS[0]
  const other = TEAM_COLORS[(s.teamColor + 1) % TEAM_COLORS.length]
  return [mine.hex, other.hex]
}

/** 對局畫面：3D 舞台、HUD、左側資訊／聊天、結算。回傳 dispose。 */
export function mountGame(root: HTMLElement, o: GameScreenOpts): () => void {
  const be = o.backend
  const g: GameState = be.g
  const colors = teamHexes()
  const canvas = h('canvas', { class: 'view', attrs: { 'aria-label': t('app.title') } })
  const arena = new Arena({ canvas, kind: g.kind, teamColors: colors, cat: getSettings().cat })
  let phase: Phase = 'idle'
  let disposed = false
  pageView('game')
  if (!be.spectator) trackGameStart({ variant: g.kind, mode: be.sendChat ? 'online' : 'ai', difficulty: be.seats.find((x) => x.level)?.level })

  /* ── 輸入狀態 ── */
  const spec: ThrowSpec = { angle: 0, power: 0.55, spin: 1 }
  let autoPower = true
  let ring: { x: number; y: number } = { x: 0, y: SHEET.teeY as number }
  let myTurn: TurnInfo | null = null
  let timeLeft = 0
  let timerOn = false
  const maxPower = g.kind === 'mission' ? (MISSIONS.find((m) => m.id === g.missionId)?.maxPower ?? 1) : 1

  /* ── 滑行（即時或回放） ── */
  let sim: SlideSim | null = null
  let simRec: ThrowRecord | null = null
  let simLive = false
  let acc = 0
  let evIdx = 0
  let lastSweepFx = 0
  let holdT = 0
  let judgeTimer = 0

  /* ───────── DOM ───────── */
  const sumList = h('div', { class: 'sum-list' })
  const chatMsgs = h('div', { class: 'chat-msgs' })
  const chatSA = ScrollArea({ class: 'side-chat-scroll', label: t('chat.title') }, chatMsgs)
  const badge = h('span', { class: 'badge', style: { display: 'none' } })
  const hint = h('div', { class: 'side-hint' })
  const side = h('aside', { class: be.sendChat ? 'side' : 'side no-chat', attrs: { 'aria-label': t('game.sidePanel') } },
    h('div', { class: 'side-sum' }, h('div', { class: 'side-title side-title-row' }, h('span', { text: 'SUMMARY' }), IconButton('back', t('game.collapseSide'), () => toggleSide(false), 'side-collapse')), sumList, hint),
    h('div', { class: 'side-chat' }, h('div', { class: 'side-title' }, icon(be.sendChat ? 'chat' : 'info'), h('span', { text: be.sendChat ? t('chat.title') : t('settings.controls') })), be.sendChat ? chatSA.el : h('div'), buildChatForm()))
  chatSA.el.style.flex = '1'
  chatSA.el.style.minHeight = '0'

  const sbHost = h('div', { class: 'scoreboard' })
  const banner = h('div', { class: 'banner', style: { display: 'none' } })
  const sideTab = IconButton(be.sendChat ? 'chat' : 'info', t('game.sidePanel'), () => toggleSide(true), 'side-tab')
  const tl = h('div', { class: 'hud-tl' }, sbHost, sideTab, banner)
  const settingsBtn = IconButton('gear', t('common.settings'), () => o.onSettings())
  const menuBtn = IconButton('home', t('game.menu'), () => confirmExit())
  sideTab.append(badge)
  badge.style.cssText = 'position:absolute;right:-6px;top:-6px;display:none'
  const tr = h('div', { class: 'hud-tr' }, menuBtn, settingsBtn)

  const turnChip = h('div', { class: 'turn-chip' })
  const tc = h('div', { class: 'hud-tc' }, turnChip)

  const mini = h('canvas', { attrs: { width: MINI_W, height: Math.round((SHEET.backY + 0.55 - MINI_Y0) * (MINI_W / (SHEET.halfWidth * 2))) } })
  const minimap = h('div', { class: 'minimap' }, mini)
  const judge = h('div', { class: 'judge', style: { display: 'none' } })

  const gauge = PowerGauge({ label: t('game.power'), value: spec.power, marker: 0.5, onChange: (v) => { autoPower = false; autoBtn.classList.remove('on'); setPower(v) } })
  const cwBtn = Button({ icon: 'cw', label: t('game.cw'), title: t('game.cw'), class: 'spin-btn', onClick: () => setSpin(1) })
  const ccwBtn = Button({ icon: 'ccw', label: t('game.ccw'), title: t('game.ccw'), class: 'spin-btn', onClick: () => setSpin(-1) })
  const autoBtn = Button({ icon: 'target', label: t('game.autoPower'), onClick: () => { autoPower = !autoPower; autoBtn.classList.toggle('on', autoPower); refreshAim() }, class: 'on' })
  const throwBtn = Button({ label: t('game.throw'), variant: 'primary', size: 'lg', class: 'throw-btn', onClick: () => launch() })
  const sweepBtn = Button({ icon: 'broom', label: t('game.sweep'), variant: 'success', size: 'lg', class: 'sweep-btn', onPress: () => { sweepTap(); startHold() } })
  const sweepGhost = Button({ icon: 'broom', label: t('game.sweep'), variant: 'secondary', size: 'md', class: 'sweep-ghost', disabled: true, title: t('game.sweepGhost') })
  const ctlLeft = h('div', { class: 'ctl-left' }, gauge.el, h('div', { class: 'ctl-row' }, cwBtn, ccwBtn, autoBtn))
  const ctlRight = h('div', { class: 'ctl-right' }, throwBtn, sweepGhost, sweepBtn)
  const controls = h('div', { class: 'controls' }, ctlLeft, ctlRight)

  const hud = h('div', { class: 'hud-layer' }, tl, tc, tr, minimap, judge, controls)
  const stage = h('div', { class: 'stage' }, canvas, hud)
  const game = h('div', { class: 'game' }, side, stage)
  root.append(game)
  arena.resize()

  /* 左欄：預設桌機展開、平板／手機收合 */
  let unread = 0
  let sideOpen = window.innerWidth > 900
  function toggleSide(force?: boolean): void {
    sideOpen = force ?? !sideOpen
    game.classList.toggle('side-open', sideOpen)
    if (sideOpen) {
      unread = 0
      badge.style.display = 'none'
    }
    requestAnimationFrame(() => arena.resize())
  }
  toggleSide(sideOpen)
  const ro = new ResizeObserver(() => arena.resize())
  ro.observe(stage)

  function buildChatForm(): HTMLElement {
    if (!be.sendChat) {
      return h('div', { class: 'chat-form' }, h('div', { class: 'muted', text: t('settings.keys') }))
    }
    const quick = h('div', { class: 'quick' })
    for (let i = 1; i <= 8; i++) {
      const key = `chat.q${i}` as 'chat.q1'
      quick.append(h('button', { attrs: { type: 'button' }, text: t(key), on: { click: () => be.sendChat?.(t(key)) } }))
    }
    const tf = TextField({ label: t('chat.title'), placeholder: t('chat.placeholder'), maxLength: 80, onEnter: (v) => send(v) })
    const send = (v: string) => {
      const txt = v.trim()
      if (!txt) return
      be.sendChat?.(txt)
      tf.input.value = ''
    }
    return h('div', { class: 'chat-form' }, quick, h('div', { class: 'chat-send' }, tf.el, Button({ icon: 'send', ariaLabel: t('chat.send'), variant: 'primary', onClick: () => send(tf.input.value) })))
  }

  function addChat(line: ChatLine): void {
    chatMsgs.append(h('div', { class: `chat-msg ${line.kind === 'sys' ? 'sys' : line.kind === 'spec' ? 'spec' : ''}` }, line.kind === 'sys' ? null : h('b', { text: line.from }), line.text))
    chatSA.scrollToBottom()
    if (!sideOpen && line.kind !== 'sys') {
      unread += 1
      badge.textContent = String(unread)
      badge.style.display = 'inline-block'
    }
  }
  be.onChat(addChat)

  /* ───────── HUD 繪製 ───────── */
  function teamName(team: number): string {
    return be.teamNames[team] ?? `${t('common.team')} ${team + 1}`
  }

  function renderScore(): void {
    clear(sbHost)
    let tab = ''
    if (g.kind === 'standard') tab = g.totalEnds > g.config.ends ? t('game.extra', { n: g.totalEnds - g.config.ends }) : t('game.end', { n: Math.min(g.end + 1, g.totalEnds) })
    else if (g.kind === 'grid' || g.kind === 'hole') tab = t('game.round', { n: isFinished(g) ? Math.max(1, g.round) : g.round + 1 })
    else tab = t(`mission.${g.missionId}.title` as 'mission.1.title')
    sbHost.append(h('div', { class: 'sb-tab', text: tab }))
    const teams = g.kind === 'mission' ? 1 : 2
    const line = scoreLines(g).values
    for (let team = 0; team < teams; team++) {
      const total = g.kind === 'mission' ? g.stars : line[team]
      const left = stonesLeft(g, team)
      const cap = g.kind === 'standard' ? g.config.stonesPerTeam : g.kind === 'mission' ? MISSIONS.find((m) => m.id === g.missionId)!.stones : g.config.stonesPerTeam
      const pips = h('div', { class: 'pips' })
      for (let i = 0; i < cap; i++) pips.append(h('span', { class: `pip${i >= left ? ' used' : ''}` }))
      pips.append(h('span', { class: 'sb-remaining', text: t('game.stonesLeft', { n: left }) }))
      const isTurn = myTurn ? myTurn.team === team : turnOf(g)?.team === team
      sbHost.append(h('div', { class: `sb-row${isTurn ? ' turn' : ''}` },
        h('span', { class: 'sb-dot', style: { background: colors[team] }, attrs: { 'data-team': team } }),
        h('span', { class: 'sb-name', text: teamName(team) }), pips, h('span', { class: 'sb-score', text: String(total) })))
    }
    banner.style.display = 'none'
    // 左欄 Summary
    clear(sumList)
    if (g.kind === 'standard') {
      for (let team = 0; team < 2; team++) {
        sumList.append(h('div', { class: 'sum-item' }, h('span', { class: 'sb-dot', style: { background: colors[team] }, attrs: { 'data-team': team } }), h('span', { text: `${teamName(team)} · ${g.scores[team].slice(0, g.end + (g.status === 'playing' ? 0 : 1)).join(' / ') || '–'}` }), h('b', { text: String(line[team]) })))
      }
      sumList.append(h('div', { class: 'sum-item muted', text: g.status === 'playing' ? (g.k < FIVE_ROCK && g.config.freeGuard ? t('game.freeGuard', { n: g.k + 1 }) : `${teamName(g.hammer)} · ${t('game.hammer')}`) : '' }))
      sumList.append(h('div', { class: 'sum-item muted', text: t('game.stoneNo', { n: Math.min(g.k + 1, g.config.stonesPerTeam * 2), total: g.config.stonesPerTeam * 2 }) }))
    } else if (g.kind === 'grid' || g.kind === 'hole') {
      for (let team = 0; team < 2; team++) sumList.append(h('div', { class: 'sum-item' }, h('span', { class: 'sb-dot', style: { background: colors[team] }, attrs: { 'data-team': team } }), h('span', { text: teamName(team) }), h('b', { text: String(line[team]) })))
    } else {
      sumList.append(h('div', { class: 'sum-item' }, h('span', { text: t(`mission.${g.missionId}.goal` as 'mission.1.goal') })))
    }
    if (g.kind === 'grid') arena.setGridOwners(g.cells)
  }

  function renderTurn(thinking: SeatInfo | null): void {
    clear(turnChip)
    const turn = turnOf(g)
    if (!turn || phase === 'over') {
      turnChip.style.display = 'none'
      return
    }
    turnChip.style.display = ''
    const seat = be.seats.find((s) => s.team === turn.team && s.player === turn.player)
    const name = seat?.name ?? teamName(turn.team)
    const mine = !!seat?.local && !be.spectator
    turnChip.append(mine ? t('game.yourTurn') : t('game.turnOf', { name }), h('small', { text: thinking ? t('game.aiThinking', { name }) : timeText() }))
  }
  function timeText(): string {
    const total = timerSecOf(g)
    if (phase !== 'aim' || total <= 0) return g.kind === 'mission' ? '' : ' '
    return `⏱ ${Math.ceil(timeLeft)}s`
  }

  let aimPred: ReturnType<typeof predictPath> | null = null
  function drawMini(): void {
    const c = mini.getContext('2d')!
    const W = mini.width
    const H = mini.height
    const k = W / (SHEET.halfWidth * 2) // 每公尺像素，X、Y 同一比例 → 圓就是正圓
    const sx = (x: number) => W / 2 + x * k
    const sy = (y: number) => H - (y - MINI_Y0) * k
    const circle = (x: number, y: number, r: number, fill: string, stroke?: string, lw = 0) => {
      c.beginPath()
      c.arc(sx(x), sy(y), r * k, 0, Math.PI * 2)
      c.fillStyle = fill
      c.fill()
      if (stroke) {
        c.lineWidth = lw
        c.strokeStyle = stroke
        c.stroke()
      }
    }
    c.fillStyle = '#eef4fb'
    c.fillRect(0, 0, W, H)
    c.strokeStyle = '#9fb4d0'
    c.lineWidth = 2
    c.beginPath()
    c.moveTo(sx(0), 0)
    c.lineTo(sx(0), H)
    c.stroke()
    // hog 線、tee 線、back 線
    const hline = (y: number, col: string) => {
      c.strokeStyle = col
      c.lineWidth = 3
      c.beginPath()
      c.moveTo(0, sy(y))
      c.lineTo(W, sy(y))
      c.stroke()
    }
    if (g.kind === 'hole') {
      for (const hl of HOLES) circle(hl.x, hl.y, hl.r, '#1d6a96', '#0b3b57', 2)
    } else if (g.kind === 'grid') {
      c.strokeStyle = '#2c6fe0'
      c.lineWidth = 3
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const cc = gridCellCenter(i, j)
        c.strokeRect(sx(cc.x - GRID_CELL / 2), sy(cc.y + GRID_CELL / 2), GRID_CELL * k, GRID_CELL * k)
      }
    } else {
      circle(0, SHEET.teeY, 1.83, '#2c6fe0')
      circle(0, SHEET.teeY, 1.22, '#ffffff')
      circle(0, SHEET.teeY, 0.61, '#e23b3b')
      circle(0, SHEET.teeY, 0.15, '#ffffff')
      hline(SHEET.teeY, '#6b86b8')
    }
    hline(SHEET.hogY, '#d33')
    hline(SHEET.backY, '#6b86b8')
    // 預估路線與停點：隨力道、旋轉、方向即時更新
    if (phase === 'aim' && aimPred) {
      c.strokeStyle = '#ffc21a'
      c.lineWidth = 4
      c.lineJoin = 'round'
      c.setLineDash([10, 7])
      c.beginPath()
      aimPred.path.forEach((p, i) => (i === 0 ? c.moveTo(sx(p.x), sy(p.y)) : c.lineTo(sx(p.x), sy(p.y))))
      c.stroke()
      c.setLineDash([])
      // 預估停點（實心）與瞄準光圈（空心）
      circle(aimPred.stop.x, aimPred.stop.y, 0.17, '#ffc21a', '#7a5a00', 2)
      c.beginPath()
      c.arc(sx(ring.x), sy(ring.y), 0.2 * k, 0, Math.PI * 2)
      c.lineWidth = 2
      c.strokeStyle = '#7a5a00'
      c.stroke()
    }
    // 所有壺（雙方、場上每一顆的實際位置）
    const list = sim ? sim.stones : g.stones
    const activeId = sim ? sim.active.id : -1
    for (const s of list) {
      if (!s.inPlay) continue
      const col = s.id >= 100 ? '#8a94a6' : colors[s.team]
      if (s.y < MINI_Y0) {
        // 還沒進入地圖範圍：在底邊畫小箭頭
        c.fillStyle = col
        c.beginPath()
        c.moveTo(sx(s.x), H - 2)
        c.lineTo(sx(s.x) - 9, H - 16)
        c.lineTo(sx(s.x) + 9, H - 16)
        c.fill()
        continue
      }
      circle(s.x, s.y, STONE_R, col, s.id === activeId ? '#000' : '#1c2540', s.id === activeId ? 4 : 2.5)
      if (g.kind !== 'mission' && getSettings().colorAssist && s.team === 1) {
        c.fillStyle = '#fff'
        c.fillRect(sx(s.x) - 4, sy(s.y) - 4, 8, 8)
      }
    }
  }

  /* ───────── 瞄準 ───────── */
  function setPower(v: number): void {
    spec.power = clamp(v, 0, maxPower)
    gauge.set(spec.power)
    refreshAim(false)
  }
  function setSpin(s: Spin): void {
    spec.spin = s
    cwBtn.classList.toggle('on', s === 1)
    ccwBtn.classList.toggle('on', s === -1)
    refreshAim()
    audio.play('click')
  }
  function refreshAim(recomputePower = true): void {
    if (phase !== 'aim') {
      arena.setAim(null)
      aimPred = null
      return
    }
    if (g.kind === 'hole' || g.kind === 'grid' || autoPower) {
      if (recomputePower) spec.power = clamp(solvePowerForY(ring.y, spec.angle, spec.spin), 0, maxPower)
    }
    gauge.set(spec.power)
    const pr = predictPath(spec, 5)
    aimPred = pr
    const my = turnOf(g)?.team ?? 0
    arena.setAim({ ring, path: pr.path, stop: pr.stop }, colors[my])
    const marker = solvePowerForY(SHEET.teeY, spec.angle, spec.spin)
    const el = gauge.el.querySelector<HTMLElement>('.gauge-marker')
    if (el) el.style.left = `${clamp(marker, 0, 1) * 100}%`
    drawMini()
  }
  function aimAt(x: number, y: number): void {
    const yy = clamp(y, 3, SHEET.backY + 1)
    const xx = clamp(x, -SHEET.halfWidth, SHEET.halfWidth)
    ring = { x: xx, y: yy }
    spec.angle = Math.atan2(xx, yy)
    refreshAim()
  }
  arena.onPlane((x, y, ph) => {
    if (phase !== 'aim') return
    if (ph === 'down' || ph === 'move') aimAt(x, y)
  })

  /* ───────── 回合流程 ───────── */
  function enterTurn(turn: TurnInfo | null, thinking: SeatInfo | null): void {
    if (disposed) return
    myTurn = turn
    renderScore()
    renderTurn(thinking)
    if (!turn) {
      // 最後一局結算按下「下一局」後，對局已結束：這裡要接著顯示終局畫面（先前會卡住）
      if (isFinished(g) && phase !== 'over') showResult()
      return
    }
    const seat = be.seats.find((s) => s.team === turn.team && s.player === turn.player)
    arena.setThrowerPose(thinking ? 'watch' : 'ready', turn.team)
    arena.setHeldStone(turn.stoneId)
    arena.syncStones(g.stones, 0)
    controls.style.display = 'none'
    hint.style.display = 'none'
    judge.style.display = 'none'
    arena.setAim(null)
    arena.setCameraMode('aim')
    if (seat?.local && !be.spectator && !thinking) {
      phase = 'aim'
      controls.prepend(ctlLeft)
      controls.style.display = ''
      sweepBtn.style.display = 'none'
      sweepGhost.style.display = ''
      throwBtn.style.display = ''
      hint.style.display = ''
      hint.textContent = t('game.aimHint')
      arena.setAimEnabled(true)
      const first = g.kind === 'grid' ? gridCellCenter(1, 1) : { x: 0, y: SHEET.teeY }
      ring = { x: first.x, y: first.y }
      spec.angle = Math.atan2(ring.x, ring.y)
      autoPower = true
      autoBtn.classList.add('on')
      cwBtn.classList.toggle('on', spec.spin === 1)
      ccwBtn.classList.toggle('on', spec.spin === -1)
      refreshAim()
      const total = timerSecOf(g)
      timeLeft = total
      timerOn = total > 0
      renderTurn(null)
    } else {
      phase = 'idle'
      arena.setAimEnabled(false)
      timerOn = false
    }
  }
  be.onTurn(enterTurn)

  function launch(): void {
    if (phase !== 'aim') return
    phase = 'live'
    timerOn = false
    const turn = myTurn!
    arena.setAimEnabled(false)
    arena.setAim(null)
    arena.setHeldStone(null)
    spec.power = clamp(spec.power, 0, maxPower)
    sim = new SlideSim(g.stones, turn.stoneId, { ...spec }, simOptsOf(g))
    simRec = null
    simLive = true
    startSimView(turn.team)
    controls.style.display = ''
    // Remove aiming controls during sliding so mobile browsers cannot retain painted fragments.
    ctlLeft.remove()
    throwBtn.style.display = 'none'
    sweepGhost.style.display = 'none'
    sweepBtn.style.display = ''
    hint.style.display = ''
    hint.textContent = t('game.sweepHint')
    audio.play('throw')
    audio.vibrate(15)
  }

  function startSimView(team: number): void {
    evIdx = 0
    acc = 0
    lastSweepFx = 0
    arena.setThrowerPose('lunge', team)
    arena.setActiveStone(sim!.active.id)
    arena.setCameraMode(getSettings().cameraFollow ? 'follow' : 'house')
    arena.setSweeping(false)
  }

  let holdTimer: number | null = null
  function startHold(): void {
    stopHold()
    holdTimer = window.setInterval(() => sweepTap(), 150)
  }
  function stopHold(): void {
    if (holdTimer !== null) { window.clearInterval(holdTimer); holdTimer = null }
  }
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel'] as const) sweepBtn.addEventListener(ev, stopHold)
  window.addEventListener('blur', stopHold)
  function sweepTap(): void {
    if (phase !== 'live' || !sim || sim.done) return
    const q = sim.tap()
    if (q === 0) return
    audio.play('sweep')
    audio.vibrate(6)
    arena.sweepChips(sim.active.x, sim.active.y, q)
  }
  function showJudge(text: string, cls: string): void {
    judge.className = `judge ${cls}`
    judge.textContent = text
    judge.style.display = ''
    judge.style.animation = 'none'
    void judge.offsetWidth
    judge.style.animation = ''
    window.clearTimeout(judgeTimer)
    judgeTimer = window.setTimeout(() => (judge.style.display = 'none'), 850)
  }

  be.onRecord((rec, live) => {
    if (disposed) return
    if (live && phase === 'live' && sim?.done) {
      finishThrow(rec)
      return
    }
    // 他人（AI／其他玩家）的投壺：回放
    phase = 'replay'
    controls.style.display = 'none'
    hint.style.display = 'none'
    arena.setAimEnabled(false)
    arena.setAim(null)
    arena.setHeldStone(null)
    sim = new SlideSim(rec.before, rec.stoneId, rec.spec, simOptsOf(g))
    sim.setTaps(rec.taps)
    simRec = rec
    simLive = false
    turnChip.style.display = ''
    clear(turnChip)
    turnChip.append(t('game.replay', { name: teamName(rec.team) }))
    startSimView(rec.team)
    audio.play('throw')
  })

  /** 即時滑行結束 → 向後端送出 → 後端回傳權威結果。 */
  function submitLive(): void {
    if (!sim) return
    be.submit({ ...spec }, sim.taps.slice())
  }

  function finishThrow(rec: ThrowRecord): void {
    // 以權威結果為準
    sim = null
    arena.syncStones(rec.after, 0)
    arena.setSweeping(false)
    arena.setActiveStone(null)
    controls.style.display = 'none'
    hint.style.display = 'none'
    if (rec.fgzViolation) {
      showJudge(t('game.fgz', { team: teamName(rec.team) }), 'ok')
      toast(`${t('game.fgz', { team: teamName(rec.team) })}。${t('game.fgzWhy')}`, 'warn', 5200)
      audio.play('out')
    }
    const hog = rec.events.some((e) => e.type === 'out' && e.id === rec.stoneId && e.reason === 'hog')
    if (hog) showJudge(t('game.hog'), 'ok')
    const sinks = rec.events.filter((e) => e.type === 'sink')
    if (sinks.length) {
      const pts = sinks.reduce((a, e) => a + (e.type === 'sink' ? e.points : 0), 0)
      showJudge(t('game.sink', { n: pts }), 'perfect')
      audio.play('sink')
    }
    arena.setCameraMode('house')
    arena.setThrowerPose('idle')
    phase = 'hold'
    holdT = 1.1
    renderScore()
    drawMini()
  }

  function afterHold(): void {
    if (isFinished(g)) return showResult()
    if (isRoundScored(g)) return showRoundEnd()
    be.next()
  }

  /* ───────── 局結算與終局 ───────── */
  let overlay: HTMLElement | null = null
  function closeOverlay(): void {
    overlay?.remove()
    overlay = null
  }

  function showRoundEnd(): void {
    phase = 'hold'
    let msg = ''
    if (g.kind === 'standard' && g.lastEnd) {
      msg = g.lastEnd.scoringTeam === -1 ? t('game.blank') : t('game.scored', { team: teamName(g.lastEnd.scoringTeam), n: g.lastEnd.points })
      if (g.lastEnd.scoringTeam === 0) arena.cheer(2)
    } else if (g.kind === 'grid' && g.lastRound) {
      msg = g.lastRound.winner < 0 ? t('game.gridDraw') : g.lastRound.line ? `${t('game.line')} ${teamName(g.lastRound.winner)}` : t('game.cellsWin', { team: teamName(g.lastRound.winner) })
      if (g.lastRound.winner >= 0) {
        audio.play('bingo')
        arena.confettiBurst()
      }
    } else if (g.kind === 'hole') {
      msg = t('result.endTitle', { n: g.round + 1 })
    }
    audio.play('score')
    renderScore()
    turnChip.style.display = 'none'
    const card = h('div', { class: 'result-card', style: { width: 'min(420px, 100%)' } },
      h('div', { class: 'result-head', text: t('result.endTitle', { n: (g.kind === 'standard' ? g.end : g.kind === 'mission' ? 0 : g.round) + 1 }) }),
      h('div', { class: 'result-body' }, h('div', { style: { fontSize: '22px', fontWeight: '900', textAlign: 'center' }, text: msg })),
      h('div', { class: 'result-actions' }, Button({ label: t('result.nextEnd'), variant: 'primary', size: 'lg', onClick: () => advance() })))
    overlay = h('div', { class: 'result', attrs: { role: 'dialog', 'aria-modal': 'true' } }, card)
    stage.append(overlay)
    ;(card.querySelector('button') as HTMLElement).focus()
    const mine = overlay
    window.setTimeout(() => { if (overlay === mine && !disposed) advance() }, 8500)
    function advance(): void {
      closeOverlay()
      be.advance()
    }
  }

  function showResult(): void {
    phase = 'over'
    timerOn = false
    trackGameEnd(g.kind === 'mission' ? 'complete' : g.winner === 0 ? 'win' : g.winner === -1 ? 'draw' : 'lose')
    controls.style.display = 'none'
    hint.style.display = 'none'
    renderScore()
    renderTurn(null)
    const mission = g.kind === 'mission'
    const win = mission ? g.stars > 0 : g.winner === 0
    const draw = !mission && g.winner === -1
    if (win) {
      audio.play('cheer')
      arena.confettiBurst()
      arena.setThrowerPose('cheer', 0)
    } else {
      audio.play('lose')
      arena.setThrowerPose('sad', 0)
    }
    const line = scoreLines(g).values
    if (!mission) {
      addRecord({ at: Date.now(), mode: o.modeLabel, result: draw ? 'draw' : win ? 'win' : 'lose', vs: teamName(1), score: `${line[0]} : ${line[1]}` })
    } else {
      saveMissionStars(g.missionId, g.stars)
    }
    const title = mission ? (win ? t('result.mission.pass') : t('result.mission.fail')) : draw ? t('result.draw') : win ? t('result.win') : t('result.lose')
    const body = h('div', { class: 'result-body' })
    if (mission) {
      const st = h('div', { class: 'stars' })
      for (let i = 0; i < 3; i++) st.append(icon(i < g.stars ? 'star' : 'starO', i < g.stars ? 'icon' : 'icon off'))
      body.append(h('div', { class: 'center' }, st), h('div', { class: 'center', text: t('result.stars', { n: g.stars }) }))
    } else if (g.kind === 'standard') {
      const head = h('tr', {}, h('th', { text: '' }))
      for (let i = 0; i < g.totalEnds; i++) head.append(h('th', { text: String(i + 1) }))
      head.append(h('th', { text: t('result.total') }))
      const rows = [0, 1].map((team) => {
        const tr = h('tr', {}, h('td', { text: teamName(team) }))
        for (let i = 0; i < g.totalEnds; i++) tr.append(h('td', { text: String(g.scores[team][i] ?? 0) }))
        tr.append(h('td', { text: String(line[team]) }))
        return tr
      })
      body.append(h('table', { class: 'result-table' }, head, ...rows))
    } else {
      body.append(h('table', { class: 'result-table' }, ...[0, 1].map((team) => h('tr', {}, h('td', { text: teamName(team) }), h('td', { text: String(line[team]) })))))
    }
    const roomBtn = Button({ label: t('result.room'), icon: 'users', onClick: () => o.onRoom?.(), disabled: !be.canRoom(), title: be.canRoom() ? undefined : t('result.notAvailable') })
    const againBtn = mission && win && o.onNextMission ? Button({ label: t('result.nextMission'), variant: 'primary', size: 'lg', onClick: () => o.onNextMission?.() }) : Button({ label: t('result.again'), variant: 'primary', size: 'lg', onClick: () => o.onAgain() })
    const actions = h('div', { class: 'result-actions' }, againBtn, mission || !o.onRoom ? null : roomBtn, Button({ label: t('result.home'), icon: 'home', onClick: () => o.onHome() }))
    overlay = h('div', { class: 'result', attrs: { role: 'dialog', 'aria-modal': 'true' } }, h('div', { class: 'result-card', attrs: { 'data-result-share': '' } }, h('div', { class: 'result-head', text: title }), body, actions))
    stage.append(overlay)
    againBtn.focus()
  }

  function confirmExit(): void {
    if (phase === 'over') return o.onHome()
    const wrap = h('div', { class: 'result' })
    const card = h('div', { class: 'result-card', style: { width: 'min(380px, 100%)' } },
      h('div', { class: 'result-head', text: t('game.menu') }),
      h('div', { class: 'result-actions' },
        Button({ label: t('common.cancel'), onClick: () => wrap.remove() }),
        Button({ label: t('result.home'), variant: 'danger', icon: 'home', onClick: () => o.onHome() })))
    wrap.append(card)
    stage.append(wrap)
    ;(card.querySelector('button') as HTMLElement).focus()
  }

  /* ───────── 每影格 ───────── */
  let miniT = 0
  arena.onFrame((dt) => {
    if (disposed) return
    if (sim && (phase === 'live' || phase === 'replay')) {
      const dbg = import.meta.env.DEV ? ((window as unknown as { __simSpeed?: number }).__simSpeed ?? 1) : 1
      const speed = (phase === 'replay' ? getSettings().replaySpeed : 1) * dbg
      acc += Math.min(dt, 0.1) * speed
      while (acc >= DT && !sim.done) {
        sim.step()
        acc -= DT
      }
      const a = sim.active
      arena.syncStones(sim.stones, dt)
      arena.followPoint(a.x, a.y)
      arena.trail(a.x, a.y, dt)
      const sw = sim.sweepNow()
      arena.setSweeping(a.inPlay && !sim.done, sw, Math.hypot(a.vx, a.vy))
      if (sw > 0 && sim.t - lastSweepFx > 0.12) {
        lastSweepFx = sim.t
        if (phase === 'replay') arena.sweepChips(a.x, a.y, sw)
      }
      const sp = Math.sqrt(a.vx * a.vx + a.vy * a.vy)
      audio.slide(sp)
      while (evIdx < sim.events.length) {
        const e = sim.events[evIdx++]
        if (e.type === 'hit') {
          arena.hitEffect(e.x, e.y, e.speed)
          audio.play(e.speed > 1.2 ? 'hitHard' : 'hit', Math.min(1, e.speed))
          audio.vibrate(e.speed > 1.2 ? 30 : 12)
        } else if (e.type === 'out') {
          audio.play('out')
          arena.popStone(e.id, 'out')
        } else if (e.type === 'sink') {
          arena.popStone(e.id, 'sink')
          audio.play('sink')
        }
      }
      if (sim.done) {
        audio.slide(0)
        if (simLive) {
          phase = 'live'
          // 先等後端回傳；finishThrow 由 onRecord 呼叫
          const s = sim
          simLive = false
          void s
          submitLive()
        } else if (simRec) {
          const rec = simRec
          simRec = null
          finishThrow(rec)
        }
      }
    } else if (phase === 'hold') {
      holdT -= dt
      arena.syncStones(g.stones, dt)
      if (holdT <= 0 && !overlay) {
        holdT = 99
        afterHold()
      }
    }
    if (timerOn && phase === 'aim' && !isModalOpen()) {
      const before = Math.ceil(timeLeft)
      timeLeft -= dt
      if (Math.ceil(timeLeft) !== before) {
        renderTurn(null)
        if (timeLeft <= 5 && timeLeft > 0) audio.play('tick')
      }
      turnChip.querySelector('small')?.classList.toggle('low', timeLeft <= 5)
      if (timeLeft <= 0) {
        timerOn = false
        showJudge(t('game.timeout'), 'ok')
        launch()
      }
    }
    miniT += dt
    if (miniT > 0.1) {
      miniT = 0
      drawMini()
    }
  })

  /* ───────── 鍵盤 ───────── */
  const onKey = (e: KeyboardEvent) => {
    if (isModalOpen() || disposed) return
    const tag = (e.target as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if (phase === 'aim') {
      const step = e.shiftKey ? 0.5 : 0.15
      if (e.key === 'ArrowLeft') aimAt(ring.x - step, ring.y)
      else if (e.key === 'ArrowRight') aimAt(ring.x + step, ring.y)
      else if (e.key === 'ArrowUp') {
        if (autoPower) aimAt(ring.x, ring.y + step * 2)
        else setPower(spec.power + 0.02)
      } else if (e.key === 'ArrowDown') {
        if (autoPower) aimAt(ring.x, ring.y - step * 2)
        else setPower(spec.power - 0.02)
      } else if (e.key === 'q' || e.key === 'Q') setSpin(-1)
      else if (e.key === 'e' || e.key === 'E') setSpin(1)
      else if (e.key === 'Enter') launch()
      else return
      e.preventDefault()
    } else if (phase === 'live' && (e.key === ' ' || e.key === 'Enter')) {
      sweepTap()
      e.preventDefault()
    }
  }
  window.addEventListener('keydown', onKey)

  /* ───────── 啟動 ───────── */
  arena.setTeamColors(colors, getSettings().cat)
  arena.setCameraMode('aim', true)
  arena.start()
  renderScore()
  const starter = be as Backend & { start?: () => void }
  window.setTimeout(() => starter.start?.(), 300)
  void tapQuality
  void ({} as Stone)

  return () => {
    disposed = true
    resetGameTracking()
    be.dispose()
    window.removeEventListener('keydown', onKey)
    ro.disconnect()
    audio.slide(0)
    arena.dispose()
    game.remove()
  }
}
