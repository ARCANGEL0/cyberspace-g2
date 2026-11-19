// Cyberspace G2 — phone view styled after the cyberspace.online terminal home.
// The landing screen stays browseable and quiet; credentials appear when the
// wearer chooses Log in. After login the glasses show the section list.

import './style.css'
import { CyberspaceApi } from './api.js'
import {
  getCurrentSection,
  getScreenText,
  getSelectedItem,
  isDetailOpen,
  isComposerOpen,
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
  setComposerNotice,
} from './glasses.js'
import { isSttReady, parseSttSettings, transcribe, type SttSettings } from './stt.js'
import { exitApp, getPersistentValue, setPersistentValue, audioControl, onAudioEvent, onAppExit } from './bridge.js'
import { PhoneTerminal } from './phone.js'
import type { ComposerState, PhoneSection } from './phone.js'
import type { GlassDetail, GlassItem } from './glasses.js'

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

// ---------- speech-to-text settings (the user's own provider and key) ----------

const STT_KEY = 'cyberspace.g2.stt'
let sttSettings: SttSettings = parseSttSettings((() => { try { return localStorage.getItem(STT_KEY) } catch { return null } })())

phone.attachStt(() => sttSettings, async (next) => {
  sttSettings = next
  const raw = JSON.stringify(next)
  try { localStorage.setItem(STT_KEY, raw) } catch {}
  await setPersistentValue(STT_KEY, raw)
})

const STT_SETUP_HINT = 'Set up speech to text first: on your phone, tap the gear at the top right and add a provider.'

// ---------- voice (G2 mic PCM -> WAV -> STT) ----------

let audioBuffers: Int16Array[] = []
let recording = false

function pcmToWav(pcm: Int16Array | number[], sampleRate = 16000): Blob {
  const bytes = new Int16Array(pcm)
  const buffer = new ArrayBuffer(44 + bytes.byteLength)
  const view = new DataView(buffer)
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + bytes.byteLength, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, bytes.byteLength, true)
  for (let i = 0; i < bytes.length; i++) view.setInt16(44 + i * 2, bytes[i], true)
  return new Blob([buffer], { type: 'audio/wav' })
}

function pcmChunksToWav(chunks: Int16Array[]): Blob {
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const pcm = new Int16Array(total)
  let off = 0
  for (const c of chunks) { pcm.set(c, off); off += c.length }
  return pcmToWav(pcm)
}

async function startRecording(): Promise<void> {
  if (recording) return
  recording = true
  audioBuffers = []
  await setListening(true)
  await audioControl(true)

  const unsub = onAudioEvent((event: any) => {
    const pcm = event.audioPcm
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2)
    audioBuffers.push(samples.slice())
  })

  // We can't unsubscribe here until stop, store it globally
  ;(window as any).__cyberspaceAudioUnsub = unsub
}

async function stopRecording(): Promise<Blob | null> {
  if (!recording) return null
  recording = false
  const unsub = (window as any).__cyberspaceAudioUnsub
  if (unsub) unsub()
  await audioControl(false)
  await setListening(false)
  if (audioBuffers.length === 0) return null
  return pcmChunksToWav(audioBuffers)
}

// Review requires every sensor off at exit; the mic may be open mid-hold.
onAppExit(() => {
  if (!recording) return
  recording = false
  const unsub = (window as any).__cyberspaceAudioUnsub
  if (unsub) unsub()
  void audioControl(false).catch(() => {})
})

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

/** Open a list item; null if it no longer matches the loading section or the fetch fails. */
async function openItem(item: GlassItem): Promise<GlassDetail | null> {
  if (getCurrentSection() !== phone.currentSection) return null   // tap landed mid section switch
  try {
    return await phone.openGlassItem(item)
  } catch (e) {
    console.warn(`glasses: open failed: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

let currentSection: PhoneSection = 'feed'
const menuSections: Record<number, PhoneSection> = {
  101: 'feed',
  102: 'circ',
  103: 'cmail',
  104: 'notifications',
  105: 'notes',
}

if (!(import.meta.env.DEV && new URLSearchParams(location.search).has('demo'))) onGlassGesture(
  // TAP
  async () => {
    const c = getComposerState()
    if (c && c.listening) return

    if (isComposerOpen() && c) {
      const sel = c.selection
      if (sel === 0) await sendComposerDraft()
      else if (sel === 1) await setComposerText('')
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

    const opened = await openItem(item)
    if (!opened) return
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
    if (isComposerOpen() || isDetailOpen()) {
      await moveCursor(1)
      phone.setMirror(getScreenText())
      return
    }
    if (!api.authed || !currentSection) return
    await moveCursor(1)
    phone.setMirror(getScreenText())
  },
  // SWIPE DOWN
  async () => {
    if (isComposerOpen() || isDetailOpen()) {
      await moveCursor(-1)
      phone.setMirror(getScreenText())
      return
    }
    if (!api.authed || !currentSection) return
    await moveCursor(-1)
    phone.setMirror(getScreenText())
  },
  // LONG PRESS — start listening on G2 mic
  async () => {
    const c = getComposerState()
    if (isComposerOpen() && c && !c.listening) {
      if (!isSttReady(sttSettings)) { await setComposerNotice(STT_SETUP_HINT); phone.setMirror(getScreenText()); return }
      await startRecording()
      phone.setMirror(getScreenText())
      return
    }
    if (!api.authed || !currentSection) return
    const item = getSelectedItem()
    if (!item || item.id === '__write__') return
    const opened = await openItem(item)
    if (!opened) return
    const kind = currentSection === 'circ' ? 'circ' : 'cmail'
    await showComposer('', opened.title, kind, item.id)
    if (!isSttReady(sttSettings)) { await setComposerNotice(STT_SETUP_HINT); phone.setMirror(getScreenText()); return }
    await startRecording()
    phone.setMirror(getScreenText())
  },
  // LONG PRESS RELEASE — stop listening, transcribe via STT, show transcript
  async () => {
    if (!recording) return
    const wav = await stopRecording()
    if (!wav) return

    await setComposerNotice('Transcribing...')
    phone.setMirror(getScreenText())
    let transcript = ''
    try {
      transcript = await transcribe(wav, sttSettings)
    } catch (e) {
      await setComposerNotice(e instanceof Error ? e.message : 'Speech to text failed.')
      phone.setMirror(getScreenText())
      return
    }

    if (!getComposerState()) return
    if (transcript) await setComposerText(transcript)
    else await setComposerNotice('Heard nothing. Hold and try again.')
    phone.setMirror(getScreenText())
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
const demo = import.meta.env.DEV && new URLSearchParams(location.search).has('demo')

;(async () => {
  if (demo) {
    const { runDemo } = await import('./demo.js')
    runDemo()
    return
  }
  let persisted: string | null = null
  try {
    persisted = await getPersistentValue(STORAGE_KEY)
  } catch {}
  if (!persisted) {
    try { persisted = localStorage.getItem(STORAGE_KEY) } catch {}
  }
  try {
    const stt = await getPersistentValue(STT_KEY)
    if (stt) sttSettings = parseSttSettings(stt)
  } catch {}
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
