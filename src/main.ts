// Cyberspace G2 plugin.
//
// Phone view: login (username / password), then sections — feed, cIRC, cMAIL,
// notifications, notes. One click opens a section, one click hold opens the
// section menu to switch sections. Wipes move between items; click / double
// click act on the selection.
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
  nextSection, onGlassGesture, SECTION_LABELS,
} from './glasses.js'

const STORAGE_KEY = 'cyberspace.g2.refreshToken'

const api = new CyberspaceApi({
  get: () => localStorage.getItem(STORAGE_KEY),
  set: (v) => { if (v === null) localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, v) },
})

// ---------- elements ----------

const app = document.getElementById('app')!
app.innerHTML = `
  <div id="phone">
    <div id="login" class="panel">
      <h1>Cyberspace</h1>
      <p id="loginStatus" class="status"></p>
      <label>username</label>
      <input id="loginUser" type="text" autocapitalize="none" autocomplete="username" />
      <label>password</label>
      <input id="loginPass" type="password" autocomplete="current-password" />
      <button id="loginBtn">log in</button>
      <button id="resumeBtn" class="quiet">resume session</button>
    </div>

    <div id="shell" class="panel hidden">
      <div id="header">
        <button id="menuBtn">menu</button>
        <span id="sectionTitle">section</span>
        <button id="logoutBtn">log out</button>
      </div>
      <div id="body"></div>
      <div id="hint">click section · hold menu · wipe to move · click / double click to act</div>
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
const menuBtn = document.getElementById('menuBtn') as HTMLButtonElement
const sectionTitle = document.getElementById('sectionTitle')!
const logoutBtn = document.getElementById('logoutBtn') as HTMLButtonElement
const body = document.getElementById('body')!

// ---------- state ----------

export type Section = 'feed' | 'circ' | 'cmail' | 'notifications' | 'notes'
let currentSection: Section | null = null

// ---------- phone UI ----------

function setPhoneLoggedIn(loggedIn: boolean): void {
  loginPanel.classList.toggle('hidden', loggedIn)
  shellPanel.classList.toggle('hidden', !loggedIn)
  if (loggedIn) renderSection(currentSection ?? 'feed')
}

async function renderSection(section: Section): Promise<void> {
  currentSection = section
  sectionTitle.textContent = SECTION_LABELS[section]
  body.innerHTML = ''

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

/** Phone items rendered as glasses list rows. */
function phoneItemsForSection(section: Section): { title: string; body: string; id?: string }[] {
  const el = document.getElementById(`list-${section}`)
  if (!el) return []
  return Array.from(el.querySelectorAll('.item')).map(item => ({
    title: item.getAttribute('data-title') ?? '',
    body: item.getAttribute('data-body') ?? '',
    id: item.getAttribute('data-id') ?? undefined,
  }))
}

function itemEl(title: string, body: string, id?: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'item'
  el.setAttribute('data-title', title)
  el.setAttribute('data-body', body)
  if (id) el.setAttribute('data-id', id)
  el.innerHTML = `<div class="head">${title}</div><div class="body">${body}</div>`
  return el
}

// ---------- feed ----------

async function renderFeed(): Promise<void> {
  body.innerHTML = '<h2>feed</h2><div id="list-feed">loading…</div>'
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
    body.innerHTML = '<h2>feed</h2><div class="error">feed unavailable</div>'
  }
}

// ---------- cIRC ----------

async function renderCirc(): Promise<void> {
  body.innerHTML = '<h2>cIRC</h2><div id="list-circ">loading…</div>'
  try {
    const rooms = await api.getCirc()
    const list = document.getElementById('list-circ')!
    list.innerHTML = ''
    rooms.forEach(r => {
      list.appendChild(itemEl(`#${r.slug}`, `${r.name} · ${r.onlineCount ?? 0} online`, r.slug))
    })
  } catch (e) {
    body.innerHTML = '<h2>cIRC</h2><div class="error">cIRC unavailable</div>'
  }
}

// ---------- cMAIL ----------

async function renderCmail(): Promise<void> {
  body.innerHTML = '<h2>cMAIL</h2><div id="list-cmail">loading…</div>'
  try {
    const threads = await api.getCmail()
    const list = document.getElementById('list-cmail')!
    list.innerHTML = ''
    threads.forEach(t => {
      list.appendChild(itemEl(`@${t.otherUser.username ?? '?'}`, t.lastMessage ?? '', t.conversationId))
    })
  } catch (e) {
    body.innerHTML = '<h2>cMAIL</h2><div class="error">cMAIL unavailable</div>'
  }
}

// ---------- notifications ----------

async function renderNotifications(): Promise<void> {
  body.innerHTML = '<h2>notifications</h2><div id="list-notifications">loading…</div>'
  try {
    const { rows } = await api.getNotifications(10)
    const list = document.getElementById('list-notifications')!
    list.innerHTML = ''
    rows.forEach(n => {
      list.appendChild(itemEl(n.type ?? 'note', n.createdAt ?? '', n.id))
    })
  } catch (e) {
    body.innerHTML = '<h2>notifications</h2><div class="error">notifications unavailable</div>'
  }
}

// ---------- notes ----------

async function renderNotes(): Promise<void> {
  body.innerHTML = '<h2>notes</h2><div id="list-notes">loading…</div>'
  try {
    const { rows } = await api.getNotes(10)
    const list = document.getElementById('list-notes')!
    list.innerHTML = ''
    rows.forEach(n => {
      list.appendChild(itemEl((n.content ?? '').slice(0, 60), n.createdAt ?? '', n.id))
    })
  } catch (e) {
    body.innerHTML = '<h2>notes</h2><div class="error">notes unavailable</div>'
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

menuBtn.addEventListener('click', async () => {
  const next = await nextSection()
  await renderSection(next as Section)
})

logoutBtn.addEventListener('click', async () => {
  api.logout()
  currentSection = null
  body.innerHTML = ''
  setPhoneLoggedIn(false)
  await showLoggedOut()
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
