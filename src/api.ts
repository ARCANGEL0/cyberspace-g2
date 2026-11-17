// Cyberspace API client for api.cyberspace.online.
// Bearer idToken on every authed route. { data } / { error: { code, message } }
// envelopes. Session resumes from a saved refresh token.
const BASE = 'https://api.cyberspace.online'

export type Json = Record<string, unknown>

export interface UserMe {
  username?: string
  userId?: string
  isSupporter?: boolean
  isSiteAdmin?: boolean
}

export interface Post {
  id?: string
  postId?: string
  title?: string
  slug?: string
  content?: string
  topics?: string[]
  author?: string
  authorUsername?: string
  repliesCount?: number
  createdAt?: string
}

export interface Reply {
  replyId?: string
  authorUsername?: string
  content?: string
  createdAt?: string
}

export interface CircRoom {
  id: string
  slug: string
  name: string
  onlineCount?: number
  lastMessageAt?: number
}

export interface CircUser {
  username: string
  isChatAdmin?: boolean
  lastActivity?: number | null
}

export interface CmailThread {
  conversationId: string
  otherUser: { userId?: string; username?: string }
  lastMessage?: string
  lastMessageAt?: number
  unreadCount?: number
}

export interface ChatMessage {
  id?: string
  messageId?: string
  username?: string
  senderUsername?: string
  content?: string
  timestamp?: number | string
  createdAt?: string
  isAction?: boolean
  action?: boolean
  deleted?: boolean
  isSystem?: boolean
}

export interface Notification {
  id: string
  type?: string
  read?: boolean
  actorUsername?: string
  targetId?: string
  targetType?: 'post' | 'reply'
  createdAt?: string
  reason?: string
  metadata?: Json
  data?: Json
}

export interface Note {
  id: string
  content?: string
  topics?: string[]
  createdAt?: string
}

class ApiError extends Error {
  public readonly code: string
  public readonly status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

export class CyberspaceApi {
  private idToken: string | null = null
  private refreshToken: string | null = null
  public username: string | null = null
  public userId: string | null = null
  public supporter = false
  public onAuthChange: ((username: string | null) => void) | null = null

  get authed(): boolean {
    return this.idToken !== null
  }

  private readonly _storage: { get: () => string | null; set: (v: string | null) => void }

  constructor(storage: { get: () => string | null; set: (v: string | null) => void }) {
    this._storage = storage
    this.refreshToken = storage.get()
  }

  /** Replace the boot-time refresh token after loading Even bridge storage. */
  hydrateRefreshToken(value: string | null): void {
    if (!this.idToken) this.refreshToken = value
  }

  async login(email: string, password: string): Promise<string> {
    const r = await this.raw<{ idToken: string; refreshToken: string }>(
      'POST', '/v1/auth/login', { email, password }, false)
    this.idToken = r.idToken
    this.refreshToken = r.refreshToken
    this._storage.set(this.refreshToken)
    try {
      await this.loadMe()
    } catch (e) {
      this.logout()
      throw e
    }
    return this.username ?? email
  }

  async resume(): Promise<string | null> {
    if (!this.refreshToken) return null
    try {
      await this.refresh()
      await this.loadMe()
      return this.username
    } catch {
      return null
    }
  }

  logout(): void {
    this.idToken = null
    this.refreshToken = null
    this.username = null
    this.userId = null
    this.supporter = false
    this._storage.set(null)
    this.onAuthChange?.(null)
  }

  async token(renew = false): Promise<string | null> {
    if ((renew || !this.idToken) && this.refreshToken) {
      await this.refresh().catch(() => { this.logout() })
    }
    return this.idToken
  }

  private async refresh(): Promise<void> {
    if (!this.refreshToken) throw new ApiError('UNAUTHORIZED', 'not logged in', 401)
    const r = await this.raw<{ idToken: string; refreshToken?: string }>(
      'POST', '/v1/auth/refresh', { refreshToken: this.refreshToken }, false, false)
    this.idToken = r.idToken
    if (r.refreshToken) {
      this.refreshToken = r.refreshToken
      this._storage.set(this.refreshToken)
    }
  }

  private async loadMe(): Promise<void> {
    const me = await this.get<UserMe>('/v1/users/me')
    this.username = me.username ?? null
    this.userId = me.userId ?? null
    this.supporter = me.isSupporter === true || me.isSiteAdmin === true
    this.onAuthChange?.(this.username)
  }

  // ---------- low level ----------

  private async raw<T>(
    method: string,
    path: string,
    body?: unknown,
    auth = true,
    retry = true,
  ): Promise<T> {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (auth && this.idToken) headers['Authorization'] = `Bearer ${this.idToken}`

    let res: Response
    try {
      res = await fetch(BASE + path, {
        method, headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new ApiError('NO_CARRIER', 'NO CARRIER', 0)
    }

    if (res.status === 401 && auth && retry && this.refreshToken) {
      await this.refresh().catch(() => { this.logout() })
      if (this.idToken) return this.raw<T>(method, path, body, true, false)
    }

    const json = await res.json().catch(() => null) as { data?: T; error?: { code?: string; message?: string } } | null
    if (!res.ok) {
      throw new ApiError(
        json?.error?.code ?? 'ERROR',
        json?.error?.message ?? `${res.status} ${res.statusText}`,
        res.status,
      )
    }
    return (json?.data ?? {}) as T
  }

  // ---------- typed routes ----------

  get<T>(path: string): Promise<T> { return this.raw<T>('GET', path) }
  post<T>(path: string, body: unknown): Promise<T> { return this.raw<T>('POST', path, body) }
  patch<T>(path: string, body: unknown): Promise<T> { return this.raw<T>('PATCH', path, body) }
  delete<T>(path: string): Promise<T> { return this.raw<T>('DELETE', path) }

  /** Feed / posts. */
  getFeed(limit = 20, cursor?: string): Promise<{ rows: Post[]; cursor: string | null }> {
    const url = `/v1/posts?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    return this.get<Post[]>(url).then(rows => ({ rows, cursor: null }))
  }

  getPost(id: string): Promise<Post> { return this.get<Post>(`/v1/posts/${id}`) }
  getPostReplies(id: string, limit = 50): Promise<Reply[]> {
    return this.get<Reply[]>(`/v1/posts/${encodeURIComponent(id)}/replies?limit=${limit}`)
  }

  /** cIRC rooms. */
  getCirc(): Promise<CircRoom[]> { return this.get<CircRoom[]>('/v1/circ') }
  getCircUsers(roomId: string): Promise<CircUser[]> {
    return this.get<CircUser[]>(`/v1/circ/${encodeURIComponent(roomId)}/users`)
  }
  getCircRoom(roomId: string, limit = 50, before?: string): Promise<{ rows: ChatMessage[]; cursor: string | null }> {
    const url = `/v1/circ/${roomId}?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`
    return this.get<ChatMessage[]>(url).then(rows => ({ rows, cursor: null }))
  }
  postCirc(roomId: string, content: string): Promise<void> {
    return this.post<void>(`/v1/circ/${roomId}`, { content })
  }
  markCircRead(roomId: string): Promise<void> {
    return this.post<void>(`/v1/circ/${roomId}/read`, {})
  }

  /** cMAIL threads. */
  getCmail(): Promise<CmailThread[]> { return this.get<CmailThread[]>('/v1/cmail') }
  openCmail(recipientUsername: string): Promise<{ conversationId: string; otherUser: { username?: string } }> {
    return this.post('/v1/cmail', { recipientUsername })
  }
  getCmailThread(conversationId: string, limit = 50, before?: string): Promise<{ rows: ChatMessage[]; cursor: string | null }> {
    const url = `/v1/cmail/${conversationId}?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`
    return this.get<ChatMessage[]>(url).then(rows => ({ rows, cursor: null }))
  }
  postCmail(conversationId: string, content: string): Promise<void> {
    return this.post<void>(`/v1/cmail/${conversationId}`, { content })
  }
  markCmailRead(conversationId: string): Promise<void> {
    return this.post<void>(`/v1/cmail/${conversationId}/read`, {})
  }

  /** Create a feed post or a note from the phone terminal. */
  createPost(content: string, title = '', topics: string[] = []): Promise<Post> {
    return this.post<Post>('/v1/posts', { content, title, topics })
  }

  createNote(content: string, topics: string[] = []): Promise<Note> {
    return this.post<Note>('/v1/notes', { content, topics })
  }

  /** Notifications. */
  getNotifications(limit = 20, cursor?: string): Promise<{ rows: Notification[]; cursor: string | null }> {
    const url = `/v1/notifications?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    return this.get<Notification[]>(url).then(rows => ({ rows, cursor: null }))
  }

  /** Notes. */
  getNotes(limit = 20, cursor?: string): Promise<{ rows: Note[]; cursor: string | null }> {
    const url = `/v1/notes?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    return this.get<Note[]>(url).then(rows => ({ rows, cursor: null }))
  }

  /** Settings. */
  getSettings(): Promise<Json> { return this.get<Json>('/v1/settings') }
}
