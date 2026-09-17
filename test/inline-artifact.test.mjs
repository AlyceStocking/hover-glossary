/**
 * hover-glossary / test/inline-artifact.test.mjs
 *
 * 用例 6: 客户端内联副本与 src/ 保持一致。
 *
 * Cordis 的 Client 半不能 import, 只能内联 src/lexicon.mjs 的实现。
 * 本用例把内联副本放进 vm 沙箱求值, 并与 src/ 的查询结果逐一对比,
 * 保证 plugin/client-inline.js 不会悄悄过期。
 *
 * 运行: node test/inline-artifact.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { createLexicon } from '../src/lexicon.mjs';
import { SEED_TABLE } from '../src/seed-data.mjs';
import { buildInlineSource } from '../scripts/build-client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 用例 6 使用的 "真实正文" 样本: 覆盖英文词、多字词与跨空格短语 */
const SAMPLE_TEXT = [
  '我输入: 请解释 WHO 与 United Nations 的关系',
  '我输出: WHO 即 世卫组织, 也叫 世界卫生组织; DSH 的 Cordis 插件负责扩展。',
  '再输入: API 和 LLM 分别是什么? DeepSeek 也收录了吗',
].join('\n');

/** 在沙箱里求值内联源码, 取回它自己构造的 Lexicon */
function loadInlineLexicon() {
  const source = readFileSync(resolve(root, 'plugin/client-inline.js'), 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${source}\nglobalThis.__inlineLexicon__ = createLexicon(SEED_TABLE);`, sandbox, {
    filename: 'client-inline.js',
  });
  return sandbox.__inlineLexicon__;
}

const inline = loadInlineLexicon();
const source = createLexicon(SEED_TABLE);

test('用例6: 内联的客户端副本与 src/ 行为完全一致', () => {
  // 结构一致
  assert.equal(inline.size, source.size);
  assert.equal(inline.itemCount, source.itemCount);

  // 词条逐项一致 (含条目顺序与编号)。用序列化比较, 因为沙箱里的数组来自另一个 realm,
  // deepEqual 会因原型不同而判不等。
  assert.equal(JSON.stringify(inline.list()), JSON.stringify(source.list()));

  // 光标查询在整段真实正文的每一个位置都一致
  const full = SAMPLE_TEXT;
  let checked = 0;
  for (let cursor = 0; cursor <= full.length; cursor += 1) {
    const a = inline.lookupAt(full, cursor);
    const b = source.lookupAt(full, cursor);
    assert.deepEqual(
      { term: a.term, key: a.key, start: a.start, end: a.end, n: a.entries.length },
      { term: b.term, key: b.key, start: b.start, end: b.end, n: b.entries.length },
      `光标 ${cursor} 处两份实现结果不一致`,
    );
    checked += 1;
  }
  assert.ok(checked > 100, '应覆盖整段文本');
  assert.ok(source.lookupAt(full, full.indexOf('WHO')).entries.length === 2, '样本文本应能被解析');

  // 内联源码里不能残留 ESM 语法, 否则 Cordis 客户端闭包会解析失败
  const raw = readFileSync(resolve(root, 'plugin/client-inline.js'), 'utf8');
  assert.ok(!/^\s*import\s/m.test(raw), '内联副本不应包含 import');
  assert.ok(!/^\s*export\s/m.test(raw), '内联副本不应包含 export');
  assert.ok(!/\brequire\s*\(/.test(raw), '内联副本不应包含 require');
});

test('用例7: 产物与构建脚本的输出保持同步 (未过期)', () => {
  const expected = buildInlineSource();
  const actual = readFileSync(resolve(root, 'plugin/client-inline.js'), 'utf8');
  assert.equal(actual, expected, 'plugin/client-inline.js 已过期, 请运行 node scripts/build-client.mjs');
});
