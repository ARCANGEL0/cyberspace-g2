// Speech-to-text for glasses voice replies, with the user's own provider and key.
//
// Neither the G2 nor cyberspace.online transcribes speech: the glasses send raw
// 16 kHz PCM, which main.ts wraps as WAV. Each provider here turns that WAV into
// text. Every provider was checked to accept calls from a browser (CORS), and its
// origin is on the network whitelist in app.json; the Even app blocks any other
// origin.
//
// Keys never leave the phone except to the chosen provider.

import { debugLog } from './debug.js'

export type SttProviderId =
  | 'openai' | 'groq' | 'deepgram' | 'elevenlabs' | 'mistral' | 'together'
  | 'huggingface' | 'lemonfox' | 'assemblyai' | 'gladia' | 'speechmatics' | 'arcxapi'

export interface SttSettings {
  provider: SttProviderId | ''
  apiKey: string
  /** Empty means the provider's default model. */
  model: string
  /** ISO 639-1 code such as "en"; empty means detect. */
  language: string
}

export const EMPTY_STT: SttSettings = { provider: '', apiKey: '', model: '', language: '' }

export interface SttProvider {
  id: SttProviderId
  label: string
  defaultModel: string
}

export const STT_PROVIDERS: SttProvider[] = [
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o-mini-transcribe' },
  { id: 'groq', label: 'Groq', defaultModel: 'whisper-large-v3-turbo' },
  { id: 'deepgram', label: 'Deepgram', defaultModel: 'nova-3' },
  { id: 'elevenlabs', label: 'ElevenLabs', defaultModel: 'scribe_v1' },
  { id: 'mistral', label: 'Mistral', defaultModel: 'voxtral-mini-latest' },
  { id: 'together', label: 'Together AI', defaultModel: 'openai/whisper-large-v3' },
  { id: 'huggingface', label: 'Hugging Face', defaultModel: 'openai/whisper-large-v3-turbo' },
  { id: 'lemonfox', label: 'Lemonfox', defaultModel: 'whisper-1' },
  { id: 'assemblyai', label: 'AssemblyAI', defaultModel: 'universal' },
  { id: 'gladia', label: 'Gladia', defaultModel: '' },
  { id: 'speechmatics', label: 'Speechmatics', defaultModel: 'enhanced' },
  { id: 'arcxapi', label: 'Arc.xApi', defaultModel: 'whisper-1' },
]

export function providerOf(id: SttProviderId | ''): SttProvider | undefined {
  return STT_PROVIDERS.find(p => p.id === id)
}

/** True when there is enough to try a transcription. */
export function isSttReady(s: SttSettings): boolean {
  const p = providerOf(s.provider)
  if (!p) return false
  return !!s.apiKey.trim()
}

// ---------- transport ----------

const TIMEOUT_MS = 60_000
const POLL_MS = 1_000

class SttError extends Error {}

async function call(label: string, url: string, init: RequestInit): Promise<Response> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
  const started = Date.now()
  const sent = init.body instanceof Blob ? `${init.body.size} bytes`
    : init.body instanceof FormData ? [...init.body.entries()].map(([k, v]) => v instanceof Blob ? `${k}=${v.size}B` : `${k}=${v}`).join(' ')
    : ''
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: abort.signal })
  } catch (e) {
    debugLog('stt', `${init.method ?? 'GET'} ${url} ${sent} -> failed after ${Date.now() - started}ms: ${e instanceof Error ? e.message : String(e)}`)
    if (abort.signal.aborted) throw new SttError(`${label}: no answer after ${TIMEOUT_MS / 1000}s`)
    const origin = (() => { try { return new URL(url).origin } catch { return url } })()
    throw new SttError(`${label}: could not reach ${origin}. Check your connection.`)
  } finally {
    clearTimeout(timer)
  }
  const reply = await res.clone().text().catch(() => '')
  debugLog('stt', `${init.method ?? 'GET'} ${url} ${sent} -> ${res.status} in ${Date.now() - started}ms: ${reply.replace(/\s+/g, ' ').slice(0, 500)}`)
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new SttError(`${label} rejected the API key. Check it in the phone settings (gear, top right).`)
    }
    const body = await res.text().catch(() => '')
    throw new SttError(`${label}: ${res.status} ${errorMessage(body) || res.statusText}`.trim())
  }
  return res
}

/** Pull a readable message out of a provider's error body. */
function errorMessage(body: string): string {
  const title = /<title>([^<]*)<\/title>/i.exec(body)
  if (title) return title[1].trim()
  try {
    const j = JSON.parse(body)
    const m = j?.error?.message ?? j?.error ?? j?.message ?? j?.detail?.message ?? j?.detail ?? j?.err_msg
    if (typeof m === 'string') return m.slice(0, 160)
  } catch {}
  return body.replace(/\s+/g, ' ').slice(0, 160)
}

async function json<T>(label: string, url: string, init: RequestInit): Promise<T> {
  return (await call(label, url, init)).json() as Promise<T>
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function poll<T>(label: string, check: () => Promise<T | null>): Promise<T> {
  const until = Date.now() + TIMEOUT_MS
  while (Date.now() < until) {
    const done = await check()
    if (done !== null) return done
    await sleep(POLL_MS)
  }
  throw new SttError(`${label}: transcription took longer than ${TIMEOUT_MS / 1000}s`)
}

function form(fields: Record<string, string | Blob>, fileName = 'voice.wav'): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (v instanceof Blob) f.append(k, v, fileName)
    else if (v) f.append(k, v)
  }
  return f
}

// ---------- providers ----------

/** OpenAI's /audio/transcriptions shape, shared by several providers. */
async function openAiStyle(label: string, url: string, wav: Blob, s: SttSettings, model: string): Promise<string> {
  const headers: Record<string, string> = {}
  if (s.apiKey.trim()) headers.Authorization = `Bearer ${s.apiKey.trim()}`
  const r = await json<{ text?: string }>(label, url, {
    method: 'POST',
    headers,
    body: form({ file: wav, model, language: s.language, response_format: 'json' }),
  })
  return r.text ?? ''
}

async function deepgram(wav: Blob, s: SttSettings, model: string): Promise<string> {
  const q = new URLSearchParams({ model, smart_format: 'true' })
  if (s.language) q.set('language', s.language)
  else q.set('detect_language', 'true')
  const r = await json<any>('Deepgram', `https://api.deepgram.com/v1/listen?${q}`, {
    method: 'POST',
    headers: { Authorization: `Token ${s.apiKey.trim()}`, 'Content-Type': 'audio/wav' },
    body: wav,
  })
  return r?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? ''
}

async function elevenlabs(wav: Blob, s: SttSettings, model: string): Promise<string> {
  const r = await json<{ text?: string }>('ElevenLabs', 'https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': s.apiKey.trim() },
    body: form({ file: wav, model_id: model, language_code: s.language }),
  })
  return r.text ?? ''
}

async function huggingface(wav: Blob, s: SttSettings, model: string): Promise<string> {
  const r = await json<{ text?: string }>('Hugging Face', `https://router.huggingface.co/hf-inference/models/${model}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.apiKey.trim()}`, 'Content-Type': 'audio/wav' },
    body: wav,
  })
  return r.text ?? ''
}

async function assemblyai(wav: Blob, s: SttSettings, model: string): Promise<string> {
  const label = 'AssemblyAI'
  const auth = { Authorization: s.apiKey.trim() }
  const up = await json<{ upload_url: string }>(label, 'https://api.assemblyai.com/v2/upload', {
    method: 'POST', headers: auth, body: wav,
  })
  const job = await json<{ id: string }>(label, 'https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_url: up.upload_url,
      ...(model ? { speech_model: model } : {}),
      ...(s.language ? { language_code: s.language } : { language_detection: true }),
    }),
  })
  return poll(label, async () => {
    const t = await json<{ status: string, text?: string, error?: string }>(label, `https://api.assemblyai.com/v2/transcript/${job.id}`, { headers: auth })
    if (t.status === 'error') throw new SttError(`${label}: ${t.error ?? 'transcription failed'}`)
    return t.status === 'completed' ? (t.text ?? '') : null
  })
}

async function gladia(wav: Blob, s: SttSettings): Promise<string> {
  const label = 'Gladia'
  const auth = { 'x-gladia-key': s.apiKey.trim() }
  const up = await json<{ audio_url: string }>(label, 'https://api.gladia.io/v2/upload', {
    method: 'POST', headers: auth, body: form({ audio: wav }),
  })
  const job = await json<{ id: string }>(label, 'https://api.gladia.io/v2/pre-recorded', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_url: up.audio_url,
      ...(s.language ? { language_config: { languages: [s.language], code_switching: false } } : {}),
    }),
  })
  return poll(label, async () => {
    const t = await json<any>(label, `https://api.gladia.io/v2/pre-recorded/${job.id}`, { headers: auth })
    if (t.status === 'error') throw new SttError(`${label}: ${t.error_code ?? 'transcription failed'}`)
    return t.status === 'done' ? (t.result?.transcription?.full_transcript ?? '') : null
  })
}

async function speechmatics(wav: Blob, s: SttSettings, model: string): Promise<string> {
  const label = 'Speechmatics'
  const auth = { Authorization: `Bearer ${s.apiKey.trim()}` }
  const base = 'https://asr.api.speechmatics.com/v2/jobs'
  const config = { type: 'transcription', transcription_config: { language: s.language || 'en', operating_point: model } }
  const job = await json<{ id: string }>(label, base, {
    method: 'POST', headers: auth, body: form({ data_file: wav, config: JSON.stringify(config) }),
  })
  await poll(label, async () => {
    const j = await json<any>(label, `${base}/${job.id}`, { headers: auth })
    const status = j?.job?.status
    if (status === 'rejected' || status === 'deleted') throw new SttError(`${label}: job ${status}`)
    return status === 'done' ? true : null
  })
  return (await call(label, `${base}/${job.id}/transcript?format=txt`, { headers: auth })).text()
}

/** Turn a WAV recording into text with the configured provider. */
export async function transcribe(wav: Blob, s: SttSettings): Promise<string> {
  const p = providerOf(s.provider)
  if (!p || !isSttReady(s)) throw new SttError('Speech-to-text is not set up')
  const model = s.model.trim() || p.defaultModel
  let text: string
  switch (p.id) {
    case 'openai': text = await openAiStyle(p.label, 'https://api.openai.com/v1/audio/transcriptions', wav, s, model); break
    case 'groq': text = await openAiStyle(p.label, 'https://api.groq.com/openai/v1/audio/transcriptions', wav, s, model); break
    case 'mistral': text = await openAiStyle(p.label, 'https://api.mistral.ai/v1/audio/transcriptions', wav, s, model); break
    case 'together': text = await openAiStyle(p.label, 'https://api.together.xyz/v1/audio/transcriptions', wav, s, model); break
    case 'lemonfox': text = await openAiStyle(p.label, 'https://api.lemonfox.ai/v1/audio/transcriptions', wav, s, model); break
    case 'arcxapi': text = await openAiStyle(p.label, 'https://api.arcangelo.net/stt', wav, s, model); break
    case 'deepgram': text = await deepgram(wav, s, model); break
    case 'elevenlabs': text = await elevenlabs(wav, s, model); break
    case 'huggingface': text = await huggingface(wav, s, model); break
    case 'assemblyai': text = await assemblyai(wav, s, model); break
    case 'gladia': text = await gladia(wav, s); break
    case 'speechmatics': text = await speechmatics(wav, s, model); break
  }
  return text.replace(/\s+/g, ' ').trim()
}

export function pcmToWav(pcm: Int16Array | number[], sampleRate = 16000): Blob {
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

export async function testStt(s: SttSettings): Promise<number> {
  const started = Date.now()
  await transcribe(pcmToWav(new Int16Array(16000)), { ...s, language: s.language || 'en' })
  return Date.now() - started
}

// ---------- storage ----------

export function parseSttSettings(raw: string | null): SttSettings {
  if (!raw) return { ...EMPTY_STT }
  try {
    const j = JSON.parse(raw)
    return {
      provider: providerOf(j.provider) ? j.provider : '',
      apiKey: typeof j.apiKey === 'string' ? j.apiKey : '',
      model: typeof j.model === 'string' ? j.model : '',
      language: typeof j.language === 'string' ? j.language : '',
    }
  } catch {
    return { ...EMPTY_STT }
  }
}
