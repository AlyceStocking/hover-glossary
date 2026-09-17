---
name: glossary-mapping
description: Update, extend, install, or verify the hover-glossary word mapping (the term to 1..N association entries shown when the cursor rests on a word in the conversation). Use this Skill when a term is missing from the hover tooltip, when an existing entry is wrong or ordered incorrectly, when new terms must be added permanently, when the plugin needs reinstalling after a DSH restart, or when asked whether a mapping change persists across restarts.
---

# Update the hover-glossary mapping

The source lives at `hover-glossary/` in this workspace. The mapping is plain data; the
hover engine itself never needs editing to add or change a term.

## How it is installed (read this first)

The capability is a **local client plugin package**, not a session-scoped dynamic plugin:

| Thing | Path |
| --- | --- |
| source (this repo) | `hover-glossary/` |
| installed package | `~/.dsh/profiles/node_modules/hover-glossary/` |
| composition row | `~/.dsh/profiles/web/cordis.patch.yml` |

The package is `lib/index.js` (host entry, an empty `apply`) plus `lib/client.js` — a
browser module wrapped in `window.__ModuleLoader__.load({ id, factory })` whose `id` equals
the package `name`. The lexicon is inlined in that bundle, so **there is no RPC and no
host-side service**; the browser answers its own lookups.

It is **not** in the workspace's `.dsh/`, and it is **not** a dynamic Cordis plugin. A
dynamic plugin (`cordis_define` / `cordis_run`) lives only in that process's memory and
vanishes on `dsh web` restart — that is why the effect disappeared once. Do not use it to
"install" this capability.

## What persists and what does not

Read this before promising anything survives a restart.

| Path | Persists | Notes |
| --- | --- | --- |
| `hover-glossary/src/seed-data.mjs` → rebuild → reinstall | **yes**, git + disk + profile package | the only durable way |
| `glossary/define` RPC (dynamic-plugin build only) | **no** — process memory | not a persistence API, see below |
| a dynamic plugin's in-memory lexicon | **no** — lost on process exit | rebuilt from the seed table on every `apply` |

**The trap:** never report a mapping as "saved" because a `glossary/define` call returned
`ok: true`. It mutates one running process's memory and is not visible after a restart.

## The durable workflow

1. **Edit** `hover-glossary/src/seed-data.mjs` — add or change the term's entry array.
2. **Rebuild** all artifacts: `node scripts/build-client.mjs` (run from `hover-glossary/`).
   This regenerates `plugin/client-inline.js`, `plugin/cordis-define.json` (the legacy
   dynamic form) and `plugin/package/` (the installable package).
3. **Test:** `node test/run.mjs` (from `hover-glossary/`). All 13 cases must pass; case 7
   fails loudly if step 2 was skipped, case 13 checks the package contract.
4. **Reinstall** the package into the profile:
   copy `hover-glossary/plugin/package/*` over
   `~/.dsh/profiles/node_modules/hover-glossary/` (keep the directory name equal to the
   package `name`).
5. **Verify** after a page reload: hover a registered word. `globalThis.__hoverGlossaryDiag__`
   in the browser console shows the lexicon size (`N 词 / M 条`) and what the pointer probe hit.

A brand-new install additionally needs the composition row in
`~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: hover-glossary
      name: hover-glossary
```

Add it as its own entry; never rewrite or reorder the existing rows, and keep the file's
comments. Restarting `dsh web` is what makes a **newly added** row take effect; replacing
only the package files does not need it.

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
- The cursor sitting on the whitespace immediately after a word keeps that word.

## Verification

- `node test/run.mjs` — 13 cases. Case 5 walks real-transcript text cursor by cursor;
  case 6 compares the inlined copy against `src/`; case 7 catches a stale artifact;
  case 12 drives `mousemove → glyph → classify → lookup → render` through a fake DOM;
  case 13 checks the package/manifest/`__ModuleLoader__` contract.
- In the browser, hover a registered word. If nothing appears, read
  `globalThis.__hoverGlossaryDiag__`: it reports whether `caretRangeFromPoint` exists,
  what the probe hit, and whether that word was in the lexicon.

## Do not

- Do not add a GUI for maintaining the mapping; the mapping is data-only by design.
- Do not "install" this with `cordis_define`/`cordis_run` — that form dies with the process.
- Do not register anything into `conversation.chat.turnTail` to mark a region: that slot is
  a selector chain where the first non-null entry wins, so an anchor there is not guaranteed
  to render, and a missing anchor silently disables every hover.
- Do not hand-edit `plugin/client-inline.js`, `plugin/cordis-define.json`, or
  `plugin/package/**`; they are generated by `scripts/build-client.mjs`.
