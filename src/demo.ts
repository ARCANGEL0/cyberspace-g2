// Dev-only glasses demo on sample data, for the simulator: open the app with ?demo.
// Loaded through import.meta.env.DEV, so it never reaches a production bundle.

import {
  getComposerState, isComposerOpen, isDetailOpen, getSelectedItem, moveCursor, onGlassGesture,
  setComposerText, setListening, showComposer, showCurrentList, showDetail, showSection,
  type GlassItem,
} from './glasses.js'

const ITEMS: GlassItem[] = [
  { id: '__write__', title: '[+] WRITE', body: 'new feed post', meta: 'FEED' },
  { id: '1', title: '@dan', body: 'Coming back to Power BI, I checked and the refresh failure is definitely the table lock.', meta: '2m ago' },
  { id: '2', title: '@neon_ghost', body: 'Anyone else running a BBS over a mesh network? Looking for peers in the east bay.', meta: '14m ago' },
  { id: '3', title: '@kiko', body: 'Re-reading Neuromancer for the third time. The sky above the port still hits.', meta: '1h ago' },
  { id: '4', title: '@zero_cool', body: 'New post on terminal colour schemes for low-light work.', meta: '2h ago' },
  { id: '5', title: '@marrow', body: 'Quiet corners of the internet are worth protecting.', meta: '3h ago' },
  { id: '6', title: '@lumen', body: 'Built a tiny weather station that only reports in haiku.', meta: '5h ago' },
  { id: '7', title: '@rook', body: 'cIRC #retro is lively tonight, come say hi.', meta: '6h ago' },
  { id: '8', title: '@vanta', body: 'Maximum altitude for a small UA in uncontrolled airspace? 400 ft AGL.', meta: '8h ago' },
]

export function runDemo(): void {
  void showSection('feed', ITEMS)
  onGlassGesture(
    async () => {
      const c = getComposerState()
      if (isComposerOpen() && c) {
        if (c.selection === 1) await setComposerText('')
        else await showCurrentList()
        return
      }
      if (isDetailOpen()) return
      const item = getSelectedItem()
      if (!item) return
      if (item.id === '__write__') { await showComposer('', 'FEED', 'write'); return }
      await showDetail({
        section: 'feed',
        title: item.title,
        meta: item.meta,
        lines: [item.body, '', 'from the feed', ...Array.from({ length: 6 }, (_, i) => `reply ${i + 1}: ${item.body}`)],
      })
    },
    async () => { if (isComposerOpen() || isDetailOpen()) await showCurrentList() },
    async () => { await moveCursor(1) },
    async () => { await moveCursor(-1) },
    async () => {
      if (!isComposerOpen()) await showComposer('', `REPLY ${getSelectedItem()?.title ?? ''}`, 'reply')
      await setListening(true)
    },
    async () => {
      await setListening(false)
      await setComposerText('Coming back to Power BI, I checked and the refresh failure is definitely the table lock.')
    },
  )
}
