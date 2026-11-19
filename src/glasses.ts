// Cyberpunk terminal UI for Even G2 glasses.
// Text-container renderer using only glyphs that render on the monochrome font:
//   +  -  |  /  \  =  :  .  #  *  [  ]  (  )  <  >  {  }
//   letters and digits.
// Dense ASCII layout with corner bevels, dashed borders, diagonal right-edge hatch.

import { TextContainerProperty } from '@evenrealities/even_hub_sdk'
import { createPage, rebuildPage, onGlassEvent } from './bridge.js'
import type { CyberspaceApi } from './api.js'

const GLASSES_W = 576
const GLASSES_H = 288
const CHAR_W = 7
const CHAR_H = 10
const COLS = Math.floor(GLASSES_W / CHAR_W)   // 82 cols
const ROWS = Math.floor(GLASSES_H / CHAR_H)   // 28 rows

const BRIGHT = 4

export type GlassSection = 'feed' | 'circ' | 'cmail' | 'notifications' | 'notes'
export type ComposerKind = 'write' | 'reply' | 'circ' | 'cmail'
export type ViewMode = 'list' | 'detail' | 'composer'

export interface GlassItem {
  title: string
  body: string
  id?: string
  meta?: string
  topics?: string[]
}

export interface GlassDetail {
  section: GlassSection
  title: string
  meta?: string
  lines: string[]
  side?: string[]
}

export interface ComposerState {
  text: string
  label: string
  kind: ComposerKind
  targetId?: string
  selection: 0 | 1 | 2
  listening: boolean
}

const SECTION_LABELS: Record<GlassSection, string> = {
  feed: 'FEED',
  circ: 'CIRC',
  cmail: 'C-MAIL',
  notifications: 'INBOX',
  notes: 'NOTES',
}

const text = (value: unknown): string => typeof value === 'string' ? value : ''

function oneLine(value: unknown): string {
  return text(value).replace(/\s+/g, ' ').trim()
}

function fit(value: string, width = COLS): string {
  const clean = oneLine(value)
  return clean.length > width ? `${clean.slice(0, Math.max(0, width - 1)).trimEnd()}+` : clean
}

function wrap(value: string, width = COLS, max = 3): string[] {
  const words = oneLine(value).split(' ').filter(Boolean)
  const out: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length <= width) line = next
    else {
      if (line) out.push(line)
      line = word.slice(0, width)
      if (out.length === max) break
    }
  }
  if (line && out.length < max) out.push(line)
  return out.length ? out : ['']
}

const HATCH_PATTERN = ['/', '\\', '/', '\\', ' ', ' ', ' ', ' ']

function hatchLine(i: number): string {
  return HATCH_PATTERN[i % HATCH_PATTERN.length]
}

function topRule(leftLabel: string, rightLabel: string): string {
  const left = `+ ${fit(leftLabel, 12)} `
  const right = ` ${fit(rightLabel, 14)} +`
  const middle = Math.max(0, COLS - left.length - right.length)
  return `${left}${'='.repeat(middle)}${right}`.slice(0, COLS)
}

function bottomRule(): string {
  return `+${'='.repeat(COLS - 2)}+`.slice(0, COLS)
}

function footer(mode: ViewMode): string {
  if (mode === 'composer') return `+ swipe select - tap confirm - 2x cancel`
  if (mode === 'detail') return `+ swipe scroll - 2x back`
  return `+ tap open - swipe scroll - 2x exit`
}

function captureLayer(): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: GLASSES_W,
    height: GLASSES_H,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 0,
    containerID: 1,
    containerName: 'input',
    content: ' ',
    isEventCapture: 1,
    textColor: BRIGHT,
  })
}

function screenLayer(content: string): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: GLASSES_W,
    height: GLASSES_H,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 0,
    containerID: 2,
    containerName: 'screen',
    content,
    isEventCapture: 0,
    textColor: BRIGHT,
  })
}

export function initGlasses(_api: CyberspaceApi): void {}

export async function showLoggedOut(): Promise<void> {
  const lines: string[] = []
  lines.push(topRule('CYBERSPACE', ''))
  lines.push('')
  lines.push(sideLine(0) + 'Not logged in yet. Access your account in your phone')
  lines.push(sideLine(1) + '')
  lines.push(footer('list'))
  lines.push(bottomRule())
  const screenText = lines.join('\n')
  await paint(screenText)
}

export async function showSection(section: GlassSection, list: GlassItem[]): Promise<void> {
  const lines: string[] = [topRule(SECTION_LABELS[section], section === 'circ' ? 'ONLINE' : 'CYBERSPACE')]

  const total = list.length + 1
  if (total <= 1) {
    lines.push(sideLine(0) + (section === 'feed' ? 'NO POSTS' : 'NO ITEMS'))
    lines.push(sideLine(1) + '')
    lines.push(footer('list'))
    lines.push(bottomRule())
    const screenText = lines.join('\n')
    await paint(screenText)
    return
  }

  const windowSize = ROWS - 5
  let start = Math.max(0, Math.min(list.length - windowSize, total - windowSize))
  start = Math.max(0, start)
  const end = Math.min(total, start + windowSize)

  let row = 0
  for (let i = start; i < end; i++) {
    const isWrite = i >= list.length
    const prefix = sideLine(row) + ' '
    if (isWrite) {
      lines.push(prefix + 'WRITE FEED')
    } else {
      const item = list[i]
      const title = fit(item.title, COLS - prefix.length - 4)
      lines.push(prefix + title)
      const body = wrap(item.body || '—', COLS - prefix.length - 4, 1)[0]
      if (body) lines.push(sideLine(row + 1) + '   ' + fit(body, COLS - prefix.length - 6))
    }
    row++
  }

  while (row < windowSize) {
    lines.push(sideLine(row))
    row++
  }

  lines.push(footer('list'))
  lines.push(bottomRule())
  const screenText = lines.join('\n')
  await paint(screenText)
}

export async function showDetail(next: GlassDetail): Promise<void> {
  const lines: string[] = [topRule(next.title, next.meta ?? SECTION_LABELS[next.section])]

  const visible = next.lines
    .slice(0, ROWS - 5)
    .flatMap(line => wrap(line, COLS - 8, 3))

  if (!visible.length) visible.push('NO MESSAGES')

  let row = 0
  for (let i = 0; i < visible.length && lines.length < ROWS - 2; i++) {
    lines.push(sideLine(row) + ' ' + fit(visible[i], COLS - 8))
    row++
  }

  while (row < ROWS - 5) {
    lines.push(sideLine(row))
    row++
  }

  lines.push(footer('detail'))
  lines.push(bottomRule())
  const screenText = lines.join('\n')
  await paint(screenText)
}

export async function showCurrentList(): Promise<void> {
  renderList()
}

export async function showComposer(_textValue: string, _label: string, _kind: ComposerKind = 'write', _targetId?: string): Promise<void> {
  const lines: string[] = [topRule(_label, 'VOICE')]
  const displayText = `>> ${_textValue || ''}`
  lines.push(sideLine(0) + ' ' + fit(displayText, COLS - 8))
  lines.push(sideLine(1) + '')

  const opts: { key: 0 | 1 | 2; label: string }[] = [
    { key: 0, label: 'Send' },
    { key: 1, label: 'Rewrite' },
    { key: 2, label: 'Quit' },
  ]
  let row = 2
  opts.forEach((opt) => {
    const mark = row === 2 ? '[*]' : '-[]'
    lines.push(sideLine(row) + ' ' + mark + ' ' + opt.label)
    row++
  })

  lines.push(footer('composer'))
  lines.push(bottomRule())
  const screenText = lines.join('\n')
  await paint(screenText)
}

export async function setListening(_listening: boolean): Promise<void> {
  renderList()
}

export async function setComposerText(_text: string): Promise<void> {
  renderList()
}

export async function toggleComposerSelection(): Promise<void> {
  renderList()
}

export async function moveCursor(_delta: number): Promise<void> {
  renderList()
}

export function getScreenText(): string { return '' }
export function isDetailOpen(): boolean { return false }
export function isComposerOpen(): boolean { return false }
export function isListening(): boolean { return false }
export function getSelectedItem(): GlassItem | null { return null }
export function getComposerState(): ComposerState | null { return null }
export function getCurrentSection(): GlassSection { return 'feed' }

export function onGlassGesture(
  onTap: () => void | Promise<void>,
  onDoubleTap: () => void | Promise<void>,
  onSwipeUp: () => void | Promise<void>,
  onSwipeDown: () => void | Promise<void>,
  onLongPress: () => void | Promise<void> = () => {},
  onLongPressRelease: () => void | Promise<void> = () => {},
  onMenuItem: (itemID: number) => void | Promise<void> = () => {},
): () => void {
  return onGlassEvent((ev) => {
    switch (ev.type) {
      case 'tap': void onTap(); break
      case 'doubleTap': void onDoubleTap(); break
      case 'swipeUp': void onSwipeUp(); break
      case 'swipeDown': void onSwipeDown(); break
      case 'longPress': void onLongPress(); break
      case 'longPressRelease': void onLongPressRelease(); break
      case 'menu': if (typeof ev.itemID === 'number') void onMenuItem(ev.itemID); break
    }
  })
}

export { SECTION_LABELS }

// ---------- private ----------

let paintCount = 0

function sideLine(i: number): string {
  return `|` + ' '.repeat(COLS - 3) + '|' + hatchLine(i)
}

function renderList(): void {
  const lines: string[] = [topRule('CYBERSPACE', 'ONLINE')]
  lines.push(sideLine(0) + 'NO POSTS')
  lines.push(sideLine(1) + '')
  lines.push(footer('list'))
  lines.push(bottomRule())
  const screenText = lines.join('\n')
  void paint(screenText)
}

async function paint(screenText: string): Promise<void> {
  paintCount++
  const next = [captureLayer(), screenLayer(screenText)]
  if (paintCount === 1) {
    const ok = await createPage(next)
    if (!ok) console.error('glasses: createPage failed')
  } else {
    const ok = await rebuildPage(next)
    if (!ok) console.error('glasses: rebuildPage failed')
  }
}
