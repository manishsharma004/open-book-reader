# Open Book Reader — design review

Status: review of the design as of commit `e324cd6` ("Store vendor connection settings in the browser"). Every finding below has been applied to [`DESIGN.md`](https://github.com/manishsharma004/open-book-reader/blob/main/specs/discussion/DESIGN.md), [`PROVIDERS.md`](https://github.com/manishsharma004/open-book-reader/blob/main/specs/discussion/PROVIDERS.md), or [`UX.md`](https://github.com/manishsharma004/open-book-reader/blob/main/specs/discussion/UX.md) unless it is listed under [Kept as is](#6-kept-as-is). New findings are appended to this file when the design changes.

The review asked five questions:

| Lens | Question |
| --- | --- |
| Operability | Can a reader actually run and use the product as intended? |
| Feasibility | Is the design grounded in what browsers, vendors, and models really do? |
| Usability | Is it intuitive and useful? |
| Feature completion | Can a reader use the product end to end with the complete design? |
| UX improvements | Smaller improvements to the experience |

Severity: **High** means the product would not work for many readers, or a stated behavior is impossible. **Medium** means a real gap or a common failure. **Low** means polish.

Summary of the most important changes:

1. The app and the proxy are served from one origin by default. A hosted HTTPS app calling a LAN proxy at `http://192.168.x.x` is blocked by mixed-content rules, and Chromium also asks permission before a public site reaches a private address.
2. Ollama is called on its native API so the context window can be set. Its OpenAI-compatible route uses the 4k default on most consumer GPUs and silently truncates.
3. The model no longer produces word ids. The browser derives them, and transcripts are requested per utterance instead of per sentence: about 2,000 calls for a novel instead of about 6,500.
4. The product works at three levels (no models, speech only, text and speech) instead of requiring every vendor, and tasks can be **blocked** on the reader with a clear action.
5. Audio is stored compressed (about 155 MB per novel instead of about 1.9 GB as WAV), with storage management, persistence, and book export, because the browser is the only copy.
6. Timings now match how vendors behave: engine word timings, engine character timings, or recognized words aligned in the browser. Most speech-to-text APIs return recognized words, not a forced alignment to given text.

## 1. Operability

| ID | Sev. | Finding | Resolution | Where |
| --- | --- | --- | --- | --- |
| O1 | High | `proxyBaseUrl` could point a hosted HTTPS app at `http://127.0.0.1` or a LAN host. Mixed-content blocking stops HTTPS pages calling LAN `http://` addresses, and Chromium's Local Network Access prompts before public pages reach loopback or private addresses. Many readers would get an opaque network error | Deployment mode A, the app and proxy on one origin, is the default. `proxyBaseUrl: null` means same origin. Modes B and C are documented with their browser requirements | `PROVIDERS.md` §2 |
| O2 | High | The app opened as `http://192.168.1.40:8787` from a phone is not a secure context. Service workers, Web Locks, `crypto.subtle`, and `speechSynthesis` are unavailable there. Calling `speechSynthesis.cancel()` while opening a book replaced the reader with a 500 page | Open from `localhost` or HTTPS when those APIs are needed. Adding a book does not depend on them: SHA-256 and ids have a fallback. Opening a book does not call a missing speech engine, so the reader paints. Play on that page says the browser voice is unavailable | `DESIGN.md` §1.1, §6.1, §7.7 |
| O3 | High | With no text model, it was unclear whether a book could reach Ready, and the pipeline had no state for "waiting on the reader". It would either stall or fail | Task status `blocked` with reasons (`needs-password`, `needs-text-profile`, `needs-speech-profile`, `quota`) and `skipped` by explicit reader choice. Chapters never block on a model. **Continue without a model** is always offered | `DESIGN.md` §5.3, §6.3, §6.4 |
| O4 | High | An empty speech or align assignment fell back to the completion profile. Text vendors mostly have no speech route, so this produced vendor errors at play time | No fallback between assignments. Empty speech means the browser voice. Empty timing means sentence highlight | `PROVIDERS.md` §1.1 |
| O5 | High | Safari deletes a site's IndexedDB after 7 days of use without visiting the site, unless the app is installed to the Home Screen. A Safari reader could lose the library | Install prompt on Safari before long processing, export reminders, persistence request and status | `DESIGN.md` §5.5, `UX.md` §3.2, §5 |
| O6 | Medium | Mobile browsers suspend background pages, so processing stops when the phone screen turns off. The design implied processing just continues | Processing screen asks to stay in front, holds a Screen Wake Lock, and suggests processing scanned books on a computer, then exporting | `DESIGN.md` §5.3, `UX.md` §3.4, §7 |
| O7 | Medium | Proxy errors had no shape. The browser could not tell a bad key from an unreachable host or a rate limit | One error envelope with `source` (`proxy`, `network`, `vendor`, `format`), status, retry hint. Behavior per source | `PROVIDERS.md` §3.3 |
| O8 | Medium | A proxy bound to the LAN with no token is an open relay for the reader's keys and a way to reach internal hosts. DNS rebinding was not considered | Loopback bind by default, token required otherwise, Origin and Host checks, metadata addresses always blocked, no redirects, no body logging. Forwarding is not an open list: completion goes to Ollama, speech goes to the speech hosts, and any extra machine is one explicit host:port | `PROVIDERS.md` §4 |
| O14 | High | The implemented proxy accepted any http or https base URL and posted to it. A caller who could reach the app server could make it open connections to other machines on the local network, including link-local metadata addresses | `POST /v1/complete` forwards only to Ollama on this machine at port 11434, an LLM on port 5173 at `127.0.0.1`, `localhost`, or `127.0.0.1`, `https://ollama.com`, or `OLLAMA_ALLOW`. `POST /v1/speak` and `POST /v1/voices/clone` forward only to Kokoro on port 8880 or Pocket TTS on port 8000 at `127.0.0.1`, `localhost`, or `127.0.0.1`, `https://api.openai.com`, `https://api.elevenlabs.io`, or `SPEECH_ALLOW`. The check happens before a socket is opened. Link-local and metadata addresses stay refused when listed. The base URL cannot carry a path other than `/v1`, a query, a fragment, or userinfo | `PROVIDERS.md` §4 |
| O9 | Medium | A missing key or model was discovered only when a call failed mid-pipeline | Assignments are validated before calls. **Test** probes each assignment and lists models and voices | `PROVIDERS.md` §1.4, §9 |
| O10 | Medium | Settings export always contained API keys, so sharing a configuration meant sharing credentials | Keys left out unless **Include API keys** is ticked. Imported profiles without keys show **Needs key** | `PROVIDERS.md` §1.5 |
| O11 | Medium | Quota exceeded was handled, but there was no way for the reader to see or manage storage | Storage bar in the library, per-book usage, remove prepared audio, keep-audio limit | `UX.md` §3.2, §3.9 |
| O12 | Low | No way to check the server version or whether audio conversion works | `GET /v1/health`, shown in Settings → About | `DESIGN.md` §4.3, `PROVIDERS.md` §3.2 |
| O13 | Low | Concurrency against local hosts was unbounded. Ollama serves one request at a time by default | At most two realtime and four batch calls per assignment | `PROVIDERS.md` §3.4 |

## 2. Feasibility

| ID | Sev. | Finding | Resolution | Where |
| --- | --- | --- | --- | --- |
| F1 | High | Ollama was configured on its OpenAI-compatible `/v1` route. Ollama defaults to a 4,096-token context below 24 GiB VRAM, and that route cannot set `num_ctx` per request, so prompts were silently truncated | Native `POST /api/chat` with `options.num_ctx` from `contextTokens` and `format` as a JSON schema. `baseUrl` is the server origin. The probe reads the model's context length | `PROVIDERS.md` §5 |
| F2 | High | The transcript schema had the model return `source_word_ids`. Small models frequently corrupt ids, and the browser already knows the mapping | The model returns clauses only. The browser derives word ids by matching content words in order | `DESIGN.md` §7.3 |
| F3 | High | The SSML example used `<prosody emotion="...">`. `prosody` has no `emotion` attribute in SSML, and each engine expresses emotion differently, if at all | Per-engine emotion mapping: OpenAI `instructions` per request, Azure `mstts:express-as` per sentence, ElevenLabs audio tags, Gemini direction text, none for Kokoro and Google | `DESIGN.md` §7.4, `PROVIDERS.md` §8 |
| F4 | High | `/v1/align` took audio plus transcript and returned word timings. Hosted speech-to-text APIs return recognized words with times, not a forced alignment to supplied text | Align returns recognized words. The browser aligns them to transcript words with an edit-distance alignment and interpolates gaps. Timing sources are ordered: engine words, engine characters, recognized words, coarse | `DESIGN.md` §7.4, `PROVIDERS.md` §7 |
| F5 | High | A transcript call per span (sentence) is about 6,500 calls for a 400-page novel, each with repeated context | One transcript call per utterance (several spans): about 2,000 | `DESIGN.md` §3, §7.2, §13 |
| F6 | High | Storing engine output as WAV would be about 1.9 GB for a 10.8-hour book at 24 kHz 16-bit | Opus or AAC at about 32 kbps, about 155 MB. The proxy requests a compressed format or converts with ffmpeg | `DESIGN.md` §5.2 |
| F7 | Medium | Lookahead was "current segment plus two". At 2× speed or with a slow local voice that can be under 30 seconds of buffer | Lookahead is at least 90 seconds at the current rate. The browser measures throughput and warns when the voice is slower than playback | `DESIGN.md` §7.2 |
| F8 | Medium | Spans stored a chapter id, but spans are built before chapters exist, and chapter edits would rewrite spans | Chapters are ranges over span order. Spans are immutable in a version | `DESIGN.md` §5.1, §6.3 |
| F9 | Medium | Chapter edits created a new book version, dropping every cached transcript and audio | Chapter edits bump a chapters revision. Only utterances touching a changed boundary are dropped | `DESIGN.md` §6, §6.3 |
| F10 | Medium | The version state machine had `Ready → Reading`. Playback is per session, and two tabs or a reprocess made this state ambiguous | Playback is session state. A version stays Ready | `DESIGN.md` §6 |
| F11 | Medium | PDF.js returns text items (runs), not words. Word boxes were assumed | Split items with `Intl.Segmenter`, apportion boxes by measured substring widths | `DESIGN.md` §6.2 |
| F12 | Medium | Metadata as one call over the book does not fit small context windows | Map-reduce sized by `contextTokens`; bibliographic fields from front matter only | `DESIGN.md` §6.4 |
| F13 | Medium | Speech vendors have hard input limits (OpenAI 4,096 characters, Google 5,000 bytes, Gemini 8,192 tokens) | Utterances respect `maxInputChars` | `DESIGN.md` §7.2, `PROVIDERS.md` §6 |
| F14 | Medium | OpenAI lists `tts-1`, `tts-1-hd`, and `gpt-4o-mini-tts` for shutdown on January 6, 2027 | Speech model is a setting and is part of the utterance key. The default engine is Kokoro, not OpenAI speech | `PROVIDERS.md` §6, `DESIGN.md` §12 |
| F15 | Medium | Anthropic API version `2026-10-21` sends the key as `Authorization: Bearer` and rejects `temperature`, `top_p`, and `top_k` | Adapter sends Bearer by default and omits sampling parameters | `PROVIDERS.md` §1.2, §5 |
| F16 | Medium | Structured output differs per vendor; some have none (DeepSeek `json_object`, Ollama cloud) | `structuredOutput` per assignment, chosen by the probe; the browser always validates | `PROVIDERS.md` §5 |
| F17 | Medium | Web Speech `boundary` events are not fired by some voices and platforms (Chrome on Linux and Android, Google network voices), and its audio cannot be recorded | The browser voice still highlights one word. Duration comes from word length, punctuation, and rate, and a boundary snaps the clock when one arrives. Pause keeps the word. Play speaks from it. Audio is still not stored | `DESIGN.md` §7.7 |
| F18 | Low | Kokoro normalizes text (numbers, abbreviations), so its word timestamps do not map 1:1 to printed words | Kokoro timings go through the same aligner | `PROVIDERS.md` §6 |
| F19 | Low | Embeddings assumed an English model | Multilingual model when the detected language is not English; model id stored per vector | `DESIGN.md` §5.4 |
| F20 | Low | Speed range 0.8–1.6 is narrower than audiobook listeners use | 0.5–3.0 with `preservesPitch` | `DESIGN.md` §7.5 |

## 3. Usability

| ID | Sev. | Finding | Resolution | Where |
| --- | --- | --- | --- | --- |
| U1 | High | First run dropped the reader into a settings JSON with no path to a working setup | First-run screen with local, hosted, or skip; **Test** with model list and voice sample; bundled sample book | `UX.md` §3.1 |
| U2 | High | Configuring OpenAI for text, speech, and timing meant three profiles with the same key | Profiles are connections; assignments pick a profile and model per job | `PROVIDERS.md` §1.1 |
| U3 | Medium | Progress was task counts only, with no time estimate | Stage counts and time left from measured rate | `UX.md` §3.4 |
| U4 | Medium | The page always turned to the spoken word, even while the reader was looking at another page | Follow along with **Back to reading position**; manual navigation pauses it | `DESIGN.md` §7.5, `UX.md` §3.6 |
| U5 | Medium | Model costs were invisible | Character and token estimates before preparing a chapter or the whole book; usage returned by the proxy | `DESIGN.md` §13, `UX.md` §3.5 |
| U6 | Medium | Error states had no wording or actions | States and microcopy table, each with actions | `UX.md` §5 |
| U7 | Medium | Metadata looked authoritative even when inferred | **Found in the book** and **Inferred** badges, editable fields marked `reader` | `DESIGN.md` §6.4, `UX.md` §3.5 |
| U8 | Medium | Uncertain chapter breaks were warnings with nowhere to fix them | Chapter review screen: move, merge, split, rename, front and back matter, with undo | `UX.md` §3.7 |
| U9 | Low | When play waited, the reader was not told why or offered anything | **Preparing** with reason; after a delay, offer the preview voice or plain reading | `DESIGN.md` §7.2, `UX.md` §5 |
| U10 | Low | A long book could only be reached by stepping or dragging the page slider | **Go to page** accepts a page number, clamps it to the book, and opens that page. `G` focuses the field | `UX.md` §3.6, §4 |
| U11 | Low | The page slider did not say which page it was on, and the page could not be turned with a swipe | The slider shows the current page and the total. A horizontal swipe slides the page off and brings the next one in. Reduced motion skips the slide | `UX.md` §3.6, §4, §6 |
| U12 | Medium | Voice cloning was specified as an ElevenLabs voice id. That host is not in use, and an 8GB GPU cannot hold a text model and a 1.7B clone model | Kokoro stays the preset voice. The clone is Kyutai Pocket TTS `english_18m_refl_2026-10` on one CPU thread. The sample stays in the browser and the proxy sends it as `voice_wav` to Pocket on port 8000. A builtin name is `voice_url`. The service does not fetch a voice URL | `DESIGN.md` §12, §14, `PROVIDERS.md` §6 |

## 4. Feature completion

| ID | Sev. | Missing | Added | Where |
| --- | --- | --- | --- | --- |
| C1 | High | Library: list, open, delete, duplicate detection | Library screen; SHA-256 duplicate check on add | `DESIGN.md` §2, `UX.md` §3.2 |
| C2 | High | Backup and moving a book. The browser is the only copy | Book export and import as a zip; library export | `DESIGN.md` §8, `UX.md` §3.9 |
| C3 | High | Listening with no speech vendor | Level 0 browser voice | `DESIGN.md` §1.1, §7.7 |
| C4 | Medium | Password-protected and DRM PDFs | `needs-password` with remember option; DRM is out of scope with a clear message | `DESIGN.md` §6.1, §9 |
| C5 | Medium | Books not in English | OCR language at upload, `Intl.Segmenter`, multilingual embeddings, voice language, `lang` on the text view | `DESIGN.md` §5.4, §6.2, `UX.md` §6 |
| C6 | Medium | Fixing mispronounced names | Per-book lexicon, model suggestions, applied after validation | `DESIGN.md` §5.1, §7.3, `UX.md` §3.8 |
| C7 | Medium | Offline listening and preparing ahead | **Prepare** next 30 min, chapter, or book; service worker app shell | `DESIGN.md` §7.2, `UX.md` §3.5 |
| C8 | Medium | Lock-screen and headphone controls | Media Session metadata and actions | `DESIGN.md` §7.5, `UX.md` §4 |
| C9 | Medium | Accessible reading surface | Text view, keyboard shortcuts, live region, reduced motion | `UX.md` §3.6, §6 |
| C10 | Low | Bookmarks, sleep timer, search | Added to the player | `DESIGN.md` §5.1, `UX.md` §3.6 |
| C11 | Low | Scanned pages that OCR cannot read | Opt-in vision retry when the text model supports images; otherwise a marker in playback | `DESIGN.md` §6.2 |

## 5. UX improvements

| ID | Improvement | Where |
| --- | --- | --- |
| X1 | Warm start: prepare the first minute at the resume position as soon as the book is Ready, so the first Play is immediate | `DESIGN.md` §6.5 |
| X2 | Word fill plus sentence underline, so the highlight is not color-only and the eye can track the sentence | `DESIGN.md` §7.5, `UX.md` §3.6 |
| X3 | Scrubber shades prepared ranges, so the reader knows where seeking is instant | `UX.md` §3.6 |
| X4 | Keyboard shortcuts compatible with common media players (`Space`, `J`, `K`, `L`) | `UX.md` §4 |
| X5 | Emotional intensity Off, Subtle, Full | `DESIGN.md` §11, `UX.md` §3.9 |
| X6 | Recap on resume after a long break, read from chapter summaries | `UX.md` §3.5 |
| X7 | **Similar passages** search using the local embeddings | `UX.md` §3.6 |
| X8 | Context menu on a word: play from here, fix pronunciation, bookmark, copy | `UX.md` §3.6 |
| X9 | Sleep timer that ends at a chapter boundary and fades out | `UX.md` §3.6 |
| X10 | Mobile bottom bar, bottom sheets, 44 px touch targets, double-tap for text view | `UX.md` §7 |

## 6. Kept as is

| Item | Why it stays | Where |
| --- | --- | --- |
| Whole-book Ready gate before play | It is the original request, and it is now a decision. Playing chapter 1 while later chapters process would start listening sooner | `DESIGN.md` §6.5, §14 |
| PDF first, EPUB later | Fixed pages make stable highlight positions. EPUB needs a pagination step | `DESIGN.md` §6.1 |
| No server-side cache | A cache keyed by text would make the server hold book content. The browser cache already dedupes | `DESIGN.md` §4.2 |
| API keys in IndexedDB in plain form | Encrypting with a key stored next to it adds nothing. A passphrase lock is possible later; the defense now is a strict CSP and no third-party scripts | `DESIGN.md` §10 |
| No streaming responses | Utterances are short, and whole responses keep the proxy simple. Streaming speech is a later optimization for time to first audio | `PROVIDERS.md` §3.4 |

## 7. To prove with a prototype

These are feasible on paper and need measurement before implementation is planned around them.

| Risk | Test |
| --- | --- |
| Word boxes from apportioned PDF.js items are accurate enough to highlight | Overlay boxes on 20 pages from varied PDFs; count visibly misplaced words |
| Local realtime throughput | Measure seconds of audio per second with a local 8B model plus Kokoro on a consumer GPU and on CPU |
| Lock-screen segment chaining on iOS and Android | Play 30 minutes with the screen locked using two elements, then MSE |
| Transcript rejection rate with small models | Run 200 utterances through 3 local models; count spans that fall back |
| Alignment quality from recognized words | Compare against Kokoro or Google word timings on the same audio |
| Emotion control is audible and not distracting | Blind listening test, Off versus Subtle versus Full |
| Storage on iOS Home Screen apps | Store 500 MB of audio, close for a week, check it is still there |

## 8. Decisions on the open questions

The questions in the earlier `DESIGN.md` §14 are decided in the current §14. Short form:

| ID | Decision |
| --- | --- |
| D1 | PDF only until EPUB has a pagination step |
| D2 | Whole-book Ready gate stays |
| D3 | Chapter headings spoken once; **Speak headings** defaults on |
| D4 | One word is highlighted while the voice runs. Timings win; otherwise a per-word estimate is used, and pause resumes from that word |
| D5 | One voice at a time. Kokoro is the preset voice. A clone on an 8GB machine is Pocket TTS `english_18m_refl_2026-10` on the CPU. The proxy sends the sample as `voice_wav` to port 8000. ElevenLabs is not the cloning path. `speaker` does not select a voice |
| D6 | 200 MB of prepared audio per book; keep the previous, current, and next chapter under pressure |
| D7 | Chapter review is after Ready and does not block play |
| D8 | Tables are not spoken; the player shows **Table, not read** |
| D9 | Vision retry is off until the reader opts in per book |
| D10 | Kokoro is the default speech engine. Hosted alternatives with timings are Google Cloud TTS and ElevenLabs |
| D11 | Kokoro runs as its own compose service. It is not baked into the app image, and no text model is bundled |

## 9. Stack

The UI stack was unnamed. It is now decided, in `DESIGN.md` §12 and §12.1.

| ID | Decision |
| --- | --- |
| S1 | The interface is Svelte 5 and SvelteKit with `adapter-static`. FastAPI serves the build and remains the only server |
| S2 | Components are Tailwind CSS 4 and shadcn-svelte, copied into the app. The PDF highlight overlay is custom |
| S3 | Ink is the default palette: cool paper and ink blue by day, blue-black at night. Lamp stays available. Literata for reading, Source Sans 3 for the chrome |

## 10. Reader pass

Checked against the running reader on 25 October 2026.

| ID | Sev. | Finding | Resolution | Where |
| --- | --- | --- | --- | --- |
| R1 | Medium | The page was scaled to width only and capped, so a tall window left a large empty band under the page | The page is fitted to the free rectangle between the header and the player | `DESIGN.md` §7.8, reader |
| R2 | Medium | Vendor settings were not on screen, and speech had no emotion, voice choice, or sample | Settings has VLLM, emotion analysis, and TTS, including a voice sample and ElevenLabs voice creation. The reader lists voices and emotions | `PROVIDERS.md` §1, `UX.md` §3.9 |
| R3 | Medium | A seek had no buffer, and OCR was refused. Processing was not visible | The reader prepares the current page plus 2 or 3 ahead, shows **Buffering** while the page is prepared, OCRs sparse pages, and keeps a pipeline log | `DESIGN.md` §7.8 |
| R4 | High | Play after Pause started the page again, and the highlight never moved because the browser voice sent no word boundaries | Pause keeps the current word. Play speaks from that word. The highlight advances on an estimated word clock and snaps to a boundary when the engine sends one. Stored audio pauses at `currentTime` | `DESIGN.md` §7.5, §7.7 |
