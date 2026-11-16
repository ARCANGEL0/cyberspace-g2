// Cyberspace G2 plugin.
//
// Phone view: VT320 terminal theme — amber monospace on near-black, framed
// panel, left nav rail, bottom command bar. Login (username / password), then
// sections: feed, cIRC, cMAIL, notifications, notes.
//
// Glasses view: NOT LOGGED IN until a session exists, then the same sections
// as text containers on the 576 x 288 monochrome display.
//
// The DOM is the phone. The glasses only see what is pushed through the
// bridge. All state lives on the phone.

import './style.css'
import { CyberspaceApi } from './api.js'
import {
  initGlasses, showLoggedOut, showSection, moveCursor,
  nextSection, onGlassGesture,
} from './glasses.js'

const STORAGE_KEY = 'cyberspace.g2.refreshToken'

const api = new CyberspaceApi({
  get: () => localStorage.getItem(STORAGE_KEY),
  set: (v) => { if (v === null) localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, v) },
})

// ---------- elements ----------

const app = document.getElementById('app')!
app.innerHTML = `
  <nav class="nav">
    <a title="Home">⌂</a>
    <a title="Feed">⚡</a>
    <a title="cIRC">#</a>
    <a title="cMAIL">✉</a>
    <a title="Notes">📝</a>
    <a title="Notify">🔔</a>
  </nav>

  <div class="shell">
    <div id="login" class="panel">
      <div class="frame login-box">
        <h1>CYBERSPACE</h1>
        <div class="tagline">Social media de-imagined. Use your words!</div>
        <p id="loginStatus" class="status"></p>
        <label>username</label>
        <input id="loginUser" type="text" autocapitalize="none" autocomplete="username" />
        <label>password</label>
        <input id="loginPass" type="password" autocomplete="current-password" />
        <div class="button-row">
          <button id="loginBtn" class="primary">Log in</button>
          <button id="resumeBtn">Resume</button>
        </div>
      </div>
    </div>

    <div id="shell" class="panel hidden">
      <div class="frame">
        <h1 id="frameTitle">CYBERSPACE</h1>
        <div id="frameBody"></div>
        <div class="tabs" id="tabs"></div>
      </div>
    </div>

    <div class="status-bar">
      <span class="help">[Ctrl+K] Commands  [↑/↓] Navigate  [ESC] Close  [Tab] Select</span>
      <span id="userChip">guest</span>
    </div>
  </div>
`

const loginPanel = document.getElementById('login')!
const shellPanel = document.getElementById('shell')!
const loginStatus = document.getElementById('loginStatus')!
const loginUser = document.getElementById('loginUser') as HTMLInputElement
const loginPass = document.getElementById('loginPass') as HTMLInputElement
const loginBtn = document.getElementById('loginBtn') as HTMLButtonElement
const resumeBtn = document.getElementById('resumeBtn') as HTMLButtonElement
const frameTitle = document.getElementById('frameTitle')!
const frameBody = document.getElementById('frameBody')!
const tabsEl = document.getElementById('tabs')!
const userChip = document.getElementById('userChip')!

// ---------- state ----------

export type Section = 'feed' | 'circ' | 'cmail' | 'notifications' | 'notes'
let currentSection: Section | null = null

const SECTION_TABS: Record<Section, string> = {
  feed: 'FEED',
  circ: 'CIRC',
  cmail: 'CMAIL',
  notifications: 'NOTIFY',
  notes: 'NOTES',
}

// ---------- phone UI ----------

function setPhoneLoggedIn(loggedIn: boolean): void {
  loginPanel.classList.toggle('hidden', loggedIn)
  shellPanel.classList.toggle('hidden', !loggedIn)
  userChip.textContent = api.username ?? 'guest'
  if (loggedIn) renderSection(currentSection ?? 'feed')
}

async function renderSection(section: Section): Promise<void> {
  currentSection = section
  frameTitle.textContent = `CYBERSPACE — ${SECTION_TABS[section]}`
  frameBody.innerHTML = ''

  // tabs
  tabsEl.innerHTML = ''
  ;(['feed', 'circ', 'cmail', 'notifications', 'notes'] as Section[]).forEach(s => {
    const t = document.createElement('div')
    t.className = 'tab' + (s === section ? ' active' : '')
    t.textContent = SECTION_TABS[s]
    t.addEventListener('click', () => { void renderSection(s) })
    tabsEl.appendChild(t)
  })

  switch (section) {
    case 'feed': renderFeed(); break
    case 'circ': renderCirc(); break
    case 'cmail': renderCmail(); break
    case 'notifications': renderNotifications(); break
    case 'notes': renderNotes(); break
  }

  if (api.authed) {
    const glassItems = phoneItemsForSection(section)
    await showSection(section, glassItems)
  }
}

function phoneItemsForSection(
  _section: Section,
): { title: string; body: string; id?: string }[] {
  const items: { title: string; body: string; id?: string }[] = []
  frameBody.querySelectorAll('.item').forEach(el => {
    items.push({
      title: el.getAttribute('data-title') ?? '',
      body: el.getAttribute('data-body') ?? '',
      id: el.getAttribute('data-id') ?? undefined,
    })
  })
  return items
}

function itemEl(title: string, body: string, id?: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'item'
  el.setAttribute('data-title', title)
  el.setAttribute('data-body', body)
  if (id) el.setAttribute('data-id', id)
  el.innerHTML = `<div class="head">${escapeHtml(title)}</div><div class="body">${escapeHtml(body)}</div>`
  return el
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

// ---------- feed ----------

async function renderFeed(): Promise<void> {
  frameBody.innerHTML = '<h2>FEED</h2><div id="list-feed">loading…</div>'
  try {
    const { rows } = await api.getFeed(10)
    const list = document.getElementById('list-feed')!
    list.innerHTML = ''
    rows.forEach(p => {
      const title = p.title ?? p.slug ?? p.id
      const bodyText = (p.content ?? '').slice(0, 120)
      list.appendChild(itemEl(title, bodyText, p.id))
    })
  } catch (e) {
    frameBody.innerHTML = '<h2>FEED</h2><div class="error">feed unavailable</div>'
  }
}

// ---------- cIRC ----------

async function renderCirc(): Promise<void> {
  frameBody.innerHTML = '<h2>CIRC</h2><div id="list-circ">loading…</div>'
  try {
    const rooms = await api.getCirc()
    const list = document.getElementById('list-circ')!
    list.innerHTML = ''
    rooms.forEach(r => {
      list.appendChild(itemEl(`#${r.slug}`, `${r.name} · ${r.onlineCount ?? 0} online`, r.slug))
    })
  } catch (e) {
    frameBody.innerHTML = '<h2>CIRC</h2><div class="error">cIRC unavailable</div>'
  }
}

// ---------- cMAIL ----------

async function renderCmail(): Promise<void> {
  frameBody.innerHTML = '<h2>CMAIL</h2><div id="list-cmail">loading…</div>'
  try {
    const threads = await api.getCmail()
    const list = document.getElementById('list-cmail')!
    list.innerHTML = ''
    threads.forEach(t => {
      list.appendChild(itemEl(`@${t.otherUser.username ?? '?'}`, t.lastMessage ?? '', t.conversationId))
    })
  } catch (e) {
    frameBody.innerHTML = '<h2>CMAIL</h2><div class="error">cMAIL unavailable</div>'
  }
}

// ---------- notifications ----------

async function renderNotifications(): Promise<void> {
  frameBody.innerHTML = '<h2>NOTIFY</h2><div id="list-notifications">loading…</div>'
  try {
    const { rows } = await api.getNotifications(10)
    const list = document.getElementById('list-notifications')!
    list.innerHTML = ''
    rows.forEach(n => {
      list.appendChild(itemEl(n.type ?? 'note', n.createdAt ?? '', n.id))
    })
  } catch (e) {
    frameBody.innerHTML = '<h2>NOTIFY</h2><div class="error">notifications unavailable</div>'
  }
}

// ---------- notes ----------

async function renderNotes(): Promise<void> {
  frameBody.innerHTML = '<h2>NOTES</h2><div id="list-notes">loading…</div>'
  try {
    const { rows } = await api.getNotes(10)
    const list = document.getElementById('list-notes')!
    list.innerHTML = ''
    rows.forEach(n => {
      list.appendChild(itemEl((n.content ?? '').slice(0, 60), n.createdAt ?? '', n.id))
    })
  } catch (e) {
    frameBody.innerHTML = '<h2>NOTES</h2><div class="error">notes unavailable</div>'
  }
}

// ---------- login ----------

loginBtn.addEventListener('click', async () => {
  loginBtn.disabled = true
  loginStatus.textContent = 'logging in…'
  try {
    await api.login(loginUser.value, loginPass.value)
    loginStatus.textContent = ''
    setPhoneLoggedIn(true)
    await showLoggedOut()
  } catch (e) {
    loginStatus.textContent = e instanceof Error ? e.message : 'login failed'
    loginBtn.disabled = false
  }
})

loginPass.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loginBtn.click()
})

resumeBtn.addEventListener('click', async () => {
  resumeBtn.disabled = true
  const user = await api.resume()
  resumeBtn.disabled = false
  if (user) {
    setPhoneLoggedIn(true)
    await showLoggedOut()
  } else {
    loginStatus.textContent = 'no saved session'
  }
})

// ---------- resume on boot ----------

;(async () => {
  initGlasses(api)
  const user = await api.resume()
  if (user) {
    setPhoneLoggedIn(true)
    await showLoggedOut()
  } else {
    setPhoneLoggedIn(false)
  }
})()

// ---------- glasses input ----------

onGlassGesture(
  async () => { if (api.authed && currentSection) await moveCursor(1) },
  async () => { if (api.authed) { const next = await nextSection(); await renderSection(next as Section) } },
  async () => { if (api.authed && currentSection) await moveCursor(-1) },
  async () => { if (api.authed && currentSection) await moveCursor(1) },
)
