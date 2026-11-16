// Glasses view for the Cyberspace G2 plugin.
//
// The glasses display is 576 x 288 pixels, monochrome green, one font at a
// fixed 27 px line height. Everything the wearer sees is pushed through the
// bridge as text containers. The DOM never reaches the glasses.
//
// Layout rules (even-g2 / glasses-ui skills):
//   - At most 12 containers per page, 8 text/list, 4 image.
//   - Exactly one container sets isEventCapture: 1 and receives gestures.
//   - Text wraps at container width; \n breaks a line; overflow scrolls in
//     firmware when the container captures input.
//   - containerID and containerName (max 16 chars) are unique per page.
//   - zOrderIndex, if used at all, must be set on every container.
//
// Interaction on the glasses:
//   - Tap: open the selected section / item.
//   - Double tap: open the section menu (switch sections).
//   - Swipe up / down: move between items in the current section.
//   - Long press: not used (may be bound to a system action by the wearer).

import { createPage, rebuildPage, onGlassEvent } from './bridge.js'
import { TextContainerProperty } from '@evenrealities/even_hub_sdk'
import { CyberspaceApi } from './api.js'

const GLASSES_W = 576
const LINE_H = 44          // container pitch for a line of text
const TITLE_Y = 4
const CONTENT_Y = 48
const MAX_LINES = 5        // how many content lines fit below the title

export type GlassSection = 'feed' | 'circ' | 'cmail' | 'notifications' | 'notes'

const SECTION_LABELS: Record<GlassSection, string> = {
  feed: 'FEED',
  circ: 'CIRC',
  cmail: 'CMAIL',
  notifications: 'NOTIFY',
  notes: 'NOTES',
}

/** Build one text container. */
function container(
  name: string,
  id: number,
  content: string,
  y: number,
  capture = false,
  color = 4,
): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: y,
    width: GLASSES_W,
    height: LINE_H,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 4,
    containerID: id,
    containerName: name,
    content,
    isEventCapture: capture ? 1 : 0,
    textColor: color,
  })
}

/** Full-screen invisible input layer. Taps reach the app even over text. */
function inputLayer(id: number): TextContainerProperty {
  return container('input', id, ' ', 0, true, 0)
}

let currentSection: GlassSection | null = null
let items: { title: string; body: string; id?: string }[] = []
let itemCursor = 0
let page = 0
let initialized = false

let containers: TextContainerProperty[] = []

/** Called once from main so the glasses module knows the phone-side API client. */
export function initGlasses(_api: CyberspaceApi): void {
  // Kept for symmetry; glasses state lives in this module.
}

/** Show the logged-out screen. */
export async function showLoggedOut(): Promise<void> {
  containers = [
    inputLayer(1),
    container('title', 2, 'NOT LOGGED IN', TITLE_Y, false, 4),
    container('hint', 3, 'log in on the phone', CONTENT_Y, false, 2),
  ]
  await paint()
}

/** Show a section on the glasses. */
export async function showSection(
  section: GlassSection,
  list: { title: string; body: string; id?: string }[],
): Promise<void> {
  currentSection = section
  items = list
  itemCursor = Math.min(itemCursor, Math.max(0, items.length - 1))
  page = Math.floor(itemCursor / MAX_LINES)
  await paint()
}

/** Advance the item cursor by one (swipe up/down). */
export async function moveCursor(delta: number): Promise<void> {
  if (!items.length) return
  itemCursor = Math.max(0, Math.min(items.length - 1, itemCursor + delta))
  page = Math.floor(itemCursor / MAX_LINES)
  await paint()
}

/** Switch to the next section (double tap / menu). */
export async function nextSection(): Promise<GlassSection> {
  const order: GlassSection[] = ['feed', 'circ', 'cmail', 'notifications', 'notes']
  const idx = currentSection ? order.indexOf(currentSection) : 0
  const next = order[(idx + 1) % order.length]
  return next
}

/** Paint the current page of containers to the glasses. */
async function paint(): Promise<void> {
  const start = page * MAX_LINES
  const slice = items.slice(start, start + MAX_LINES)

  const parts: TextContainerProperty[] = [
    inputLayer(1),
    container('title', 2, currentSection ? SECTION_LABELS[currentSection] : 'CYBERSPACE', TITLE_Y, false, 4),
  ]

  if (slice.length === 0) {
    parts.push(container('empty', 3, 'no items', CONTENT_Y, false, 2))
  } else {
    slice.forEach((it, i) => {
      const marker = i + start === itemCursor ? '> ' : '  '
      const line = (marker + it.title).slice(0, 60)
      parts.push(container(`line${i}`, 3 + i, line, CONTENT_Y + i * LINE_H, false, 4))
    })
  }

  containers = parts
  if (!initialized) {
    initialized = await createPage(containers)
  } else {
    await rebuildPage(containers)
  }
}

/** Subscribe to glasses gestures and route them to callbacks. */
export function onGlassGesture(
  onTap: () => void | Promise<void>,
  onDoubleTap: () => void | Promise<void>,
  onSwipeUp: () => void | Promise<void>,
  onSwipeDown: () => void | Promise<void>,
): () => void {
  return onGlassEvent((ev) => {
    switch (ev.type) {
      case 'tap': void onTap(); break
      case 'doubleTap': void onDoubleTap(); break
      case 'swipeUp': void onSwipeUp(); break
      case 'swipeDown': void onSwipeDown(); break
    }
  })
}

export { SECTION_LABELS }
