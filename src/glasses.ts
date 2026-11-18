// The monochrome terminal rendered on the G2.
// View modes: list (section items), detail (entry + replies), composer (write/reply).
// Unselected items are raw text; the selected item gets an outline marker "[>]".

import { TextContainerProperty } from '@evenrealities/even_hub_sdk'
import { createPage, rebuildPage, onGlassEvent } from './bridge.js'
import type { CyberspaceApi } from './api.js'

const GLASSES_W = 576
const GLASSES_H = 288
const SCREEN_WIDTH = 56
const MAX_LINES = 10

export type GlassSection = 'feed' | 'circ' | 'cmail' | 'notifications' | 'notes'
export type ComposerKind = 'write' | 'reply'
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
  lines: string[]   // OP message + replies, in display order
  side?: string[]
}

export interface ComposerState {
  text: string
  label: string
  kind: ComposerKind
  targetId?: string          // conversation/post id for replies
  selection: 0 | 1 | 2       // 0=Send, 1=Rewrite, 2=Quit
  listening: boolean         // voice recording active
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

function fit(value: string, width = SCREEN_WIDTH): string {
  const clean = oneLine(value)
  return clean.length > width ? `${clean.slice(0, Math.max(0, width - 1)).trimEnd()}…` : clean
}

function wrap(value: string, width = SCREEN_WIDTH, max = 3): string[] {
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

function rule(label: string, right = ''): string {
  const left = `-- ${fit(label, 18)} `
  const tail = right ? ` ${fit(right, 16)} --` : '--'
  const middle = Math.max(2, SCREEN_WIDTH - left.length - tail.length)
  return `${left}${'-'.repeat(middle)}${tail}`.slice(0, SCREEN_WIDTH)
}

function footer(mode: ViewMode): string {
  if (mode === 'composer') return 'swipe select   tap confirm   2x cancel'
  if (mode === 'detail') return 'swipe scroll   2x back'
  return 'tap open   swipe scroll   2x exit'
}

function captureLayer(): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0, yPosition: 0,
    width: GLASSES_W, height: GLASSES_H,
    borderWidth: 0, borderColor: 0,
    paddingLength: 0, containerID: 1,
    containerName: 'input', content: ' ',
    isEventCapture: 1, textColor: 0,
  })
}

function screenLayer(content: string): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0, yPosition: 0,
    width: GLASSES_W, height: GLASSES_H,
    borderWidth: 1, borderColor: 4,
    paddingLength: 6, containerID: 2,
    containerName: 'screen', content,
    isEventCapture: 0, textColor: 4,
  })
}

// ---------- state ----------

let mode: ViewMode = 'list'
let currentSection: GlassSection = 'feed'
let items: GlassItem[] = []
let cursor = 0
let detail: GlassDetail | null = null
let detailCursor = 0
let composer: ComposerState | null = null
let screenText = ''
let initialized = false

export function getScreenText(): string { return screenText }
export function isDetailOpen(): boolean { return mode === 'detail' }
export function isComposerOpen(): boolean { return mode === 'composer' }
export function isListening(): boolean { return composer?.listening ?? false }
export function getSelectedItem(): GlassItem | null { return items[cursor] ?? null }
export function getComposerState(): ComposerState | null { return composer }
export function getCurrentSection(): GlassSection { return currentSection }

export function initGlasses(_api: CyberspaceApi): void {}

export async function showLoggedOut(): Promise<void> {
  mode = 'list'
  currentSection = 'feed'
  items = []
  cursor = 0
  detail = null
  detailCursor = 0
  composer = null
  screenText = [rule('CYBERSPACE'), 'Not logged in yet. Access your account in your phone', '', footer('list')].join('\n')
  await paint()
}

export async function showSection(section: GlassSection, list: GlassItem[]): Promise<void> {
  mode = 'list'
  currentSection = section
  items = list
  cursor = 0
  detail = null
  detailCursor = 0
  composer = null
  await paint()
}

export async function showDetail(next: GlassDetail): Promise<void> {
  mode = 'detail'
  detail = next
  detailCursor = 0
  composer = null
  await paint()
}

export async function showCurrentList(): Promise<void> {
  mode = 'list'
  detail = null
  detailCursor = 0
  composer = null
  await paint()
}

export async function showComposer(textValue: string, label: string, kind: ComposerKind = 'write', targetId?: string): Promise<void> {
  mode = 'composer'
  composer = { text: textValue, label, kind, targetId, selection: 0, listening: false }
  await paint()
}

export async function setListening(listening: boolean): Promise<void> {
  if (!composer) return
  composer.listening = listening
  await paint()
}

export async function setComposerText(text: string): Promise<void> {
  if (!composer) return
  composer.text = text
  await paint()
}

export async function toggleComposerSelection(): Promise<void> {
  if (!composer) return
  composer.selection = ((composer.selection + 1) % 3) as 0 | 1 | 2
  await paint()
}

/** Move the selection cursor within the current view. */
export async function moveCursor(delta: number): Promise<void> {
  if (mode === 'detail') {
    if (!detail || !detail.lines.length) return
    detailCursor = Math.max(0, Math.min(detail.lines.length - 1, detailCursor + delta))
    await paint()
    return
  }
  if (mode === 'composer') {
    toggleComposerSelection()
    return
  }
  if (!items.length) return
  cursor = Math.max(0, Math.min(items.length - 1, cursor + delta))
  await paint()
}

// ---------- screens ----------

function listScreen(): string[] {
  const lines: string[] = [rule(SECTION_LABELS[currentSection], currentSection === 'circ' ? 'ONLINE' : 'CYBERSPACE')]

  const total = items.length + 1 // +1 for WRITE FEED
  if (total <= 1) {
    lines.push(currentSection === 'feed' ? 'NO POSTS' : 'NO ITEMS')
    lines.push('', footer('list'))
    return lines.slice(0, MAX_LINES + 1)
  }

  // Sliding window so the cursor stays visible
  const windowSize = MAX_LINES - 3 // header + footer + write row
  let start = Math.max(0, Math.min(cursor - Math.floor(windowSize / 2), total - windowSize))
  start = Math.max(0, start)
  const end = Math.min(total, start + windowSize)

  for (let i = start; i < end; i++) {
    const isWrite = i >= items.length
    const isSelected = i === cursor
    const mark = isSelected ? '[>]' : '   '

    if (isWrite) {
      lines.push(`${mark}WRITE FEED`.slice(0, SCREEN_WIDTH))
    } else {
      const item = items[i]
      const title = fit(item.title, SCREEN_WIDTH - mark.length - 2)
      lines.push(`${mark}${title}`.slice(0, SCREEN_WIDTH))
      const body = wrap(item.body || '—', SCREEN_WIDTH - 4, 1)[0]
      if (body) lines.push(`   ${fit(body, SCREEN_WIDTH - 4)}`)
    }
  }

  lines.push('', footer('list'))
  return lines.slice(0, MAX_LINES + 1)
}

function detailScreen(): string[] {
  if (!detail) return listScreen()
  const active = detail
  const lines: string[] = [rule(active.title, active.meta ?? SECTION_LABELS[active.section])]

  const visible = active.lines
    .slice(detailCursor, detailCursor + MAX_LINES - 3)
    .flatMap(line => wrap(line, SCREEN_WIDTH - 2, 3))

  if (!visible.length) visible.push('NO MESSAGES')

  for (let i = 0; i < visible.length && lines.length < MAX_LINES - 1; i++) {
    const isSelected = i === 0 // first visible line is the "selected" message
    const mark = isSelected ? '[>]' : '   '
    lines.push(`${mark}${fit(visible[i]!, SCREEN_WIDTH - mark.length - 2)}`.slice(0, SCREEN_WIDTH))
  }

  lines.push('', footer('detail'))
  return lines.slice(0, MAX_LINES + 1)
}

function composerScreen(): string[] {
  if (!composer) return listScreen()
  const c = composer
  const lines: string[] = [rule(c.label, c.listening ? 'LISTENING' : 'VOICE')]
  const displayText = c.listening ? '>> listening…' : `>> ${c.text || ''}`
  lines.push(fit(displayText, SCREEN_WIDTH - 2))
  lines.push('') // blank line

  const opts: { key: 0 | 1 | 2; label: string }[] = [
    { key: 0, label: 'Send' },
    { key: 1, label: 'Rewrite' },
    { key: 2, label: 'Quit' },
  ]
  opts.forEach((opt) => {
    const isSelected = c.selection === opt.key
    const mark = isSelected ? '[*]' : '-[]'
    lines.push(`${mark} ${opt.label}`.slice(0, SCREEN_WIDTH))
  })

  lines.push('', footer('composer'))
  return lines.slice(0, MAX_LINES + 1)
}

// ---------- paint ----------

async function paint(): Promise<void> {
  screenText = (() => {
    if (mode === 'composer') return composerScreen()
    if (mode === 'detail') return detailScreen()
    return listScreen()
  })().join('\n')

  const next = [captureLayer(), screenLayer(screenText)]
  if (!initialized) initialized = await createPage(next)
  else await rebuildPage(next)
}

// ---------- gesture binding ----------

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
