import { getLang, t } from '../i18n'
import { h } from './dom'
import { Button, openModal } from './kit'
import { createOutageWatcher } from '../net/outage'
import type { NetClient } from '../net/client'

export const SPONSOR_URL = 'https://portaly.cc/pjh-eric/support'
const SPONSOR_WORD = { 'zh-TW': '贊助', 'zh-CN': '赞助', en: 'Sponsorships' } as const

/** 把提示文字中的「贊助」變成贊助連結 */
export function sponsorParts(text: string): (string | HTMLElement)[] {
  const word = SPONSOR_WORD[getLang()]
  const at = text.indexOf(word)
  if (at < 0) return [text]
  const link = h('a', { text: word, attrs: { href: SPONSOR_URL, target: '_blank', rel: 'noopener noreferrer' }, style: { color: 'inherit', fontWeight: '900', textDecoration: 'underline' } })
  return [text.slice(0, at), link, text.slice(at + word.length)]
}

/** 線上連不上伺服器太久時，跳出「伺服器過載休息中」提示。 */
export function mountOutageNotice(net: NetClient, eligible: () => boolean): void {
  const w = createOutageWatcher({
    eligible,
    show: () => {
      const m = openModal({
        title: t('outage.title'),
        width: 'sm',
        closeLabel: t('common.close'),
        body: h('div', { class: 'center', style: { padding: '18px 20px' } }, ...sponsorParts(t('outage.body'))),
        footer: Button({ label: t('outage.ok'), variant: 'primary', onClick: () => m.close() }),
      })
    },
  })
  net.onStatus((s) => w.onStatus(s))
}
