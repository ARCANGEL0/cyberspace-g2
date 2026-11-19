// Cyberpunk terminal UI for Even G2 glasses.
// Neon green (#0F0) on black, corner bevels, diagonal hatch/scan lines,
// terminal monospace text. High contrast for visibility on monochrome display.

import { TextContainerProperty } from '@evenrealities/even_hub_sdk'
import { createPage, rebuildPage, onGlassEvent } from './bridge.js'
import type { CyberspaceApi } from './api.js'

const GLASSES_W = 576
const GLASSES_H = 288
const SCREEN_WIDTH = 56
const MAX_LINES = 10
const BRIGHT = 4   // brightest text level

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

const CORNER_TL = '╭'
const CORNER_TR = '╮'
const CORNER_BL = '╰'
const CORNER_BR = '╯'
const H_LINE = '─'

function rule(label: string, right = ''): string {
  const left = `┤ ${fit(label, 16)} ├`
  const tail = right ? ` ├ ${fit(right, 14)} ┤` : ''
  const middle = Math.max(2, SCREEN_WIDTH - left.length - tail.length)
  return `${left}${H_LINE.repeat(middle)}${tail}`.slice(0, SCREEN_WIDTH)
}

function topRule(): string {
  const mid = H_LINE.repeat(SCREEN_WIDTH - 4)
  return `${CORNER_TL}${mid}${CORNER_TR}`.slice(0, SCREEN_WIDTH)
}

function bottomRule(): string {
  const mid = H_LINE.repeat(SCREEN_WIDTH - 4)
  return `${CORNER_BL}${mid}${CORNER_BR}`.slice(0, SCREEN_WIDTH)
}

function sectionRule(label: string, right?: string): string {
  return rule(label, right)
}

function footer(mode: ViewMode): string {
  if (mode === 'composer') return `┤ swipe select · tap confirm · 2x cancel ├`
  if (mode === 'detail') return `┤ swipe scroll · 2x back ├`
  return `┤ tap open · swipe scroll · 2x exit ├`
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

export function pcmToWav(pcm: Int16Array | number[], sampleRate = 16000): Blob {
  const bytes = new Int16Array(pcm)
  const buffer = new ArrayBuffer(44 + bytes.byteLength)
  const view = new DataView(buffer)
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + bytes.byteLength, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, bytes.byteLength, true)
  for (let i = 0; i < bytes.length; i++) view.setInt16(44 + i * 2, bytes[i], true)
  return new Blob([buffer], { type: 'audio/wav' })
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
  const lines: string[] = [topRule(), sectionRule(SECTION_LABELS[currentSection], currentSection === 'circ' ? 'ONLINE' : 'CYBERSPACE')]

  const total = items.length + 1 // +1 for WRITE FEED
  if (total <= 1) {
    lines.push(currentSection === 'feed' ? 'NO POSTS' : 'NO ITEMS')
    lines.push('', footer('list'))
    lines.push(bottomRule())
    return lines.slice(0, MAX_LINES + 1)
  }

  // Sliding window so the cursor stays visible
  const windowSize = MAX_LINES - 4 // header + section rule + footer + bottom rule
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
  lines.push(bottomRule())
  return lines.slice(0, MAX_LINES + 1)
}

function detailScreen(): string[] {
  if (!detail) return listScreen()
  const active = detail
  const lines: string[] = [topRule(), sectionRule(active.title, active.meta ?? SECTION_LABELS[active.section])]

  const visible = active.lines
    .slice(detailCursor, detailCursor + MAX_LINES - 4)
    .flatMap(line => wrap(line, SCREEN_WIDTH - 2, 3))

  if (!visible.length) visible.push('NO MESSAGES')

  for (let i = 0; i < visible.length && lines.length < MAX_LINES - 1; i++) {
    const isSelected = i === 0 // first visible line is the "selected" message
    const mark = isSelected ? '[>]' : '   '
    lines.push(`${mark}${fit(visible[i]!, SCREEN_WIDTH - mark.length - 2)}`.slice(0, SCREEN_WIDTH))
  }

  lines.push('', footer('detail'))
  lines.push(bottomRule())
  return lines.slice(0, MAX_LINES + 1)
}

function composerScreen(): string[] {
  if (!composer) return listScreen()
  const c = composer
  const lines: string[] = [topRule(), sectionRule(c.label, c.listening ? 'LISTENING' : 'VOICE')]
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
  lines.push(bottomRule())
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
