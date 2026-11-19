# Speech-to-text providers

Settings live behind the gear on the phone screen.

| Provider | Get a key | Default model | Notes |
|---|---|---|---|
| OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | `gpt-4o-mini-transcribe` | `gpt-4o-transcribe` and `whisper-1` also work |
| Groq | [console.groq.com/keys](https://console.groq.com/keys) | `whisper-large-v3-turbo` | `whisper-large-v3` also works |
| Deepgram | [console.deepgram.com](https://console.deepgram.com/) | `nova-3` | |
| ElevenLabs | [elevenlabs.io/app/settings/api-keys](https://elevenlabs.io/app/settings/api-keys) | `scribe_v1` | a restricted key needs Speech to Text access |
| Mistral | [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys) | `voxtral-mini-latest` | |
| Together AI | [api.together.ai/settings/api-keys](https://api.together.ai/settings/api-keys) | `openai/whisper-large-v3` | |
| Hugging Face | [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) | `openai/whisper-large-v3-turbo` | a fine-grained token needs "Make calls to Inference Providers" |
| Lemonfox | [lemonfox.ai/apis/keys](https://lemonfox.ai/apis/keys) | `whisper-1` | |
| AssemblyAI | [assemblyai.com/dashboard](https://www.assemblyai.com/dashboard) | `universal` | model is the `speech_model` |
| Gladia | [app.gladia.io](https://app.gladia.io/) | | model is ignored |
| Speechmatics | [portal.speechmatics.com](https://portal.speechmatics.com/) | `enhanced` | model is the operating point (`enhanced` or `standard`); language defaults to `en` |

Language takes an ISO 639-1 code (`en`, `de`, `pt`...). Leave it empty to auto-detect.

AssemblyAI, Gladia and Speechmatics transcribe as a queued job, so they take a few seconds longer than the rest.

## Configuring a custom STT endpoint

Pick Custom to use any OpenAI-compatible transcription endpoint (the same API as OpenAI's [`/v1/audio/transcriptions`](https://platform.openai.com/docs/api-reference/audio/createTranscription)). Paste its full URL as the endpoint, and its key if it has one.

The app sends a multipart `POST` with `file` (WAV, 16 kHz mono), `model`, `language` when set and `response_format=json`, and reads `text` from the JSON answer. The server has to send CORS headers.

The Even app blocks any server that isn't in the `network` whitelist in `app.json`, so add your endpoint's origin there.

Ways to run one:

- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/), Whisper behind a Worker
- [Speaches](https://speaches.ai/), a self-hosted faster-whisper server
- [LocalAI](https://localai.io/features/audio-to-text/), self-hosted
