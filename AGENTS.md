# Agent instructions

## Design changes

When a design decision changes, do all three of these in the same piece of work. Do not stop after the file edit.

1. Update `specs/discussion/DESIGN.md` so it is the current design, including diagrams.
2. Update GitHub issue #1 so the issue body matches that file.
   - Issue: https://github.com/manishsharma004/open-book-reader/issues/1
   - Start the body with a short note that the canonical write-up is `specs/discussion/DESIGN.md` on `main`, and link to `https://github.com/manishsharma004/open-book-reader/blob/main/specs/discussion/DESIGN.md`.
   - After that note, include the full file contents so the issue still has the diagrams and the explanation.
3. Commit and push to the `main` branch. Fast-forward `main`. Do not force-push. If `main` has moved, pull and rebase or merge, then push again.

Push the design file before editing the issue when the issue links at `main`, so the link and the body describe the same text.

Authenticate to GitHub with the token in `$GITHUB_TOKEN_FILE`. Do not print the token, and do not put it in a remote URL.

## Standing architecture

These constraints are already decided in `specs/discussion/DESIGN.md`. Keep them when you edit the design.

- Book data, embeddings, analysis results, audio, playback position, and task state stay in the browser, in IndexedDB. File and audio bytes are Blob values.
- The backend for transcription, analysis, and completion is stateless. It does not store the book.
