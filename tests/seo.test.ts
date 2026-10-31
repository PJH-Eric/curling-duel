import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error 純 JS 模組
import { inject, validate } from '../scripts/inject-seo.mjs'

const cfg = JSON.parse(readFileSync('seo.config.json', 'utf8'))

function sandbox(html: string): string {
  const root = mkdtempSync(join(tmpdir(), 'seo-'))
  mkdirSync(join(root, 'dist'))
  copyFileSync('seo.config.json', join(root, 'seo.config.json'))
  writeFileSync(join(root, 'dist', 'index.html'), html)
  return root
}
const page = '<html><head><title>x</title>\n<!--SEO:HEAD-->\n</head><body></body></html>'

describe('SEO / GA4', () => {
  it('設定檔通過驗證', () => { expect(() => validate(cfg, 'G-PG79WZK8QY')).not.toThrow() })
  it('GA4 page_location 使用 GitHub Pages 實際網址', () => {
    const root = sandbox(page)
    inject(root, {})
    const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
    const config = JSON.parse(html.match(/window\.GAME_ANALYTICS_CONFIG=(\{[^<]+\});/)![1])
    expect(config.page_location).toBe('https://pjh-eric.github.io/curling-duel/')
  })
  it('注入 canonical / OG / JSON-LD / gtag 設定與 sitemap，且重複執行不累積', () => {
    const root = sandbox(page)
    inject(root, {})
    inject(root, {})
    const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
    expect(html.match(/rel="canonical"/g)).toHaveLength(1)
    expect(html.match(/application\/ld\+json/g)).toHaveLength(1)
    expect(html).toContain('hreflang="en"')
    expect(html).toContain('og:image:alt')
    expect(html).toContain('screenshot')
    expect(readFileSync(join(root, 'dist', 'sitemap.xml'), 'utf8')).toContain('image:loc')
    expect(html).toContain('og:image')
    expect(html).toContain('GAME_ANALYTICS_CONFIG')
    expect(html).toContain('<title>' + cfg.title + '</title>')
    expect(readFileSync(join(root, 'dist', 'sitemap.xml'), 'utf8')).toContain(cfg.siteUrl)
  })
  it('把含圖片 alt 的靜態內容放進 #app，並產生圖片 sitemap 與 JSON-LD 截圖', () => {
    const root = sandbox('<html><head><title>x</title>\n<!--SEO:HEAD-->\n</head><body><div id="app"></div></body></html>')
    inject(root, {})
    const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
    expect(html).toMatch(/<div id="app"><main id="seo-static"/)
    expect(html.match(/<img [^>]*alt="[^"]+"/g)!.length).toBeGreaterThanOrEqual(4)
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1])
    expect(ld['@graph'][0].screenshot).toHaveLength(3)
    expect(readFileSync(join(root, 'dist', 'sitemap.xml'), 'utf8').match(/<image:loc>/g)).toHaveLength(4)
  })
  it('缺少標記時直接失敗', () => {
    expect(() => inject(sandbox('<html><head><title>x</title></head></html>'), {})).toThrow()
  })
  it('衡量 ID 格式錯誤時失敗', () => {
    expect(() => inject(sandbox(page), { GA_MEASUREMENT_ID: 'bad' })).toThrow()
  })
})
