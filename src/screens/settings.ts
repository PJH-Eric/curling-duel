import { getSettings, resetSettings, updateSettings } from '../game/settings'
import { audio } from '../audio/engine'
import { t } from '../i18n'
import { h } from '../ui/dom'
import { Button, openModal, Segmented, Slider, toast, Toggle, type ModalHandle } from '../ui/kit'

/** 設定視窗：音樂與音效分開、減少動態、色彩輔助、語言等；變更立即生效並保存。 */
export function openSettings(): ModalHandle {
  const body = h('div', { class: 'stack' })
  const render = () => {
    const s = getSettings()
    body.replaceChildren(
      Toggle({ label: t('settings.music'), value: s.musicOn, onChange: (v) => updateSettings({ musicOn: v }) }),
      Slider({ label: `${t('settings.music')} ${t('settings.volume')}`, value: s.musicVol, min: 0, max: 100, step: 5, onChange: (v) => updateSettings({ musicVol: v }), format: (v) => `${v}%` }),
      Toggle({ label: t('settings.sfx'), value: s.sfxOn, onChange: (v) => { updateSettings({ sfxOn: v }); if (v) audio.play('click') } }),
      Slider({ label: `${t('settings.sfx')} ${t('settings.volume')}`, value: s.sfxVol, min: 0, max: 100, step: 5, onChange: (v) => { updateSettings({ sfxVol: v }); audio.play('click') }, format: (v) => `${v}%` }),
      Toggle({ label: t('settings.reduce'), hint: t('settings.reduceHint'), value: s.reduceMotion, onChange: (v) => updateSettings({ reduceMotion: v }) }),
      Toggle({ label: t('settings.colorAssist'), value: s.colorAssist, onChange: (v) => updateSettings({ colorAssist: v }) }),
      Toggle({ label: t('settings.haptics'), value: s.haptics, onChange: (v) => updateSettings({ haptics: v }) }),
      Segmented({ label: t('settings.replaySpeed'), value: s.replaySpeed, options: [{ value: 1, label: '1×' }, { value: 2, label: '2×' }, { value: 3, label: '3×' }], onChange: (v) => updateSettings({ replaySpeed: v }) }),
      Segmented({ label: t('settings.camera'), value: s.cameraFollow ? 'follow' : 'fixed', options: [{ value: 'follow', label: t('settings.camera.follow') }, { value: 'fixed', label: t('settings.camera.fixed') }], onChange: (v) => updateSettings({ cameraFollow: v === 'follow' }) }),
      h('div', { class: 'stack' }, h('b', { text: t('settings.controls') }), h('div', { class: 'muted', text: t('settings.keys') }), h('div', { class: 'muted', text: t('settings.touch') })),
    )
  }
  render()
  const footer = h('div', { class: 'row' }, Button({ label: t('common.reset'), variant: 'secondary', onClick: () => { resetSettings(); toast(t('settings.restored'), 'ok'); modal.close(); openSettings() } }))
  const modal = openModal({ title: t('settings.title'), body, footer, closeLabel: t('common.close'), width: 'md' })
  return modal
}
