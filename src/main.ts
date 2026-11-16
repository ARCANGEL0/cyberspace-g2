// Cyberspace G2 plugin.
//
// Phone view: login (username / password), then sections — cIRC, cMAIL, feed,
// notifications, notes. One click opens a section, one click hold opens the
// menu to switch between sections. Wipes navigate items; click / double click
// interact.
//
// Glasses view: shows NOT LOGGED IN until a session exists, then the same
// sections rendered as text containers on the 576 x 288 monochrome display.
//
// The DOM is the phone. The glasses only see what is pushed through the
// bridge. All state lives here.

import './style.css'
import { CyberspaceApi } from './api.js'
import { createPage, rebuildPage, onGlassEvent } from './bridge.js'
import { TextContainerProperty } from '@evenrealities/even_hub_sdk'

const STORAGE_KEY = 'cyberspace.g2.refreshToken'

const api = new CyberspaceApi({
  get: () => localStorage.getItem(STORAGE_KEY),
  set: (v) => { if (v === null) localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, v) },
})

// ---------- sections ----------

export type Section = 'circ' | 'cmail' | 'feed' | 'notifications' | 'notes'

const SECTION_LABELS: Record<Section, string> = {
  circ: 'cIRC',
  cmail: 'cMAIL',
  feed: 'feed',
  notifications: 'notify',
  notes: 'notes',
}

let currentSection: Section | null = null

// ---------- phone UI ----------

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

// ---------- glasses UI ----------

const GLASSES_W = 576

let glassesContainers: TextContainerProperty[] = []
let glassesInitialized = false

function glassesContainer(name: string, id: number, content: string, y: number, capture = false): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0, yPosition: y, width: GLASSES_W, height: 44,
    borderWidth: 0, borderColor: 0, paddingLength: 4,
    containerID: id, containerName: name,
    content,
    isEventCapture: capture ? 1 : 0,
    textColor: 4,
  })
}

async function glassesShowLoggedOut(): Promise<void> {
  glassesContainers = [
    glassesContainer('title', 1, 'NOT LOGGED IN', 60, true),
    glassesContainer('hint', 2, 'log in on the phone', 120),
  ]
  if (!glassesInitialized) {
    glassesInitialized = await createPage(glassesContainers)
  } else {
    await rebuildPage(glassesContainers)
  }
}

async function glassesShowSection(section: Section, lines: string[]): Promise<void> {
  glassesContainers = [
    glassesContainer('title', 1, SECTION_LABELS[section], 4, true),
    ...lines.slice(0, 5).map((line, i) =>
      glassesContainer(`line${i}`, i + 2, line, 40 + i * 44, false)),
  ]
  if (!glassesInitialized) {
    glassesInitialized = await createPage(glassesContainers)
  } else {
    await rebuildPage(glassesContainers)
  }
}

// ---------- rendering ----------

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

  if (api.authed) await glassesShowSection(section, [])
}

// ---------- feed ----------

async function renderFeed(): Promise<void> {
  body.innerHTML = '<h2>feed</h2><div id="feedList">loading…</div>'
  try {
    const { rows } = await api.getFeed(10)
    const list = document.getElementById('feedList')!
    list.innerHTML = rows.map(p => `
      <div class="item" data-id="${p.id}">
        <div class="head">${p.author ?? p.slug ?? p.id}</div>
        <div class="body">${(p.content ?? '').slice(0, 120)}</div>
      </div>
    `).join('')
    list.querySelectorAll('.item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id')!
        void api.getPost(id).then(p => {
          body.innerHTML = `<h2>${p.title ?? p.id}</h2><div class="post">${p.content}</div>`
        })
      })
    })
  } catch (e) {
    body.innerHTML = '<h2>feed</h2><div class="error">feed unavailable</div>'
  }
}

// ---------- cIRC ----------

async function renderCirc(): Promise<void> {
  body.innerHTML = '<h2>cIRC</h2><div id="circList">loading…</div>'
  try {
    const rooms = await api.getCirc()
    const list = document.getElementById('circList')!
    list.innerHTML = rooms.map(r => `
      <div class="item" data-slug="${r.slug}">
        <div class="head">#${r.slug}</div>
        <div class="body">${r.name} · ${r.onlineCount ?? 0} online</div>
      </div>
    `).join('')
    list.querySelectorAll('.item').forEach(el => {
      el.addEventListener('click', () => {
        const slug = el.getAttribute('data-slug')!
        body.innerHTML = `<h2>#${slug}</h2><div class="irc">room ${slug}</div>`
      })
    })
  } catch (e) {
    body.innerHTML = '<h2>cIRC</h2><div class="error">cIRC unavailable</div>'
  }
}

// ---------- cMAIL ----------

async function renderCmail(): Promise<void> {
  body.innerHTML = '<h2>cMAIL</h2><div id="cmailList">loading…</div>'
  try {
    const threads = await api.getCmail()
    const list = document.getElementById('cmailList')!
    list.innerHTML = threads.map(t => `
      <div class="item" data-conv="${t.conversationId}">
        <div class="head">@${t.otherUser.username ?? '?'}</div>
        <div class="body">${t.lastMessage ?? ''}</div>
      </div>
    `).join('')
    list.querySelectorAll('.item').forEach(el => {
      el.addEventListener('click', () => {
        const conv = el.getAttribute('data-conv')!
        body.innerHTML = `<h2>cMAIL</h2><div class="cmail">conversation ${conv}</div>`
      })
    })
  } catch (e) {
    body.innerHTML = '<h2>cMAIL</h2><div class="error">cMAIL unavailable</div>'
  }
}

// ---------- notifications ----------

async function renderNotifications(): Promise<void> {
  body.innerHTML = '<h2>notifications</h2><div id="notifList">loading…</div>'
  try {
    const { rows } = await api.getNotifications(10)
    const list = document.getElementById('notifList')!
    list.innerHTML = rows.map(n => `
      <div class="item">${n.type ?? 'note'} · ${n.createdAt ?? ''}</div>
    `).join('')
  } catch (e) {
    body.innerHTML = '<h2>notifications</h2><div class="error">notifications unavailable</div>'
  }
}

// ---------- notes ----------

async function renderNotes(): Promise<void> {
  body.innerHTML = '<h2>notes</h2><div id="notesList">loading…</div>'
  try {
    const { rows } = await api.getNotes(10)
    const list = document.getElementById('notesList')!
    list.innerHTML = rows.map(n => `
      <div class="item" data-id="${n.id}">
        <div class="body">${(n.content ?? '').slice(0, 120)}</div>
      </div>
    `).join('')
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
    await glassesShowLoggedOut()
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
    await glassesShowLoggedOut()
  } else {
    loginStatus.textContent = 'no saved session'
  }
})

menuBtn.addEventListener('click', async () => {
  const sections: Section[] = ['feed', 'circ', 'cmail', 'notifications', 'notes']
  const idx = currentSection ? sections.indexOf(currentSection) : 0
  const next = sections[(idx + 1) % sections.length]
  await renderSection(next)
})

logoutBtn.addEventListener('click', async () => {
  api.logout()
  currentSection = null
  body.innerHTML = ''
  setPhoneLoggedIn(false)
  await glassesShowLoggedOut()
})

// ---------- resume on boot ----------

;(async () => {
  const user = await api.resume()
  if (user) {
    setPhoneLoggedIn(true)
    await glassesShowLoggedOut()
  } else {
    setPhoneLoggedIn(false)
  }
})()

// ---------- glasses input ----------

onGlassEvent((ev) => {
  if (!api.authed) return
  switch (ev.type) {
    case 'tap':
      // advance to next section on tap
      if (currentSection) {
        const sections: Section[] = ['feed', 'circ', 'cmail', 'notifications', 'notes']
        const idx = sections.indexOf(currentSection)
        renderSection(sections[(idx + 1) % sections.length])
      }
      break
    case 'doubleTap':
      // section menu: jump to next section
      if (currentSection) {
        const sections: Section[] = ['feed', 'circ', 'cmail', 'notifications', 'notes']
        const idx = sections.indexOf(currentSection)
        renderSection(sections[(idx + 1) % sections.length])
      }
      break
    case 'swipeUp':
    case 'swipeDown':
      // navigate items within a section
      break
  }
})
