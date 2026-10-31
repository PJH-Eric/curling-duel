import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { en } from '../src/i18n/en'
import { zhCN } from '../src/i18n/zh-CN'
import { zh } from '../src/i18n/zh-TW'
import { normalizeLang } from '../src/i18n'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
  })
}

describe('i18n', () => {
  it('繁中、簡中、英文鍵值完全一致', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(zh).sort())
  })
  it('簡體中文沒有殘留繁體專用字', () => {
    const traditional = /[壺對戰機體線設擊個這們們還讓點開關選擇還應該實時錄戶網顯與]/
    expect(Object.values(zhCN).filter((v) => traditional.test(v))).toEqual([])
  })
  it('語言代碼正規化（與其他遊戲共用）', () => {
    expect(normalizeLang('zh-Hant')).toBe('zh-TW')
    expect(normalizeLang('zh-TW')).toBe('zh-TW')
    expect(normalizeLang('zh-Hans')).toBe('zh-CN')
    expect(normalizeLang('zh_CN')).toBe('zh-CN')
    expect(normalizeLang('en-US')).toBe('en')
    expect(normalizeLang('fr')).toBeNull()
  })
  it('程式碼中用字面值呼叫 t() 的鍵都存在', () => {
    const missing: string[] = []
    for (const f of walk('src')) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_.]+)'[,)]/g)) if (!(m[1] in zh)) missing.push(`${f}: ${m[1]}`)
    }
    expect(missing).toEqual([])
  })
  it('任務 1–7 都有標題、目標、提示', () => {
    for (let i = 1; i <= 7; i++) for (const k of ['title', 'goal', 'hint']) expect(`mission.${i}.${k}` in zh).toBe(true)
  })
})
