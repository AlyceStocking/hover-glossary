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
import { buildInlineSource, composeTemplate, buildPackageHostSource } from '../scripts/build-client.mjs';

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

  // 两套产物必须来自同一份内联源码, 否则动态版与持久版会漂移
  const bundle = readFileSync(resolve(root, 'lib/client.js'), 'utf8');
  const defineJson = JSON.parse(readFileSync(resolve(root, 'plugin/cordis-define.json'), 'utf8'));
  assert.equal(defineJson.code.client, bundle, 'lib/client.js 与 cordis-define.json 的 client 不一致');
  assert.ok(bundle.includes(expected), 'profile 包未包含内联词库');
  assert.equal(bundle, composeTemplate('plugin/client-panel.js'), '客户端模板改动后必须重新构建');
  assert.equal(readFileSync(resolve(root, 'lib/index.js'), 'utf8'), buildPackageHostSource());
});

/**
 * 在沙箱里以浏览器语义加载 profile 包的 client bundle:
 * 提供 window.__ModuleLoader__ 与 require 桩, 取回 factory。
 */
function loadBrowserModule() {
  const bundle = readFileSync(resolve(root, 'lib/client.js'), 'utf8');
  let captured = null;
  const sandbox = { console: { log() {}, error() {} }, Date, setTimeout, clearTimeout, globalThis: undefined };
  sandbox.window = sandbox;
  sandbox.__ModuleLoader__ = {
    load(definition) {
      captured = definition;
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(bundle, sandbox, { filename: 'hover-glossary-client.js' });
  return { definition: captured, sandbox };
}

test('用例13: 仓库根目录是合法的客户端插件包 (可持久安装的前提)', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  // 契约: 本地包靠 dsh.client.platform 声明自己是浏览器插件, 否则加载器不会挂载
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.equal(manifest.type, 'module');
  assert.ok(manifest.exports['./client'], '应导出 ./client');

  // 契约: dsh.bundle.patch 指向真实存在的装配补丁, 否则 dsh plugin add 只会
  // 把它当作普通依赖, 插件管理 UI 不会列出它, 也不会自动挂载
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml', '应声明 dsh.bundle.patch');
  assert.equal(manifest.exports['./cordis.patch.yml'], './cordis.patch.yml', '应导出 ./cordis.patch.yml');
  const patch = readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8');
  assert.ok(patch.includes(`name: '${manifest.name}'`), '装配补丁应按包名挂载本插件');

  // host 半边必须是可被 Node 加载的 ESM, 且只导出 apply
  const hostEntry = readFileSync(resolve(root, 'lib/index.js'), 'utf8');
  assert.ok(/export\s*\{\s*apply\s*\}/.test(hostEntry), 'host 半边应导出 apply');
  assert.ok(!/^\s*import\s/m.test(hostEntry), 'host 半边不需要 import');

  // client bundle 必须以模块加载器契约注册, 且 id 等于包名
  const { definition } = loadBrowserModule();
  assert.ok(definition, 'bundle 未调用 __ModuleLoader__.load');
  assert.equal(definition.id, manifest.name, 'id 必须等于 package.json 的 name');
  assert.equal(typeof definition.factory, 'function');

  // factory 返回 Cordis 对象插件; 纯客户端仍须声明客户端服务依赖。
  const reactStub = {
    createElement: () => ({}),
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
  };
  const requireStub = (name) => {
    if (name === 'react') return reactStub;
    throw new Error('不允许的 require: ' + name);
  };
  const mod = definition.factory(requireStub);
  const plugin = mod && mod.default ? mod.default : mod;
  assert.equal(typeof plugin.apply, 'function', 'factory 应导出 apply');
  assert.equal(JSON.stringify(plugin.inject), '["slots"]', '必须声明 Cordis slots 服务');

  // 关键契约: 必须声明 slots 依赖, 否则 ctx.slots 解析不到, 插件会静默失效。
  // 这正是线上第一次 "完全没反应" 的原因 (ctx.get('slots') 返回 undefined)。
  assert.equal(
    JSON.stringify(manifest.dsh.client.inject),
    JSON.stringify(['@deepseek-ai/dsh-client-ui-renderer']),
    'package.json 必须声明 slots 注入, 否则悬停字典在浏览器里不会注册任何东西',
  );

  const record = readFileSync(resolve(root, 'lib/client.js'), 'utf8');

  // 取服务必须走已声明的注入 (ctx.slots); 只看代码行, 避免注释里的说明文字触发断言
  const codeLines = record
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  assert.ok(/ctx\.slots/.test(codeLines), '应通过 ctx.slots 取得 slots 服务');
  assert.ok(
    !/ctx\.get\(\s*['"]slots['"]\s*\)/.test(codeLines),
    '不应再用 ctx.get 取 slots —— 它会静默返回 undefined 让插件无声失效',
  );

  // 内联词库在浏览器侧独立可用: 不再依赖任何 RPC
  [
    'host.call',
    "require('host')",
    'harness',
    'ctx.remote',
  ].forEach((forbidden) => {
    assert.ok(!record.includes(forbidden), `持久版本不应依赖 ${forbidden}`);
  });
});
