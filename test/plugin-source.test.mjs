/**
 * hover-glossary / test/plugin-source.test.mjs
 *
 * 用例 8: 动态插件版本的两个函数体都是合法的普通 JS 函数体 (无 ESM 语法)。
 * 用例 9: 动态版本的 Host 半在沙箱里真实执行, 验证 harness.handle('glossary/resolve')。
 * 用例 10/11: 客户端 bundle 的函数体、词库与 Host 侧逐光标一致。
 * 用例 12: 用假 DOM 跑通 "鼠标经过 -> 取字 -> 分类 -> 查词 -> 渲染浮层" 整条路径。
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

/** 可持久安装的客户端 bundle (浏览器模块), 用例 10-12 的测试对象 */
function browserModuleSource() {
  return readFileSync(resolve(root, 'lib/client.js'), 'utf8');
}
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

/** 最小 React 桩: 只覆盖客户端用到的三个 API */
const reactStub = {
  createElement: () => ({}),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
};

/**
 * 以浏览器模块语义求值客户端 bundle, 取回 factory 与插件对象。
 * 源码是 `window.__ModuleLoader__.load({ id, factory })` 包装 (与本地插件包契约一致),
 * 不再是可直接调用的函数体。
 * @param {string} source - plugin/package/lib/client.js 的内容
 */
function loadClientModule(source) {
  let captured = null;
  const sandbox = { console: { log() {}, error() {} } };
  sandbox.window = sandbox;
  sandbox.__ModuleLoader__ = { load: (definition) => { captured = definition; } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'client-module.js' });
  assert.ok(captured, 'client bundle 未注册到 __ModuleLoader__');
  const plugin = captured.factory((name) => {
    if (name === 'react') return reactStub;
    throw new Error('不允许的 require: ' + name);
  });
  return { definition: captured, plugin, sandbox };
}

/**
 * 取回客户端内部的 INDEX 与光标取词函数, 用于校验客户端识别结果。
 * 做法: 在模块上下文里定义一个探针全局, 让 factory 闭包把内部索引挂上去。
 * @param {string} source
 */
function makeClientSandbox(source) {
  const probe = `
    globalThis.__index__ = INDEX;
    globalThis.__termAt__ = (text, cursor) => {
      const hit = tokenAt(text, cursor);
      return hit ? hit.term : null;
    };
    globalThis.__tokenAt__ = (text, cursor) => tokenAt(text, cursor);
  `;
  const marker = '\n    function apply(ctx) {';
  const at = source.indexOf(marker);
  assert.ok(at > 0, 'client 源码应包含 apply 定义');
  const patched = source.slice(0, at) + '\n' + probe + source.slice(at);
  return loadClientModule(patched).sandbox;
}

test('用例8: 两个函数体都是合法源码且不含 ESM 语法', () => {
  for (const half of ['host', 'client']) {
    const source = define.code[half];
    assert.ok(source.length > 1000, `${half} 源码过短`);
    assert.ok(!/^\s*import\s/m.test(source), `${half} 不应有 import`);
    assert.ok(!/^\s*export\s/m.test(source), `${half} 不应有 export`);
    assert.doesNotThrow(() => new Function(source), `${half} 语法检查失败`);
  }
  // 动态版本的 host 半边运行在 Node 闭包里, 不能有 require;
  // client 半边是浏览器模块, 只允许 require 平台原语 (react)
  assert.ok(!/\brequire\s*\(/.test(define.code.host), 'host 半边不应有 require');
  const requires = [...define.code.client.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(requires)], ['react'], `client 只应 require react, 实际: ${requires.join(', ')}`);
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
 * 在沙箱里以浏览器模块语义加载客户端 bundle, 并 apply 起来, 用假 DOM 模拟一次鼠标移动。
 * 这是唯一覆盖 "鼠标经过 -> 取字 -> 分类 -> 查词 -> 渲染浮层" 整条路径的测试;
 * 之前 "悬停没反应" 的缺陷正是出现在这段路径上。
 *
 * 持久版本是纯客户端的: 查词在浏览器侧完成, 没有 RPC, 因此这里断言的是
 * 浮层实际的渲染结果 (文本 + 条目), 而不是 "有没有发起查询"。
 */
function runHoverOnce(options) {
  const listeners = { mousemove: [], mouseleave: [], scroll: [], blur: [] };
  if (options.element && !options.outside) {
    options.element.parentElement = { getAttribute: name => name === 'data-chat-flow-kind' ? 'user' : null };
  }
  const doc = {
    addEventListener(type, fn) {
      if (listeners[type]) listeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      if (listeners[type]) listeners[type] = listeners[type].filter((f) => f !== fn);
    },
    elementFromPoint: () => options.element,
    caretRangeFromPoint: () => ({ startContainer: options.node, startOffset: options.offset }),
    createRange: () => ({setStart() {}, setEnd() {}, getClientRects: () => options.blank ? [] : [{left: 90,right: 110,top:90,bottom:110}]}),
    body: {},
    documentElement: {},
  };
  const logs = [];
  const elements = [];
  const registered = [];
  const slots = {
    inject: (key, callback) => {
      try {
        const maybe = callback();
        if (typeof maybe === 'function') maybe();
      } catch (error) {
        logs.push('ERR inject ' + key + ': ' + error.message);
      }
      return () => {};
    },
    register: (definition, render) => {
      // 注册对象形如 { name, render } —— 渲染函数在 .render 上
      assert.equal(typeof render, 'function', 'slots.register 应收到渲染函数: ' + JSON.stringify(definition));
      registered.push(render);
      return () => {};
    },
  };

  // 真实的 React 桩: useState 触发重渲染, useEffect 尊重依赖数组,
  // 渲染期间不重入 (否则 setState -> flush -> render 会无限递归)。
  // hook 单元按 "组件身份 + hook 序号" 索引 —— 不能用嵌套深度, 否则两个顶层
  // 组件 (GlossaryTip / DiagCard) 会共用同一格状态。
  const hookState = new Map();
  const effectCells = new Map();
  let currentComponent = -1; // 当前渲染的组件 id, -1 表示尚未进入组件
  let hookCursor = 0;
  let renderDepth = 0;
  let nextComponentId = 1;
  const renderers = [];
  const pendingCleanups = [];
  const React = {
    // React 会调用函数组件来渲染, 桩也必须这样, 否则看不到组件内部的元素
    createElement: (type, props, ...children) => {
      if (typeof type === 'function') {
        const id = type.__hgId || (type.__hgId = nextComponentId++);
        const savedComponent = currentComponent;
        const savedCursor = hookCursor;
        currentComponent = id;
        hookCursor = 0;
        try {
          return type({ ...(props || {}), children });
        } finally {
          currentComponent = savedComponent;
          hookCursor = savedCursor;
        }
      }
      const element = { type, props, children };
      elements.push(element);
      return element;
    },
    useState: (initial) => {
      const key = currentComponent + ':' + hookCursor;
      hookCursor += 1;
      if (!hookState.has(key)) hookState.set(key, initial);
      const setter = (value) => {
        const previous = hookState.get(key);
        hookState.set(key, typeof value === 'function' ? value(previous) : value);
        flush();
      };
      return [hookState.get(key), setter];
    },
    useEffect: (effect, deps) => {
      const key = currentComponent + ':' + hookCursor;
      hookCursor += 1;
      const previous = effectCells.get(key);
      const sameDeps =
        previous &&
        Array.isArray(deps) &&
        Array.isArray(previous.deps) &&
        deps.length === previous.deps.length &&
        deps.every((value, index) => Object.is(value, previous.deps[index]));
      if (sameDeps) return;
      // 渲染期间只登记, 副作用由 flush 的提交阶段统一执行
      effectCells.set(key, { deps: deps ? deps.slice() : null, effect });
    },
  };

  // 每个组件有独立的 hook 作用域, 因此 hook 游标在 "每个组件渲染前" 复位
  function flush() {
    if (renderDepth > 0) return;
    renderDepth += 1;
    try {
      for (let pass = 0; pass < 4; pass += 1) {
        elements.length = 0;
        currentComponent = -1;
        for (const render of renderers) {
          hookCursor = 0;
          render();
        }
      }
      // 提交阶段: 执行本轮变更过的副作用 (与 React 一致)
      for (const cell of effectCells.values()) {
        if (cell.ran === cell.deps) continue;
        cell.ran = cell.deps;
        const cleanup = cell.effect();
        if (typeof cleanup === 'function') pendingCleanups.push(cleanup);
      }
    } finally {
      renderDepth -= 1;
    }
  }

  let captured = null;
  const sandbox = {
    console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push('ERR ' + a.join(' ')) },
    document: doc,
    navigator: { userAgent: 'fake' },
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener: (type, fn) => listeners[type]?.push(fn),
    removeEventListener: (type, fn) => { if (listeners[type]) listeners[type] = listeners[type].filter(f=>f!==fn); },
    Date,
    setTimeout,
    clearTimeout,
    __ModuleLoader__: { load: (definition) => { captured = definition; } },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(browserModuleSource(), sandbox, { filename: 'client-run.js' });

  assert.ok(captured, 'client bundle 未注册到 __ModuleLoader__');
  const plugin = captured.factory((name) => {
    if (name === 'react') return React;
    throw new Error('不允许的 require: ' + name);
  });
  if (options.inject) plugin.inject = options.inject;

  // register 期只登记渲染函数, 不执行; apply 之后统一首渲。
  // ctx 只提供 ctx.slots (与真实运行时一致), 刻意不提供 ctx.get('slots') ——
  // 这样 "依赖没声明导致静默失效" 这类问题会在测试里直接暴露。
  plugin.apply({
    get slots() {
      assert.ok(plugin.inject.includes('slots'), 'cannot get property "slots" without inject');
      return slots;
    },
    effect: (effect) => {
      const cleanup = effect();
      if (typeof cleanup === 'function') pendingCleanups.push(cleanup);
      return () => {};
    },
  });
  for (const render of registered) renderers.push(render);
  flush();

  assert.ok(listeners.mousemove.length >= 1, '应注册 mousemove 监听');
  // 节流是 50ms, 这里只触发一次; 状态变化会经 setter 自动重渲染
  for (const fn of listeners.mousemove) fn({ clientX: 100, clientY: 100 });

  return {
    elements,
    listeners,
    logs,
    cleanup() {
      for (const fn of pendingCleanups) fn();
    },
  };
}

/** 收集 React 元素树里的文本 */
function collectText(node, out) {
  if (node === null || node === undefined) return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  if (typeof node === 'object' && node.children) collectText(node.children, out);
  return out;
}

/** 某个 className 是否精确包含给定类名 (避免 hg-diag-head 被当成 hg-diag) */
function hasClass(element, name) {
  if (!element || !element.props || typeof element.props.className !== 'string') return false;
  return element.props.className.split(/\s+/).includes(name);
}

/** 浮层 (hg-tip) 里当前渲染出来的文本 */
function tipText(run) {
  const tip = run.elements.filter((element) => hasClass(element, 'hg-tip')).pop();
  if (!tip) return null;
  return collectText(tip, []).join(' ');
}

/** 诊断卡片 (hg-diag) 里当前渲染出来的文本 */
function diagText(run) {
  const card = run.elements.filter((element) => hasClass(element, 'hg-diag')).pop();
  if (!card) return null;
  return collectText(card, []).join(' ');
}

test('用例12: 鼠标经过正文里的词会渲染出联想浮层 (整条悬停路径)', () => {
  // 索引: u0 s1 e2 ␣3 W4 H5 O6 ␣7 h8 e9 r10 e11
  const node = { nodeType: 3, data: 'use WHO here' };

  // caret 落在所见字符右侧 (offset 7 = "WHO" 之后的空格): 必须向左回退一格取到 O
  const rightSide = runHoverOnce({ element: { tagName: 'SPAN' }, node, offset: 7 });
  const tip1 = tipText(rightSide);
  assert.ok(tip1, '悬停在 WHO 上应渲染浮层');
  assert.ok(tip1.includes('WHO'), `浮层应显示词本身, 实际: ${tip1}`);
  assert.ok(tip1.includes('世卫组织'), `浮层应显示 WHO 的条目, 实际: ${tip1}`);
  assert.ok(tip1.includes('谁'), `浮层应显示全部 1..N 条, 实际: ${tip1}`);

  // offset 正落在 "WHO" 中间 (caret 在 H 与 O 之间)
  const onChar = runHoverOnce({ element: { tagName: 'SPAN' }, node, offset: 6 });
  assert.ok((tipText(onChar) || '').includes('世卫组织'), 'offset 落在词内同样应命中');

  // offset 落在 "WHO" 的首字母 W 上
  const onFirst = runHoverOnce({ element: { tagName: 'SPAN' }, node, offset: 4 });
  assert.ok((tipText(onFirst) || '').includes('世卫组织'), 'offset 落在首字母上应命中');

  // 未收录的词: 不渲染浮层
  const none = runHoverOnce({ element: { tagName: 'SPAN' }, node, offset: 9 });
  assert.equal(tipText(none), null, '未收录的词不应渲染浮层');

  // 落在控件内: 不渲染浮层
  const insideButton = runHoverOnce({
    element: { tagName: 'BUTTON', parentElement: null },
    node,
    offset: 6,
  });
  assert.equal(tipText(insideButton), null, '控件内不应渲染浮层');

  // 取字返回 null: 不应抛错
  const blank = runHoverOnce({ element: null, node, offset: 6 });
  assert.equal(tipText(blank), null);
  assert.ok(!blank.logs.some((line) => line.startsWith('ERR')), `不应抛错: ${blank.logs.join(' | ')}`);

  assert.equal(diagText(rightSide), null, '用户要求没有额外诊断 GUI');
  for (const run of [rightSide,onChar,onFirst,none,insideButton,blank]) run.cleanup();
});

test('用例14: 服务依赖缺失时确实拒绝激活, 无 styles 全局也能运行', () => {
  assert.throws(() => runHoverOnce({element: {tagName:'SPAN'}, node:{nodeType:3,data:'WHO'},offset:1,inject:[]}), /without inject/);
  const run=runHoverOnce({element:{tagName:'SPAN'},node:{nodeType:3,data:'WHO'},offset:1});
  assert.ok(tipText(run).includes('世卫组织'));
  assert.ok(run.elements.some(e=>e.type==='style'), '样式由 React 管理');
  run.cleanup();
  assert.ok(Object.values(run.listeners).every(v=>v.length===0), '卸载移除所有监听器');
});

test('用例15: 五个词、中文连续正文和短语走真实 mousemove 查询路径', () => {
  for(const [text, offset, expected] of [
    ['WHO',1,'世卫组织'],['API',1,'应用程序编程接口'],['DSH',1,'数字签名硬件'],
    ['Cordis',2,'插件运行时'],['LLM',1,'大语言模型'],
    ['即世界卫生组织发布报告',3,'简称世卫组织'],['United Nations',3,'联合国']
  ]) {
    const run=runHoverOnce({element:{tagName:'SPAN'},node:{nodeType:3,data:text},offset});
    assert.ok((tipText(run)||'').includes(expected),text+' 应命中 '+expected);
    run.cleanup();
  }
});

test('用例16: 侧栏、行尾空白不触发, 滚动关闭浮层', () => {
  for(const extra of [{outside:true},{blank:true}]) {
    const run=runHoverOnce({element:{tagName:'SPAN'},node:{nodeType:3,data:'WHO'},offset:1,...extra});
    assert.equal(tipText(run),null);
    run.cleanup();
  }
  const run=runHoverOnce({element:{tagName:'SPAN'},node:{nodeType:3,data:'WHO'},offset:1});
  assert.ok(tipText(run));
  run.listeners.scroll.forEach(fn=>fn());
  assert.equal(tipText(run),null);
  run.cleanup();
});
