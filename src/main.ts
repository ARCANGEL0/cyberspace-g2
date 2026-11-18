// Cyberspace G2 — phone view styled after the cyberspace.online terminal home.
// The landing screen stays browseable and quiet; credentials appear when the
// wearer chooses Log in. After login the glasses show the section list.

import './style.css'
import { CyberspaceApi } from './api.js'
import {
  getScreenText,
  getSelectedItem,
  isDetailOpen,
  isComposerOpen,
  isListening,
  getComposerState,
  moveCursor,
  onGlassGesture,
  showComposer,
  showCurrentList,
  showDetail,
  showLoggedOut,
  showSection,
  setListening,
  setComposerText,
  toggleComposerSelection,
} from './glasses.js'
import { exitApp, getPersistentValue, setPersistentValue, audioControl } from './bridge.js'
import { PhoneTerminal } from './phone.js'
import type { ComposerState, PhoneSection } from './phone.js'

const STORAGE_KEY = 'cyberspace.g2.refreshToken'
let refreshTokenCache: string | null = null
try { refreshTokenCache = localStorage.getItem(STORAGE_KEY) } catch {}

const api = new CyberspaceApi({
  get: () => refreshTokenCache,
  set: (v) => {
    refreshTokenCache = v
    try {
      if (v === null) localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, v)
    } catch {}
    void setPersistentValue(STORAGE_KEY, v).catch(() => {})
  },
})

const app = document.getElementById('app')!

app.innerHTML = `
  <div class="cyber-page">
    <header class="auth-bar" aria-label="Account actions">
      <button id="loginOpen" class="auth-button" type="button">Log in</button>
      <button id="signupButton" class="auth-button auth-button-primary" type="button">Sign up</button>
      <button id="logoutButton" class="auth-button auth-button-primary" type="button" hidden>Log out</button>
    </header>

    <main class="terminal-shell">
      <section id="welcomeView" class="welcome-view" aria-labelledby="siteTitle">
        <h1 id="siteTitle" class="login-title">ᑕ¥βєяรค¢є</h1>
        <p class="tagline">Social media de-imagined.<br />Use your words!</p>

        <nav class="topic-links" aria-label="Explore cyberspace">
          <a href="#arts">Arts</a>
          <a href="#videos">Videos</a>
          <a href="#algorithm">Algorithm</a>
          <a href="#suggestions">Suggestions</a>
          <a href="#tracking">Tracking</a>
          <a href="#crypto">Crypto</a>
          <a href="#bots">Bots</a>
        </nav>

        <p class="subtitle">A quiet corner of the internet where you can think, write, read and connect. Like how the internet was supposed to be.</p>

        <nav class="footer-links" aria-label="Information">
          <a href="#about">About</a><span aria-hidden="true"> / </span>
          <a href="#netiquette">Netiquette</a><span aria-hidden="true"> / </span>
          <a href="#faq">FAQ</a><span aria-hidden="true"> / </span>
          <a href="#contact">Contact</a>
        </nav>
      </section>

      <section id="loginView" class="login-view" hidden aria-labelledby="loginTitle">
        <button id="loginBack" class="back-link" type="button">← back to cyberspace</button>
        <h2 id="loginTitle">Log in</h2>
        <p class="login-intro">Continue on Even G2.</p>
        <form id="loginForm">
          <label for="loginUser">username</label>
          <input id="loginUser" name="username" type="text" autocapitalize="none" autocomplete="username" required />
          <label for="loginPass">password</label>
          <input id="loginPass" name="password" type="password" autocomplete="current-password" required />
          <button id="loginBtn" class="submit-button" type="submit">Log in</button>
        </form>
        <p id="loginStatus" class="status" aria-live="polite"></p>
      </section>

      <section id="phoneView" class="phone-view" hidden aria-label="Cyberspace terminal"></section>
    </main>

  </div>
`

const loginOpen = document.getElementById('loginOpen') as HTMLButtonElement
const loginBack = document.getElementById('loginBack') as HTMLButtonElement
const signupButton = document.getElementById('signupButton') as HTMLButtonElement
const logoutButton = document.getElementById('logoutButton') as HTMLButtonElement
const welcomeView = document.getElementById('welcomeView') as HTMLElement
const loginView = document.getElementById('loginView') as HTMLElement
const loginForm = document.getElementById('loginForm') as HTMLFormElement
const loginStatus = document.getElementById('loginStatus')!
const loginUser = document.getElementById('loginUser') as HTMLInputElement
const loginPass = document.getElementById('loginPass') as HTMLInputElement
const loginBtn = document.getElementById('loginBtn') as HTMLButtonElement
const phoneView = document.getElementById('phoneView') as HTMLElement
const cyberPage = document.querySelector('.cyber-page') as HTMLElement
const authBar = document.querySelector('.auth-bar') as HTMLElement

function updateAuthBar(): void {
  const loggedIn = api.authed
  loginOpen.hidden = loggedIn
  signupButton.hidden = loggedIn
  logoutButton.hidden = !loggedIn
  logoutButton.setAttribute('aria-expanded', String(loggedIn))
}

const phone = new PhoneTerminal(phoneView, api, async (section, items) => {
  currentSection = section
  await showSection(section, items)
  phone.setMirror(getScreenText())
}, async (state: ComposerState | null) => {
  if (state) {
    await showComposer(state.text, state.label, state.kind, state.targetId)
  } else if (isComposerOpen()) {
    await showCurrentList()
  }
  phone.setMirror(getScreenText())
})

function openLogin(): void {
  welcomeView.hidden = true
  loginView.hidden = false
  loginOpen.setAttribute('aria-expanded', 'true')
  loginUser.focus()
}

function closeLogin(): void {
  loginView.hidden = true
  welcomeView.hidden = false
  loginOpen.setAttribute('aria-expanded', 'false')
  loginStatus.textContent = ''
}

function closePhone(): void {
  phone.close()
  cyberPage.classList.remove('logged-in')
  authBar.hidden = false
  loginView.hidden = true
  welcomeView.hidden = false
  loginOpen.setAttribute('aria-expanded', 'false')
  updateAuthBar()
}

async function openPhone(): Promise<void> {
  welcomeView.hidden = true
  loginView.hidden = true
  phoneView.hidden = false
  cyberPage.classList.add('logged-in')
  authBar.hidden = true
  await phone.open()
  currentSection = 'feed'
  await phone.loadSection('feed')
  phone.setMirror(getScreenText())
}

loginOpen.setAttribute('aria-expanded', 'false')
loginOpen.addEventListener('click', openLogin)
loginBack.addEventListener('click', closeLogin)
signupButton.addEventListener('click', () => {
  openLogin()
  loginStatus.textContent = 'Sign up is available at cyberspace.online.'
})
logoutButton.addEventListener('click', () => {
  api.logout()
  updateAuthBar()
  closePhone()
  void showLoggedOut()
})

// ---------- voice ----------

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

let voiceCtx: { stop: () => void } | null = null

function startVoice(onTranscript: (text: string) => void): void {
  const ctor = (window as unknown as {
    SpeechRecognition?: { new (): SpeechRecognitionLike }
    webkitSpeechRecognition?: { new (): SpeechRecognitionLike }
  }).SpeechRecognition
    ?? (window as unknown as {
      webkitSpeechRecognition?: { new (): SpeechRecognitionLike }
    }).webkitSpeechRecognition
  if (!ctor) return
  const rec: SpeechRecognitionLike = new ctor()
  rec.continuous = true
  rec.interimResults = true
  rec.lang = 'en-US'
  rec.onresult = (event) => {
    const parts: string[] = []
    for (let i = 0; i < event.results.length; i++) parts.push(event.results[i][0].transcript)
    onTranscript(parts.join(' ').trim())
  }
  rec.onerror = () => {}
  rec.onend = () => {}
  try {
    rec.start()
    voiceCtx = { stop: () => rec.stop() }
  } catch {}
}

function stopVoice(): void {
  voiceCtx?.stop()
  voiceCtx = null
}

// ---------- composer draft ----------

async function sendComposerDraft(): Promise<void> {
  const c = getComposerState()
  if (!c) return
  const content = c.text.trim()
  if (!content) return

  try {
    if (c.kind === 'write') await api.createPost(content)
    else if (c.kind === 'circ' && c.targetId) await api.postCirc(c.targetId, content)
    else if (c.kind === 'cmail' && c.targetId) await api.postCmail(c.targetId, content)
    else if (c.kind === 'reply' && c.targetId) await api.postCmail(c.targetId, content)
  } catch (e) {
    loginStatus.textContent = e instanceof Error ? e.message : 'send failed'
    return
  }

  await phone.cancelDraft()
  await showCurrentList()
  phone.setMirror(getScreenText())
  if (c.kind === 'write') await phone.loadSection('feed')
  else if (c.kind === 'circ') await phone.loadSection('circ')
  else if (c.kind === 'cmail') await phone.loadSection('cmail')
}

// ---------- glasses input ----------

let currentSection: PhoneSection = 'feed'
const menuSections: Record<number, PhoneSection> = {
  101: 'feed',
  102: 'circ',
  103: 'cmail',
  104: 'notifications',
  105: 'notes',
}

onGlassGesture(
  // TAP
  async () => {
    const c = getComposerState()
    if (c && c.listening) return

    if (isComposerOpen() && c) {
      const sel = c.selection
      if (sel === 0) await sendComposerDraft()
      else if (sel === 2) await showCurrentList()
      phone.setMirror(getScreenText())
      return
    }

    if (!api.authed || !currentSection) return
    const item = getSelectedItem()
    if (!item) return

    if (item.id === '__write__') {
      await showComposer('', 'FEED', 'write')
      phone.setMirror(getScreenText())
      return
    }

    const opened = await phone.openGlassItem(item)
    await showDetail(opened)
    phone.setMirror(getScreenText())
  },
  // DOUBLE TAP
  async () => {
    if (isComposerOpen()) {
      await showCurrentList()
      phone.setMirror(getScreenText())
      return
    }
    if (isDetailOpen()) {
      await showCurrentList()
      phone.setMirror(getScreenText())
      return
    }
    await exitApp()
  },
  // SWIPE UP
  async () => {
    if (isComposerOpen()) {
      toggleComposerSelection()
      phone.setMirror(getScreenText())
      return
    }
    if (isDetailOpen()) {
      moveCursor(1)
      phone.setMirror(getScreenText())
      return
    }
    if (!api.authed || !currentSection) return
    moveCursor(1)
    phone.setMirror(getScreenText())
  },
  // SWIPE DOWN
  async () => {
    if (isComposerOpen()) {
      toggleComposerSelection()
      phone.setMirror(getScreenText())
      return
    }
    if (isDetailOpen()) {
      moveCursor(-1)
      phone.setMirror(getScreenText())
      return
    }
    if (!api.authed || !currentSection) return
    moveCursor(-1)
    phone.setMirror(getScreenText())
  },
  // LONG PRESS — start listening
  async () => {
    const c = getComposerState()
    if (isComposerOpen() && c && !c.listening) {
      await setListening(true)
      await audioControl(true)
      startVoice((text) => { void setComposerText(text) })
      return
    }
    if (!api.authed || !currentSection) return
    const item = getSelectedItem()
    if (!item || item.id === '__write__') return
    const opened = await phone.openGlassItem(item)
    const kind = currentSection === 'circ' ? 'circ' : 'cmail'
    await showComposer('', opened.title, kind, item.id)
    await setListening(true)
    await audioControl(true)
    startVoice((text) => { void setComposerText(text) })
    phone.setMirror(getScreenText())
  },
  // LONG PRESS RELEASE — stop listening
  async () => {
    if (isComposerOpen() && getComposerState()?.listening) {
      stopVoice()
      await audioControl(false)
      await setListening(false)
      phone.setMirror(getScreenText())
      return
    }
    if (isListening()) {
      stopVoice()
      await audioControl(false)
      await setListening(false)
      phone.setMirror(getScreenText())
    }
  },
  // MENU ITEM — section switch
  async itemID => {
    const section = menuSections[itemID]
    if (!api.authed || !section) return
    await phone.loadSection(section)
    phone.setMirror(getScreenText())
  },
)

// ---------- login ----------

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  loginBtn.disabled = true
  loginStatus.textContent = 'logging in…'
  try {
    await api.login(loginUser.value, loginPass.value)
    loginStatus.textContent = `Logged in as ${api.username}. Glasses show your sections.`
    updateAuthBar()
    await openPhone()
  } catch (e) {
    loginStatus.textContent = e instanceof Error ? e.message : 'login failed'
    loginBtn.disabled = false
  }
})

// ---------- resume on boot ----------
;(async () => {
  let persisted: string | null = null
  try {
    persisted = await getPersistentValue(STORAGE_KEY)
  } catch {}
  if (!persisted) {
    try { persisted = localStorage.getItem(STORAGE_KEY) } catch {}
  }
  if (persisted) {
    refreshTokenCache = persisted
    api.hydrateRefreshToken(persisted)
  }
  const user = await api.resume()
  if (user) {
    loginStatus.textContent = `Logged in as ${api.username}. Glasses show your sections.`
    updateAuthBar()
    await openPhone()
  } else {
    updateAuthBar()
    await showLoggedOut()
  }
})()

updateAuthBar()
