import { append, clear, h, nextId, type Child } from './dom'
import { icon, type IconName } from './icons'
import { getLang, LANG_BADGE, LANG_NAMES, LANGS, t, type Lang } from '../i18n'

/* ───────────── 按鈕 ───────────── */

export interface ButtonOpts {
  label?: string
  icon?: IconName
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
  size?: 'sm' | 'md' | 'lg'
  onClick?: (e: MouseEvent) => void
  disabled?: boolean
  ariaLabel?: string
  title?: string
  class?: string
  /** 長按連點用：true 時 pointerdown 就觸發 */
  onPress?: () => void
}

export function Button(o: ButtonOpts): HTMLButtonElement {
  const b = h('button', {
    class: `btn btn-${o.variant ?? 'secondary'} btn-${o.size ?? 'md'}${o.class ? ' ' + o.class : ''}`,
    attrs: { type: 'button', 'aria-label': o.ariaLabel ?? (o.label ? undefined : o.title), title: o.title },
  })
  if (o.icon) b.appendChild(icon(o.icon, 'icon btn-icon'))
  if (o.label) b.appendChild(h('span', { class: 'btn-label', text: o.label }))
  b.disabled = !!o.disabled
  if (o.onClick) b.addEventListener('click', (e) => o.onClick!(e))
  if (o.onPress) {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      o.onPress!()
    })
    b.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault()
        o.onPress!()
      }
    })
  }
  return b
}

export function IconButton(name: IconName, label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  return Button({ icon: name, ariaLabel: label, title: label, onClick, variant: 'ghost', class: `icon-btn ${cls}` })
}

/* ───────────── 語言選單：地球鈕＋目前語言徽章，點開列出全部語言 ───────────── */

/** onPick 由呼叫端決定如何套用（寫入設定並重畫畫面）。↑↓ 移動、Esc 關閉、點外面關閉。 */
export function LangMenu(onPick: (l: Lang) => void): HTMLElement {
  const cur = getLang()
  const btn = Button({ icon: 'globe', ariaLabel: `${t('lang.switch')}：${LANG_NAMES[cur]}`, title: t('lang.switch'), variant: 'ghost', class: 'icon-btn langbtn' })
  btn.append(h('span', { class: 'lang-badge', text: LANG_BADGE[cur], attrs: { 'aria-hidden': 'true' } }))
  const wrap = h('div', { class: 'langmenu' }, btn)
  let pop: HTMLElement | null = null
  const onDoc = (e: Event) => { if (!wrap.contains(e.target as Node)) close(false) }
  function close(focus: boolean): void {
    if (!pop) return
    pop.remove()
    pop = null
    btn.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', onDoc, true)
    if (focus) btn.focus()
  }
  function open(): void {
    pop = h('div', { class: 'langpop', attrs: { role: 'menu', 'aria-label': t('lang.switch') } })
    const items: HTMLButtonElement[] = LANGS.map((code, i) => {
      const b = h('button', { class: `langopt${code === cur ? ' cur' : ''}`, text: LANG_NAMES[code], attrs: { type: 'button', role: 'menuitemradio', 'aria-checked': String(code === cur), lang: code === 'zh-TW' ? 'zh-Hant' : code === 'zh-CN' ? 'zh-Hans' : 'en' } }) as HTMLButtonElement
      b.addEventListener('click', () => { close(false); onPick(code) })
      b.addEventListener('keydown', (e) => {
        e.stopPropagation()
        const go = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length].focus() }
        if (e.key === 'ArrowDown') go(i + 1)
        else if (e.key === 'ArrowUp') go(i - 1)
        else if (e.key === 'Escape') { e.preventDefault(); close(true) }
        else if (e.key === 'Tab') close(false)
      })
      return b
    })
    pop.append(...items)
    wrap.append(pop)
    btn.setAttribute('aria-expanded', 'true')
    document.addEventListener('pointerdown', onDoc, true)
    items[Math.max(0, LANGS.indexOf(cur))].focus()
  }
  btn.setAttribute('aria-haspopup', 'menu')
  btn.setAttribute('aria-expanded', 'false')
  btn.addEventListener('click', () => (pop ? close(false) : open()))
  return wrap
}

/* ───────────── 面板、標籤、鍵帽 ───────────── */

export function Panel(opts: { class?: string; title?: string }, ...children: Child[]): HTMLElement {
  return h('section', { class: `panel ${opts.class ?? ''}` }, opts.title ? h('h3', { class: 'panel-title', text: opts.title }) : null, children)
}

export function Tag(text: string, tone: 'info' | 'warn' | 'ok' | 'hot' = 'info'): HTMLElement {
  return h('span', { class: `tag tag-${tone}`, text })
}

export function KeyCap(text: string): HTMLElement {
  return h('kbd', { class: 'keycap', text })
}

/* ───────────── 自繪捲動區（自訂捲軸） ───────────── */

export interface ScrollAreaHandle {
  el: HTMLElement
  viewport: HTMLElement
  scrollToBottom: () => void
}

export function ScrollArea(opts: { class?: string; label?: string; horizontal?: boolean }, ...children: Child[]): ScrollAreaHandle {
  const viewport = h('div', { class: 'sa-viewport', attrs: { tabindex: 0, role: 'region', 'aria-label': opts.label ?? '' } }, children)
  const thumbY = h('div', { class: 'sa-thumb' })
  const trackY = h('div', { class: 'sa-track sa-track-y', attrs: { 'aria-hidden': 'true' } }, thumbY)
  const thumbX = h('div', { class: 'sa-thumb' })
  const trackX = h('div', { class: 'sa-track sa-track-x', attrs: { 'aria-hidden': 'true' } }, thumbX)
  const el = h('div', { class: `sa ${opts.class ?? ''}${opts.horizontal ? ' sa-h' : ''}` }, viewport, trackY, opts.horizontal ? trackX : null)

  const update = () => {
    const { scrollTop, scrollHeight, clientHeight, scrollLeft, scrollWidth, clientWidth } = viewport
    const needY = scrollHeight > clientHeight + 1
    trackY.style.display = needY ? 'block' : 'none'
    if (needY) {
      const th = Math.max(36, (clientHeight / scrollHeight) * trackY.clientHeight)
      const max = trackY.clientHeight - th
      thumbY.style.height = `${th}px`
      thumbY.style.transform = `translateY(${(scrollTop / (scrollHeight - clientHeight)) * max}px)`
    }
    if (opts.horizontal) {
      const needX = scrollWidth > clientWidth + 1
      trackX.style.display = needX ? 'block' : 'none'
      if (needX) {
        const tw = Math.max(36, (clientWidth / scrollWidth) * trackX.clientWidth)
        const max = trackX.clientWidth - tw
        thumbX.style.width = `${tw}px`
        thumbX.style.transform = `translateX(${(scrollLeft / (scrollWidth - clientWidth)) * max}px)`
      }
    }
  }
  viewport.addEventListener('scroll', update, { passive: true })
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(update)
    ro.observe(viewport)
    ro.observe(el)
    const mo = new MutationObserver(update)
    mo.observe(viewport, { childList: true, subtree: true })
  }
  queueMicrotask(update)

  const drag = (thumb: HTMLElement, axis: 'x' | 'y') => {
    thumb.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      thumb.setPointerCapture(e.pointerId)
      const start = axis === 'y' ? e.clientY : e.clientX
      const startScroll = axis === 'y' ? viewport.scrollTop : viewport.scrollLeft
      const move = (ev: PointerEvent) => {
        if (axis === 'y') {
          const th = thumb.offsetHeight
          const room = trackY.clientHeight - th
          viewport.scrollTop = startScroll + ((ev.clientY - start) / room) * (viewport.scrollHeight - viewport.clientHeight)
        } else {
          const tw = thumb.offsetWidth
          const room = trackX.clientWidth - tw
          viewport.scrollLeft = startScroll + ((ev.clientX - start) / room) * (viewport.scrollWidth - viewport.clientWidth)
        }
      }
      const up = () => {
        thumb.removeEventListener('pointermove', move)
        thumb.removeEventListener('pointerup', up)
      }
      thumb.addEventListener('pointermove', move)
      thumb.addEventListener('pointerup', up)
    })
  }
  drag(thumbY, 'y')
  drag(thumbX, 'x')
  trackY.addEventListener('pointerdown', (e) => {
    if (e.target === thumbY) return
    const r = thumbY.getBoundingClientRect()
    viewport.scrollBy({ top: e.clientY < r.top ? -viewport.clientHeight * 0.9 : viewport.clientHeight * 0.9, behavior: 'smooth' })
  })
  return { el, viewport, scrollToBottom: () => { viewport.scrollTop = viewport.scrollHeight } }
}

/* ───────────── 開關 ───────────── */

export function Toggle(o: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }): HTMLElement {
  const id = nextId('tg')
  let value = o.value
  const sw = h('button', { class: 'switch', id, attrs: { type: 'button', role: 'switch', 'aria-checked': String(value), 'aria-labelledby': `${id}-l` } }, h('span', { class: 'switch-knob' }))
  const apply = () => {
    sw.setAttribute('aria-checked', String(value))
    sw.classList.toggle('on', value)
  }
  apply()
  sw.addEventListener('click', () => {
    value = !value
    apply()
    o.onChange(value)
  })
  return h('div', { class: 'field field-row' }, h('div', { class: 'field-text' }, h('label', { class: 'field-label', id: `${id}-l`, text: o.label, attrs: { for: id } }), o.hint ? h('div', { class: 'field-hint', text: o.hint }) : null), sw)
}

/* ───────────── 滑桿 ───────────── */

export function Slider(o: { label: string; min?: number; max?: number; step?: number; value: number; onChange: (v: number) => void; format?: (v: number) => string }): HTMLElement {
  const min = o.min ?? 0
  const max = o.max ?? 100
  const step = o.step ?? 1
  let value = o.value
  const id = nextId('sl')
  const fill = h('div', { class: 'slider-fill' })
  const knob = h('div', { class: 'slider-knob' })
  const track = h('div', { class: 'slider-track' }, fill, knob)
  const out = h('span', { class: 'slider-value' })
  const root = h('div', { class: 'slider', id, attrs: { role: 'slider', tabindex: 0, 'aria-labelledby': `${id}-l`, 'aria-valuemin': min, 'aria-valuemax': max } }, track)
  const apply = () => {
    const f = (value - min) / (max - min)
    fill.style.width = `${f * 100}%`
    knob.style.left = `${f * 100}%`
    root.setAttribute('aria-valuenow', String(value))
    const txt = o.format ? o.format(value) : String(Math.round(value))
    root.setAttribute('aria-valuetext', txt)
    out.textContent = txt
  }
  const set = (v: number) => {
    const snapped = Math.round((v - min) / step) * step + min
    const nv = Math.min(max, Math.max(min, Number(snapped.toFixed(6))))
    if (nv === value) return
    value = nv
    apply()
    o.onChange(value)
  }
  const fromEvent = (e: PointerEvent) => {
    const r = track.getBoundingClientRect()
    set(min + ((e.clientX - r.left) / r.width) * (max - min))
  }
  root.addEventListener('pointerdown', (e) => {
    root.setPointerCapture(e.pointerId)
    root.focus()
    fromEvent(e)
    const mv = (ev: PointerEvent) => fromEvent(ev)
    const up = () => {
      root.removeEventListener('pointermove', mv)
      root.removeEventListener('pointerup', up)
    }
    root.addEventListener('pointermove', mv)
    root.addEventListener('pointerup', up)
  })
  root.addEventListener('keydown', (e) => {
    const big = (max - min) / 10
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(value + step)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(value - step)
    else if (e.key === 'PageUp') set(value + big)
    else if (e.key === 'PageDown') set(value - big)
    else if (e.key === 'Home') set(min)
    else if (e.key === 'End') set(max)
    else return
    e.preventDefault()
  })
  apply()
  return h('div', { class: 'field' }, h('div', { class: 'field-head' }, h('label', { class: 'field-label', id: `${id}-l`, text: o.label }), out), root)
}

/** 可從外部更新的滑桿（力道條用）。 */
export interface GaugeHandle {
  el: HTMLElement
  set: (v: number) => void
}

export function PowerGauge(o: { label: string; marker?: number; onChange: (v: number) => void; value: number }): GaugeHandle {
  let value = o.value
  const id = nextId('pg')
  const fill = h('div', { class: 'gauge-fill' })
  const knob = h('div', { class: 'gauge-knob' })
  const marker = o.marker !== undefined ? h('div', { class: 'gauge-marker', style: { left: `${o.marker * 100}%` } }, h('span', { text: '◂ 圓心力道'.slice(0, 0) })) : null
  const bar = h('div', { class: 'gauge-bar' }, fill, marker, knob)
  const out = h('span', { class: 'gauge-val' })
  const root = h('div', { class: 'gauge', id, attrs: { role: 'slider', tabindex: 0, 'aria-label': o.label, 'aria-valuemin': 0, 'aria-valuemax': 100 } }, h('span', { class: 'gauge-tag', text: o.label }), bar, out)
  const apply = () => {
    fill.style.width = `${value * 100}%`
    knob.style.left = `${value * 100}%`
    out.textContent = `${Math.round(value * 100)}%`
    root.setAttribute('aria-valuenow', String(Math.round(value * 100)))
  }
  const set = (v: number, notify = true) => {
    const nv = Math.min(1, Math.max(0, Math.round(v * 100) / 100))
    if (nv === value && notify) return
    value = nv
    apply()
    if (notify) o.onChange(value)
  }
  const fromEvent = (e: PointerEvent) => {
    const r = bar.getBoundingClientRect()
    set((e.clientX - r.left) / r.width)
  }
  root.addEventListener('pointerdown', (e) => {
    root.setPointerCapture(e.pointerId)
    root.focus()
    fromEvent(e)
    const mv = (ev: PointerEvent) => fromEvent(ev)
    const up = () => {
      root.removeEventListener('pointermove', mv)
      root.removeEventListener('pointerup', up)
    }
    root.addEventListener('pointermove', mv)
    root.addEventListener('pointerup', up)
  })
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(value + (e.shiftKey ? 0.1 : 0.01))
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(value - (e.shiftKey ? 0.1 : 0.01))
    else return
    e.preventDefault()
  })
  apply()
  return { el: root, set: (v) => set(v, false) }
}

/* ───────────── 分段按鈕（單選） ───────────── */

export function Segmented<T extends string | number>(o: { label?: string; options: { value: T; label: string; icon?: IconName }[]; value: T; onChange: (v: T) => void }): HTMLElement {
  const id = nextId('sg')
  let value = o.value
  const group = h('div', { class: 'segmented', attrs: { role: 'radiogroup', 'aria-labelledby': o.label ? `${id}-l` : undefined } })
  const buttons: HTMLButtonElement[] = []
  const apply = () => {
    buttons.forEach((b, i) => {
      const on = o.options[i].value === value
      b.classList.toggle('on', on)
      b.setAttribute('aria-checked', String(on))
      b.tabIndex = on ? 0 : -1
    })
  }
  o.options.forEach((opt, i) => {
    const b = h('button', { class: 'seg', attrs: { type: 'button', role: 'radio' } }, opt.icon ? icon(opt.icon) : null, h('span', { text: opt.label }))
    b.addEventListener('click', () => {
      value = opt.value
      apply()
      o.onChange(value)
    })
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      e.preventDefault()
      const ni = (i + (e.key === 'ArrowRight' ? 1 : -1) + o.options.length) % o.options.length
      buttons[ni].focus()
      buttons[ni].click()
    })
    buttons.push(b)
    group.appendChild(b)
  })
  apply()
  return h('div', { class: 'field' }, o.label ? h('div', { class: 'field-label', id: `${id}-l`, text: o.label }) : null, group)
}

/* ───────────── 步進器 ───────────── */

export function Stepper(o: { label: string; min: number; max: number; value: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }): HTMLElement {
  let value = o.value
  const id = nextId('st')
  const out = h('span', { class: 'stepper-val', attrs: { 'aria-live': 'polite' } })
  const set = (v: number) => {
    value = Math.min(o.max, Math.max(o.min, v))
    out.textContent = o.format ? o.format(value) : String(value)
    dec.disabled = value <= o.min
    inc.disabled = value >= o.max
    o.onChange(value)
  }
  const dec = Button({ icon: 'minus', ariaLabel: `${o.label} −`, onClick: () => set(value - (o.step ?? 1)), size: 'sm' })
  const inc = Button({ icon: 'plus', ariaLabel: `${o.label} +`, onClick: () => set(value + (o.step ?? 1)), size: 'sm' })
  out.textContent = o.format ? o.format(value) : String(value)
  dec.disabled = value <= o.min
  inc.disabled = value >= o.max
  return h('div', { class: 'field field-row' }, h('label', { class: 'field-label', id: `${id}-l`, text: o.label }), h('div', { class: 'stepper' }, dec, out, inc))
}

/* ───────────── 文字輸入 ───────────── */

export function TextField(o: { label: string; value?: string; maxLength?: number; placeholder?: string; onInput?: (v: string) => void; onEnter?: (v: string) => void; hint?: string; class?: string }): { el: HTMLElement; input: HTMLInputElement } {
  const id = nextId('tf')
  const input = h('input', { class: 'input', id, attrs: { type: 'text', maxlength: o.maxLength, placeholder: o.placeholder, autocomplete: 'off', autocapitalize: 'off', spellcheck: false } })
  input.value = o.value ?? ''
  input.addEventListener('input', () => o.onInput?.(input.value))
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') o.onEnter?.(input.value)
  })
  const el = h('div', { class: `field ${o.class ?? ''}` }, h('label', { class: 'field-label', text: o.label, attrs: { for: id } }), h('div', { class: 'input-wrap' }, input), o.hint ? h('div', { class: 'field-hint', text: o.hint }) : null)
  return { el, input }
}

/* ───────────── 自製下拉選單 ───────────── */

export function Select<T extends string | number>(o: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }): HTMLElement {
  const id = nextId('se')
  let value = o.value
  let open = false
  let pop: HTMLElement | null = null
  let active = 0
  const labelOf = (v: T) => o.options.find((x) => x.value === v)?.label ?? ''
  const text = h('span', { class: 'select-text', text: labelOf(value) })
  const btn = h('button', { class: 'select-btn', id, attrs: { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-labelledby': `${id}-l ${id}` } }, text, icon('chevron', 'icon select-chev'))

  const close = () => {
    if (!open) return
    open = false
    btn.setAttribute('aria-expanded', 'false')
    pop?.remove()
    pop = null
    document.removeEventListener('pointerdown', outside, true)
  }
  const outside = (e: Event) => {
    if (pop && !pop.contains(e.target as Node) && !btn.contains(e.target as Node)) close()
  }
  const choose = (i: number) => {
    value = o.options[i].value
    text.textContent = labelOf(value)
    close()
    o.onChange(value)
    btn.focus()
  }
  const render = () => {
    if (!pop) return
    Array.from(pop.children).forEach((c, i) => {
      c.classList.toggle('active', i === active)
      c.setAttribute('aria-selected', String(o.options[i].value === value))
    })
    const cur = pop.children[active] as HTMLElement | undefined
    cur?.scrollIntoView({ block: 'nearest' })
  }
  const openIt = () => {
    if (open) return
    open = true
    btn.setAttribute('aria-expanded', 'true')
    active = Math.max(0, o.options.findIndex((x) => x.value === value))
    pop = h('div', { class: 'select-pop', attrs: { role: 'listbox', 'aria-labelledby': `${id}-l` } })
    o.options.forEach((opt, i) => {
      const li = h('div', { class: 'select-opt', text: opt.label, attrs: { role: 'option' } })
      li.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        choose(i)
      })
      li.addEventListener('pointermove', () => {
        active = i
        render()
      })
      pop!.appendChild(li)
    })
    const r = btn.getBoundingClientRect()
    pop.style.minWidth = `${r.width}px`
    pop.style.left = `${r.left}px`
    const room = window.innerHeight - r.bottom
    const need = Math.min(240, o.options.length * 40 + 8)
    if (room < need && r.top > room) {
      pop.style.bottom = `${window.innerHeight - r.top + 4}px`
    } else {
      pop.style.top = `${r.bottom + 4}px`
    }
    ;(document.getElementById('overlay-root') ?? document.body).appendChild(pop)
    document.addEventListener('pointerdown', outside, true)
    render()
  }
  btn.addEventListener('click', () => (open ? close() : openIt()))
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) openIt()
      else {
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + o.options.length) % o.options.length
        render()
      }
    } else if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault()
      choose(active)
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation()
      close()
    }
  })
  btn.addEventListener('blur', () => setTimeout(() => { if (open && document.activeElement !== btn) close() }, 120))
  return h('div', { class: 'field' }, h('div', { class: 'field-label', id: `${id}-l`, text: o.label }), btn)
}

/* ───────────── Modal（焦點鎖定、Esc 關閉、返回原焦點） ───────────── */

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface ModalHandle {
  close: () => void
  el: HTMLElement
}

let modalDepth = 0

export function openModal(o: { title: string; body: Node; footer?: Node; onClose?: () => void; width?: 'sm' | 'md' | 'lg'; closeLabel: string; dismissible?: boolean }): ModalHandle {
  const opener = document.activeElement as HTMLElement | null
  const root = document.getElementById('overlay-root') ?? document.body
  const titleId = nextId('mt')
  const sa = ScrollArea({ class: 'modal-scroll', label: o.title }, o.body)
  const closeBtn = IconButton('close', o.closeLabel, () => close())
  const dialog = h('div', { class: `modal modal-${o.width ?? 'md'}`, attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId } },
    h('header', { class: 'modal-head' }, h('h2', { id: titleId, text: o.title }), o.dismissible === false ? null : closeBtn),
    sa.el,
    o.footer ? h('footer', { class: 'modal-foot' }, o.footer) : null)
  const backdrop = h('div', { class: 'modal-backdrop' }, dialog)
  modalDepth += 1
  root.appendChild(backdrop)
  const key = (e: KeyboardEvent) => {
    if (backdrop !== root.lastElementChild && !backdrop.contains(document.activeElement)) return
    if (e.key === 'Escape' && o.dismissible !== false) {
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab') {
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }
  document.addEventListener('keydown', key, true)
  if (o.dismissible !== false) backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) close() })
  let closed = false
  function close() {
    if (closed) return
    closed = true
    document.removeEventListener('keydown', key, true)
    backdrop.remove()
    modalDepth -= 1
    o.onClose?.()
    opener?.focus?.()
  }
  requestAnimationFrame(() => {
    const first = dialog.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
  })
  return { close, el: dialog }
}

export function isModalOpen(): boolean {
  return modalDepth > 0
}

/* ───────────── Toast ───────────── */

export function toast(message: string, tone: 'info' | 'ok' | 'warn' = 'info', ms = 2600): void {
  const root = document.getElementById('overlay-root') ?? document.body
  let host = root.querySelector<HTMLElement>('.toast-host')
  if (!host) {
    host = h('div', { class: 'toast-host', attrs: { role: 'status', 'aria-live': 'polite' } })
    root.appendChild(host)
  }
  const t = h('div', { class: `toast toast-${tone}`, text: message })
  host.appendChild(t)
  setTimeout(() => {
    t.classList.add('out')
    setTimeout(() => t.remove(), 300)
  }, ms)
}

export function replaceChildren(el: HTMLElement, ...children: Child[]): void {
  clear(el)
  append(el, children)
}
