/** 極簡 DOM 工具：建立元素、設定屬性與子節點。 */
export type Child = Node | string | number | null | undefined | false | Child[]

export interface Props {
  class?: string
  id?: string
  text?: string
  style?: Partial<CSSStyleDeclaration> | string
  attrs?: Record<string, string | number | boolean | undefined>
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (e: HTMLElementEventMap[K]) => void }>
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (props.class) el.className = props.class
  if (props.id) el.id = props.id
  if (props.text !== undefined) el.textContent = props.text
  if (props.style) {
    if (typeof props.style === 'string') el.setAttribute('style', props.style)
    else Object.assign(el.style, props.style)
  }
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) {
      if (v === undefined || v === false) continue
      el.setAttribute(k, v === true ? '' : String(v))
    }
  }
  if (props.on) {
    for (const [k, fn] of Object.entries(props.on)) el.addEventListener(k, fn as EventListener)
  }
  append(el, children)
  return el
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue
    if (Array.isArray(c)) append(el, c)
    else if (c instanceof Node) el.appendChild(c)
    else el.appendChild(document.createTextNode(String(c)))
  }
}

export function clear(el: Node): void {
  while (el.firstChild) el.removeChild(el.firstChild)
}

export function svg(markup: string, className = 'icon'): SVGSVGElement {
  const t = document.createElement('template')
  t.innerHTML = markup.trim()
  const el = t.content.firstElementChild as SVGSVGElement
  el.setAttribute('class', className)
  el.setAttribute('aria-hidden', 'true')
  el.setAttribute('focusable', 'false')
  return el
}

let uid = 0
export function nextId(prefix = 'u'): string {
  uid += 1
  return `${prefix}${uid}`
}
