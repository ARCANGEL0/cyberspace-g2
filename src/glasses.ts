// The monochrome terminal rendered on the G2. The phone owns the data and
// composers; this module turns the current list or open conversation into a
// compact, readable 576x288 screen.

import { TextContainerProperty } from '@evenrealities/even_hub_sdk'
import { createPage, rebuildPage, onGlassEvent } from './bridge.js'
import type { CyberspaceApi } from './api.js'

const GLASSES_W = 576
const GLASSES_H = 288
const SCREEN_WIDTH = 56
const MAX_LINES = 10
const MAX_RECORDS = 3

export type GlassSection = 'feed' | 'circ' | 'cmail' | 'notifications' | 'notes'

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

function footer(detail: boolean): string {
  return detail ? 'swipe scroll   2x back' : 'tap open   swipe scroll   2x exit'
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
    textColor: 0,
  })
}

function screenLayer(content: string): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: GLASSES_W,
    height: GLASSES_H,
    borderWidth: 1,
    borderColor: 4,
    paddingLength: 6,
    containerID: 2,
    containerName: 'screen',
    content,
    isEventCapture: 0,
    textColor: 4,
  })
}

let currentSection: GlassSection | null = null
let items: GlassItem[] = []
let itemCursor = 0
let detail: GlassDetail | null = null
let detailOffset = 0
let composer: { text: string; label: string; selection: 'send' | 'cancel' } | null = null
let screenText = ''
let initialized = false

export function getScreenText(): string { return screenText }
export function isDetailOpen(): boolean { return detail !== null }
export function isComposerOpen(): boolean { return composer !== null }
export function getComposerSelection(): 'send' | 'cancel' { return composer?.selection ?? 'send' }
export function getSelectedItem(): GlassItem | null { return items[itemCursor] ?? null }

/** Kept for callers that initialize the renderer with the API client. */
export function initGlasses(_api: CyberspaceApi): void {}

export async function showLoggedOut(): Promise<void> {
  currentSection = null
  items = []
  detail = null
  composer = null
  screenText = [rule('CYBERSPACE'), 'Not logged in yet. Access your account in your phone', '', footer(false)].join('\n')
  await paint()
}

export async function showSection(section: GlassSection, list: GlassItem[]): Promise<void> {
  currentSection = section
  items = list
  itemCursor = 0
  detail = null
  composer = null
  detailOffset = 0
  await paint()
}

export async function showDetail(next: GlassDetail): Promise<void> {
  currentSection = next.section
  detail = next
  composer = null
  detailOffset = 0
  await paint()
}

export async function showCurrentList(): Promise<void> {
  detail = null
  composer = null
  detailOffset = 0
  await paint()
}

export async function showComposer(textValue: string, label: string): Promise<void> {
  composer = { text: textValue, label, selection: 'send' }
  await paint()
}

export async function toggleComposerSelection(): Promise<void> {
  if (!composer) return
  composer.selection = composer.selection === 'send' ? 'cancel' : 'send'
  await paint()
}

/** Swipe through list rows or scroll an open message. */
export async function moveCursor(delta: number): Promise<void> {
  if (detail) {
    const max = Math.max(0, detail.lines.length - (MAX_LINES - 2))
    detailOffset = Math.max(0, Math.min(max, detailOffset + delta))
    await paint()
    return
  }
  if (!items.length) return
  itemCursor = Math.max(0, Math.min(items.length - 1, itemCursor + delta))
  await paint()
}

function listScreen(): string[] {
  const section = currentSection ?? 'feed'
  const lines: string[] = [rule(SECTION_LABELS[section], section === 'circ' ? 'ONLINE' : 'CYBERSPACE')]
  if (!items.length) {
    lines.push(section === 'feed' ? 'NO POSTS' : 'NO ITEMS')
    lines.push('', footer(false))
    return lines
  }

  const start = Math.floor(itemCursor / MAX_RECORDS) * MAX_RECORDS
  const shown = items.slice(start, start + MAX_RECORDS)
  shown.forEach((item, row) => {
    if (lines.length >= MAX_LINES - 1) return
    const index = start + row
    const mark = index === itemCursor ? '> ' : '  '
    const title = fit(item.title, SCREEN_WIDTH - mark.length - (item.meta ? item.meta.length + 1 : 0))
    const suffix = item.meta ? ` ${fit(item.meta, 13)}` : ''
    lines.push(`${mark}${title}${suffix}`.slice(0, SCREEN_WIDTH))
    const body = wrap(item.body || '—', SCREEN_WIDTH - 3, section === 'feed' ? 1 : 2)[0]
    lines.push(`   ${fit(body, SCREEN_WIDTH - 3)}`)
    if (section === 'feed' && item.topics?.length) {
      lines.push(`   ${fit(item.topics.map(topic => `#${topic}`).join(' '), SCREEN_WIDTH - 3)}`)
    }
  })
  lines.push('', footer(false))
  return lines.slice(0, MAX_LINES + 1)
}

function detailScreen(): string[] {
  if (!detail) return listScreen()
  const active = detail
  const lines = [rule(active.title, active.meta ?? SECTION_LABELS[active.section])]
  const visible = active.lines
    .slice(detailOffset, detailOffset + MAX_LINES - 2)
    .flatMap(line => wrap(line, active.side?.length ? 37 : SCREEN_WIDTH - 2, 3))
  if (!visible.length) visible.push('NO MESSAGES')
  for (let i = 0; i < visible.length && lines.length < MAX_LINES; i++) {
    const side = active.side?.[i] ? `  ${fit(active.side[i]!, 14)}` : ''
    const leftWidth = active.side?.length ? SCREEN_WIDTH - 16 : SCREEN_WIDTH
    lines.push(`${fit(visible[i]!, leftWidth)}${side}`.slice(0, SCREEN_WIDTH))
  }
  lines.push('', footer(true))
  return lines.slice(0, MAX_LINES + 1)
}

function composerScreen(): string[] {
  if (!composer) return listScreen()
  const selected = composer.selection
  const lines = [rule(composer.label, 'REVIEW'), `${selected === 'send' ? '> ' : '  '}Send`, `${selected === 'cancel' ? '> ' : '  '}Cancel`, '']
  lines.push(...wrap(composer.text || 'TRANSCRIPT EMPTY / TYPE ON PHONE', SCREEN_WIDTH - 2, 3))
  lines.push('', 'swipe select   tap confirm   2x cancel')
  return lines.slice(0, MAX_LINES + 1)
}

async function paint(): Promise<void> {
  screenText = (composer ? composerScreen() : detail ? detailScreen() : listScreen()).join('\n')
  const next = [captureLayer(), screenLayer(screenText)]
  if (!initialized) initialized = await createPage(next)
  else await rebuildPage(next)
}

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
