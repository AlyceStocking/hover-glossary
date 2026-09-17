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

/**
 * 在沙箱里求值 Client 半的整个函数体 (把末尾的 return 换成暴露内部索引),
 * 取回它自己的 INDEX 与光标取词函数, 用于校验客户端识别结果。
 * @param {string} source - define.code.client
 */
function makeClientSandbox(source) {
  const marker = '\nreturn {';
  const at = source.lastIndexOf(marker);
  assert.ok(at > 0, 'client 源码应以 return { 结束');
  const body = source.slice(0, at) + `
    globalThis.__index__ = INDEX;
    globalThis.__termAt__ = (text, cursor) => {
      const hit = tokenAt(text, cursor);
      return hit ? hit.term : null;
    };
    globalThis.__tokenAt__ = (text, cursor) => tokenAt(text, cursor);
    return { code: 6 };`;
  const sandbox = { console: { log() {}, error() {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  sandbox.__plugin__ = vm.runInContext(`(function(){${body}\n})()`, sandbox, { filename: 'client-engine.js' });
  return sandbox;
}

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

  // 3) 跨空格短语: 光标在第一个词上时整体命中 (短语可向右跨过内部空格)
  for (const offset of [0, 3, 6]) {
    const un = host.call('glossary/resolve', { text: SAMPLE, cursor: cursorOf('United Nations', offset) });
    assert.equal(un.term, 'United Nations', `offset ${offset} 应命中整个短语`);
    assert.equal(un.entries.length, 2);
  }
  // 停在第二个词上时按该词自身查询, 不回头扩张
  assert.equal(host.call('glossary/resolve', { text: SAMPLE, cursor: cursorOf('United Nations', 9) }).entries.length, 0);

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

test('用例10: 客户端源码只装饰真实正文, 不含演示面板/模拟控件', () => {
  const source = define.code.client;

  // 面板必须把 SEED_TABLE / SAMPLE_TEXT 内联进来, 才能独立运行
  assert.ok(/const SEED_TABLE\s*=/.test(source), 'Client 应内联 SEED_TABLE');
  for (const term of Object.keys(SEED_TABLE)) {
    assert.ok(source.includes(term), `Client 内联词库缺少 "${term}"`);
  }

  // 不再有演示面板: 必须没有 CELLS/演示段落相关的东西
  assert.ok(!/const CELLS\s*=/.test(source), '旧的演示面板切分逻辑应已移除');
  assert.ok(!/hg-panel/.test(source), '不应再注册演示面板');
  assert.ok(!/simulate|模拟光标/.test(source), '不应再有模拟光标控件');

  // 悬停引擎的必要组成: 取字 + 浮层 + 自检; 且不依赖任何锚点元素
  assert.ok(/caretRangeFromPoint|caretPositionFromPoint/.test(source), '缺少光标处字符定位');
  assert.ok(/shell\.overlay/.test(source), '浮层应注册在 shell.overlay');
  assert.ok(/function selfCheck/.test(source), '应带启动自检');
  assert.ok(source.includes('__hoverGlossaryDiag__'), '自检结果应可从控制台读取');
  assert.ok(!source.includes('data-hg-zone'), '不应再依赖锚点元素判定范围');
  assert.ok(!source.includes('conversation.chat.turnTail'), '不应再与 turnTail chain 竞争');
  assert.ok(/addEventListener\('mousemove'/.test(source), '应监听鼠标移动');
  assert.ok(!/\bdocument\.body\s*\.\s*(append|innerHTML|style)/.test(source), '不应改写 product DOM');

  // 客户端内联的词库必须与 Host 一致: 同一段真实正文, 逐光标结果相同
  const sandbox = makeClientSandbox(source);
  const clientTermAt = (text, cursor) => sandbox.__termAt__(text, cursor);
  const clientEntries = (term) => sandbox.__index__.lookup(term);
  assert.equal(sandbox.__index__.size, Object.keys(SEED_TABLE).length);

  // 用 "真实正文" 复刻需求场景: 用户输入的句子 + 我输出的句子
  const realText = [
    '帮我查一下 WHO 的说法',
    'WHO 是世卫组织, 全称 World Health Organization, 也叫 世界卫生组织。',
  ];
  const seen = new Set();
  for (const text of realText) {
    for (let cursor = 0; cursor < text.length; cursor += 1) {
      const term = clientTermAt(text, cursor);
      if (!term) continue;
      const entries = clientEntries(term);
      if (entries.length === 0) continue;
      seen.add(term.toLowerCase());
      // 同一光标在 Host 侧必须给出完全相同的条目
      const hostResult = host.call('glossary/resolve', { text, cursor, term });
      assert.equal(
        j(hostResult.entries.map((e) => e.text)),
        j(entries.map((e) => e.text)),
        `光标 ${cursor} (${term}) 处 Host/Client 不一致`,
      );
    }
  }
  assert.ok(seen.has('who'), '真实正文里的 WHO 应能被客户端识别');
  assert.ok(seen.has('世界卫生组织'), '真实正文里的多字词应能被识别');
  // 未收录的词不产生浮层
  assert.equal(clientEntries('这句话里没有收录的词').length, 0);
});

test('用例11: 真实对话文本下 Host 与 Client 逐光标一致', () => {
  const sandbox = makeClientSandbox(define.code.client);

  // 模拟一段你和我的真实对话文本 (包含中英混排、多字词与跨空格短语)
  const transcript = [
    '我输入: 请解释 WHO 和 United Nations 的关系',
    '我输出: WHO 即 世卫组织, 隶属 United Nations; DSH 里 Cordis 插件负责扩展。',
    '再输入: 那 API 呢? 以及 世界卫生组织 的官网, 顺便说说 LLM 和 DeepSeek',
  ].join('\n');

  let hits = 0;
  for (let cursor = 0; cursor < transcript.length; cursor += 1) {
    const term = sandbox.__termAt__(transcript, cursor);
    if (!term) continue;
    const entries = sandbox.__index__.lookup(term);
    if (entries.length === 0) continue;
    hits += 1;
    const hostResult = host.call('glossary/resolve', { text: transcript, cursor, term });
    assert.ok(hostResult.entries.length >= 1, `光标 ${cursor} 处 Host 未命中`);
    assert.equal(
      j(hostResult.entries.map((e) => e.text)),
      j(entries.map((e) => e.text)),
      `光标 ${cursor} (${term}) 处 Host/Client 条目不一致`,
    );
  }
  assert.ok(hits >= 10, `真实对话文本中命中太少 (${hits})`);
  // 未被收录的词不产生任何浮层
  assert.equal(sandbox.__index__.lookup('这句话里没有收录的词').length, 0);
});

/**
 * 在沙箱里把 Client 半真正 apply 起来, 用假 DOM 模拟一次鼠标移动。
 * 这是唯一能覆盖 "鼠标经过 -> 取字 -> 分类 -> 查询" 整条路径的测试;
 * 之前 "悬停没反应" 的缺陷正是出现在这段路径上。
 */
function runHoverOnce(options) {
  const listeners = { mousemove: [], mouseleave: [] };
  const doc = {
    addEventListener(type, fn) {
      if (listeners[type]) listeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      if (listeners[type]) listeners[type] = listeners[type].filter((f) => f !== fn);
    },
    elementFromPoint: () => options.element,
    caretRangeFromPoint: () => ({ startContainer: options.node, startOffset: options.offset }),
    body: {},
    documentElement: {},
  };
  const calls = [];
  const logs = [];
  const slots = {
    inject: () => () => {},
    register: (options2, render) => {
      void render;
      return () => {};
    },
  };
  const sandbox = {
    console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push('ERR ' + a.join(' ')) },
    document: doc,
    navigator: { userAgent: 'fake' },
    innerWidth: 1200,
    innerHeight: 800,
    React: {
      createElement: (type, props, ...children) => ({ type, props, children }),
      useState: (initial) => [initial, () => {}],
      useEffect: () => {},
    },
    styles: { insert: () => () => {} },
    host: {
      call: (method, args) => {
        calls.push({ method, args });
        return Promise.resolve({ ok: true, entries: [{ index: 1, text: options.entryText, kind: '缩写' }] });
      },
    },
    ctx: {
      get: (name) => (name === 'slots' ? slots : undefined),
      effect: () => () => {},
      timer: { throttle: (fn) => fn, debounce: (fn) => fn },
      timeouts: [],
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const plugin = vm.runInContext(`(function(){${define.code.client}})()`, sandbox, { filename: 'client-run.js' });
  plugin.apply(sandbox.ctx);

  assert.ok(listeners.mousemove.length >= 1, '应注册 mousemove 监听');
  for (const fn of listeners.mousemove) fn({ clientX: 100, clientY: 100 });
  return { calls, listeners, logs };
}

test('用例12: 鼠标经过正文里的词会发起查询 (整条悬停路径)', async () => {
  // 索引: u0 s1 e2 ␣3 W4 H5 O6 ␣7 h8 e9 r10 e11
  const node = { nodeType: 3, data: 'use WHO here' };

  // caret 落在所见字符右侧 (offset 7 = "WHO" 之后的空格): 必须向左回退一格取到 O
  const rightSide = runHoverOnce({ element: { tagName: 'SPAN' }, node, offset: 7, entryText: '世卫组织' });
  assert.equal(rightSide.calls.length, 1, '应发起一次 glossary/resolve');
  assert.equal(rightSide.calls[0].method, 'glossary/resolve');
  assert.equal(rightSide.calls[0].args.term, 'WHO');
  assert.equal(rightSide.calls[0].args.text, node.data);
  assert.equal(rightSide.calls[0].args.cursor, 6, 'offset 落在空格上时应回退到 6');

  // offset 正落在 "WHO" 的中间 (caret 在 H 与 O 之间, 取左侧的 H)
  const onChar = runHoverOnce({ element: { tagName: 'SPAN' }, node, offset: 6, entryText: '世卫组织' });
  assert.equal(onChar.calls.length, 1);
  assert.equal(onChar.calls[0].args.term, 'WHO');
  assert.equal(onChar.calls[0].args.cursor, 5);

  // offset 落在 "WHO" 的首字母 W 上
  const onFirst = runHoverOnce({ element: { tagName: 'SPAN' }, node, offset: 4, entryText: '世卫组织' });
  assert.equal(onFirst.calls.length, 1);
  assert.equal(onFirst.calls[0].args.term, 'WHO');
  assert.equal(onFirst.calls[0].args.cursor, 4);

  // 未收录的词: 不应该发起查询
  const none = runHoverOnce({ element: { tagName: 'SPAN' }, node, offset: 9, entryText: 'x' });
  assert.equal(none.calls.length, 0, '未收录的词不应发起查询');

  // 落在控件内: 不应该发起查询
  const insideButton = runHoverOnce({
    element: { tagName: 'BUTTON', parentElement: null },
    node,
    offset: 6,
    entryText: '世卫组织',
  });
  assert.equal(insideButton.calls.length, 0, '控件内不应发起查询');

  // 取字返回 null: 不应崩, 不发起查询
  const blank = runHoverOnce({ element: null, node, offset: 6, entryText: '世卫组织' });
  assert.equal(blank.calls.length, 0);
});

