# Open Book Reader — providers, settings, and the proxy

Status: discussion. Part of the design in [`DESIGN.md`](https://github.com/manishsharma004/open-book-reader/blob/main/specs/discussion/DESIGN.md). Vendor facts were checked against vendor documentation in October 2026 and must be re-checked when the adapter is written; vendors rename models and retire them.

This file covers:

1. [The settings document](#1-the-settings-document) the browser stores and sends.
2. [Where the proxy runs](#2-where-the-proxy-runs) and why the app and proxy should share an origin.
3. [The proxy contract](#3-proxy-contract): request and response envelopes, errors, limits.
4. [Proxy security](#4-proxy-security).
5. Vendor tables for [text](#5-text-vendors), [speech](#6-speech-vendors), and [timing](#7-timing-vendors).
6. [Emotion mapping](#8-emotion-mapping) per speech engine.
7. [Probe, model lists, and voice preview](#9-probe-model-lists-and-voice-preview).
8. [Open-book providers](#10-open-book-providers): one interface, the routes, and the catalogs registered on 26 October 2026.

## 1. The settings document

Vendor choice is a browser setting, not server configuration. One document in the `settings` store holds every connection. Batch analysis, transcripts, speech, and timing all read it, and each call sends the part it needs. The proxy keeps no copy.

The reader settings screen keeps three hosts separate: VLLM (Ollama completion), emotion analysis (a second Ollama model that returns clause emotions), and TTS (browser, Kokoro, Pocket TTS, OpenAI speech, or ElevenLabs). The browser calls `POST /v1/complete`, `POST /v1/speak`, and `POST /v1/voices/clone`. Each body includes that call's base URL, model, and key. The proxy does not treat that URL as an open forward. Completion is sent only to Ollama on this machine at port 11434, to an LLM on port 5173 at `127.0.0.1`, `localhost`, or `192.168.29.45`, to `https://ollama.com`, or to one host listed in `OLLAMA_ALLOW`. Speech is sent only to Kokoro on port 8880 or Pocket TTS on port 7508 at `127.0.0.1`, `localhost`, or `192.168.29.45`, to `https://api.openai.com`, to `https://api.elevenlabs.io`, or to a `host:port` listed in `SPEECH_ALLOW`. Link-local and cloud-metadata addresses are refused even when listed. Redirects are not followed, and the body is not logged. The sample stays in the browser. Kokoro does not clone. The cloning model for an 8GB machine is Kyutai Pocket TTS `english_18m_refl_2026-10`, run on the CPU so the GPU stays with the text model. The proxy sends the stored sample as `voice_wav` on each Pocket request. ElevenLabs can still create a voice id, and that is not the path for this machine. The browser voice does not call the proxy; it changes pitch, rate, and volume for the chosen emotion and says so.

```json
{
  "schema": 2,
  "proxyBaseUrl": null,
  "proxyToken": null,
  "profiles": [
    {
      "id": "p_ollama_lan",
      "name": "Ollama on the study PC",
      "vendor": "ollama",
      "baseUrl": "http://192.168.1.40:11434",
      "apiKey": null,
      "timeoutMs": 180000,
      "extraHeaders": {}
    },
    {
      "id": "p_kokoro_lan",
      "name": "Kokoro on the study PC",
      "vendor": "kokoro",
      "baseUrl": "http://192.168.1.40:8880",
      "apiKey": null,
      "timeoutMs": 60000,
      "extraHeaders": {}
    },
    {
      "id": "p_openai",
      "name": "OpenAI",
      "vendor": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-...",
      "organization": null,
      "project": null,
      "timeoutMs": 120000,
      "extraHeaders": {}
    }
  ],
  "assignments": {
    "text": {
      "profileId": "p_ollama_lan",
      "model": "qwen3:8b",
      "contextTokens": 16384,
      "structuredOutput": "json_schema"
    },
    "speech": {
      "profileId": "p_kokoro_lan",
      "model": "kokoro",
      "voice": "af_heart",
      "maxInputChars": 2000,
      "emotion": "none"
    },
    "timing": {
      "profileId": "p_openai",
      "model": "whisper-1"
    }
  }
}
```

The study-PC URLs above are stored in the browser. The app server still refuses them until its environment names those sockets: `OLLAMA_ALLOW=192.168.1.40:11434` and `SPEECH_ALLOW=192.168.1.40:8880`. A base URL on its own does not open the rest of that network.

### 1.1 Profiles and assignments

A **profile** is a connection: vendor, base URL, credentials, timeout, extra headers. An **assignment** says which profile and model do one job, plus the options for that job. One OpenAI profile can serve text, speech, and timing with three different models, and the key is entered once.

In `DESIGN.md`, "text profile", "speech profile", and "timing profile" mean the assignment for that job: a profile plus its model and options.

| Assignment | Used by | Options |
| --- | --- | --- |
| `text` | chapter check, metadata map and reduce, transcripts, vision retry | `model`, `contextTokens`, `structuredOutput` (`json_schema`, `json_object`, `none`), `vision` (bool) |
| `speech` | `/v1/speak` | `model`, `voice`, `maxInputChars`, `emotion` (`clause`, `request`, `none`; set by the vendor adapter, editable when the vendor supports more than one), `outputFormat` |
| `timing` | `/v1/align` | `model`, `language` override |

There is no fallback between assignments. An empty `speech` assignment means the browser voice (level 0 in `DESIGN.md`), not "use the text profile". A text vendor rarely has a speech route, and silently sending speech to it produced confusing failures in the earlier draft.

An empty `timing` assignment is allowed. Segments from engines without timings are then `coarse` (sentence highlight). The settings screen says so next to the speech assignment when the chosen engine returns no timings.

### 1.2 Fields every profile has

| Field | Required | Notes |
| --- | --- | --- |
| `id`, `name` | yes | Local. `name` is what the reader sees |
| `vendor` | yes | A row in the tables below |
| `baseUrl` | yes | The vendor's client base URL, not a full endpoint. Defaults are filled in for hosted vendors. A LAN host is contacted only when `OLLAMA_ALLOW` or `SPEECH_ALLOW` names that host and port |
| `apiKey` | per vendor | Forwarded only to `baseUrl`'s host, in the header that vendor expects |
| `timeoutMs` | no | Default 120000. Local models on CPU need more |
| `extraHeaders` | no | String map added after the vendor's headers. Cannot set `Authorization`, `api-key`, `x-api-key`, `xi-api-key`, `x-goog-api-key`, `Ocp-Apim-Subscription-Key`, `Host`, `Cookie`, or `Content-Length`. Credentials live only in named fields so the reader can see them |

Sampling parameters such as temperature are not settings. The proxy's vendor adapter chooses them per `kind`, and omits them where a vendor rejects them (Anthropic API version `2026-10-21` returns 400 for `temperature`, `top_p`, and `top_k`).

### 1.3 Proxy fields

- `proxyBaseUrl`: `null` means the proxy is on the same origin as the app (deployment A). Otherwise the absolute URL of the proxy.
- `proxyToken`: sent as `Authorization: Bearer` to the proxy only. It is never forwarded. Vendor keys travel inside the request body and are put on the vendor request by the proxy.

### 1.4 Validation before a call

The browser checks the assignment before it calls the proxy: the profile exists, the vendor's required fields are present, the model is set, and for speech the voice is set. A missing field shows in Settings and blocks the task with `needs-text-profile` or `needs-speech-profile`. It is not discovered by a failed request at minute 40 of a processing run.

### 1.5 Export, import, and sharing

- Export writes the settings document as a JSON file. API keys and `proxyToken` are left out unless the reader ticks **Include API keys**, and the dialog says that anyone with the file can spend on those accounts.
- Import replaces `profiles` and `assignments`, and keeps this browser's `proxyBaseUrl` and `proxyToken` unless the reader chooses to replace them. A proxy that can reach a LAN model is usually different per machine.
- Imported profiles without keys are marked **Needs key** and block their assignments until filled in.
- A `schema` number lets a later version migrate older files.

## 2. Where the proxy runs

The proxy must be able to open a TCP connection to every `baseUrl` the reader uses, and the browser must be allowed to call the proxy. Browsers restrict the second part more than the earlier draft assumed.

| Mode | App served from | Proxy at | Works | Reader setup |
| --- | --- | --- | --- | --- |
| **A. Same origin (default)** | The app server | The same app server, `/v1` | All browsers | Run one container or process on a machine that can reach the model hosts. Open its URL |
| B. Hosted app, loopback proxy | A public HTTPS site | `http://127.0.0.1:8787` on the reader's machine | Chromium after a Local Network Access permission prompt; Firefox treats loopback as trustworthy. Safari must be tested | Run the proxy locally, allow the permission |
| C. Hosted app, LAN proxy | A public HTTPS site | Another machine on the LAN | Only if the proxy has HTTPS with a certificate the browser trusts, plus the Local Network Access permission in Chromium | Certificate on the LAN host |

Why A is the default:

- A page served over HTTPS cannot call `http://192.168.x.x` (mixed content), and Chromium's Local Network Access asks permission before a public page calls a loopback or private address. With `fetch(url, { targetAddressSpace: "loopback" | "local" })` the request can go ahead after the prompt, but it is one more failure point for every reader.
- In mode A the app and the proxy share an origin. There is no CORS, no mixed content, and no permission prompt. `proxyBaseUrl` stays `null`.
- The service worker caches the app shell, so a prepared book still plays when the app server is offline. Only new model calls need it.

Typical mode A layouts:

- Everything on one laptop: the app server, Ollama, and Kokoro all on `127.0.0.1`. Open `http://localhost:8787`. `localhost` is a secure context, so the service worker, Web Locks, and `crypto.subtle` work over plain HTTP.
- A home server: the app server runs on the same host as Ollama, and other devices open `https://reader.home.example` through a reverse proxy with a certificate. Plain `http://192.168.1.40:8787` is **not** a secure context: service workers and the browser voice are unavailable. Adding a PDF and opening it still work, because the hash, ids, and reader paint do not require `crypto.subtle` or `speechSynthesis`. Listening on that phone uses a speech model. HTTPS remains the way to give phones the service worker, Web Locks, and the browser voice.
- A cloud VM: the app server next to hosted vendors only. It cannot reach the reader's LAN.

## 3. Proxy contract

Model routes are under `/v1`. They take JSON except `/v1/align`, which takes `multipart/form-data` because it carries audio. Open-book routes do not use this envelope and carry no profile. They are in [Open-book providers](#10-open-book-providers).

### 3.1 Envelope

```json
{
  "profile": { "vendor": "ollama", "baseUrl": "http://192.168.1.40:11434", "apiKey": null, "timeoutMs": 180000, "extraHeaders": {} },
  "assignment": { "model": "qwen3:8b", "contextTokens": 16384, "structuredOutput": "json_schema" },
  "kind": "transcript",
  "schema": "transcript.v1",
  "payload": { "utterance": [], "context": {} },
  "requestId": "req_7f2c"
}
```

- `profile` and `assignment` are copied from settings for this call. `id` and `name` are not sent.
- `schema` names a JSON schema the proxy and the browser both ship. The proxy uses it for the vendor's structured-output mechanism; the browser validates the result against the same schema whatever the vendor did.
- `requestId` is generated by the browser for correlating a retry. The proxy echoes it and does not store it.

### 3.2 Routes

| Route | Body | Success response |
| --- | --- | --- |
| `POST /v1/complete` | envelope with `kind` `chapters`, `metadata-map`, `metadata-reduce`, `metadata-front`, `transcript`, or `vision-page` | `{ "result": {...}, "usage": { "inputTokens", "outputTokens" }, "model": "..." }` |
| `POST /v1/speak` | envelope with `payload: { "input", "inputType": "text" or "ssml", "voice", "accept": ["audio/webm;codecs=opus", "audio/mp4"] }` | `{ "audio": base64, "mediaType", "durationMs", "timings": null or { "unit": "word" or "char", "items": [...] }, "usage": { "characters" } }` |
| `POST /v1/align` | form parts `request` (envelope JSON with `payload: { "language", "prompt" }`) and `audio` | `{ "words": [{ "text", "startMs", "endMs" }], "model": "..." }` |
| `POST /v1/probe` | envelope with `kind` `text`, `speech`, or `timing` | see [Probe](#9-probe-model-lists-and-voice-preview) |
| `GET /v1/health` | none | `{ "version", "ffmpeg": true, "maxBodyBytes" }` |
| Open books | none of this envelope | [Open-book providers](#10-open-book-providers) |

`/v1/speak` returns JSON with base64 audio. A 20-second utterance at 32 kbps is about 80 KB, about 107 KB encoded, so the overhead does not matter and timings arrive in the same response.

`accept` lists what this browser's `MediaSource.isTypeSupported` / `canPlayType` reported. The proxy asks the vendor for one of those formats when the vendor offers it, and otherwise converts with ffmpeg. Conversion happens in memory or in a temporary file deleted before the response.

### 3.3 Errors

Every error has one shape:

```json
{ "error": { "source": "vendor", "status": 429, "code": "rate_limited", "message": "Rate limit reached for requests", "retryAfterMs": 20000, "requestId": "req_7f2c" } }
```

| `source` | Meaning | Browser behavior |
| --- | --- | --- |
| `proxy` | Bad envelope, blocked host, body too large, missing token | Not retried. Shown with a settings link |
| `network` | Proxy could not connect, DNS failed, TLS failed, timeout | Retried with backoff. After 3 tries: "Can't reach {host} from the app server" |
| `vendor` | The vendor answered with an error | 401/403: not retried, profile marked **Key rejected**. 404 on model: **Model not found**. 429 and 5xx: retried after `retryAfterMs` or backoff |
| `format` | Vendor answered 200 but the body did not match the schema | One retry with the validation error in the prompt, then the task fails with the vendor text shown |

The vendor message is passed through so the reader sees what the vendor said, with the API key removed if a vendor echoed it.

### 3.4 Limits

- Request body: 32 MB by default (`MAX_BODY_BYTES`). OpenAI's transcription route accepts up to 25 MB of audio, and an utterance is far smaller.
- Concurrency: the browser keeps at most two realtime calls in flight per assignment and four batch calls. Local hosts such as Ollama serve one request at a time unless configured otherwise, so more would only queue.
- Timeouts: `timeoutMs` per call, applied to the whole vendor exchange.
- No streaming in the first version. Each response is the whole result.

## 4. Proxy security

The proxy holds no data, but it is a request forwarder that receives API keys. It must not become an open relay or a way into the reader's network.

| Rule | Default | Why |
| --- | --- | --- |
| Bind address | `127.0.0.1` | Binding to the LAN is an explicit choice |
| Token | Required when bound to anything but loopback (`PROXY_TOKEN`), refused to start without it | A LAN-bound proxy without a token lets any device on the network spend the reader's keys if it sees a request, and reach internal hosts |
| Origin check | Requests with an `Origin` header must match the app's own origin or `CORS_ORIGINS` | Another website open in the same browser cannot call the proxy |
| Host check | `Host` must be in `ALLOWED_HOSTS` (default: `localhost`, `127.0.0.1`, and the configured public name) | DNS rebinding |
| Forwarding targets | Completion: Ollama at `127.0.0.1`, `localhost`, or `::1` on port 11434; an LLM on port 5173 at those loopback hosts or at `192.168.29.45`; plus `https://ollama.com`. Speech: Kokoro on port 8880 and Pocket TTS on port 7508 at those loopback hosts or at `192.168.29.45`, `https://api.openai.com`, and `https://api.elevenlabs.io`. `OLLAMA_ALLOW` and `SPEECH_ALLOW` add exact `host` or `host:port` entries (a completion entry without a port uses 11434; a speech entry must include a port). No CIDR, and no other path than the one the route builds. Link-local and metadata (`169.254.0.0/16`, `fd00:ec2::254`) are refused even if listed | The base URL is chosen by the caller. An open forward would let that caller reach the rest of the local network |
| Redirects | Not followed for completion, speech, align, and probe. An open-book file or cover follows a redirect only when the next host is on that provider's list, and at most three times | A vendor redirect could move a key to another host. An open-book fetch carries no key, and the next host is still one that provider named |
| Credentials | Vendor keys are taken only from named profile fields and sent only to `baseUrl`'s host | `extraHeaders` cannot carry a second key |
| Logging | Each `/v1` response logs method, route, vendor, status, and duration. A browser crash also posts `/v1/log` with the page route and a short error message. No bodies, headers, keys, tokens, book text, or URLs with query strings | Book text and keys must not land in server logs |
| Temporary files | Deleted before the response finishes | Stateless |
| Response headers | `Cache-Control: no-store` on `/v1` | No intermediary keeps book text |

The app server sends a strict Content Security Policy for the app: `default-src 'self'`, `connect-src 'self'` plus the proxy origin in modes B and C, `worker-src 'self' blob:`, no inline scripts. That matters because API keys are readable by any script on the app's origin.

## 5. Text vendors

All rows return one JSON object for the named schema. The `structuredOutput` option chooses how the proxy asks for it. The browser validates every response regardless.

| Vendor | Default `baseUrl` | Auth | Request | Structured output | Notes |
| --- | --- | --- | --- | --- | --- |
| `openai` | `https://api.openai.com/v1` | `Authorization: Bearer` | `POST /chat/completions` | `response_format: { type: "json_schema", json_schema: { strict: true } }` | Optional `organization` (`OpenAI-Organization`), `project` (`OpenAI-Project`) |
| `azure-openai` | `https://{resource}.openai.azure.com/openai/v1/` (required) | `api-key` header, or Bearer when `authStyle: bearer` | `POST /chat/completions`; `model` is the deployment name | Same as OpenAI, model-dependent | Optional `apiVersion` selects the legacy `/openai/deployments/{model}/chat/completions?api-version=` shape |
| `anthropic` | `https://api.anthropic.com` | `Authorization: Bearer` (legacy `x-api-key` with `authStyle: x-api-key`) | `POST /v1/messages`, `anthropic-version` from the profile (`2026-10-21`) | `output_config.format: { type: "json_schema", schema }` | Optional `workspaceId` (`anthropic-workspace-id`), required when the key is not scoped to one workspace. No sampling parameters on `2026-10-21` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta` | `x-goog-api-key` | `POST /models/{model}:generateContent` | `generationConfig.responseMimeType: "application/json"` plus the schema | `wire: openai` uses `/v1beta/openai/` with the same key |
| `groq` | `https://api.groq.com/openai/v1` | Bearer | `POST /chat/completions` | `json_schema` on models that support it, else `json_object` | |
| `openrouter` | `https://openrouter.ai/api/v1` | Bearer | `POST /chat/completions` | `json_schema`, honored when the routed provider supports it | Optional `httpReferer` (`HTTP-Referer`), `appTitle` (`X-Title`) |
| `mistral` | `https://api.mistral.ai/v1` | Bearer | `POST /chat/completions` | `json_schema` | |
| `deepseek` | `https://api.deepseek.com/v1` | Bearer | `POST /chat/completions` | `json_object` only; schema goes in the prompt | |
| `xai` | `https://api.x.ai/v1` | Bearer | `POST /chat/completions` | `json_schema` | |
| `together` | `https://api.together.xyz/v1` | Bearer | `POST /chat/completions` | `json_schema` on supported models | |
| `fireworks` | `https://api.fireworks.ai/inference/v1` | Bearer | `POST /chat/completions` | `json_schema` on supported models | |
| `ollama` | required: `http://{host}:11434` for a local or LAN server, `https://ollama.com` for Ollama's cloud | none locally; Bearer for `ollama.com` | Native `POST /api/chat` with `stream: false` | `format: <JSON schema>` locally. Ollama's cloud has no structured outputs, so the schema goes in the prompt | `options.num_ctx` is set from `contextTokens`. See below |
| `openai-compatible` | required, e.g. LM Studio `http://{host}:1234/v1`, llama.cpp `http://{host}:8080/v1`, vLLM `http://{host}:8000/v1` | optional Bearer | `POST /chat/completions` | `structuredOutput` chosen by the reader or the probe. LM Studio, llama.cpp server, and vLLM accept `json_schema` | Any host not listed above |

**Why Ollama uses the native route.** Ollama's default context window is 4,096 tokens on machines with less than 24 GiB of VRAM, and its OpenAI-compatible `/v1/chat/completions` route has no way to set `num_ctx` per request. A metadata chunk or a transcript with context would be silently truncated. The native `/api/chat` accepts `options.num_ctx` and a JSON schema in `format`. That is why `baseUrl` for Ollama is the server origin without `/v1`. The probe reads the model's maximum context from `POST /api/show` and suggests a `contextTokens` value. Larger contexts use more memory; the settings screen shows the value and lets the reader lower it.

`contextTokens` for hosted vendors is filled from the model list where the vendor reports it, otherwise from a conservative default of 32,768. `DESIGN.md` uses it to size metadata chunks.

**Vision retry.** Only offered when the text assignment has `vision: true`. The page image is sent as an image content part in the vendor's format.

## 6. Speech vendors

Kokoro is the default speech engine: it returns word timings and needs no account, and the recommended compose file runs it next to the app server (`DESIGN.md` §12). The browser still calls only the proxy. OpenAI's current speech models are not the default; OpenAI lists them for shutdown on January 6, 2027, and they return no timings. A hosted voice, when the reader wants one, is Google Cloud TTS or ElevenLabs. The default Kokoro assignment leaves `timing` empty.

| Vendor | Request | Auth | Voices | Emotion | Timings | Output | Input limit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `openai` | `POST {baseUrl}/audio/speech` | Bearer | Fixed list (`alloy`, `ash`, `coral`, ...) | `instructions` per request (`gpt-4o-mini-tts` only) | none | `response_format`: `opus`, `aac`, `mp3`, `wav`, `pcm` | 4,096 characters |
| `elevenlabs` | `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps` | `xi-api-key` | `GET /v1/voices` | Inline audio tags in v3-class models, e.g. `[whispers]` | character start and end times (`alignment`) | `output_format`, e.g. `mp3_44100_64`, `opus_48000_32` | per model, set in `maxInputChars` |
| `azure-speech` | `POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1`, SSML body | `Ocp-Apim-Subscription-Key` | `GET /cognitiveservices/voices/list` (includes each voice's styles) | `<mstts:express-as style styledegree>` per sentence, on voices that list the style | none on REST; word boundaries only through the Speech SDK | `X-Microsoft-OutputFormat`, e.g. `ogg-24khz-16bit-mono-opus` | SSML up to the REST limit; the browser keeps utterances short |
| `google-tts` | `POST https://texttospeech.googleapis.com/v1beta1/text:synthesize` | `x-goog-api-key` | `GET /v1/voices` | none | `<mark name="w12"/>` before each word with `enableTimePointing: ["SSML_MARK"]`; returns mark times | `audioEncoding`: `OGG_OPUS`, `MP3`, `LINEAR16` | 5,000 bytes of input |
| `gemini-tts` | `POST {baseUrl}/models/{model}:generateContent` with `responseModalities: ["AUDIO"]` | `x-goog-api-key` | Prebuilt voice names | Natural-language style direction per part | none | Uncompressed 24 kHz 16-bit audio; converted by the proxy | 8,192 input tokens |
| `kokoro` | Kokoro-FastAPI `POST {baseUrl}/dev/captioned_speech` with `stream: false` | none by default | `GET {baseUrl}/v1/audio/voices` | none | word start and end times | `response_format`: `opus`, `mp3`, `wav` | keep utterances short; chunked internally |
| `pocket` | `POST {origin}/tts` as multipart form `text`, plus `voice_wav` or `voice_url` | none | a builtin name such as `alba`, or the uploaded sample | none | none | `audio/wav` | 8,000 characters |
| `openai-compatible` | `POST {baseUrl}/audio/speech` | optional Bearer | from settings | `instructions` if the host supports it, else none | none | host-dependent | `maxInputChars` |
| browser voice | `speechSynthesis` in the page, no proxy | none | `speechSynthesis.getVoices()` | none | `boundary` events with `charIndex`, where the platform fires them | not capturable | per span |

Notes that change the design:

- **OpenAI.** OpenAI lists `tts-1`, `tts-1-hd`, and `gpt-4o-mini-tts` for shutdown on January 6, 2027. A deployment choosing OpenAI speech now must plan for the replacement model. The speech assignment stores the model name, so switching is a setting change, but it invalidates cached audio because the model is part of the utterance key. OpenAI speech returns no timings; pair it with a timing assignment for word highlight. Request `opus` or `aac` directly to skip conversion.
- **ElevenLabs.** The `with-timestamps` route returns JSON with base64 audio and `alignment.characters` plus start and end times per character. The browser sums characters into words. Audio tags are present in the input but not spoken; their characters are removed before mapping. SSML emotion is not supported; tags are.
- **Azure.** Styles depend on the voice; the voices list returns a `StyleList` per voice, and the settings screen only offers emotions that map to a listed style. The REST route returns audio only. The proxy may use the Speech SDK to collect `WordBoundary` events; if it does not, Azure segments need the timing assignment. The REST route requires a `User-Agent` header, which the proxy sets.
- **Google Cloud TTS.** Word timings come from marks the proxy inserts before each word id. Mark times are word starts; each word ends where the next starts. Not every voice family supports SSML marks; the probe synthesizes a sample and reports whether timepoints came back.
- **Gemini TTS.** The response is raw audio that the proxy must convert before returning. Direction is plain language ("say this in a somber, quiet voice"), so each clause's emotion becomes a short style prefix on its part.
- **Kokoro.** The captioned route returns word timestamps. Kokoro's text normalization may expand "1984" into words or change spelling, so the browser maps Kokoro's words to transcript words with the same aligner used for recognized words. `normalization_options.normalize: false` keeps words closer to 1:1 but can mispronounce numbers. The proposal: keep normalization on and align. Kokoro has preset voices only. It does not clone.
- **Pocket TTS.** The service in `services/pocket` loads `english_18m_refl_2026-10` when its process starts (`POCKET_LANGUAGE`). It uses ROCm PyTorch `2.14.0+rocm10.1.0` with gfx1012 kernels on the RX 5500M when that card has at least 1 GB free, and stays on the CPU otherwise. A request does not switch the model. `POST /tts` matches Pocket's form: `text`, and either `voice_wav` or `voice_url`. The proxy sends the browser sample as `voice_wav` when one is stored, and otherwise sends `voice_url` only when the voice field is a builtin name (`alba` and the same shape). A sample wins if both are present. The service refuses a `voice_url` that contains a URL, so it does not download a voice. No sample and an empty voice use the process default. The response is `audio/wav` with no word times, so highlight uses the per-word estimate. The reader does not send a whole page in one request. It sends clips split on full stops, packed up to the pace selected in the player, and still prepares the open page plus the next 2 or 3 pages. A sentence longer than the pace stays one clip. A page without a full stop is still cut at that pace, because that page would otherwise be one chunk and run to Pocket's length cap. Leaving the page closes that request. Pocket stops the generation on the next step instead of finishing the clip. **Remove sample** deletes the stored reference from the browser, and later requests use the voice id. The weights stay gated: the first launch needs a Hugging Face token. Pocket has no emotion channel.
- **Voice cloning on 8GB.** Checked 25 October 2026. The large cloners (Qwen3-TTS 1.7B, Fish Audio S2) are the wrong size: the 1.7B model was measured at a 7.3GB peak on an 8GB card, which leaves no room for the text model. The choice is Kyutai Pocket TTS `english_18m_refl_2026-10`, released 20 October 2026. It is 18.2M parameters including the decoder, English, and trained on public audiobook speech. Kyutai's LibriSpeech test-clean numbers are 0.82% word error, UTMOS 4.40, and speaker similarity 0.917, at 9.9× realtime on one CPU thread. A wav file is the voice (`--voice`). The code is MIT. The weights are CC-BY-4.0 and gated, so a Hugging Face login is required to download them. A clean sample matters, because the model copies noise in the clip. It has no word timings. The 6.9M reward-tuned sibling is the smaller fallback (12.6×, UTMOS 4.40, similarity 0.913). Chatterbox Nano (110M, MIT, July 2026) is the GPU alternative if paralinguistic tags are wanted later; Resemble's "3× realtime on 8 CPU cores" was not reproduced on a 6-core laptop on 16 October 2026 (1.93 seconds of compute per second of audio). The proxy forwards Pocket speech to port 7508, inside the 7500–7510 range this container publishes, and sends the sample as `voice_wav`.
- **Browser voice.** Not a profile. It is what an empty `speech` assignment means.

## 7. Timing vendors

Used by `/v1/align` when the speech response has no timings.

| Vendor | Request | Word timestamps | Notes |
| --- | --- | --- | --- |
| `openai` | `POST {baseUrl}/audio/transcriptions`, `model=whisper-1` | `response_format=verbose_json` with `timestamp_granularities[]=word` | Newer transcription models do not return word timestamps; use `whisper-1`. 25 MB upload limit |
| `groq` | `POST https://api.groq.com/openai/v1/audio/transcriptions`, Whisper large v3 models | same parameters as OpenAI | Fast and cheap enough to run on every segment |
| `whisper-cpp` | whisper.cpp server `POST {baseUrl}/inference` | `response_format=verbose_json`; word times from token timestamps | Runs on the same LAN host as other local models |
| `openai-compatible` | `POST {baseUrl}/audio/transcriptions` | if the host supports `timestamp_granularities[]=word` | e.g. faster-whisper servers; the probe checks for word times |

The browser sends the utterance's transcript text as `prompt` (trimmed to the vendor's prompt limit) so recognition favors the book's names and spellings. Recognized words are aligned to the transcript, not trusted as text.

## 8. Emotion mapping

The transcript has one of eight emotions per clause. The speech adapter maps them. `intensity` is the reader's **Emotional intensity** setting.

| Emotion | OpenAI `instructions` (request) | Azure style (clause) | ElevenLabs tag (clause) | Gemini direction (clause) |
| --- | --- | --- | --- | --- |
| `neutral` | "Read in a clear, even narrator voice." | none | none | none |
| `calm` | "...calm and unhurried." | `calm` | `[calm]` | "calmly" |
| `warm` | "...warm and gentle." | `friendly` | `[warmly]` | "warmly" |
| `tense` | "...tense, with urgency." | `serious` | `[nervous]` | "with tension" |
| `somber` | "...somber and subdued." | `sad` | `[sad]` | "in a somber voice" |
| `excited` | "...excited and bright." | `excited` | `[excited]` | "excitedly" |
| `whispered` | "...as a whisper." | `whispering` | `[whispers]` | "in a whisper" |
| `angry` | "...with controlled anger." | `angry` | `[angry]` | "angrily" |

- `intensity: off` sends no emotion direction and treats every clause as `neutral`.
- `intensity: subtle` adds "slightly" to instructions and directions, and sets Azure `styledegree` to 0.6. `full` uses 1.3. ElevenLabs tags are omitted for `subtle` except `whispered`.
- An Azure voice that lacks the mapped style speaks that clause without `express-as`.
- For request-granularity engines (OpenAI), `DESIGN.md` explains when utterances split on emotion changes.
- Engines with no emotion control ignore the field. Kokoro and Pocket TTS are in that group: the proxy does not send instructions or tags to them. Punctuation and `pause_after_ms` (compiled to SSML `<break>` where SSML is accepted, or to punctuation otherwise) still shape delivery.
- ElevenLabs tags and Gemini directions are prompts to the model, not guaranteed controls. The listening test in `DESIGN.md` acceptance covers whether they are worth enabling by default.

## 9. Probe, model lists, and voice preview

`POST /v1/probe` runs a short check for one assignment and returns what the settings screen needs to guide the reader.

| `kind` | What the proxy does | Returns |
| --- | --- | --- |
| `text` | Lists models (`GET /models`, Ollama `GET /api/tags` and `POST /api/show`, Anthropic `GET /v1/models`, Gemini `GET /models`). Sends one tiny structured request with the chosen `structuredOutput` | `ok`, models, context length when known, whether structured output worked, latency |
| `speech` | Lists voices. Synthesizes one short sentence | `ok`, voices, the sample audio, timing unit returned (`word`, `char`, none), seconds of audio per second of wall time |
| `timing` | Transcribes a bundled two-second clip | `ok`, whether word timestamps came back |

The settings screen uses the result:

- A model dropdown instead of a free-text field when the host lists models.
- **Test voice** plays the sample.
- If speech throughput is below 1.0, the screen warns that playback will wait at 1× and suggests Prepare ahead.
- If the speech engine returns no timings and no timing assignment exists, it says "Highlight will follow sentences, not words" and offers to add one.
- If structured output failed, it switches `structuredOutput` to the next mode down and probes again.

Probe sends no book text and writes nothing in the book.

## 10. Open-book providers

Checked from this machine on 26 October 2026. Designed, not built. The product side is [Open books](https://github.com/manishsharma004/open-book-reader/blob/main/specs/discussion/DESIGN.md#611-open-books). The screen is in `UX.md`.

A provider is an extension of the proxy and of the browse screen. The screen and the routes do not branch on which catalog they are talking to. They call the same three operations, and they render the same book fields. A new legal source is a new module and one line in the registry. It is not a new route, a new card, or a new way into the library.

### 10.1 The interface

Each provider is one module under `apps/server/open_book/open_books/`. The registry is a tuple in that package. Registration is appending an instance. The web app does not import these modules.

Every module exposes the same fields and methods:

| Member | Meaning |
| --- | --- |
| `id` | Stable token used in the route. Lowercase, no spaces |
| `name` | The chip label |
| `search` | `true` when a query is sent to the catalog. `false` when the module only has a fixed list, such as new releases. The search box does not apply |
| `languages` | Language codes the module can filter on. Empty means it does not filter |
| `note` | One short line on the chip when the reader needs it. Empty when there is nothing to say |
| `hosts` | The only hosts this module may contact. Written in the module, not in settings and not in the response |
| `search(q, language, page)` | Books, and an opaque next-page token when the catalog has another page. `page` is that token, or empty for the first page. It is never a URL |
| `file(id, mediaType)` | Bytes, media type, and filename for one format of one book |
| `cover(id)` | Image bytes and media type, or nothing when the catalog has no cover |

`search` returns only books the source marks as public domain or under a license that lets the reader keep a copy. The route checks again and drops anything else, including a book with no license. The two values the browser may see are `public-domain` and `open-license`. An open license the card can name is CC0, CC BY, CC BY-SA, or a license the source states in the same terms. Borrow-only, lending, print-disabled, freemium, patron-only, and unknown are dropped inside the module.

A book object has provider, id, title, authors, languages, year, `license`, a short license note, and formats. Each format is a media type, a label, and `addable`. There is no URL field. `application/pdf` and `text/plain` are addable. A charset on text is normalized to `text/plain`. `application/epub+zip` is listed with `addable: false`. Any other media type is omitted.

`file` is called only for an addable type the search result listed. The bytes go back to the browser, which hashes them and stores them the same way as a file from disk. The provider does not paginate text. The browser does, as [Open books](https://github.com/manishsharma004/open-book-reader/blob/main/specs/discussion/DESIGN.md#611-open-books) describes.

### 10.2 Routes

These routes take no profile and no API key. The server stores nothing: not the query, not the page, not the file.

| Route | Request | Response |
| --- | --- | --- |
| `GET /v1/open-books/providers` | none | The registry: id, name, `search`, languages, note. No hosts |
| `GET /v1/open-books/{provider}` | `q`, `language`, `page` | `{ "books": [...], "page": "<next token or null>" }`. A provider with `search: false` ignores `q` and returns its fixed list |
| `POST /v1/open-books/{provider}/{id}` | `{ "mediaType": "text/plain" }` | The file bytes, `Content-Type` set to that media type, `Content-Disposition` carrying the filename |
| `GET /v1/open-books/{provider}/{id}/cover` | none | The image, or 404 when `cover` returned nothing |

An unknown provider id is 404. A media type that is not addable for that book is 404. The log line is method, route, provider id, status, and duration. It does not include `q`, the book id's query, or the source URL.

The fetch uses the provider's `hosts` and nothing else. It follows a redirect only when the next host is on that list, and at most three times. Speech, completion, align, and probe still do not follow redirects. A response larger than 40 MB is dropped. The exchange times out at 60 seconds. The browse screen asks for one page at a time. It does not walk a catalog.

One provider speaks HTTP because its catalog host does not answer on HTTPS: `aozora.textlive.net`. No other provider may use HTTP. The proxy sets one User-Agent that names this app. It does not send the reader's keys, cookie, or book text.

### 10.3 Registered providers

Each row answered from this machine on 26 October 2026. A third-party catalog list was only a lead (checked by its author on 24 August 2026). A feed that did not answer is not in this table.

| `id` | Catalog contacted | What it gives | `search` | Hosts the module may use |
| --- | --- | --- | --- | --- |
| `gutenberg` | `https://www.gutenberg.org/ebooks/search.opds/` returned Atom XML. A language filter is `query=l.{code}` | Project Gutenberg, US public domain. Their offline-catalogs page says the XML OPDS feed is expected to sunset in 2027, and the OPDS2 JSON feed is testing-only. Until then this module uses the Atom feed that answered | yes | `www.gutenberg.org` |
| `openlibrary` | `https://openlibrary.org/search.json` with `ebook_access=public` returned JSON | Open Library records that are public-domain ebooks. The module always sends `ebook_access=public`. Borrowable, print-disabled, and controlled digital lending are dropped. The file host is `archive.org` for those public items only | yes | `openlibrary.org`, `archive.org` |
| `standardebooks` | `https://standardebooks.org/feeds/atom/new-releases` returned Atom with enclosure links. `https://standardebooks.org/feeds/opds` returned 401 | Standard Ebooks, public domain on the website. The full catalog feed is for patrons. This module uses the public new-releases feed and does not read HTML pages | no. The note is "New releases" | `standardebooks.org` |
| `ebooksgratuits` | `https://www.ebooksgratuits.com/opds/` returned XML | French public-domain classics | yes | `www.ebooksgratuits.com` |
| `wolnelektury` | `https://wolnelektury.pl/opds/` returned Atom | Polish free texts | yes | `wolnelektury.pl` |
| `textos` | `https://textos.info/opds` returned XML | Spanish public domain | yes | `textos.info` |
| `aozora` | `http://aozora.textlive.net/catalog.opds` returned Atom. HTTPS on that host did not answer | Japanese public domain | yes | `aozora.textlive.net` over HTTP only |
| `imwerden` | `https://imwerden.de/opds/` returned an Atom navigation feed | A book is included only when that entry is marked free to copy | yes | `imwerden.de` |
| `bokselskap` | `https://www.bokselskap.no/wp-content/themes/bokselskap/tekster/opds/root.xml` returned XML | Norwegian public-domain editions | yes | `www.bokselskap.no` |
| `cbeta` | `https://www.cbeta.org/opds` returned XML | Chinese Buddhist canon, free to copy. Acquisition links in the feed may contain `&amp;`. The module decodes that before it fetches, or the download is empty | yes | `www.cbeta.org` |
| `openedition` | `https://opds.openedition.org/` returned XML | Open-access books. Freemium entries are dropped. A file host is added to this module only after a download from that host succeeds | yes | `opds.openedition.org`, plus file hosts added the same way |
| `wikisource` | `https://en.wikisource.org/w/api.php` search returned JSON | One provider. `language` selects the wiki. The module starts with `en.wikisource.org` and lists each further wiki host it enables. Public domain and free licenses only. The file is that wiki's plain-text export | yes | Each `{lang}.wikisource.org` the module lists |

Gutendex (`gutendex.com`) answered for a known Gutenberg id and timed out on a search. It describes the same Project Gutenberg catalog, so it is not a second provider.

`archive.org` is a file host for `openlibrary` only. The old `bookserver.archive.org` catalog did not answer and is not a provider. Open Library asks callers to send a User-Agent, to cache, and not to harvest the catalog. This server still stores nothing. The screen requests a page when the reader asks for one.

### 10.4 Not registered

These were considered and left out. A later module can register one of the legal rows after a fetch from this app succeeds and the license rule in §10.1 holds. The last two groups are not candidates.

| Source | What happened on 26 October 2026 | Why it is not a provider |
| --- | --- | --- |
| Gallica OPDS `https://gallica.bnf.fr/opds` | 403, including with a browser User-Agent | Legal public-domain collection. Register it only after a fetch succeeds |
| Faded Page search | Timed out at 15 seconds | No answer to register against |
| Feedbooks public domain (Cantook) | Empty feed | Nothing to list |
| ManyBooks | 403 from Cloudflare | No answer to register against |
| OAPEN OPDS | Empty or 500 | Nothing to list |
| Hungarian MEK OPDS | Navigation feed with no book entries | Nothing to list |
| Internet Archive bookserver | `bookserver.archive.org` did not answer | Dead catalog. Public files still arrive through `openlibrary` |
| O'Reilly Japan, Gihyo, Tatsu-zine | Not probed as free libraries | Publisher catalogs, not books the source gives away |
| Gutenberg Australia and similar sites | Not used | A book that is public domain in one country can still be under copyright elsewhere. This reader does not offer that set |
| Libgen, Z-Library, Anna's Archive, PDF Drive | Not contacted | Not legal sources. Never a provider |
| Chitanka and similar scan libraries | Not contacted | Translation copyright is not clear. Out unless a feed marks a free license on the entry |

### 10.5 Adding a provider

1. Add a module that implements §10.1, with its hosts written in that file.
2. Append it to the registry tuple.
3. Confirm a search and a file fetch against the live catalog, and confirm a book that is not public domain or open-license is absent from the response.
4. Leave the browse screen, the routes, and the upload path as they are.

A provider that needs a new response field, a new button, or its own screen is the wrong shape. Change the shared book fields first, for every provider, or do not add it.
