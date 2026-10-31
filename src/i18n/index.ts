import { en } from './en'
import { zhCN } from './zh-CN'
import { zh, type Dict } from './zh-TW'

/** 內部代碼：zh-TW＝繁體中文、zh-CN＝簡體中文、en＝English */
export type Lang = 'zh-TW' | 'zh-CN' | 'en'
export type Key = keyof Dict

export const LANGS: Lang[] = ['zh-TW', 'zh-CN', 'en']
export const LANG_NAMES: Record<Lang, string> = { 'zh-TW': '繁體中文', 'zh-CN': '简体中文', en: 'English' }
export const LANG_BADGE: Record<Lang, string> = { 'zh-TW': '繁', 'zh-CN': '简', en: 'EN' }
/** <html lang> 與跨遊戲共用的語言代碼 */
const HTML_LANG: Record<Lang, string> = { 'zh-TW': 'zh-Hant', 'zh-CN': 'zh-Hans', en: 'en' }
/** 與其他遊戲共用同一個 key，同一網域下語言偏好互通 */
const SHARED_KEY = 'game-island-lang'

const dicts: Record<Lang, Dict> = { 'zh-TW': zh as unknown as Dict, 'zh-CN': zhCN, en }
let lang: Lang = 'zh-TW'
const listeners = new Set<() => void>()

export function normalizeLang(v: string | null | undefined): Lang | null {
  if (!v) return null
  const s = String(v).toLowerCase().replace(/_/g, '-')
  if (s === 'en' || s.startsWith('en-')) return 'en'
  if (s.startsWith('zh')) return /^zh-(hans|cn|sg)/.test(s) ? 'zh-CN' : 'zh-TW'
  return null
}

/** 明確指定的語言：網址 ?lang= → 共用儲存值（沒有就回傳 null，交給設定或瀏覽器語言） */
export function explicitLang(): Lang | null {
  try {
    const q = normalizeLang(new URLSearchParams(location.search).get('lang'))
    if (q) return q
  } catch { /* 沒有網址就略過 */ }
  try {
    return normalizeLang(localStorage.getItem(SHARED_KEY))
  } catch {
    return null
  }
}

export function setLang(l: Lang): void {
  const changed = l !== lang
  lang = l
  if (typeof document !== 'undefined') document.documentElement.lang = HTML_LANG[l]
  try { localStorage.setItem(SHARED_KEY, HTML_LANG[l]) } catch { /* 儲存失敗不影響遊戲 */ }
  try {
    const u = new URL(location.href)
    if (u.searchParams.has('lang')) {
      u.searchParams.set('lang', HTML_LANG[l])
      history.replaceState(history.state, '', u)
    }
  } catch { /* 沒有網址就略過 */ }
  if (changed) listeners.forEach((f) => f())
}

export function getLang(): Lang {
  return lang
}

export function onLangChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function t(key: Key, vars?: Record<string, string | number>): string {
  let s = dicts[lang][key] ?? dicts['zh-TW'][key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
  return s
}

export function detectLang(): Lang {
  const ex = explicitLang()
  if (ex) return ex
  if (typeof navigator === 'undefined') return 'zh-TW'
  return normalizeLang(navigator.language) ?? 'en'
}

export { dicts }
