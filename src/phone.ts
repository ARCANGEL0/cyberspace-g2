import { AudioInputSource } from '@evenrealities/even_hub_sdk'
import { audioControl } from './bridge.js'
import { CyberspaceApi } from './api.js'
import type { ChatMessage, CmailThread, CircRoom, CircUser, Notification, Note, Post, Reply } from './api.js'
import type { GlassDetail, GlassItem } from './glasses.js'

export type PhoneSection = 'feed' | 'circ' | 'cmail' | 'notifications' | 'notes'

type ComposerTarget =
  | { kind: 'circ'; id: string }
  | { kind: 'cmail'; id: string }
  | { kind: 'notes' }
  | { kind: 'feed' }

export interface ComposerState {
  text: string
  label: string
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
  private readonly onLogout: () => void
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

  private section: PhoneSection = 'feed'
  private items: GlassItem[] = []
  private target: ComposerTarget | null = null
  private recognition: Recognition | null = null
  private recording = false
  private draft = ''
  private mirrorOpen = false

  constructor(
    host: HTMLElement,
    api: CyberspaceApi,
    onLogout: () => void,
    onSectionChange: (section: PhoneSection, items: GlassItem[]) => void | Promise<void> = () => {},
    onComposer: (state: ComposerState | null) => void | Promise<void> = () => {},
  ) {
    this.host = host
    this.api = api
    this.onLogout = onLogout
    this.onSectionChange = onSectionChange
    this.onComposer = onComposer
    host.innerHTML = `
      <div class="phone-app">
        <header class="phone-header">
          <div class="phone-brand"><span class="phone-kicker">ONLINE</span><strong>CYBERSPACE</strong></div>
          <div class="phone-account"><span id="phoneUser"></span><button id="mirrorToggle" class="mirror-toggle" type="button" aria-label="Mirror glasses"><span class="pixel-bug" aria-hidden="true"></span></button></div>
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

    host.querySelectorAll<HTMLButtonElement>('[data-phone-section]').forEach(button => {
      button.addEventListener('click', () => { void this.loadSection(button.dataset.phoneSection as PhoneSection) })
    })
    this.mirrorToggle.addEventListener('click', () => this.toggleMirror())
    this.bindTalkButton()
    this.send.addEventListener('click', () => { void this.sendDraft() })
    this.cancel.addEventListener('click', () => this.cancelDraft())
    this.detail.addEventListener('click', event => {
      if ((event.target as HTMLElement).classList.contains('detail-back')) this.closeDetail()
    })
  }

  async open(): Promise<GlassItem[]> {
    this.host.hidden = false
    this.setMirrorVisible(false)
    const user = this.host.querySelector('#phoneUser')
    if (user) user.textContent = `@${this.api.username ?? 'unknown'}`
    return this.loadSection(this.section)
  }

  close(): void {
    this.stopTalking()
    this.setMirrorVisible(false)
    this.host.hidden = true
  }

  setMirror(value: string): void { this.mirrorText.textContent = value }

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
          body: reasonPhrase(notice.reason),
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
      await this.onComposer({ text: '', label: 'FEED' })
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
    void this.onComposer({ text: this.draft, label: SECTION_LABELS[this.section] })
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

  private toggleMirror(): void { this.setMirrorVisible(!this.mirrorOpen) }

  private setMirrorVisible(show: boolean): void {
    this.mirrorOpen = show
    this.mainView.hidden = show
    this.mirror.hidden = !show
    this.mirrorToggle.classList.toggle('active', show)
  }
}
