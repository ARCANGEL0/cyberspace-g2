// Card UI for Even G2 glasses.
//
// One fixed page for every screen:
//   - four image tiles draw the bevelled frame (see frame.ts),
//   - three text containers sit above them: title (in the header notch),
//     body (six lines inside the card) and hint (two lines under the card),
//   - a full-screen blank text container at the back captures input.
// The page is created once. After that, screen changes are flicker-free
// textContainerUpgrade calls; only the header tile is resent when its icon changes.

import { ImageContainerProperty, TextContainerProperty } from '@evenrealities/even_hub_sdk'
import { getTextWidth, pxTruncate } from '@evenrealities/pretext'
import { createPage, onGlassEvent, rebuildPage, updateImageRawData, upgradeText } from './bridge.js'
import { CARD, HEADER_RULE_Y, HEADER_TILE, SCREEN_H, SCREEN_W, TILES, drawFrame, tilePng, type HeaderMarks, type IconKind, type Tile } from './frame.js'
import type { CyberspaceApi } from './api.js'

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
  transcribing: boolean
  heldMic: boolean
  /** Shown in place of the transcript, never sent: setup hints and errors. */
  notice?: string
}

const SECTION_ICONS: Record<GlassSection, IconKind> = {
  feed: 'feed',
  circ: 'circ',
  cmail: 'cmail',
  notifications: 'inbox',
  notes: 'notes',
}

const SECTION_LABELS: Record<GlassSection, string> = {
  feed: 'FEED',
  circ: 'cIRC',
  cmail: 'C-MAIL',
  notifications: 'INBOX',
  notes: 'NOTES',
}

// ---------- layout ----------

const LINE_H = 27        // firmware font line height
const BODY_LINES = 6
const HINT_LINES = 2

interface Box { id: number, name: string, x: number, y: number, width: number, height: number }

const INPUT: Box = { id: 1, name: 'input', x: 0, y: 0, width: SCREEN_W, height: SCREEN_H }
const TITLE: Box = { id: 6, name: 'title', x: CARD.x0 + 21, y: CARD.y0 + 5, width: 400, height: LINE_H + 6 }
const BODY: Box = { id: 7, name: 'body', x: CARD.x0 + 20, y: HEADER_RULE_Y + 8, width: 528, height: LINE_H * BODY_LINES + 4 }
const HINT: Box = { id: 8, name: 'hint', x: CARD.x0 + 14, y: CARD.y1 + 4, width: 540, height: LINE_H * HINT_LINES + 2 }

const SEP = '  ·  '
const HINT_COLOR = 2   // dimmer than body text, as on the reference cards
const CURSOR = '> '

// ---------- text fitting (pixel-accurate, pretext mirrors the firmware font) ----------

const text = (value: unknown): string => typeof value === 'string' ? value : ''

function oneLine(value: unknown): string {
  return text(value)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // Markdown link: keep the label only
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(value: string, maxPx: number): string {
  return pxTruncate(oneLine(value), maxPx)
}

/** Word-wrap to lines no wider than maxPx; overlong words are hard-split. */
function wrap(value: string, maxPx: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of oneLine(value).split(' ').filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (getTextWidth(next) <= maxPx) { line = next; continue }
    if (line) out.push(line)
    line = ''
    let rest = word
    while (getTextWidth(rest) > maxPx) {
      let n = rest.length - 1
      while (n > 1 && getTextWidth(rest.slice(0, n)) > maxPx) n--
      out.push(rest.slice(0, n))
      rest = rest.slice(n)
    }
    line = rest
  }
  if (line) out.push(line)
  return out
}

/** Spaces that take up the same width as the cursor, so rows stay aligned. */
const INDENT = (() => {
  let pad = ''
  while (getTextWidth(pad) < getTextWidth(CURSOR)) pad += ' '
  return pad
})()

function row(label: string, selected: boolean): string {
  const prefix = selected ? CURSOR : INDENT
  return prefix + truncate(label, BODY.width - getTextWidth(prefix) - 4)
}

function pad(lines: string[], count: number): string {
  const out = lines.slice(0, count)
  return out.join('\n') || ' '
}

// ---------- state ----------

let mode: ViewMode = 'list'
let loggedIn = false
let currentSection: GlassSection = 'feed'
let items: GlassItem[] = []
let cursor = 0
let detail: GlassDetail | null = null
let detailRows: string[] = []
let detailPage = 0
let composer: ComposerState | null = null
let screenText = ''

export function getScreenText(): string { return screenText }
export function isDetailOpen(): boolean { return mode === 'detail' }
export function isComposerOpen(): boolean { return mode === 'composer' }
export function isListening(): boolean { return composer?.listening ?? false }
export function isTranscribing(): boolean { return composer?.transcribing ?? false }
export function hasTranscript(): boolean { return !!composer && !composer.listening && !composer.transcribing && !!composer.text }
export function getSelectedItem(): GlassItem | null { return items[cursor] ?? null }
export function getComposerState(): ComposerState | null { return composer }
export function getCurrentSection(): GlassSection { return currentSection }

export function initGlasses(_api: CyberspaceApi): void {}

export async function showLoggedOut(): Promise<void> {
  loggedIn = false
  mode = 'list'
  currentSection = 'feed'
  items = []
  cursor = 0
  detail = null
  composer = null
  await paint()
}

export async function showSection(section: GlassSection, list: GlassItem[]): Promise<void> {
  loggedIn = true
  mode = 'list'
  if (section !== currentSection) cursor = 0
  currentSection = section
  items = list
  cursor = Math.min(cursor, Math.max(0, items.length - 1))
  detail = null
  composer = null
  await paint()
}

export async function showDetail(next: GlassDetail): Promise<void> {
  mode = 'detail'
  detail = next
  detailRows = next.lines.flatMap(line => {
    const rows = wrap(line, BODY.width - 4)
    return rows.length ? rows : ['']   // keep blank separator lines
  })
  if (!detailRows.length) detailRows = ['NO MESSAGES']
  // Chats read bottom-up: page from the newest line, so the last page is full
  // and any short page is the oldest one. Open on the newest page.
  const chat = next.section === 'circ' || next.section === 'cmail'
  if (chat) {
    const short = (BODY_LINES - (detailRows.length % BODY_LINES)) % BODY_LINES
    detailRows = [...Array<string>(short).fill(''), ...detailRows]
  }
  detailPage = chat ? Math.max(0, Math.ceil(detailRows.length / BODY_LINES) - 1) : 0
  composer = null
  await paint()
}

export async function showCurrentList(): Promise<void> {
  mode = 'list'
  detail = null
  composer = null
  await paint()
}

export async function showComposer(textValue: string, label: string, kind: ComposerKind = 'write', targetId?: string): Promise<void> {
  mode = 'composer'
  composer = { text: textValue, label, kind, targetId, selection: 0, listening: false, transcribing: false, heldMic: false }
  await paint()
}

export async function setListening(listening: boolean, held = false): Promise<void> {
  if (!composer) return
  composer.listening = listening
  composer.heldMic = listening && held
  if (listening) {
    composer.notice = undefined
    composer.text = ''
    voiceFrame = 0
    voiceLevel = 0
  }
  await paint()
}

export async function setTranscribing(transcribing: boolean): Promise<void> {
  if (!composer) return
  composer.transcribing = transcribing
  if (transcribing) {
    composer.notice = undefined
    voiceFrame = 0
  }
  await paint()
}

let voiceFrame = 0
let voiceLevel = 0

export async function tickVoice(level: number): Promise<void> {
  if (!composer || !(composer.listening || composer.transcribing)) return
  voiceFrame++
  voiceLevel = Math.max(0, Math.min(1, level))
  await paint()
}

export async function setComposerText(value: string): Promise<void> {
  if (!composer) return
  composer.text = value
  composer.notice = undefined
  composer.transcribing = false
  composer.selection = 0
  await paint()
}

/** Show a hint or an error where the transcript goes. It is never sent. */
export async function setComposerNotice(notice: string): Promise<void> {
  if (!composer) return
  composer.notice = notice
  composer.text = ''
  composer.transcribing = false
  await paint()
}

export async function toggleComposerSelection(): Promise<void> {
  await moveCursor(1)
}

/** Swipe within the current view: list row, detail page or composer option. */
export async function moveCursor(delta: number): Promise<void> {
  if (mode === 'composer') {
    if (!composer || !hasTranscript()) return
    composer.selection = (((composer.selection + delta) % 3) + 3) % 3 as 0 | 1 | 2
  } else if (mode === 'detail') {
    const last = Math.max(0, Math.ceil(detailRows.length / BODY_LINES) - 1)
    const next = Math.max(0, Math.min(last, detailPage + delta))
    if (next === detailPage) return
    detailPage = next
  } else {
    if (!items.length) return
    const next = Math.max(0, Math.min(items.length - 1, cursor + delta))
    if (next === cursor) return
    cursor = next
  }
  await paint()
}

// ---------- views ----------

interface View { title: string, body: string, hint: string, marks: HeaderMarks }

function loggedOutView(): View {
  return {
    title: 'CYBERSPACE',
    body: pad([
      'Not logged in.',
      '',
      'Open Cyberspace on your phone',
      'and log in to see your feed.',
    ], BODY_LINES),
    hint: pad(['offline', '2x exit'], HINT_LINES),
    marks: { icon: 'trace' },
  }
}

function listView(): View {
  const label = SECTION_LABELS[currentSection]
  if (!items.length) {
    return {
      title: label,
      body: currentSection === 'feed' ? 'No posts yet.' : 'Nothing here yet.',
      hint: pad([`${label.toLowerCase()} is empty`, 'hold for sections  ·  2x exit'], HINT_LINES),
      marks: { icon: SECTION_ICONS[currentSection] },
    }
  }
  const page = Math.floor(cursor / BODY_LINES)
  const start = page * BODY_LINES
  const rows = items.slice(start, start + BODY_LINES).map((item, i) => {
    const label = item.body ? `${item.title}${SEP}${oneLine(item.body)}` : item.title
    return row(label, start + i === cursor)
  })
  const selected = items[cursor]
  const context = selected?.meta ? `${cursor + 1} of ${items.length}${SEP}${selected.meta}` : `${cursor + 1} of ${items.length}`
  return {
    title: label,
    body: pad(rows, BODY_LINES),
    hint: pad([context, 'swipe choose  ·  tap open  ·  2x exit'], HINT_LINES),
    marks: { icon: SECTION_ICONS[currentSection] },
  }
}

function detailView(): View {
  const d = detail!
  const pages = Math.max(1, Math.ceil(detailRows.length / BODY_LINES))
  const rows = detailRows.slice(detailPage * BODY_LINES, (detailPage + 1) * BODY_LINES)
  const meta = d.meta ?? SECTION_LABELS[d.section]
  const where = pages > 1 ? `${meta}${SEP}page ${detailPage + 1} of ${pages}` : meta
  return {
    title: d.title,
    body: pad(rows, BODY_LINES),
    hint: pad([where, pages > 1 ? 'swipe page  ·  hold reply  ·  2x back' : 'hold reply  ·  2x back'], HINT_LINES),
    marks: { icon: SECTION_ICONS[d.section] },
  }
}

const WAVE_GLYPHS = ['_', '.', '-', '~', '^']

function voiceWave(): string {
  const width = 24
  const amp = 0.12 + voiceLevel * 0.88
  const phase = voiceFrame * 0.9
  let out = ''
  for (let x = 0; x < width; x++) {
    const v = (Math.sin(x * 0.55 + phase) * 0.7 + Math.sin(x * 1.3 - phase * 1.4) * 0.3) * amp
    out += WAVE_GLYPHS[Math.round(((v + 1) / 2) * (WAVE_GLYPHS.length - 1))]
  }
  return out
}

function composerView(): View {
  const c = composer!
  const dots = '.'.repeat(voiceFrame % 4).padEnd(3, ' ')
  if (c.listening) {
    return {
      title: c.label,
      body: pad(['', `LISTENING${dots}`, voiceWave()], BODY_LINES),
      hint: pad(['recording from G2 mic', c.heldMic ? 'release to stop  ·  2x cancel' : 'tap to stop  ·  2x cancel'], HINT_LINES),
      marks: { icon: 'mic-live' },
    }
  }
  if (c.transcribing) {
    return {
      title: c.label,
      body: pad(['', `TRANSCRIBING${dots}`], BODY_LINES),
      hint: pad(['speech to text', '2x cancel'], HINT_LINES),
      marks: { icon: 'mic' },
    }
  }
  if (!c.text) {
    const said = c.notice ? wrap(c.notice, BODY.width - 4) : ['Hold to talk, or tap to start.']
    return {
      title: c.label,
      body: pad(said, BODY_LINES),
      hint: pad([c.notice ? 'speech to text' : 'voice message', 'hold talk  ·  tap start  ·  2x cancel'], HINT_LINES),
      marks: { icon: 'mic' },
    }
  }
  const said = wrap(`"${c.text}"`, BODY.width - 4)
  const shown = said.length > 3 ? [...said.slice(0, 2), truncate(said.slice(2).join(' '), BODY.width - 4)] : said
  while (shown.length < 3) shown.push('')
  const options = ['Send', 'Rewrite', 'Quit'].map((option, i) => row(option, c.selection === i))
  return {
    title: c.label,
    body: pad([...shown, ...options], BODY_LINES),
    hint: pad(['voice transcript', 'swipe choose  ·  tap select  ·  2x cancel'], HINT_LINES),
    marks: { icon: 'mic' },
  }
}

function currentView(): View {
  if (!loggedIn) return loggedOutView()
  if (mode === 'composer' && composer) return composerView()
  if (mode === 'detail' && detail) return detailView()
  return listView()
}

// ---------- paint ----------

function textBox(box: Box, content: string, capture = false, z = 0, color = 4): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: box.x,
    yPosition: box.y,
    width: box.width,
    height: box.height,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 0,
    containerID: box.id,
    containerName: box.name,
    content,
    isEventCapture: capture ? 1 : 0,
    zOrderIndex: z,
    textColor: color,
  })
}

function imageBox(tile: Tile, z: number): ImageContainerProperty {
  return new ImageContainerProperty({
    xPosition: tile.x,
    yPosition: tile.y,
    width: tile.width,
    height: tile.height,
    containerID: tile.id,
    containerName: tile.name,
    zOrderIndex: z,
  })
}

let pageReady = false
let shown: View | null = null
let tileMarks: HeaderMarks | null = null   // what the header tile currently shows
let framePending = false                    // all four tiles still need sending
let painting: Promise<void> | null = null
let dirty = false

const sameMarks = (a: HeaderMarks, b: HeaderMarks) => a.icon === b.icon

async function sendTiles(tiles: Tile[], marks: HeaderMarks): Promise<void> {
  const frame = drawFrame(marks)
  for (const tile of tiles) {
    const res = await updateImageRawData({ containerID: tile.id, containerName: tile.name, imageData: await tilePng(frame, tile) } as any)
    if (String(res) !== 'success') throw new Error(`tile ${tile.name}: ${res}`)
  }
}

async function flush(): Promise<void> {
  const v = currentView()
  screenText = [`[ ${v.title} ]`, v.body, '', v.hint].join('\n')
  const title = truncate(v.title, TITLE.width - 4) || ' '

  if (!pageReady) {
    const texts = [
      textBox(INPUT, ' ', true, 1),
      textBox(TITLE, title, false, 6),
      textBox(BODY, v.body, false, 7),
      textBox(HINT, v.hint, false, 8, HINT_COLOR),
    ]
    const images = TILES.map((tile, i) => imageBox(tile, 2 + i))
    // After a WebView reload the startup page already exists, so create fails; rebuild instead.
    pageReady = await createPage(texts, images) || await rebuildPage(texts, images)
    if (!pageReady) { console.error('glasses: page setup failed'); return }
    framePending = true
  }
  if (framePending || !tileMarks || !sameMarks(tileMarks, v.marks)) {
    // A failed send leaves the flags set, so the next paint tries again.
    await sendTiles(framePending ? TILES : [HEADER_TILE], v.marks)
    framePending = false
    tileMarks = v.marks
    shown = null   // text may drop after image sends (simulator); write it all again
  }

  if (!shown || shown.title !== title) await upgradeText(TITLE.id, TITLE.name, title)
  if (!shown || shown.body !== v.body) await upgradeText(BODY.id, BODY.name, v.body)
  if (!shown || shown.hint !== v.hint) await upgradeText(HINT.id, HINT.name, v.hint)
  shown = { ...v, title }
}

/** Render the current state. Calls made while a render runs collapse into one more. */
function paint(): Promise<void> {
  dirty = true
  if (painting) return painting
  painting = (async () => {
    let failures = 0
    while (dirty) {
      dirty = false
      try {
        await flush()
        failures = 0
      } catch (e) {
        console.error(`glasses: paint failed: ${e instanceof Error ? e.message : String(e)}`)
        shown = null
        // A slow BLE hop should not leave a stale screen until the next gesture.
        if (++failures <= 3) {
          await new Promise(resolve => setTimeout(resolve, 500 * failures))
          dirty = true
        }
      }
    }
  })().finally(() => { painting = null })
  return painting
}

// ---------- input ----------

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
