# Learnings

From the reader work through 26 October 2026. `DESIGN.md` §1.2 is the behavior. This file is why it is shaped that way, and which fixes failed before the ones that landed.

## Pocket was slow because one page was one request

A 1,593-character page with no sentence punctuation became one Pocket chunk of about 460 tokens. Pocket's own splitter breaks on `.!?` and then `,;:`. With no end mark it never emits EOS. Generation runs to `tokens / 3 + 2` seconds of audio, which on that page was about 155 seconds. The proxy allows 90 seconds. On the GPU the call still took about 89 seconds.

Do not split that on the server. A server-side 45-token cutter was started and removed. The browser builds the clips. Short sentences pack up to the player pace. A sentence longer than the pace stays one clip until twice the pace, and never past 64 words. A run with no full stop is still cut at the pace, or an unpunctuated page is one request again.

The buffer is still the open page plus the next 2 or 3 pages. Capping the buffer at a few dozen words was tried and rejected. The clips are small. The window stays full. The open page is queued first.

## Clip updates have to stay visible to the reader

The prepared page is filled in after the reader stores it. Speech writes `audioUrl` on the clips in that object, then the buffer tick asks the reader to look again. Putting the page in a deep `$state` proxy freezes each clip field at the moment of assignment, so the tick runs and still sees no audio. Playback then waits forever. Leaving the page and coming back assigns the page again, after the URLs exist, which is why that was the only way it started. Play and Pause call the same lookup, so they wait too. The page is `$state.raw`, and the buffer tick is what refreshes it.

## Play starts on the first clip

Waiting for emotion analysis, or for every clip on the page, held the page after the words were already known. The page is returned after the text is read and the clips are queued. Emotion only updates clips that are still pending. The reader calls play from the first word when the page appears. If the browser blocks autoplay, the player says to press Play. That is not a fatal error.

## Leaving the page has to stop the GPU

Clearing the client queue left Pocket generating the old page. The in-flight request has to close too.

Two attempts did not stop it. Polling `request.is_disconnected()` misses a socket that closes after the body has been read. `httpx.Client.close()` from the event-loop thread waits on the pool lock the request thread already holds. What works is a small HTTP core backend that records the raw socket, then `shutdown(SHUT_RDWR)` when `request.receive()` reports `http.disconnect`. The proxy returns 499. Pocket's `generate_audio_stream` checks a stop event on each autoregressive step and drops the partial audio. An 80-word clip that had already started then stopped in under half a second, and the next page's clip could run.

Only the Pocket path does this. OpenAI, Kokoro, and ElevenLabs are still blocking calls.

## Punctuation has to survive the segmenter

`Intl.Segmenter` with `isWordLike` drops commas, stops, and quotes, so the voice never hears them. Marks stay on the word they belong to. A `closed` flag is required: after `. , ; : ! ?` a following quote belongs to the previous word. Without that flag, `"Hello," she said.` becomes `"Hello,` and `"she`. Opening quotes still stay with the word they introduce. Highlight timing already adds a pause for a trailing stop or comma once the mark is on the word.

## The next clip has to be loaded before the current one ends

One audio element assigns `src` when the clip ends, and that decode is the gap. Two elements are used. The idle one loads the next blob as soon as the URL exists, including the first clip of the next page while the last line of this page plays.

Resume must stay on the element that already has the current clip. Preferring the idle element drops the preloaded next clip. The first `play` cannot require the player reference to be set already, because that reference is chosen inside play. Setting `currentTime` to 0 on a primed element that is already at 0 can stall it, so that seek is skipped.

## A finished page turns itself

The vendor path already started playback after a manual page change. The browser voice did not, so the last line stopped on the same page. When the last line ends, the reader moves to the next page and keeps that as a continued read, including the browser voice. The last page stops. A page with nothing speakable is skipped while that continued read is active.

## Titles are not body text

A chapter title packed into the following sentences is read as prose. A title is a larger short line, a label such as Chapter 3, or a short line of capitals. It is its own clip. A second title line gets a pause before it, and the clip ends with a stop if the page did not print one. The words stay marked on the page.

A short small line in the top or bottom margin, including a page number, is a running header and is not spoken. Body size is the most common line height, so one large drop cap does not make the whole line a title. A sentence that merely starts with the word "Chapter" stays prose.

## Chapter navigation comes from the file, not from a catalog

The open-book search does not return a table of contents, and Gutenberg and Standard Ebooks arrive as plain text, so a PDF outline alone would leave those books with no chapters. The list is built when the file is saved, and again on open if an older book has no `chapters` field. A PDF outline with two or more page destinations wins. Otherwise each page of text is scanned for a chapter, part, or matter line. A short line under a bare "Chapter I" is kept as the title. A line that already ends with a stop is the first sentence, not a subtitle.

A contents page full of dot leaders, and a page with four or more of those labels, is skipped so the menu is not the contents. The same title on later pages is a running header and stays one entry. Roman numerals or short lines of capitals are used only when the book has no "Chapter N" line. One heading is not a menu. The stored record is `{ title, pageIndex }` on the book. Schema version stays 1. The span range, confidence, and review flow in DESIGN §6.3 are still the target.

## A saved sample needs an obvious delete

The sample lives in IndexedDB. A quiet control that only appeared next to the filename was easy to miss, and the file picker still showed the chosen file after the record was cleared. Removal deletes the blob, clears the id and the filename, resets the picker, and bumps the settings revision so clips prepared with that sample are built again. The same action is in Settings and in the player. Later speech uses the voice id.

The weights loaded here are `pocket-tts-without-voice-cloning`. Builtin names work. The sample is still sent as `voice_wav`, and these weights do not clone a speaker from it. The cloning weights are gated and the Hugging Face token is unset.

## The GPU

The RX 5500M is gfx1012. Official ROCm wheels do not include that chip. The venv already has ROCm torch `2.14.0+rocm10.1.0` with those kernels. `services/pocket/requirements.txt` does not pin torch. Installing it on Linux pulls a CUDA wheel and replaces the ROCm one. Do not set `HSA_OVERRIDE_GFX_VERSION`.

Pocket uses the card only when HIP can see it and at least 1 GB is free. Otherwise it stays on the CPU. The CPU path of the ROCm wheel is several times slower than a CPU wheel, which is why an earlier CPU-only run felt stuck. Another process had been holding almost all of the card. Stopping that process, and only that pid, let Pocket load on the GPU. The first utterance warned about a missing MIOpen kernel. Later short lines were about five times realtime.

Pocket must listen on `0.0.0.0:7508`. The published port is on the host. The proxy accepts Pocket at `http://127.0.0.1:7508`. Port 8000 is refused. Choosing Pocket rewrites an allowed Kokoro URL from 8880 to 7508.

## Process and build

The app server serves `apps/web/build` from disk. A web change is live after `npm run build`. Restart uvicorn only after a proxy change, and Pocket only after a Pocket change.

`open_book` logs need their own stream handler with propagation off. Under uvicorn they are otherwise invisible.

`svelte-check` fails on `apps/web/src/hooks.client.ts` because `HandleClientError` is not exported. That failure was already there.

Headless Chrome's `speechSynthesis` often ends with `synthesis-failed`. A UI check of vendor audio can mock `speechSynthesis.speak`, or it can call Pocket. `locator().innerText` is not a function in the puppeteer-core used here.
