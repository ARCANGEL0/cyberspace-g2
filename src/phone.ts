import { AudioInputSource } from '@evenrealities/even_hub_sdk'
import { audioControl } from './bridge.js'
import { CyberspaceApi } from './api.js'
import type { ChatMessage, CmailThread, CircRoom, CircUser, Notification, Note, Post, Reply } from './api.js'
import type { GlassDetail, GlassItem } from './glasses.js'
import { STT_PROVIDERS, providerOf, isSttReady, testStt, type SttSettings } from './stt.js'
import { clearDebug, getDebugEntries, getLastRecording, onDebugChange } from './debug.js'

export type PhoneSection = 'feed' | 'circ' | 'cmail' | 'notifications' | 'notes'

type ComposerTarget =
  | { kind: 'circ'; id: string }
  | { kind: 'cmail'; id: string }
  | { kind: 'notes' }
  | { kind: 'feed' }

export type ComposerKind = 'write' | 'circ' | 'cmail' | 'reply'

export interface ComposerState {
  text: string
  label: string
  kind: ComposerKind
  targetId?: string
  selection: 0 | 1 | 2
  listening: boolean
}

type Recognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type RecognitionConstructor = new () => Recognition

const SECTION_LABELS: Record<PhoneSection, string> = {
  feed: 'FEED',
  circ: 'cIRC',
  cmail: 'C-MAIL',
  notifications: 'INBOX',
  notes: 'NOTES',
}

const SECTION_ORDER: PhoneSection[] = ['feed', 'circ', 'cmail', 'notifications', 'notes']
const text = (value: unknown): string => typeof value === 'string' ? value : ''

function stamp(value: unknown): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(text(value))
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function clock(value: unknown): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(text(value))
  return Number.isNaN(date.getTime()) ? '' : date.toTimeString().slice(0, 5)
}

function reasonPhrase(reason?: string): string {
  switch (reason) {
    case 'bookmark': return 'saved your entry'
    case 'chat_mention': return 'mentioned you'
    case 'reply': return 'replied to you'
    case 'like': return 'liked your entry'
    case 'follow': return 'followed you'
    default: return reason ?? 'activity'
  }
}

function postId(post: Post): string { return post.id ?? post.postId ?? '' }

function postItem(post: Post): GlassItem {
  const author = post.authorUsername ?? post.author ?? 'unknown'
  return {
    id: postId(post),
    title: `@${author}`,
    body: `${post.title ? `${post.title} ` : ''}${post.content ?? ''}`.trim(),
    meta: stamp(post.createdAt),
    topics: post.topics,
  }
}

function messageLines(messages: ChatMessage[], cmail: boolean): string[] {
  const lines: string[] = []
  messages.forEach(message => {
    const who = message.senderUsername ?? message.username ?? 'unknown'
    const when = clock(message.timestamp ?? message.createdAt)
    const body = text(message.content) || '[deleted]'
    if (cmail) {
      lines.push(`${who}${when ? `  ${when}` : ''}`)
      lines.push(`  ${body}`)
    } else {
      lines.push(`${when ? `${when} ` : ''}${who}: ${body}`)
    }
  })
  return lines
}

function roomUsers(users: CircUser[]): string[] {
  return users
    .slice()
    .sort((a, b) => (a.isChatAdmin === b.isChatAdmin ? a.username.localeCompare(b.username) : a.isChatAdmin ? -1 : 1))
    .map(user => `@${user.username}`)
}

export class PhoneTerminal {
  private readonly host: HTMLElement
  private readonly api: CyberspaceApi
  private readonly onSectionChange: (section: PhoneSection, items: GlassItem[]) => void | Promise<void>
  private readonly onComposer: (state: ComposerState | null) => void | Promise<void>
  private readonly mainView: HTMLElement
  private readonly mirror: HTMLElement
  private readonly mirrorText: HTMLElement
  private readonly mirrorToggle: HTMLButtonElement
  private readonly status: HTMLElement
  private readonly list: HTMLElement
  private readonly detail: HTMLElement
  private readonly composer: HTMLElement
  private readonly talk: HTMLButtonElement
  private readonly review: HTMLElement
  private readonly reviewText: HTMLTextAreaElement
  private readonly send: HTMLButtonElement
  private readonly cancel: HTMLButtonElement
  private readonly sttPane: HTMLElement
  private readonly sttToggle: HTMLButtonElement
  private readonly sttForm: HTMLFormElement
  private readonly sttStatus: HTMLElement
  private stt: { load: () => SttSettings, save: (s: SttSettings) => Promise<void> } | null = null
  private readonly debugPane: HTMLElement
  private readonly debugToggle: HTMLButtonElement
  private debugAudioUrl = ''

  private section: PhoneSection = 'feed'
  private items: GlassItem[] = []
  private target: ComposerTarget | null = null
  private recognition: Recognition | null = null
  private recording = false
  private draft = ''
  private pane: 'main' | 'mirror' | 'stt' | 'debug' = 'main'

  constructor(
    host: HTMLElement,
    api: CyberspaceApi,
    onSectionChange: (section: PhoneSection, items: GlassItem[]) => void | Promise<void> = () => {},
    onComposer: (state: ComposerState | null) => void | Promise<void> = () => {},
  ) {
    this.host = host
    this.api = api
    this.onSectionChange = onSectionChange
    this.onComposer = onComposer
    host.innerHTML = `
      <div class="phone-app">
        <header class="phone-header">
          <div class="phone-brand"><span class="phone-kicker">ONLINE</span><strong>CYBERSPACE</strong></div>
          <div class="phone-account"><span id="phoneUser"></span><button id="mirrorToggle" class="mirror-toggle" type="button" aria-label="Mirror glasses"><span class="pixel-bug" aria-hidden="true"></span></button><button id="debugToggle" class="mirror-toggle debug-toggle" type="button" aria-label="Debug log">&gt;_</button><button id="sttToggle" class="mirror-toggle" type="button" aria-label="Speech-to-text settings"><span class="pixel-gear" aria-hidden="true"></span></button></div>
        </header>
        <div class="phone-main">
          <nav class="phone-tabs" aria-label="Cyberspace sections">
            ${SECTION_ORDER.map(section => `<button type="button" data-phone-section="${section}">${SECTION_LABELS[section]}</button>`).join('')}
          </nav>
          <div class="phone-status" aria-live="polite"></div>
          <section class="phone-content" aria-live="polite">
            <div class="phone-detail" hidden></div>
            <div class="phone-list"></div>
          </section>
          <section class="phone-composer" hidden aria-label="Terminal composer">
            <div class="composer-label">MESSAGE / HOLD TO TALK</div>
            <button class="talk-button" type="button">hold to talk</button>
            <div class="voice-review" hidden>
              <textarea aria-label="Transcript to send" rows="3" placeholder="Your transcript appears here"></textarea>
              <div class="voice-actions"><button class="send-button" type="button">&gt; Send</button><button class="cancel-button" type="button">Cancel</button></div>
            </div>
          </section>
        </div>
        <section class="glass-mirror" hidden aria-label="Glasses mirror">
          <pre></pre>
          <p>tap the bug to return</p>
        </section>
        <section class="debug-pane" hidden aria-labelledby="debugTitle">
          <button class="back-link" type="button" data-debug-close>← back</button>
          <h2 id="debugTitle">Debug</h2>
          <p class="login-intro">Voice replies and speech-to-text calls, newest first. API keys are never logged.</p>
          <div class="debug-recording" hidden>
            <div class="composer-label">LAST RECORDING</div>
            <p class="debug-recording-info"></p>
            <audio controls preload="metadata"></audio>
          </div>
          <div class="stt-actions"><button class="submit-button secondary" type="button" data-debug-clear>Clear</button></div>
          <pre class="debug-log"></pre>
        </section>
        <section class="stt-settings" hidden aria-labelledby="sttTitle">
          <button class="back-link" type="button" data-stt-close>← back</button>
          <h2 id="sttTitle">Speech to text</h2>
          <p class="login-intro">Voice replies on the glasses need a speech-to-text service. Use your own API key; it stays on this phone.</p>
          <form class="stt-form">
            <label for="sttProvider">provider</label>
            <select id="sttProvider">
              <option value="">off</option>
              ${STT_PROVIDERS.map(p => `<option value="${p.id}">${p.label}</option>`).join('')}
            </select>
            <label for="sttKey">api key</label>
            <input id="sttKey" type="password" autocapitalize="none" autocomplete="off" spellcheck="false" />
            <label for="sttModel">model</label>
            <input id="sttModel" type="text" autocapitalize="none" autocomplete="off" spellcheck="false" />
            <label for="sttLanguage">language</label>
            <input id="sttLanguage" type="text" autocapitalize="none" autocomplete="off" spellcheck="false" maxlength="5" placeholder="auto, or a code like en" />
            <div class="stt-actions">
              <button class="submit-button" type="submit">Save</button>
              <button class="submit-button secondary" type="button" data-stt-test>Test connection</button>
            </div>
          </form>
          <p class="status" aria-live="polite"></p>
        </section>
      </div>
    `

    this.mainView = host.querySelector('.phone-main') as HTMLElement
    this.mirror = host.querySelector('.glass-mirror') as HTMLElement
    this.mirrorText = host.querySelector('.glass-mirror pre') as HTMLElement
    this.mirrorToggle = host.querySelector('#mirrorToggle') as HTMLButtonElement
    this.status = host.querySelector('.phone-status') as HTMLElement
    this.list = host.querySelector('.phone-list') as HTMLElement
    this.detail = host.querySelector('.phone-detail') as HTMLElement
    this.composer = host.querySelector('.phone-composer') as HTMLElement
    this.talk = host.querySelector('.talk-button') as HTMLButtonElement
    this.review = host.querySelector('.voice-review') as HTMLElement
    this.reviewText = host.querySelector('.voice-review textarea') as HTMLTextAreaElement
    this.send = host.querySelector('.send-button') as HTMLButtonElement
    this.cancel = host.querySelector('.cancel-button') as HTMLButtonElement
    this.sttPane = host.querySelector('.stt-settings') as HTMLElement
    this.sttToggle = host.querySelector('#sttToggle') as HTMLButtonElement
    this.sttForm = host.querySelector('.stt-form') as HTMLFormElement
    this.sttStatus = host.querySelector('.stt-settings .status') as HTMLElement
    this.debugPane = host.querySelector('.debug-pane') as HTMLElement
    this.debugToggle = host.querySelector('#debugToggle') as HTMLButtonElement

    host.querySelectorAll<HTMLButtonElement>('[data-phone-section]').forEach(button => {
      button.addEventListener('click', () => { void this.loadSection(button.dataset.phoneSection as PhoneSection) })
    })
    this.mirrorToggle.addEventListener('click', () => this.showPane(this.pane === 'mirror' ? 'main' : 'mirror'))
    this.sttToggle.addEventListener('click', () => this.showPane(this.pane === 'stt' ? 'main' : 'stt'))
    host.querySelector('[data-stt-close]')!.addEventListener('click', () => this.showPane('main'))
    this.debugToggle.addEventListener('click', () => this.showPane(this.pane === 'debug' ? 'main' : 'debug'))
    host.querySelector('[data-debug-close]')!.addEventListener('click', () => this.showPane('main'))
    host.querySelector('[data-debug-clear]')!.addEventListener('click', () => clearDebug())
    onDebugChange(() => { if (this.pane === 'debug') this.renderDebug() })
    this.sttField('sttProvider').addEventListener('change', () => this.syncSttFields())
    this.sttForm.addEventListener('submit', event => { event.preventDefault(); void this.saveStt() })
    host.querySelector('[data-stt-test]')!.addEventListener('click', () => void this.testStt())
    this.bindTalkButton()
    this.send.addEventListener('click', () => { void this.sendDraft() })
    this.cancel.addEventListener('click', () => this.cancelDraft())
    this.detail.addEventListener('click', event => {
      if ((event.target as HTMLElement).classList.contains('detail-back')) this.closeDetail()
    })
  }

  async open(): Promise<GlassItem[]> {
    this.host.hidden = false
    this.showPane('main')
    const user = this.host.querySelector('#phoneUser')
    if (user) user.textContent = `@${this.api.username ?? 'unknown'}`
    return this.loadSection(this.section)
  }

  close(): void {
    this.stopTalking()
    this.showPane('main')
    this.host.hidden = true
  }

  setMirror(value: string): void { this.mirrorText.textContent = value }

  /** Section being shown or loaded; changes before its items arrive. */
  get currentSection(): PhoneSection { return this.section }

  async loadSection(section: PhoneSection): Promise<GlassItem[]> {
    this.section = section
    this.target = null
    this.closeDetail()
    this.composer.hidden = true
    this.review.hidden = true
    this.setActiveTab()
    this.status.textContent = `loading ${SECTION_LABELS[section].toLowerCase()}…`
    try {
      this.items = await this.fetchItems(section)
      this.renderItems(section)
      this.status.textContent = `${SECTION_LABELS[section]} / ${this.items.length} item${this.items.length === 1 ? '' : 's'}`
      await this.onSectionChange(section, this.items)
    } catch (error) {
      this.items = []
      this.list.innerHTML = '<p class="phone-empty">NO CARRIER</p>'
      this.status.textContent = error instanceof Error ? error.message : 'load failed'
    }
    return this.items
  }

  private async fetchItems(section: PhoneSection): Promise<GlassItem[]> {
    switch (section) {
      case 'feed': {
        const page = await this.api.getFeed(20)
        return [
          { id: '__write__', title: '[+] WRITE', body: 'new feed post', meta: 'FEED' },
          ...page.rows.map(postItem).filter(item => item.id || item.title),
        ]
      }
      case 'circ': {
        const rooms = await this.api.getCirc()
        return rooms.map((room: CircRoom) => ({
          id: room.id,
          title: `#${room.slug || room.name}`,
          body: `${room.name || room.slug}${room.onlineCount === undefined ? '' : ` · ${room.onlineCount} online`}`,
          meta: room.lastMessageAt ? stamp(room.lastMessageAt) : '',
        }))
      }
      case 'cmail': {
        const threads = await this.api.getCmail()
        return threads
          .filter(thread => thread.otherUser?.username && thread.otherUser.username !== '[deleted]')
          .filter(thread => (thread.lastMessage ?? '').trim() !== '')
          .map((thread: CmailThread) => ({
            id: thread.conversationId,
            title: `@${thread.otherUser?.username ?? 'unknown'}`,
            body: thread.lastMessage ?? '',
            meta: thread.lastMessageAt ? stamp(thread.lastMessageAt) : '',
          }))
      }
      case 'notifications': {
        const page = await this.api.getNotifications(30)
        return page.rows.map((notice: Notification) => ({
          id: notice.id,
          title: notice.actorUsername ? `@${notice.actorUsername}` : (notice.type ?? 'notice'),
          body: reasonPhrase(notice.reason ?? notice.type),
          meta: notice.createdAt ? stamp(notice.createdAt) : '',
        }))
      }
      case 'notes': {
        const page = await this.api.getNotes(30)
        return page.rows.map((note: Note) => ({
          id: note.id,
          title: note.topics?.length ? `#${note.topics.join(' #')}` : 'note',
          body: note.content ?? '',
          meta: note.createdAt ? stamp(note.createdAt) : '',
          topics: note.topics,
        }))
      }
    }
  }

  private renderItems(section: PhoneSection): void {
    this.list.innerHTML = ''
    if (section === 'feed') {
      const write = document.createElement('button')
      write.type = 'button'
      write.className = 'phone-write'
      write.textContent = '[+] Write a post'
      write.addEventListener('click', () => this.beginCompose({ kind: 'feed' }))
      this.list.append(write)
    }
    if (!this.items.length) {
      this.list.insertAdjacentHTML('beforeend', `<p class="phone-empty">${section === 'feed' ? 'NO POSTS' : 'NO ITEMS'}</p>`)
      return
    }
    this.items.forEach((item, index) => {
      if (item.id === '__write__') return
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'phone-record'
      button.innerHTML = `<span class="record-index">${String(index + 1).padStart(2, '0')}</span><span class="record-copy"><strong></strong><small></small></span>`
      button.querySelector('strong')!.textContent = item.title
      button.querySelector('small')!.textContent = `${item.body || '—'}${item.meta ? `  ${item.meta}` : ''}`
      button.addEventListener('click', () => { void this.openGlassItem(item) })
      this.list.append(button)
    })
  }

  /** Open the same record selected on the glasses and return its rich screen. */
  async openGlassItem(item: GlassItem): Promise<GlassDetail> {
    if (item.id === '__write__') {
      this.beginCompose({ kind: 'feed' })
      await this.onComposer({ text: '', label: 'FEED', kind: 'write', selection: 0, listening: false })
      return { section: 'feed', title: '[+] WRITE', meta: 'FEED', lines: ['Hold the phone button to talk.', 'Release to review the transcript.', 'Swipe fields, tap SEND.'] }
    }
    if (!item.id) return { section: this.section, title: item.title, meta: SECTION_LABELS[this.section], lines: [item.body] }
    const detail = await this.buildDetail(item)
    this.renderPhoneDetail(detail)
    return detail
  }

  private async buildDetail(item: GlassItem): Promise<GlassDetail> {
    if (this.section === 'circ') {
      const room = await this.api.getCircRoom(item.id!)
      const users = await this.api.getCircUsers(item.id!).catch(() => [] as CircUser[])
      void this.api.markCircRead(item.id!).catch(() => {})
      this.target = { kind: 'circ', id: item.id! }
      this.beginCompose(this.target)
      return { section: 'circ', title: item.title, meta: `ONLINE (${users.length})`, lines: messageLines(room.rows, false), side: roomUsers(users) }
    }
    if (this.section === 'cmail') {
      const thread = await this.api.getCmailThread(item.id!)
      void this.api.markCmailRead(item.id!).catch(() => {})
      this.target = { kind: 'cmail', id: item.id! }
      this.beginCompose(this.target)
      return { section: 'cmail', title: item.title, meta: 'C-MAIL', lines: messageLines(thread.rows, true) }
    }
    if (this.section === 'feed') {
      const post = await this.api.getPost(item.id!).catch(() => null)
      const replies = await this.api.getPostReplies(item.id!).catch(() => [] as Reply[])
      const author = post?.authorUsername ?? item.title
      const lines = [
        `${author}${post?.createdAt ? `  ${stamp(post.createdAt)}` : ''}`,
        post?.title || item.body,
        post?.content ?? item.body,
        ...(post?.topics?.length ? [post.topics.map(topic => `#${topic}`).join(' ')] : []),
        ...replies.flatMap(reply => [
          `${reply.authorUsername ?? 'unknown'}${reply.createdAt ? `  ${stamp(reply.createdAt)}` : ''}`,
          `  ${reply.content ?? '[deleted]'}`,
        ]),
      ]
      this.target = { kind: 'feed' }
      this.beginCompose(this.target)
      return { section: 'feed', title: item.title, meta: item.meta || 'FEED', lines }
    }
    this.target = this.section === 'notes' ? { kind: 'notes' } : null
    if (this.target) this.beginCompose(this.target)
    return {
      section: this.section,
      title: item.title,
      meta: item.meta || SECTION_LABELS[this.section],
      lines: [item.body || 'NO CONTENT', ...(item.topics?.length ? [item.topics.map(topic => `#${topic}`).join(' ')] : [])],
    }
  }

  private renderPhoneDetail(detail: GlassDetail): void {
    this.detail.hidden = false
    this.detail.innerHTML = '<button type="button" class="detail-back">← back</button><h2></h2><div class="detail-body"></div>'
    this.detail.querySelector('h2')!.textContent = detail.title
    const body = this.detail.querySelector('.detail-body') as HTMLElement
    detail.lines.forEach(line => {
      const row = document.createElement('p')
      row.className = 'detail-message'
      row.textContent = line
      body.append(row)
    })
  }

  private closeDetail(): void {
    this.detail.hidden = true
    this.detail.replaceChildren()
    this.composer.hidden = true
    this.review.hidden = true
  }

  private beginCompose(target: ComposerTarget): void {
    this.target = target
    this.composer.hidden = false
    this.review.hidden = true
    this.status.textContent = 'READY / hold to talk'
  }

  public cancelDraft(): void {
    this.draft = ''
    this.reviewText.value = ''
    this.review.hidden = true
    this.status.textContent = 'draft cancelled'
    void this.onComposer(null)
  }

  private setActiveTab(): void {
    this.host.querySelectorAll<HTMLButtonElement>('[data-phone-section]').forEach(button => {
      button.classList.toggle('active', button.dataset.phoneSection === this.section)
    })
  }

  private bindTalkButton(): void {
    const start = (event: Event) => { event.preventDefault(); this.startTalking() }
    const stop = (event: Event) => { event.preventDefault(); this.stopTalking() }
    this.talk.addEventListener('pointerdown', start)
    this.talk.addEventListener('pointerup', stop)
    this.talk.addEventListener('pointercancel', stop)
    this.talk.addEventListener('pointerleave', stop)
    this.talk.addEventListener('keydown', event => {
      if ((event.key === ' ' || event.key === 'Enter') && !this.recording) start(event)
    })
    this.talk.addEventListener('keyup', event => {
      if (event.key === ' ' || event.key === 'Enter') stop(event)
    })
  }

  startTalking(): void {
    if (this.recording) return
    if (!this.target) this.beginCompose({ kind: this.section === 'notes' ? 'notes' : 'feed' })
    this.recording = true
    this.draft = ''
    this.review.hidden = true
    this.talk.classList.add('recording')
    this.talk.textContent = 'release to stop'
    this.status.textContent = 'MIC OPEN / speak now'
    void audioControl(true, AudioInputSource.Glasses).then(ok => {
      if (!ok) this.status.textContent = 'MIC UNAVAILABLE / type instead'
    }).catch(() => {
      this.status.textContent = 'MIC UNAVAILABLE / type instead'
    })

    const ctor = (window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: RecognitionConstructor }).webkitSpeechRecognition
    if (!ctor) return
    const recognition = new ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.onresult = (event) => {
      const parts: string[] = []
      for (let i = 0; i < event.results.length; i++) parts.push(event.results[i][0].transcript)
      this.draft = parts.join(' ').trim()
      this.reviewText.value = this.draft
    }
    recognition.onerror = () => { this.status.textContent = 'MIC OPEN / transcript unavailable' }
    recognition.onend = () => { if (this.recording) this.status.textContent = 'MIC OPEN / speak now' }
    this.recognition = recognition
    try { recognition.start() } catch { this.status.textContent = 'MIC OPEN / type instead' }
  }

  stopTalking(): void {
    if (!this.recording) return
    this.recording = false
    this.talk.classList.remove('recording')
    this.talk.textContent = 'hold to talk'
    this.recognition?.stop()
    this.recognition = null
    void audioControl(false).catch(() => {})
    this.review.hidden = false
    this.reviewText.value = this.draft
    this.reviewText.focus()
    this.status.textContent = this.draft ? 'TRANSCRIPT READY / Send or Cancel' : 'TRANSCRIPT EMPTY / type or cancel'
    void this.onComposer({
      text: this.draft,
      label: SECTION_LABELS[this.section],
      kind: this.target?.kind === 'circ' || this.target?.kind === 'cmail' ? 'reply' : 'write',
      targetId: this.target?.kind === 'circ' || this.target?.kind === 'cmail' ? this.target.id : undefined,
      selection: 0,
      listening: false,
    })
  }

  public async sendDraft(): Promise<void> {
    const content = this.reviewText.value.trim()
    if (!content || !this.target) return
    const target = this.target
    this.send.disabled = true
    this.status.textContent = 'sending…'
    try {
      if (target.kind === 'circ') await this.api.postCirc(target.id, content)
      else if (target.kind === 'cmail') await this.api.postCmail(target.id, content)
      else if (target.kind === 'notes') await this.api.createNote(content)
      else await this.api.createPost(content)
      this.cancelDraft()
      this.status.textContent = 'sent'
      if (target.kind === 'circ' || target.kind === 'cmail') {
        const item = this.items.find(row => row.id === target.id)
        if (item) await this.openGlassItem(item)
      } else {
        await this.loadSection(this.section)
      }
    } catch (error) {
      this.status.textContent = error instanceof Error ? error.message : 'send failed'
    } finally {
      this.send.disabled = false
    }
  }

  /** Show the terminal, the glasses mirror or the speech-to-text settings. */
  private showPane(pane: 'main' | 'mirror' | 'stt' | 'debug'): void {
    this.pane = pane
    this.mainView.hidden = pane !== 'main'
    this.mirror.hidden = pane !== 'mirror'
    this.sttPane.hidden = pane !== 'stt'
    this.debugPane.hidden = pane !== 'debug'
    this.mirrorToggle.classList.toggle('active', pane === 'mirror')
    this.sttToggle.classList.toggle('active', pane === 'stt')
    this.debugToggle.classList.toggle('active', pane === 'debug')
    if (pane === 'stt') this.fillSttForm()
    if (pane === 'debug') this.renderDebug()
  }

  private renderDebug(): void {
    const time = (at: number) => new Date(at).toTimeString().slice(0, 8)
    const rec = getLastRecording()
    const box = this.debugPane.querySelector('.debug-recording') as HTMLElement
    const audio = box.querySelector('audio') as HTMLAudioElement
    box.hidden = !rec
    if (this.debugAudioUrl) URL.revokeObjectURL(this.debugAudioUrl)
    this.debugAudioUrl = rec ? URL.createObjectURL(rec.wav) : ''
    if (rec) {
      (box.querySelector('.debug-recording-info') as HTMLElement).textContent = `${time(rec.at)}  ${rec.info}`
      audio.src = this.debugAudioUrl
    } else {
      audio.removeAttribute('src')
    }
    const log = getDebugEntries().map(e => `${time(e.at)} [${e.kind}] ${e.text}`).join('\n')
    ;(this.debugPane.querySelector('.debug-log') as HTMLElement).textContent = log || 'nothing yet: hold to talk on the glasses, or test the connection'
  }

  /** Where speech-to-text settings are kept; set by main.ts. */
  attachStt(load: () => SttSettings, save: (s: SttSettings) => Promise<void>): void {
    this.stt = { load, save }
  }

  private sttField<T extends HTMLElement = HTMLInputElement>(id: string): T {
    return this.sttPane.querySelector(`#${id}`) as T
  }

  private fillSttForm(): void {
    const s = this.stt?.load()
    if (!s) return
    this.sttField<HTMLSelectElement>('sttProvider').value = s.provider
    this.sttField('sttKey').value = s.apiKey
    this.sttField('sttModel').value = s.model
    this.sttField('sttLanguage').value = s.language
    this.sttStatus.textContent = isSttReady(s) ? `voice replies use ${providerOf(s.provider)!.label}` : 'voice replies are off'
    this.syncSttFields()
  }

  /** Show the fields the chosen provider needs, with its default model as a hint. */
  private syncSttFields(): void {
    const p = providerOf(this.sttField<HTMLSelectElement>('sttProvider').value as SttSettings['provider'])
    this.sttField('sttModel').placeholder = p?.defaultModel ? `default: ${p.defaultModel}` : 'provider default'
    for (const id of ['sttKey', 'sttModel', 'sttLanguage']) this.sttField(id).disabled = !p
  }

  private readSttForm(): SttSettings | null {
    const next: SttSettings = {
      provider: this.sttField<HTMLSelectElement>('sttProvider').value as SttSettings['provider'],
      apiKey: this.sttField('sttKey').value.trim(),
      model: this.sttField('sttModel').value.trim(),
      language: this.sttField('sttLanguage').value.trim().toLowerCase(),
    }
    const p = providerOf(next.provider)
    if (p && !isSttReady(next)) {
      this.sttStatus.textContent = 'add your api key'
      return null
    }
    return next
  }

  private async saveStt(): Promise<void> {
    if (!this.stt) return
    const next = this.readSttForm()
    if (!next) return
    const p = providerOf(next.provider)
    try {
      await this.stt.save(next)
      this.sttStatus.textContent = p ? `saved / voice replies use ${p.label}` : 'saved / voice replies are off'
    } catch (error) {
      this.sttStatus.textContent = error instanceof Error ? error.message : 'save failed'
    }
  }

  private async testStt(): Promise<void> {
    const next = this.readSttForm()
    if (!next) return
    const p = providerOf(next.provider)
    if (!p) { this.sttStatus.textContent = 'pick a provider to test'; return }
    const buttons = [...this.sttForm.querySelectorAll('button')]
    buttons.forEach(b => { b.disabled = true })
    this.sttStatus.textContent = `testing ${p.label}...`
    try {
      const ms = await testStt(next)
      this.sttStatus.textContent = `connection ok / ${p.label} answered in ${(ms / 1000).toFixed(1)}s`
    } catch (error) {
      this.sttStatus.textContent = `test failed / ${error instanceof Error ? error.message : String(error)}`
    } finally {
      buttons.forEach(b => { b.disabled = false })
    }
  }

}
