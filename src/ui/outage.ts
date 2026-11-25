import { t } from '../i18n'
import { h } from './dom'
import { Button, openModal } from './kit'
import { createOutageWatcher } from '../net/outage'
import type { NetClient } from '../net/client'

/** 線上連不上伺服器太久時，跳出「伺服器過載休息中」提示。 */
export function mountOutageNotice(net: NetClient, eligible: () => boolean): void {
  const w = createOutageWatcher({
    eligible,
    show: () => {
      const m = openModal({
        title: t('outage.title'),
        width: 'sm',
        closeLabel: t('common.close'),
        body: h('div', { class: 'center', style: { padding: '18px 20px' }, text: t('outage.body') }),
        footer: Button({ label: t('outage.ok'), variant: 'primary', onClick: () => m.close() }),
      })
    },
  })
  net.onStatus((s) => w.onStatus(s))
}
