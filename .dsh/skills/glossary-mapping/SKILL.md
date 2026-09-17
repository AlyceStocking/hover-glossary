---
name: glossary-mapping
description: Update, extend, or verify the hover-glossary word mapping (the term to 1..N association entries shown when the cursor rests on a word in the conversation). Use this Skill when a term is missing from the hover tooltip, when an existing entry is wrong or ordered incorrectly, when new terms must be added permanently, or when asked whether a mapping change persists across restarts.
---

# Update the hover-glossary mapping

The plugin lives at `hover-glossary/` in this workspace. The mapping is plain data; the
hover engine itself never needs editing to add or change a term.

## What persists and what does not

Read this before promising anything survives a restart.

| Path | Persists | Visible to the browser | Notes |
| --- | --- | --- | --- |
| `hover-glossary/src/seed-data.mjs` (edit + rebuild) | yes, in git and on disk | yes, after the Package is redefined | the only durable way |
| `harness.handle('glossary/define', ...)` | **no** — process memory only | **no** | see the trap below |
| the running Package's in-memory lexicon | **no** — lost on process exit | yes for Host-side lookups | rebuilt from the seed table on every `apply` |

**The trap:** `glossary/define` is not a persistence API. It mutates the Host half's
in-memory index of one running Run, and it cannot make a word hoverable even temporarily,
because the Client half keeps its own inlined copy of the seed table and ignores any word
absent from it. Never tell a user a mapping was "saved" because `define` returned `ok: true`.

## The one durable workflow

1. **Edit** `hover-glossary/src/seed-data.mjs` — add or change the term's entry array.
2. **Rebuild** so the Client half's inlined copy matches:
   `node scripts/build-client.mjs` (from `hover-glossary/`).
3. **Test:** `node test/run.mjs` (from `hover-glossary/`). All cases must pass;
   case 7 fails loudly if step 2 was skipped.
4. **Redeploy** the plugin so the page picks up the new table: `cordis_define` with
   `plugin.kind: 'existing'` and `pluginId: hover-1`, passing the `host` and `client`
   strings from `hover-glossary/plugin/cordis-define.json`, then `cordis_run` with
   `mode: 'update'`. Pass **both halves in the same Package** — a Client-only Package
   has no Host half, so its `host.call` has nothing to answer it.
5. **Confirm** the size line changed: the Host half logs
   `[hover-glossary] 词库就绪: N 词 / M 条` at startup.

## Entry schema

Each value is an ordered array of 1..N entries. Order is the 1, 2, 3 the tooltip shows.

```js
TERM: [
  { text: '第一解释', kind: '缩写', weight: 100, tags: ['分类'] },
  { text: '第二解释', kind: '代词', weight: 10 },
],
```

- `text` (required) — the association text.
- `kind` (optional) — the small label after the text; defaults to `释义`.
- `weight` (optional, default 0) — higher sorts first. Ties keep source order.
- `tags` (optional) — carried in the data, not currently rendered.

`index` is assigned by the builder after sorting; never write it by hand.

## Term-matching rules that decide whether a mapping will ever fire

- Matching is case-, punctuation-, full-width- and whitespace-insensitive:
  `who`, `Who`, `ＷＨＯ`, `(WHO)` and `WHO.` all resolve to the same entry.
- Longest known term wins. With both `世卫组织` and `世界卫生组织` registered, the cursor
  anywhere inside `世界卫生组织` resolves to the longer one.
- **CJK has no word boundaries.** Consecutive Han characters form one token, so a
  multi-character term must be preceded by a real boundary (space, punctuation, or line
  start). In `即世卫组织` the cursor on `世` cannot resolve `世卫组织`, because `即` holds
  the token start. Write `即 世卫组织`, or accept that the leading character blocks it.
- A spaced phrase is matched from its **first** word: `United Nations` resolves while the
  cursor is on `United`, and does not when it is on `Nations`.
- The cursor sitting on the whitespace immediately after a word keeps that word
  (the panel does not flicker out mid-read).

## Verification

- `node test/run.mjs` — 12 cases. Case 5 walks real-transcript text cursor by cursor;
  case 6 compares the inlined Client copy against `src/`; case 7 catches a stale artifact;
  case 12 drives `mousemove → glyph → classify → RPC` through a fake DOM.
- After redeploying, hover a registered word in the conversation. If nothing appears,
  read the self-check card in the bottom-right of the page (or
  `globalThis.__hoverGlossaryDiag__` in the browser console): it reports whether
  `caretRangeFromPoint` is available, what the probe hit, and whether that word was in
  the lexicon.

## Do not

- Do not add a GUI for maintaining the mapping; the mapping is data-only by design.
- Do not register the plugin into `conversation.chat.turnTail` to mark a region — that slot
  is a selector chain where the first non-null entry wins, so an anchor there is not
  guaranteed to render, and a missing anchor silently disables every hover.
- Do not edit `hover-glossary/plugin/cordis-define.json` by hand; it is generated.
