---
name: glossary-mapping
description: Update, rebuild, install, and verify the persistent hover-glossary term-to-many-meanings mapping for DeepSeek Harness. Use when adding or correcting entries or checking whether an update survives a Harness restart.
---

# Maintain the hover glossary

The repository contains `hover-glossary/`. The sole persistent mapping source is
`hover-glossary/src/seed-data.mjs`. Do not add a glossary GUI or model-facing tools.

## Durable update

1. Edit the source mapping, preserving unrelated entries.
2. From the repository root run `node hover-glossary/scripts/build-client.mjs`.
3. Run `node hover-glossary/test/run.mjs` (16 tests). Tests do not regenerate files;
   a stale artifact should fail verification.
4. Copy the contents of `hover-glossary/plugin/package/` into
   `~/.dsh/profiles/node_modules/hover-glossary/`.
5. Reload the browser and hover a changed word in a sent user or assistant message.
   Restart Harness when the manifest or composition changed, and whenever verifying
   persistence. Open the authenticated URL printed at startup.
6. Review the diff before committing. Publish only when requested.

First installation also needs a single entry in `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: hover-glossary
      name: hover-glossary
```

Preserve other rows and comments; avoid duplicates.

The package has an empty Host `apply` and a browser module containing the lexicon.
It uses no RPC or model request. Dynamic `cordis_define` / `cordis_run` state and the
legacy `glossary/define` RPC are not persistent installation or mapping APIs.

## Entry format

```js
TERM: [
  { text: '第一解释', kind: '缩写', weight: 100, tags: ['分类'] },
  { text: '第二解释', kind: '代词', weight: 10 },
],
```

`text` is required. `kind` defaults to `释义`; `weight` defaults to zero and sorts
descending, with ties preserving input order. `tags` are optional metadata.
The runtime assigns `index`; do not write it manually.

Case and full-width variants normalize to one key. Continuous Chinese text supports
longest registered substrings; Latin words require whole-word boundaries. A spaced
phrase currently matches from its first word. Text split across DOM text nodes is not
joined. Sent chat messages are covered; editable inputs, links, buttons, sidebar and
settings text are excluded.

## Runtime contract and verification

- `package.json` → `dsh.client.inject` declares module dependencies:
  `@deepseek-ai/dsh-client-ui-renderer`, the provider of `slots` in the tested version.
- The browser factory exports `inject = ['slots']`: this separate service dependency
  authorizes `ctx.slots`. An empty export causes `cannot get property "slots" without inject`.
- `shell.overlay` is registered through `ctx.slots.inject`; styles are React `<style>`
  elements. There is no injected/global `styles` helper.
- Do not hand-edit generated `plugin/client-inline.js`, `plugin/cordis-define.json`,
  or `plugin/package/**`; change source/templates and rebuild.
- Successful bundle delivery or a permissive mocked context does not prove activation.
  Verify in a browser; `__hoverGlossaryDiag__` gives console diagnostics without extra UI.
- `hover-glossary/test/browser.mjs` tests a running installation, existing conversation WHO
  text, and transient DOM fixtures. See `hover-glossary/README.md` for environment variables.
  Run again after a fresh Host process starts to prove persistence. Keep authentication
  URLs out of reports.

Official contracts: [services](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/service)
and [slots](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/slots).
