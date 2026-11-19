// Dev-only glasses demo on made-up sample data, for the simulator: open the app with ?demo
// (or ?demo=offline for the logged-out screen).
// Loaded through import.meta.env.DEV, so it never reaches a production bundle.
// Hold the touchpad and pick a section from the menu to switch, like the real app.

import {
  getComposerState, getCurrentSection, getSelectedItem, isComposerOpen, isDetailOpen, moveCursor,
  onGlassGesture, setComposerText, setListening, showComposer, showCurrentList, showDetail, showLoggedOut,
  showSection,
  type GlassDetail, type GlassItem, type GlassSection,
} from './glasses.js'

const LISTS: Record<GlassSection, GlassItem[]> = {
  feed: [
    { id: '__write__', title: '[+] WRITE', body: 'new feed post', meta: 'FEED' },
    { id: 'f1', title: '@dan', body: 'Coming back to Power BI, I checked and the refresh failure is definitely the table lock.', meta: '2m ago' },
    { id: 'f2', title: '@neon_ghost', body: 'Anyone else running a BBS over a mesh network? Looking for peers in the east bay.', meta: '14m ago' },
    { id: 'f3', title: '@kiko', body: 'Re-reading Neuromancer for the third time. The sky above the port still hits.', meta: '1h ago' },
    { id: 'f4', title: '@zero_cool', body: 'New post on terminal colour schemes for low-light work.', meta: '2h ago' },
    { id: 'f5', title: '@marrow', body: 'Quiet corners of the internet are worth protecting.', meta: '3h ago' },
    { id: 'f6', title: '@lumen', body: 'Built a tiny weather station that only reports in haiku.', meta: '5h ago' },
    { id: 'f7', title: '@rook', body: 'cIRC #retro is lively tonight, come say hi.', meta: '6h ago' },
  ],
  circ: [
    { id: 'c1', title: '#lobby', body: 'The Sprawl · 8 online', meta: 'just now' },
    { id: 'c2', title: '#retro', body: 'Old machines, new tricks · 5 online', meta: '3m ago' },
    { id: 'c3', title: '#ideas', body: 'Ideas for Cyberspace · 2 online', meta: '1h ago' },
    { id: 'c4', title: '#help', body: 'Ask anything · 1 online', meta: '2h ago' },
    { id: 'c5', title: '#music', body: 'Now playing · 0 online', meta: 'yesterday' },
  ],
  cmail: [
    { id: 'm1', title: '@kiko', body: 'See you at the meetup on Friday?', meta: '5m ago' },
    { id: 'm2', title: '@neon_ghost', body: 'Sent you the mesh config, let me know if it boots.', meta: '1h ago' },
    { id: 'm3', title: '@lumen', body: 'Haha the haiku forecast was perfect today', meta: 'yesterday' },
  ],
  notifications: [
    { id: 'n1', title: '@kiko', body: 'replied to you', meta: '4m ago' },
    { id: 'n2', title: '@rook', body: 'liked your entry', meta: '20m ago' },
    { id: 'n3', title: '@marrow', body: 'mentioned you', meta: '1h ago' },
    { id: 'n4', title: '@lumen', body: 'followed you', meta: '3h ago' },
  ],
  notes: [
    { id: 'o1', title: '#ideas', body: 'A cIRC bot that reads the room topic aloud when you join.', meta: 'today' },
    { id: 'o2', title: '#reading', body: 'Finish Neuromancer, then start Snow Crash.', meta: 'yesterday' },
  ],
}

const DETAILS: Record<string, string[]> = {
  f1: [
    '@dan  2m ago',
    'Coming back to Power BI, I checked and the refresh failure is definitely the table lock.',
    '',
    '@marrow  1m ago',
    'Classic. Did you try moving the refresh off the hour?',
  ],
  c1: [
    '21:02 kiko: anyone around tonight?',
    '21:03 rook: always',
    '21:04 neon_ghost: just got the mesh node online',
    '21:04 kiko: nice, what range are you getting?',
    '21:05 neon_ghost: about two blocks with the cheap antenna',
    '21:06 lumen: that is honestly impressive',
    '21:07 rook: pics or it did not happen',
  ],
  m1: [
    'kiko  20:51',
    'Are you coming to the meetup on Friday?',
    'you  20:58',
    'Probably, depends on the train.',
    'kiko  21:10',
    'See you at the meetup on Friday?',
  ],
}

const MENU: Record<number, GlassSection> = { 101: 'feed', 102: 'circ', 103: 'cmail', 104: 'notifications', 105: 'notes' }

function detailFor(section: GlassSection, item: GlassItem): GlassDetail {
  const lines = DETAILS[item.id ?? ''] ?? [`${item.title}  ${item.meta ?? ''}`, item.body]
  const meta = section === 'circ' ? 'ONLINE (8)' : item.meta
  return { section, title: item.title, meta, lines }
}

export function runDemo(): void {
  if (new URLSearchParams(location.search).get('demo') === 'offline') { void showLoggedOut(); return }
  void showSection('feed', LISTS.feed)
  onGlassGesture(
    // tap: open, or act on the composer option
    async () => {
      const c = getComposerState()
      if (isComposerOpen() && c) {
        if (c.selection === 1) await setComposerText('')
        else await showCurrentList()   // Send and Quit both close the composer in the demo
        return
      }
      if (isDetailOpen()) return
      const item = getSelectedItem()
      if (!item) return
      if (item.id === '__write__') { await showComposer('', 'FEED', 'write'); return }
      await showDetail(detailFor(getCurrentSection(), item))
    },
    // double tap: back
    async () => { if (isComposerOpen() || isDetailOpen()) await showCurrentList() },
    async () => { await moveCursor(1) },
    async () => { await moveCursor(-1) },
    // hold: reply by voice
    async () => {
      if (!isComposerOpen()) await showComposer('', `REPLY ${getSelectedItem()?.title ?? ''}`, 'reply')
      await setListening(true)
    },
    async () => {
      await setListening(false)
      await setComposerText('Sounds good, I will bring the mesh node so we can test the range.')
    },
    async (itemID) => {
      const section = MENU[itemID]
      if (section) await showSection(section, LISTS[section])
    },
  )
}
