// GA4 事件追蹤（與其他遊戲共用同一套規則）。
// 追蹤碼由部署時的 scripts/inject-seo.mjs 注入 window.GAME_ANALYTICS_CONFIG；
// 本機、預覽與非正式網域不載入 Google tag，所有函式皆為無副作用，失敗不影響遊戲。
type Params = Record<string, string | number | undefined>
interface Cfg { measurement_id: string; game_id: string; page_location: string }
type GtagFn = (...args: unknown[]) => void
const w = window as unknown as { GAME_ANALYTICS_CONFIG?: Cfg; dataLayer?: unknown[]; gtag?: GtagFn }

const ALLOWED = new Set(['game_start', 'game_end', 'room_create', 'room_join'])
let siteUrl = ''
let lastScreen = ''
const SAFE = /^[a-zA-Z0-9_-]{1,40}$/
let gameId = ''
let active: { params: Params; at: number } | null = null

function cleanUrl(v: string): string {
  try { const u = new URL(v); return /^https?:$/.test(u.protocol) ? u.origin + u.pathname : '' } catch { return '' }
}

export function initAnalytics(): void {
  const o = w.GAME_ANALYTICS_CONFIG
  if (!o || gameId) return
  const site = cleanUrl(o.page_location)
  if (!site || !/^[a-z0-9-]{1,40}$/.test(o.game_id)) return
  gameId = o.game_id
  siteUrl = site
  if (location.hostname !== new URL(site).hostname || location.hostname !== 'pjh-eric.github.io' || !/^G-[A-Z0-9]+$/.test(o.measurement_id)) return
  w.dataLayer = w.dataLayer || []
  // Google tag requires Arguments objects; ordinary arrays are not processed as commands.
  w.gtag = w.gtag || function () { (w.dataLayer as unknown[]).push(arguments) }
  w.gtag('js', new Date())
  w.gtag('config', o.measurement_id, {
    game_id: gameId, page_location: site, send_page_view: false, page_referrer: cleanUrl(document.referrer),
    allow_google_signals: false, allow_ad_personalization_signals: false,
  })
  const s = document.createElement('script')
  s.async = true
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + o.measurement_id
  document.head.appendChild(s)
}

/** 僅送出固定維度，不含暱稱、房號、邀請 token 等個資 */
function clean(p: Params): Params {
  const out: Params = { game_id: gameId }
  for (const k of ['variant', 'difficulty', 'via', 'result']) {
    const v = p[k]
    if (typeof v === 'string' && SAFE.test(v)) out[k] = v
  }
  if (p.mode === 'solo' || p.mode === 'ai' || p.mode === 'online') out.mode = p.mode
  if (typeof p.duration_sec === 'number' && p.duration_sec >= 0) out.duration_sec = Math.round(p.duration_sec)
  out.app_language = document.documentElement.lang === 'en' ? 'en' : 'zh-Hant'
  out.transport_type = 'beacon'
  return out
}

export function track(name: string, p: Params = {}): void {
  if (!ALLOWED.has(name) || !w.gtag) return
  try { w.gtag('event', name, clean(p)) } catch { /* 統計失敗不影響遊戲 */ }
}

/** variant＝玩法（standard/grid/hole/mission），mode＝ai/online，difficulty＝AI 難度 */
export function trackGameStart(p: Params): void {
  active = { params: p, at: Date.now() }
  track('game_start', p)
}
export function trackGameEnd(result: 'win' | 'lose' | 'draw' | 'complete'): void {
  if (!active) return
  const m = active
  active = null
  track('game_end', { ...m.params, result, duration_sec: (Date.now() - m.at) / 1000 })
}
export function resetGameTracking(): void { active = null }

/** 畫面切換時送出 page_view（以 #/畫面 區分，不含房號或邀請碼） */
export function pageView(screen: string): void {
  if (!w.gtag || !siteUrl || !SAFE.test(screen) || screen === lastScreen) return
  lastScreen = screen
  try {
    w.gtag('event', 'page_view', {
      game_id: gameId, page_location: siteUrl + '#/' + screen, page_referrer: cleanUrl(document.referrer),
      page_title: document.title + ' - ' + screen, screen_name: screen,
    })
  } catch { /* 畫面追蹤失敗不影響操作 */ }
}
