// Cyberspace G2 — phone view, CRT glow VT320 theme.
//
// Pure login card: title, subtitle, username / password, Login button.
// After login the glasses show the section list (NOT LOGGED IN until then).

import './style.css'
import { CyberspaceApi } from './api.js'
import { showLoggedOut, showSection, moveCursor, nextSection, onGlassGesture } from './glasses.js'

const STORAGE_KEY = 'cyberspace.g2.refreshToken'

const api = new CyberspaceApi({
  get: () => localStorage.getItem(STORAGE_KEY),
  set: (v) => { if (v === null) localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, v) },
})

const app = document.getElementById('app')!

// CRT glow login card
app.innerHTML = `
  <div class="login-card">
    <h1>ᑕ¥βєяรค¢є</h1>
    <div class="tagline">Social media de-imagined.</div>
    <div class="subtitle">A quiet corner of the internet where you can think,
write, read and connect. Like how the internet was supposed to be.</div>
    <p id="loginStatus" class="status"></p>
    <label>username</label>
    <input id="loginUser" type="text" autocapitalize="none" autocomplete="username" />
    <label>password</label>
    <input id="loginPass" type="password" autocomplete="current-password" />
    <div class="button-row">
      <button id="loginBtn" class="primary">Login</button>
    </div>
    <div class="status">Login to your account to continue on Even G2</div>
  </div>
`

const loginStatus = document.getElementById('loginStatus')!
const loginUser = document.getElementById('loginUser') as HTMLInputElement
const loginPass = document.getElementById('loginPass') as HTMLInputElement
const loginBtn = document.getElementById('loginBtn') as HTMLButtonElement

// ---------- glasses input ----------
let currentSection: 'feed' | 'circ' | 'cmail' | 'notifications' | 'notes' | null = null

onGlassGesture(
  async () => { if (api.authed && currentSection) await moveCursor(1) },
  async () => { if (api.authed) { const next = await nextSection(); if (next) currentSection = next; await showSection(next, []) } },
  async () => { if (api.authed && currentSection) await moveCursor(-1) },
  async () => { if (api.authed && currentSection) await moveCursor(1) },
)

// ---------- login ----------

loginBtn.addEventListener('click', async () => {
  loginBtn.disabled = true
  loginStatus.textContent = 'logging in…'
  try {
    await api.login(loginUser.value, loginPass.value)
    loginStatus.textContent = `Logged in as ${api.username}. Glasses show your sections.`
    await showLoggedOut()
    const sections: ('feed' | 'circ' | 'cmail' | 'notifications' | 'notes')[] = ['feed', 'circ', 'cmail', 'notifications', 'notes']
    currentSection = sections[0]
    await showSection(currentSection, [])
  } catch (e) {
    loginStatus.textContent = e instanceof Error ? e.message : 'login failed'
    loginBtn.disabled = false
  }
})

loginPass.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loginBtn.click()
})

// ---------- resume on boot ----------
;(async () => {
  const user = await api.resume()
  if (user) {
    loginStatus.textContent = `Logged in as ${api.username}. Glasses show your sections.`
    await showLoggedOut()
    const sections: ('feed' | 'circ' | 'cmail' | 'notifications' | 'notes')[] = ['feed', 'circ', 'cmail', 'notifications', 'notes']
    currentSection = sections[0]
    await showSection(currentSection, [])
  } else {
    await showLoggedOut()
  }
})()
