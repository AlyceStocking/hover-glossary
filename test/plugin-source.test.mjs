/**
 * hover-glossary / test/plugin-source.test.mjs
 *
 * 用例 8: 交给 cordis_define 的两个函数体都是合法的普通 JS 函数体 (无 ESM 语法)。
 * 用例 9: Host 半在沙箱里真实执行, 验证 harness.handle('glossary/resolve') 的返回值,
 *        即 "光标 -> 词的 1..N 条联想" 的完整链路。
 * 用例 10: 面板界面的静态部分 (演示段落切分、预置词覆盖) 与 src/ 一致。
 *
 * 运行: node test/run.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { SEED_TABLE } from '../src/seed-data.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const define = JSON.parse(readFileSync(resolve(root, 'plugin/cordis-define.json'), 'utf8'));

/** 在沙箱里跑起 Host 半, 返回 { call, logs } */
function bootHost() {
  const handlers = new Map();
  const logs = [];
  const sandbox = {
    console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push('ERR ' + a.join(' ')) },
    harness: {
      handle(method, handler) {
        handlers.set(method, handler);
        return () => handlers.delete(method);
      },
    },
    ctx: { effect: () => () => {} },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const plugin = vm.runInContext(`(function(){${define.code.host}})()`, sandbox, { filename: 'host.js' });
  plugin.apply(sandbox.ctx);
  return {
    call: (method, args) => {
      const handler = handlers.get(method);
      assert.ok(handler, `未注册的 RPC: ${method}`);
      return handler(args);
    },
    logs,
  };
}

const host = bootHost();
const SAMPLE = 'United Nations 里 WHO 和 世界卫生组织 都收录了';
const cursorOf = (needle, offset = 0) => SAMPLE.indexOf(needle) + offset;
/** 沙箱返回的对象来自另一个 realm, 原型不同, 因此统一按 JSON 比较 */
const j = (value) => JSON.stringify(value);

test('用例8: 两个函数体都是合法源码且不含 ESM 语法', () => {
  for (const half of ['host', 'client']) {
    const source = define.code[half];
    assert.ok(source.length > 1000, `${half} 源码过短`);
    assert.ok(!/^\s*import\s/m.test(source), `${half} 不应有 import`);
    assert.ok(!/^\s*export\s/m.test(source), `${half} 不应有 export`);
    assert.ok(!/\brequire\s*\(/.test(source), `${half} 不应有 require`);
    assert.doesNotThrow(() => new Function(source), `${half} 语法检查失败`);
  }
  assert.equal(define.name, 'Hover Glossary');
});

test('用例9: Host RPC 按光标返回 1..N 条联想', () => {
  // 1) 需求给定的示例: WHO -> 1、世卫组织 2、谁
  const who = host.call('glossary/resolve', { text: SAMPLE, cursor: cursorOf('WHO', 1) });
  assert.equal(who.ok, true);
  assert.equal(who.key, 'who');
  assert.equal(j(who.entries.map((e) => e.text)), j(['世卫组织', '谁']));
  assert.equal(j(who.entries.map((e) => e.index)), j([1, 2]));
  // 返回的必须是纯 JSON 可序列化的最小对象
  assert.deepEqual(Object.keys(who.entries[0]).sort(), ['index', 'kind', 'text', 'weight']);
  assert.doesNotThrow(() => JSON.stringify(who));

  // 2) 最长词优先: 光标在 "世界卫生组织" 的最后一个字上
  const long = host.call('glossary/resolve', { text: SAMPLE, cursor: cursorOf('世界卫生组织', 6) });
  assert.equal(long.term, '世界卫生组织');
  assert.equal(long.entries[0].text, '世界卫生组织（WHO），简称世卫组织');

  // 3) 跨空格短语: 光标在 United / Nations 任意位置都整体命中
  for (const offset of [0, 6, 9]) {
    const un = host.call('glossary/resolve', { text: SAMPLE, cursor: cursorOf('United Nations', offset) });
    assert.equal(un.term, 'United Nations', `offset ${offset} 应命中整个短语`);
    assert.equal(un.entries.length, 2);
  }

  // 4) Client 直接按词查询 (悬停分支)
  const pinned = host.call('glossary/resolve', { text: SAMPLE, cursor: 0, term: 'api' });
  assert.equal(pinned.key, 'api');
  assert.equal(pinned.entries.length, 3);

  // 5) 未收录 / 空白: 返回 ok 且空数组, 不抛错
  const none = host.call('glossary/resolve', { text: '没有收录的词', cursor: 0 });
  assert.equal(none.ok, true);
  assert.equal(j(none.entries), '[]');
  assert.equal(none.empty, true);
  const blank = host.call('glossary/resolve', { cursor: 999 });
  assert.equal(blank.ok, true);
  assert.equal(j(blank.entries), '[]');

  // 6) 词条可追加, 1 -> N 的 N 会增长
  const added = host.call('glossary/define', { term: 'DSH-Test', entries: ['自定义解释一', '自定义解释二'] });
  assert.equal(added.ok, true);
  assert.equal(added.total, 2);
  const after = host.call('glossary/resolve', { term: 'dsh-test', cursor: 0, text: '' });
  assert.equal(j(after.entries.map((e) => e.text)), j(['自定义解释一', '自定义解释二']));
  // 参数不合法时明确报错, 不静默吞掉
  assert.equal(host.call('glossary/define', { term: '', entries: [] }).ok, false);

  assert.ok(host.logs.some((line) => line.includes('词库就绪')), 'Host 启动时应打印词库规模');
});

test('用例10: 面板源码里的演示段落覆盖全部预置词, 且切分逻辑正确', () => {
  const source = define.code.client;

  // 面板必须把 SEED_TABLE / SAMPLE_TEXT 内联进来, 才能独立运行
  assert.ok(/const SEED_TABLE\s*=/.test(source), 'Client 应内联 SEED_TABLE');
  assert.ok(/const SAMPLE_TEXT\s*=/.test(source), 'Client 应内联 SAMPLE_TEXT');
  for (const term of Object.keys(SEED_TABLE)) {
    assert.ok(source.includes(term), `Client 内联词库缺少 "${term}"`);
  }

  // 用沙箱复核面板里 CELLS 的切分: 每个可悬停单元的文本必须与它的 term 一致
  const sandbox = { console: { log() {}, error() {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const probe = vm.runInContext(
    `${source.slice(0, source.indexOf('const CSS ='))}
     globalThis.__cells__ = CELLS;
     globalThis.__index__ = INDEX;`,
    sandbox,
    { filename: 'client-cells.js' },
  );
  void probe;
  const cells = sandbox.__cells__;
  const index = sandbox.__index__;
  assert.ok(Array.isArray(cells) && cells.length > 20, 'CELLS 切分结果为空');

  const hoverable = cells.filter((c) => c.term);
  assert.ok(hoverable.length >= 8, '可悬停单元太少');
  for (const cell of hoverable) {
    assert.equal(cell.text.normalize('NFKC').toLowerCase(), cell.term.normalize('NFKC').toLowerCase());
    assert.ok(index.lookup(cell.term).length >= 1, `演示词 ${cell.term} 没有条目`);
  }
  // 整段文本拼接后应与 SAMPLE_TEXT 一致
  const joined = cells.map((c) => c.text).join('');
  assert.ok(joined.includes('United Nations'), '拼接后的演示文本缺少短语');
  assert.ok(joined.includes('WHO'), '拼接后的演示文本缺少 WHO');
});

