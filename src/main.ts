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
  setTranscribing,
  getSelectedOption,
  setConfirming,
  togglePostFlag,
  tickVoice,
  hasTranscript,
  isTranscribing,
  setComposerText,
  setComposerNotice,
} from './glasses.js'
import { isSttReady, parseSttSettings, pcmBytesToWav, providerOf, transcribe, type SttSettings } from './stt.js'
import { debugLog, setLastRecording } from './debug.js'
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

let audioBuffers: Uint8Array[] = []
let recording = false
let starting = false
let stopQueued = false
let voiceRun = 0
let lastLevel = 0
let ticker: ReturnType<typeof setInterval> | null = null
let audioUnsub: (() => void) | null = null
let maxTimer: ReturnType<typeof setTimeout> | null = null
let micOpenedAt = 0
let chunkSizes: number[] = []
let roleCounts: Record<string, number> = {}
let directions = new Set<string>()

const MAX_RECORDING_MS = 60_000
const TICK_MS = 400

function joinBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.byteLength, 0))
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.byteLength }
  return out
}

const TARGET_PEAK = 29000
const MAX_GAIN = 30

function boost(pcm: Uint8Array, peak: number): { pcm: Uint8Array, gain: number } {
  if (!peak) return { pcm, gain: 1 }
  const gain = Math.min(MAX_GAIN, TARGET_PEAK / peak)
  if (gain <= 1.05) return { pcm, gain: 1 }
  const out = new Uint8Array(pcm.byteLength)
  const src = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const dst = new DataView(out.buffer)
  for (let i = 0; i + 1 < pcm.byteLength; i += 2) {
    dst.setInt16(i, Math.max(-32768, Math.min(32767, Math.round(src.getInt16(i, true) * gain))), true)
  }
  return { pcm: out, gain }
}

function peakOf(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let peak = 0
  for (let i = 0; i + 1 < bytes.byteLength; i += 2) peak = Math.max(peak, Math.abs(view.getInt16(i, true)))
  return peak
}

function startTicker(): void {
  stopTicker()
  ticker = setInterval(() => {
    void tickVoice(lastLevel).then(() => phone.setMirror(getScreenText()))
    lastLevel *= 0.6
  }, TICK_MS)
}

function stopTicker(): void {
  if (ticker) clearInterval(ticker)
  ticker = null
}

function closeMic(): void {
  recording = false
  if (audioUnsub) audioUnsub()
  audioUnsub = null
  if (maxTimer) clearTimeout(maxTimer)
  maxTimer = null
  void audioControl(false).catch(() => {})
}

async function startListening(): Promise<void> {
  if (recording || starting || isTranscribing()) return
  if (!isSttReady(sttSettings)) { await setComposerNotice(STT_SETUP_HINT); phone.setMirror(getScreenText()); return }
  starting = true
  stopQueued = false
  audioBuffers = []
  chunkSizes = []
  roleCounts = {}
  directions = new Set()
  lastLevel = 0
  debugLog('mic', 'open')
  try {
    recording = true
    audioUnsub = onAudioEvent((event: any) => {
      if (!recording) return
      const pcm: Uint8Array | undefined = event.audioPcm
      if (!pcm?.byteLength) return
      const bytes = pcm.slice()
      chunkSizes.push(bytes.byteLength)
      const role = String(event.speakerRole ?? 'unknown')
      roleCounts[role] = (roleCounts[role] ?? 0) + 1
      directions.add(event.direction === null || event.direction === undefined ? 'none' : String(event.direction))
      audioBuffers.push(bytes)
      lastLevel = Math.max(lastLevel, Math.min(1, peakOf(bytes) / 3000))
    })
    const opened = await audioControl(true)
    micOpenedAt = Date.now()
    debugLog('mic', `audioControl(true) returned ${String(opened)}`)
    await setListening(true)
    phone.setMirror(getScreenText())
    startTicker()
    maxTimer = setTimeout(() => { void finishListening() }, MAX_RECORDING_MS)
  } catch (e) {
    debugLog('mic', `open failed: ${e instanceof Error ? e.message : String(e)}`)
    closeMic()
    stopTicker()
    await setListening(false)
    await setComposerNotice(e instanceof Error ? e.message : 'Could not open the microphone.')
    phone.setMirror(getScreenText())
  } finally {
    starting = false
  }
  if (stopQueued) await finishListening()
}

async function finishListening(): Promise<void> {
  if (starting) { stopQueued = true; return }
  if (!recording) return
  const run = ++voiceRun
  closeMic()
  const chunks = audioBuffers
  audioBuffers = []
  const pcm = joinBytes(chunks)
  const samples = Math.floor(pcm.byteLength / 2)
  const peak = peakOf(pcm)
  const seconds = (samples / 16000).toFixed(1)
  const level = Math.round((peak / 32768) * 100)
  const wall = micOpenedAt ? ((Date.now() - micOpenedAt) / 1000).toFixed(1) : '?'
  const sizes = [...new Set(chunkSizes)].slice(0, 5).join(',')
  const roles = Object.entries(roleCounts).map(([k, v]) => `${k} ${v}`).join(', ') || '-'
  const dirs = [...directions].slice(0, 8).join(',') || '-'
  const boosted = boost(pcm, peak)
  const info = `${chunks.length} chunks (bytes ${sizes || '-'}), ${samples} samples = ${seconds}s at 16 kHz, mic open ${wall}s, peak ${peak} (${level}%), boost x${boosted.gain.toFixed(1)}, speaker ${roles}, direction ${dirs}`
  debugLog('mic', `closed: ${info}`)
  await setListening(false)
  if (!samples) {
    stopTicker()
    await setComposerNotice('No audio came from the G2 mic. Tap to try again.')
    phone.setMirror(getScreenText())
    return
  }
  const wav = pcmBytesToWav(boosted.pcm)
  setLastRecording(wav, info)
  debugLog('stt', `sending ${wav.size} bytes to ${providerOf(sttSettings.provider)?.label ?? 'none'}${sttSettings.model ? ` model ${sttSettings.model}` : ''}`)
  await setTranscribing(true)
  phone.setMirror(getScreenText())
  let transcript = ''
  let failure = ''
  try {
    transcript = await transcribe(wav, sttSettings)
  } catch (e) {
    failure = e instanceof Error ? e.message : 'Speech to text failed.'
  }
  debugLog('stt', failure ? `failed: ${failure}` : `transcript (${transcript.length} chars): ${transcript.slice(0, 200) || '(empty)'}`)
  if (run !== voiceRun || !getComposerState()) return
  stopTicker()
  await setTranscribing(false)
  if (failure) await setComposerNotice(failure)
  else if (transcript) await setComposerText(transcript)
  else await setComposerNotice(`Speech to text found no words in ${seconds}s of audio (peak level ${level}%). Tap to try again.`)
  phone.setMirror(getScreenText())
}

function cancelListening(): void {
  voiceRun++
  stopQueued = false
  if (recording) closeMic()
  audioBuffers = []
  stopTicker()
}

onAppExit(() => {
  if (recording) closeMic()
  stopTicker()
})

// ---------- composer draft ----------

async function sendComposerDraft(): Promise<void> {
  const c = getComposerState()
  if (!c) return
  const content = c.text.trim()
  if (!content) return

  try {
    if (c.kind === 'write') await api.createPost(content, '', [], { isPublic: c.post.blog, isNSFW: c.post.nsfw, repliesDisabled: c.post.noReplies })
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
    if (isComposerOpen() && c) {
      if (recording || starting) { await finishListening(); return }
      if (isTranscribing()) return
      if (!hasTranscript()) { await startListening(); return }
      const option = getSelectedOption()
      if (option === 'send') {
        if (c.kind === 'write') await setConfirming(true)
        else await sendComposerDraft()
      }
      else if (option === 'yes') await sendComposerDraft()
      else if (option === 'no') await setConfirming(false)
      else if (option === 'rewrite') await startListening()
      else if (option === 'blog' || option === 'nsfw' || option === 'noReplies') await togglePostFlag(option)
      else if (option === 'quit') { cancelListening(); await showCurrentList() }
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
      cancelListening()
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
  async () => {
    if (isComposerOpen() || !api.authed || !currentSection) return
    const item = getSelectedItem()
    if (!item || item.id === '__write__') return
    const opened = await openItem(item)
    if (!opened) return
    const kind = currentSection === 'circ' ? 'circ' : 'cmail'
    await showComposer('', opened.title, kind, item.id)
    phone.setMirror(getScreenText())
  },
  async () => {},
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
