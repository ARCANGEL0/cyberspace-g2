// Even Hub bridge wrapper for the Cyberspace G2 plugin.
//
// Every glasses call goes through waitForEvenAppBridge(). Calls made before the
// bridge resolves do nothing, with no error. Writes are serialized through a
// single promise queue so overlapping text upgrades and parallel image sends
// cannot race on the BLE link. Each call carries a timeout: one flaky BLE hop
// can otherwise hang for about thirty seconds.
//
// The glasses hold no state. Everything lives on the phone, in this WebView.
//
// References (even-g2 skill):
//   bridge discipline, traps H1-H23, lifecycle checkpoints, app.json rules.

import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  StartUpPageCreateResult,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

type GlassEvent = {
  type: 'tap' | 'doubleTap' | 'swipeUp' | 'swipeDown' | 'longPress' | 'longPressRelease'
  source?: 'right' | 'ring' | 'left'
}

/** Bridge write, one at a time. */
class WriteQueue {
  private chain = Promise.resolve()
  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    this.chain = this.chain.then(() => fn()).then(resolve, reject)
    return promise
  }
}

const queue = new WriteQueue()
const TIMEOUT_MS = 4000

/** Run a bridge call with a hard timeout and serialization. */
async function withTimeout<T>(fn: () => Promise<T>): Promise<T> {
  return queue.enqueue(async () => {
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('bridge timeout')), TIMEOUT_MS))
    return Promise.race([fn(), timeout])
  })
}

let bridge: Awaited<ReturnType<typeof waitForEvenAppBridge>> | null = null
let ready = false

/** Wait for the Even app bridge, once. */
export async function getBridge(): Promise<Awaited<ReturnType<typeof waitForEvenAppBridge>>> {
  if (bridge) return bridge
  bridge = await withTimeout(() => waitForEvenAppBridge())
  ready = true
  return bridge
}

export function isReady(): boolean {
  return ready
}

/** Create the startup page once. Returns true on success. */
export async function createPage(containers: TextContainerProperty[]): Promise<boolean> {
  const b = await getBridge()
  const payload = new CreateStartUpPageContainer({
    containerTotalNum: containers.length,
    textObject: containers,
  })
  const res = await withTimeout(() => b.createStartUpPageContainer(payload))
  return res === StartUpPageCreateResult.success
}

/** Flicker-free in-place text update. containerID + containerName must match. */
export async function upgradeText(
  containerID: number,
  containerName: string,
  content: string,
): Promise<boolean> {
  const b = await getBridge()
  const payload = new TextContainerUpgrade({
    containerID,
    containerName,
    contentOffset: 0,
    contentLength: 0,
    content,
  })
  return withTimeout(() => b.textContainerUpgrade(payload))
}

/** Full page rebuild. Flickers; use only for layout changes. */
export async function rebuildPage(containers: TextContainerProperty[]): Promise<boolean> {
  const b = await getBridge()
  const payload = new CreateStartUpPageContainer({
    containerTotalNum: containers.length,
    textObject: containers,
  })
  return withTimeout(() => b.rebuildPageContainer(payload as any))
}

/** Exit the app with the system confirmation dialog. */
export async function exitApp(): Promise<boolean> {
  const b = await getBridge()
  return withTimeout(() => b.shutDownPageContainer(1))
}

/** Subscribe to glasses input events. Returns an unsubscribe function. */
export function onGlassEvent(cb: (ev: GlassEvent) => void): () => void {
  const b = getBridge()   // fire and forget; listener registered below once ready
  let unsub: (() => void) | null = null
  ;(async () => {
    const br = await b
    unsub = br.onEvenHubEvent((raw: any) => {
      const ev = mapEvent(raw)
      if (ev) cb(ev)
    })
  })()
  return () => { if (unsub) unsub() }
}

/** Map a raw hub event to a typed glasses gesture. Handles both envelopes and
 *  the protobuf zero-value trap (CLICK is 0, arrives as undefined). */
function mapEvent(raw: any): GlassEvent | null {
  const sys = raw?.sysEvent
  const txt = raw?.textEvent
  const evtType = (e: any) => e ? (e.eventType ?? OsEventTypeList.CLICK_EVENT) : null
  const sysType = evtType(sys)
  const txtType = evtType(txt)

  if (raw?.audioEvent) return null
  if (raw?.menuItemClickEvent) return null

  const is = (t: OsEventTypeList) => sysType === t || txtType === t

  if (is(OsEventTypeList.DOUBLE_CLICK_EVENT)) return { type: 'doubleTap', source: eventSource(sys) }
  if (is(OsEventTypeList.SCROLL_TOP_EVENT)) return { type: 'swipeUp' }
  if (is(OsEventTypeList.SCROLL_BOTTOM_EVENT)) return { type: 'swipeDown' }
  if (sysType === OsEventTypeList.LONG_PRESS_EVENT) return { type: 'longPress', source: eventSource(sys) }
  if (sysType === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) return { type: 'longPressRelease', source: eventSource(sys) }
  if (sysType === OsEventTypeList.FOREGROUND_ENTER_EVENT) return { type: 'tap' }   // checkpoint, keep alive
  if (sysType === OsEventTypeList.FOREGROUND_EXIT_EVENT) return { type: 'tap' }    // checkpoint
  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    return { type: 'tap' }   // cleanup handled by caller
  }
  if (is(OsEventTypeList.CLICK_EVENT)) return { type: 'tap', source: eventSource(sys) }
  return null
}

function eventSource(sys: any): 'right' | 'ring' | 'left' | undefined {
  if (!sys || sys.eventSource === undefined) return undefined
  switch (sys.eventSource) {
    case 1: return 'right'
    case 2: return 'ring'
    case 3: return 'left'
    default: return undefined
  }
}
