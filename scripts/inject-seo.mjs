// 建置後注入 GA4 與 SEO 標籤到 dist/index.html，並產生 sitemap.xml（與 shoot-balloon 同一套做法）。
// 用法：npm run build && node scripts/inject-seo.mjs   （部署 workflow 會自動執行）
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MARK = '<!--SEO:HEAD-->'
const END = '<!--SEO:END-->'
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c')

export function validate(cfg, gaId) {
  for (const key of ['id', 'siteUrl', 'title', 'description', 'lobbyUrl', 'genre', 'players']) {
    if (typeof cfg[key] !== 'string' || !cfg[key].trim()) throw new Error('seo.config.json 缺少欄位：' + key)
  }
  // GitHub Pages repository slug can differ from the stable game_id after a repository rename.
  if (!/^[a-z0-9-]+$/.test(cfg.id) || !/^https:\/\/pjh-eric\.github\.io\/[a-z0-9-]+\/$/.test(cfg.siteUrl)) {
    throw new Error('siteUrl 必須是遊戲自己的 HTTPS 網址，並以 / 結尾')
  }
  if (cfg.lobbyUrl !== 'https://pjh-eric.github.io/game-lobby/') throw new Error('lobbyUrl 格式錯誤')
  if (cfg.title.length > 40 || cfg.description.length < 40 || cfg.description.length > 120) throw new Error('SEO 文案長度錯誤')
  if (!/^G-[A-Z0-9]+$/.test(gaId)) throw new Error('GA_MEASUREMENT_ID 格式錯誤')
  if (cfg.ogImage && !/^https:\/\/.+\/assets\/images\/(?:cover|seo)\.(jpg|webp)$/.test(cfg.ogImage)) throw new Error('ogImage 必須指向 HTTPS 的 cover／seo 的 JPG 或 WebP 圖片')
  for (const sc of cfg.screenshots ?? []) if (!sc.file || !sc.alt) throw new Error('screenshots 每張都要有 file 與 alt')
}

export function inject(root, env = process.env) {
  const cfg = JSON.parse(readFileSync(join(root, 'seo.config.json'), 'utf8'))
  const gaId = env.GA_MEASUREMENT_ID || 'G-PG79WZK8QY'
  validate(cfg, gaId)
  const indexPath = join(root, 'dist', 'index.html')
  if (!existsSync(indexPath)) throw new Error('找不到 dist/index.html，請先執行 npm run build')
  let html = readFileSync(indexPath, 'utf8')
  if (html.split(MARK).length !== 2) throw new Error('index.html 必須有一個 ' + MARK)
  // 保留界線，重複執行不會累積標籤
  html = html.replace(/<!--SEO:HEAD-->[\s\S]*?<!--SEO:END-->/, MARK)
    .replace(/<meta\b(?=[^>]*\bname=["']description["'])[^>]*>\s*/gi, '')
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, () => '<title>' + esc(cfg.title) + '</title>')
  const abs = (f) => cfg.siteUrl + f
  const shots = (cfg.screenshots ?? []).map((x) => ({ '@type': 'ImageObject', url: abs(x.file), contentUrl: abs(x.file), caption: x.caption || x.alt, description: x.alt, width: 1200, height: 675, encodingFormat: 'image/webp' }))
  const cover = cfg.ogImage ? { '@type': 'ImageObject', url: cfg.ogImage, contentUrl: cfg.ogImage, caption: cfg.ogImageAlt, width: 1200, height: 630, encodingFormat: cfg.ogImage.endsWith('.jpg') ? 'image/jpeg' : 'image/webp' } : undefined
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': ['WebApplication', 'VideoGame'], '@id': cfg.siteUrl + '#app',
        name: cfg.title.split('｜')[0], alternateName: 'Ice Duel', url: cfg.siteUrl, description: cfg.description,
        applicationCategory: 'GameApplication', operatingSystem: 'Any', browserRequirements: 'Requires JavaScript and WebGL',
        inLanguage: ['zh-Hant', 'zh-Hans', 'en'], genre: cfg.genre, playMode: ['SinglePlayer', 'MultiPlayer'],
        numberOfPlayers: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 8 },
        featureList: cfg.features, offers: { '@type': 'Offer', price: '0', priceCurrency: 'TWD' },
        image: cover, screenshot: shots, thumbnailUrl: cfg.ogImage || undefined,
        isPartOf: { '@type': 'WebSite', url: cfg.lobbyUrl, name: '遊戲小小島' },
      },
      {
        '@type': 'ImageGallery', name: cfg.title.split('｜')[0] + ' 遊戲畫面', url: cfg.siteUrl, image: shots,
      },
    ],
  }
  const alt = esc(cfg.ogImageAlt || cfg.title)
  const head = [
    MARK,
    '<script>window.GAME_ANALYTICS_CONFIG=' + safeJson({ measurement_id: gaId, game_id: cfg.id, page_location: cfg.siteUrl }) + ';</script>',
    cfg.googleSiteVerification && '<meta name="google-site-verification" content="' + esc(cfg.googleSiteVerification) + '">',
    '<meta name="description" content="' + esc(cfg.description) + '">',
    '<link rel="canonical" href="' + esc(cfg.siteUrl) + '">',
    '<link rel="alternate" hreflang="zh-Hant" href="' + esc(cfg.siteUrl) + '">',
    '<link rel="alternate" hreflang="zh-Hans" href="' + esc(cfg.siteUrl) + '?lang=zh-Hans">',
    '<link rel="alternate" hreflang="en" href="' + esc(cfg.siteUrl) + '?lang=en">',
    '<link rel="alternate" hreflang="x-default" href="' + esc(cfg.siteUrl) + '">',
    '<link rel="manifest" href="manifest.webmanifest">',
    '<meta name="robots" content="index, follow, max-image-preview:large">',
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="zh_TW">',
    '<meta property="og:locale:alternate" content="zh_CN">',
    '<meta property="og:locale:alternate" content="en_US">',
    '<meta property="og:site_name" content="遊戲小小島">',
    '<meta property="og:title" content="' + esc(cfg.title) + '">',
    '<meta property="og:description" content="' + esc(cfg.description) + '">',
    '<meta property="og:url" content="' + esc(cfg.siteUrl) + '">',
    cfg.ogImage && '<meta property="og:image" content="' + esc(cfg.ogImage) + '">',
    cfg.ogImage && '<meta property="og:image:type" content="' + (cfg.ogImage.endsWith('.jpg') ? 'image/jpeg' : 'image/webp') + '">',
    cfg.ogImage && '<meta property="og:image:width" content="1200">',
    cfg.ogImage && '<meta property="og:image:height" content="630">',
    cfg.ogImage && '<meta property="og:image:alt" content="' + alt + '">',
    '<meta name="twitter:card" content="' + (cfg.ogImage ? 'summary_large_image' : 'summary') + '">',
    '<meta name="twitter:title" content="' + esc(cfg.title) + '">',
    '<meta name="twitter:description" content="' + esc(cfg.description) + '">',
    cfg.ogImage && '<meta name="twitter:image" content="' + esc(cfg.ogImage) + '">',
    cfg.ogImage && '<meta name="twitter:image:alt" content="' + alt + '">',
    '<script type="application/ld+json">' + safeJson(jsonLd) + '</script>',
    END,
  ].filter(Boolean).join('\n')
  html = html.replace(MARK, () => head)
  // 搜尋引擎／無 JavaScript 時可讀的靜態內容：放進 #app，遊戲啟動後會被整個取代
  const staticHtml = '<main id="seo-static" style="max-width:860px;margin:0 auto;padding:24px 16px;font-family:system-ui,sans-serif;color:#10224f;background:#eaf6ff">' +
    '<h1>' + esc(cfg.title.split('｜')[0]) + ' Ice Duel</h1><p>' + esc(cfg.description) + '</p>' +
    '<img src="' + esc(abs('assets/images/cover.webp')) + '" alt="' + alt + '" width="1200" height="675" style="max-width:100%;height:auto">' +
    '<h2>玩法特色</h2><ul>' + (cfg.features ?? []).map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>' +
    '<h2>遊戲畫面</h2>' + (cfg.screenshots ?? []).map((x) => '<figure style="margin:0 0 16px"><img src="' + esc(abs(x.file)) + '" alt="' + esc(x.alt) + '" width="1200" height="675" loading="lazy" style="max-width:100%;height:auto"><figcaption>' + esc(x.caption || x.alt) + '</figcaption></figure>').join('') +
    '<p><a href="' + esc(cfg.lobbyUrl) + '">更多免費小遊戲：遊戲小小島</a></p><noscript><p>此遊戲需要啟用 JavaScript 才能遊玩。</p></noscript></main>'
  html = html.replace(/<div id="app"><\/div>/, () => '<div id="app">' + staticHtml + '</div>')
  writeFileSync(indexPath, html, 'utf8')
  const day = new Date().toISOString().slice(0, 10)
  const imgs = [{ file: cfg.ogImage.replace(cfg.siteUrl, ''), c: cfg.ogImageAlt }, ...(cfg.screenshots ?? []).map((x) => ({ file: x.file, c: x.caption || x.alt }))]
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n  <url>\n    <loc>' + esc(cfg.siteUrl) + '</loc>\n    <lastmod>' + day + '</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>1.0</priority>\n' +
    ['zh-Hant|', 'zh-Hans|?lang=zh-Hans', 'en|?lang=en'].map((v) => { const [l, q] = v.split('|'); return '    <xhtml:link rel="alternate" hreflang="' + l + '" href="' + esc(cfg.siteUrl + q) + '"/>\n' }).join('') +
    imgs.map((x) => '    <image:image><image:loc>' + esc(abs(x.file)) + '</image:loc><image:caption>' + esc(x.c) + '</image:caption></image:image>\n').join('') +
    '  </url>\n</urlset>\n'
  writeFileSync(join(root, 'dist', 'sitemap.xml'), xml, 'utf8')
  return cfg
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log('✓ SEO 與 GA4 已注入：' + inject(join(dirname(fileURLToPath(import.meta.url)), '..')).id) }
  catch (e) { console.error(e.message); process.exitCode = 1 }
}
