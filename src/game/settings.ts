import { detectLang, explicitLang, setLang, type Lang } from '../i18n'

export interface CatStyle {
  pattern: 'plain' | 'stripe' | 'spot'
  ears: 'point' | 'round' | 'fold'
  face: 'smile' | 'cool' | 'sleepy'
}

export interface Settings {
  musicOn: boolean
  musicVol: number
  sfxOn: boolean
  sfxVol: number
  reduceMotion: boolean
  colorAssist: boolean
  haptics: boolean
  lang: Lang
  replaySpeed: 1 | 2 | 3
  cameraFollow: boolean
  nickname: string
  teamColor: number
  cat: CatStyle
}

export const TEAM_COLORS = [
  { id: 0, hex: '#e23b3b', key: 'color.red' as const },
  { id: 1, hex: '#f2c230', key: 'color.yellow' as const },
  { id: 2, hex: '#1ea3a3', key: 'color.teal' as const },
  { id: 3, hex: '#8a5be0', key: 'color.purple' as const },
]

export const DEFAULTS: Settings = {
  musicOn: true,
  musicVol: 60,
  sfxOn: true,
  sfxVol: 80,
  reduceMotion: false,
  colorAssist: false,
  haptics: true,
  lang: 'zh-TW',
  replaySpeed: 2,
  cameraFollow: true,
  nickname: '',
  teamColor: 0,
  cat: { pattern: 'plain', ears: 'point', face: 'smile' },
}

const KEY = 'iceduel.settings.v1'
let cur: Settings = { ...DEFAULTS, cat: { ...DEFAULTS.cat } }
const listeners = new Set<(s: Settings) => void>()

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
function safeSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* 隱私模式等情況下略過 */
  }
}

export function loadSettings(): Settings {
  const raw = safeGet(KEY)
  let fromStore: Partial<Settings> = {}
  if (raw) {
    try {
      fromStore = JSON.parse(raw)
    } catch {
      fromStore = {}
    }
  }
  cur = { ...DEFAULTS, lang: detectLang(), ...fromStore, cat: { ...DEFAULTS.cat, ...(fromStore.cat ?? {}) } }
  // 網址 ?lang= 或與其他遊戲共用的語言偏好優先
  const ex = explicitLang()
  if (ex) cur.lang = ex
  applyDom()
  return cur
}

export function getSettings(): Settings {
  return cur
}

export function updateSettings(patch: Partial<Settings>): Settings {
  cur = { ...cur, ...patch, cat: { ...cur.cat, ...(patch.cat ?? {}) } }
  safeSet(KEY, JSON.stringify(cur))
  applyDom()
  listeners.forEach((f) => f(cur))
  return cur
}

export function resetSettings(): Settings {
  const keep = { nickname: cur.nickname }
  cur = { ...DEFAULTS, lang: cur.lang, cat: { ...DEFAULTS.cat }, ...keep }
  safeSet(KEY, JSON.stringify(cur))
  applyDom()
  listeners.forEach((f) => f(cur))
  return cur
}

export function onSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function applyDom(): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.reduce = cur.reduceMotion ? '1' : '0'
  document.documentElement.dataset.colorassist = cur.colorAssist ? '1' : '0'
  setLang(cur.lang)
}

export function storageGet(key: string): string | null {
  return safeGet(key)
}
export function storageSet(key: string, value: string): void {
  safeSet(key, value)
}

export interface RecordEntry {
  at: number
  mode: string
  result: 'win' | 'lose' | 'draw'
  vs: string
  score: string
}

const REC_KEY = 'iceduel.records.v1'
export function loadRecords(): RecordEntry[] {
  const raw = safeGet(REC_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as RecordEntry[]
  } catch {
    return []
  }
}
export function addRecord(r: RecordEntry): void {
  const list = [r, ...loadRecords()].slice(0, 30)
  safeSet(REC_KEY, JSON.stringify(list))
}

export function loadMissionStars(): Record<number, number> {
  const raw = safeGet('iceduel.missions.v1')
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}
export function saveMissionStars(id: number, stars: number): void {
  const m = loadMissionStars()
  m[id] = Math.max(m[id] ?? 0, stars)
  safeSet('iceduel.missions.v1', JSON.stringify(m))
}
