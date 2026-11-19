// Cyberpunk terminal UI for Even G2 glasses.
// Renders a raw pixel image (grayscale 4-bit, 576x288) via ImageRawDataUpdate
// instead of text containers — pixel-perfect borders, corners, and hatches.

import { ImageRawDataUpdate } from '@evenrealities/even_hub_sdk'
import { onGlassEvent, updateImageRawData } from './bridge.js'
import type { CyberspaceApi } from './api.js'

const W = 576
const H = 288
const PX_W = W / 4   // 144 chars per row (4-bit packed: 2 px per byte... no, 1 px per byte for 4-bit grayscale)
const PX_H = H

// Pixel buffer: 1 byte per pixel, value 0-15 (4-bit grayscale)
// 0 = black (off), 15 = white (on/bright green)
const buf = new Uint8Array(PX_W * PX_H)

function px(x: number, y: number, v = 15): void {
  if (x < 0 || x >= PX_W || y < 0 || y >= PX_H) return
  buf[y * PX_W + x] = v
}

function line(x0: number, y0: number, x1: number, y1: number, v = 15): void {
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  let x = x0
  let y = y0
  while (true) {
    px(x, y, v)
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; x += sx }
    if (e2 < dx) { err += dx; y += sy }
  }
}

function hatchRight(y: number): void {
  const pat = ['/', '\\', '/', '\\', ' ', ' ', ' ', ' ']
  const i = y % pat.length
  const ch = pat[i]
  if (ch === '/') { px(PX_W - 1, y, 15); px(PX_W - 2, y + 1, 15); px(PX_W - 3, y + 2, 15) }
  else if (ch === '\\') { px(PX_W - 1, y + 2, 15); px(PX_W - 2, y + 1, 15); px(PX_W - 3, y, 15) }
}

// 5x7 monospace font (pixels per char)
// Each char: 5 rows of 7-bit values (MSB = leftmost pixel)
const FONT: Record<string, number[]> = {
  ' ': [0b0000000, 0b0000000, 0b0000000, 0b0000000, 0b0000000],
  '!': [0b0001000, 0b0001000, 0b0001000, 0b0001000, 0b0000000],
  '"': [0b0011000, 0b0011000, 0b0000000, 0b0000000, 0b0000000],
  '#': [0b0101000, 0b1111100, 0b0101000, 0b1111100, 0b0101000],
  '$': [0b0010000, 0b1011000, 0b0111000, 0b0110100, 0b0001000],
  '%': [0b1100100, 0b1011000, 0b0100000, 0b0010100, 0b1001100],
  '&': [0b0111000, 0b1000100, 0b0111000, 0b1001100, 0b0111000],
  "'": [0b0010000, 0b0010000, 0b0000000, 0b0000000, 0b0000000],
  '(': [0b0010000, 0b0100000, 0b1000000, 0b0100000, 0b0010000],
  ')': [0b0100000, 0b0010000, 0b0001000, 0b0010000, 0b0100000],
  '*': [0b0010000, 0b1010100, 0b0111000, 0b1010100, 0b0010000],
  '+': [0b0001000, 0b0001000, 0b1111100, 0b0001000, 0b0001000],
  ',': [0b0001000, 0b0001000, 0b0000000, 0b1000000, 0b0111000],
  '-': [0b0000000, 0b0000000, 0b1111100, 0b0000000, 0b0000000],
  '.': [0b0000000, 0b0000000, 0b0001000, 0b0000000, 0b0000000],
  '/': [0b1000000, 0b0100000, 0b0010000, 0b0001000, 0b0000100],
  '0': [0b0111000, 0b1000100, 0b1001100, 0b1010100, 0b0111000],
  '1': [0b0001000, 0b0011000, 0b0101000, 0b0001000, 0b0001000],
  '2': [0b0111000, 0b0000100, 0b0111000, 0b1000000, 0b1111100],
  '3': [0b1111000, 0b0000100, 0b0111000, 0b0000100, 0b1111000],
  '4': [0b1000100, 0b1000100, 0b1111100, 0b0000100, 0b0000100],
  '5': [0b1111100, 0b1000000, 0b1111000, 0b0000100, 0b0111000],
  '6': [0b0111000, 0b1000000, 0b1111000, 0b1000100, 0b0111000],
  '7': [0b1111100, 0b0000100, 0b0001000, 0b0010000, 0b0100000],
  '8': [0b0111000, 0b1000100, 0b0111000, 0b1000100, 0b0111000],
  '9': [0b0111000, 0b1000100, 0b0111100, 0b0000100, 0b0111000],
  ':': [0b0001000, 0b0000000, 0b0001000, 0b0000000, 0b0000000],
  ';': [0b0001000, 0b0001000, 0b0000000, 0b1000000, 0b0111000],
  '<': [0b1000000, 0b0100000, 0b0010000, 0b0100000, 0b1000000],
  '=': [0b0000000, 0b1111100, 0b0000000, 0b1111100, 0b0000000],
  '>': [0b0000100, 0b0010000, 0b0100000, 0b0010000, 0b0000100],
  '?': [0b0111000, 0b0000100, 0b0010000, 0b0000000, 0b0010000],
  '@': [0b0111000, 0b1000100, 0b1011100, 0b1010100, 0b0111000],
  'A': [0b0111000, 0b1000100, 0b1111100, 0b1000100, 0b1000100],
  'B': [0b1111000, 0b1000100, 0b1111000, 0b1000100, 0b1111000],
  'C': [0b0111000, 0b1000000, 0b1000000, 0b1000000, 0b0111000],
  'D': [0b1111000, 0b1000100, 0b1000100, 0b1000100, 0b1111000],
  'E': [0b1111100, 0b1000000, 0b1111000, 0b1000000, 0b1111100],
  'F': [0b1111100, 0b1000000, 0b1111000, 0b1000000, 0b1000000],
  'G': [0b0111000, 0b1000000, 0b1011100, 0b1000100, 0b0111000],
  'H': [0b1000100, 0b1000100, 0b1111100, 0b1000100, 0b1000100],
  'I': [0b1111100, 0b0001000, 0b0001000, 0b0001000, 0b1111100],
  'J': [0b0000100, 0b0000100, 0b0000100, 0b1000100, 0b0111000],
  'K': [0b1000100, 0b1001000, 0b1010000, 0b1001000, 0b1000100],
  'L': [0b1000000, 0b1000000, 0b1000000, 0b1000000, 0b1111100],
  'M': [0b1000100, 0b1101100, 0b1010100, 0b1000100, 0b1000100],
  'N': [0b1000100, 0b1100100, 0b1010100, 0b1001100, 0b1000100],
  'O': [0b0111000, 0b1000100, 0b1000100, 0b1000100, 0b0111000],
  'P': [0b1111000, 0b1000100, 0b1111000, 0b1000000, 0b1000000],
  'Q': [0b0111000, 0b1000100, 0b1000100, 0b1010100, 0b0111000],
  'R': [0b1111000, 0b1000100, 0b1111000, 0b1001000, 0b1000100],
  'S': [0b0111000, 0b1000000, 0b0111000, 0b0000100, 0b1111000],
  'T': [0b1111100, 0b0001000, 0b0001000, 0b0001000, 0b0001000],
  'U': [0b1000100, 0b1000100, 0b1000100, 0b1000100, 0b0111000],
  'V': [0b1000100, 0b1000100, 0b1000100, 0b0101000, 0b0010000],
  'W': [0b1000100, 0b1000100, 0b1010100, 0b1101100, 0b1000100],
  'X': [0b1000100, 0b0101000, 0b0010000, 0b0101000, 0b1000100],
  'Y': [0b1000100, 0b0101000, 0b0010000, 0b0001000, 0b0001000],
  'Z': [0b1111100, 0b0001000, 0b0010000, 0b0100000, 0b1111100],
  '[': [0b0111000, 0b1000000, 0b1000000, 0b1000000, 0b0111000],
  '\\': [0b0000100, 0b0001000, 0b0010000, 0b0100000, 0b1000000],
  ']': [0b1111000, 0b0000100, 0b0000100, 0b0000100, 0b1111000],
  '^': [0b0010000, 0b0101000, 0b1000100, 0b0000000, 0b0000000],
  '_': [0b0000000, 0b0000000, 0b0000000, 0b0000000, 0b1111100],
  '`': [0b0001000, 0b0000000, 0b0000000, 0b0000000, 0b0000000],
  'a': [0b0000000, 0b0111000, 0b1000100, 0b0111100, 0b1000100],
  'b': [0b1000000, 0b1001100, 0b1010100, 0b1000100, 0b1111000],
  'c': [0b0000000, 0b0111000, 0b1000000, 0b1000000, 0b0111000],
  'd': [0b0000100, 0b0010100, 0b0100100, 0b1000100, 0b1111100],
  'e': [0b0000000, 0b0111000, 0b1011000, 0b1010000, 0b0111000],
  'f': [0b0011000, 0b0100000, 0b1111000, 0b0100000, 0b0100000],
  'g': [0b0000000, 0b0111000, 0b1000100, 0b0111100, 0b1000100],
  'h': [0b1000000, 0b1001100, 0b1010100, 0b1000100, 0b1000100],
  'i': [0b0010000, 0b0000000, 0b0110000, 0b0010000, 0b0010000],
  'j': [0b0000100, 0b0000000, 0b0010000, 0b1000100, 0b0111000],
  'k': [0b1000000, 0b1001000, 0b1010000, 0b1001000, 0b1000100],
  'l': [0b0010000, 0b0010000, 0b0010000, 0b0010000, 0b0010000],
  'm': [0b0000000, 0b1101100, 0b1010100, 0b1000100, 0b1000100],
  'n': [0b0000000, 0b1001100, 0b1010100, 0b1000100, 0b1000100],
  'o': [0b0000000, 0b0111000, 0b1000100, 0b1000100, 0b0111000],
  'p': [0b0000000, 0b1111000, 0b1000100, 0b1111000, 0b1000000],
  'q': [0b0000000, 0b0111000, 0b1000100, 0b0111100, 0b1000100],
  'r': [0b0000000, 0b1001100, 0b1111000, 0b1000000, 0b1000000],
  's': [0b0000000, 0b0111000, 0b1010000, 0b1010100, 0b0101000],
  't': [0b0011000, 0b0100000, 0b0111000, 0b0100000, 0b0111000],
  'u': [0b0000000, 0b1000100, 0b1000100, 0b1000100, 0b0111000],
  'v': [0b0000000, 0b1000100, 0b1000100, 0b0101000, 0b0010000],
  'w': [0b0000000, 0b1000100, 0b1010100, 0b1101100, 0b1000100],
  'x': [0b0000000, 0b1000100, 0b0101000, 0b0010000, 0b0101000],
  'y': [0b0000000, 0b1000100, 0b1000100, 0b0111100, 0b1000100],
  'z': [0b0000000, 0b1111100, 0b0010000, 0b0100000, 0b1111100],
}

const CHAR_W = 6
const CHAR_H = 7

function drawChar(x: number, y: number, ch: string, v = 15): void {
  const rows = FONT[ch] || FONT[' ']
  for (let r = 0; r < CHAR_H; r++) {
    const bits = rows[r]
    for (let c = 0; c < CHAR_W - 1; c++) {
      if (bits & (1 << (CHAR_W - 2 - c))) px(x + c, y + r, v)
    }
  }
}

function drawText(x: number, y: number, str: string, v = 15): void {
  let cx = x
  for (const ch of str) {
    drawChar(cx, y, ch, v)
    cx += CHAR_W
  }
}

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

export function clear(): void {
  buf.fill(0)
}

function drawBorder(): void {
  // Top border
  line(0, 0, PX_W - 1, 0, 15)
  // Bottom border
  line(0, PX_H - 1, PX_W - 1, PX_H - 1, 15)
  // Left border
  line(0, 0, 0, PX_H - 1, 15)
  // Right border
  line(PX_W - 1, 0, PX_W - 1, PX_H - 1, 15)
  // Corners
  px(0, 0, 15)
  px(PX_W - 1, 0, 15)
  px(0, PX_H - 1, 15)
  px(PX_W - 1, PX_H - 1, 15)
  // Right edge hatch
  for (let y = 1; y < PX_H - 1; y++) hatchRight(y)
}

function drawSectionHeader(label: string): void {
  const lab = label.padEnd(10).slice(0, 10)
  drawText(2, 2, lab)
  line(2 + CHAR_W * 10 + 2, 4, PX_W - 3, 4, 15)
  px(2 + CHAR_W * 10 + 1, 4, 15)
  px(PX_W - 2, 4, 15)
}

function render(): void {
  clear()
  drawBorder()
  drawSectionHeader(SECTION_LABELS['feed'])
  drawText(2, 10, 'NO POSTS')
  send()
}

function send(): void {
  const container = new ImageRawDataUpdate({
    containerID: 2,
    containerName: 'screen',
    imageData: Array.from(buf),
  })
  void updateImageRawData(container)
}

export function initGlasses(_api: CyberspaceApi): void {}

export async function showLoggedOut(): Promise<void> {
  render()
}

export async function showSection(_section: GlassSection, _list: GlassItem[]): Promise<void> {
  render()
}

export async function showDetail(_next: GlassDetail): Promise<void> {
  render()
}

export async function showCurrentList(): Promise<void> {
  render()
}

export async function showComposer(_textValue: string, _label: string, _kind: ComposerKind = 'write', _targetId?: string): Promise<void> {
  render()
}

export async function setListening(_listening: boolean): Promise<void> {
  render()
}

export async function setComposerText(_text: string): Promise<void> {
  render()
}

export async function toggleComposerSelection(): Promise<void> {
  render()
}

export async function moveCursor(_delta: number): Promise<void> {
  render()
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
