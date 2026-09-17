/**
 * hover-glossary / plugin/client-panel.js
 *
 * DSH 客户端插件包 (browser module) 的源码模板, 由 scripts/build-client.mjs 生成
 * profile 包 lib/client.js。契约与 @local/dsh-yukimi-theme 一致:
 *   window.__ModuleLoader__.load({ id, factory })
 *   factory(require) 内 require 只解析包名/平台原语, 不支持相对路径 -> 逻辑必须内联。
 *
 * 纯客户端: 词库内联在浏览器侧, 不需要 host 半边、不需要 RPC、不依赖任何会话级
 * 服务 (inject 为空), 因此进程重启后依然生效。
 *
 * "__INLINE_SOURCE__" 占位符由 scripts/build-client.mjs 替换为 src/ 的内联副本。
 */

window.__ModuleLoader__.load({
  // id 必须等于 package.json 的 name
  id: 'hover-glossary',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react');

    /* ===== 内联区开始 (由 build-client.mjs 从 src/ 生成) ===== */
/* 由 scripts/build-client.mjs 生成, 请勿手改; 改 src/ 后重新构建 */
/* ------------------------------------------------------------------ *
 * 文本规范化
 * ------------------------------------------------------------------ */

const APOSTROPHES = /[\u2018\u2019\u02bc\u02b9`]/g;
const PUNCT_EDGE = /^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu;
const CJK_SPACE = /(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu;


function normalize(input) {
  if (typeof input !== 'string') return '';
  let s = input.normalize('NFKC');
  s = s.replace(APOSTROPHES, "'");
  s = s.replace(/\s+/g, ' ');
  // 中文之间的空格视为排版噪声 ("世 卫 组织" -> "世卫组织")
  s = s.replace(CJK_SPACE, '');
  s = s.replace(PUNCT_EDGE, '');
  return s.toLowerCase();
}


function displayTerm(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ *
 * 游标 -> 词
 * ------------------------------------------------------------------ */

const WORD_CHAR =
  /[\p{L}\p{N}\p{M}\u2019\u02bc'\u05f3\u30fb\u30fc\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/u;


function isWordChar(ch) {
  if (typeof ch !== 'string' || ch.length === 0) return false;
  return WORD_CHAR.test(ch);
}


function tokenAt(text, cursor) {
  if (typeof text !== 'string' || text.length === 0) return null;
  if (!Number.isFinite(cursor)) return null;
  let i = Math.max(0, Math.min(text.length, Math.trunc(cursor)));
  // 光标停在词尾右侧 (紧邻的下一位) 时, 向左退一格归入该词;
  // 落在真正的空白/标点上时不归属任何词, 由 lookupAt 自行决定是否回退到前一个词。
  if (i >= text.length) {
    if (i > 0 && isWordChar(text[i - 1])) i -= 1;
    else return null;
  } else if (!isWordChar(text[i])) {
    return null;
  }
  let start = i;
  let end = i + 1;
  while (start > 0 && isWordChar(text[start - 1])) start -= 1;
  while (end < text.length && isWordChar(text[end])) end += 1;
  return { term: text.slice(start, end), start, end };
}




class Lexicon {
  
  constructor(options = {}) {
    
    this.entries = new Map();
    
    this.display = new Map();
    
    this.byLength = new Map();
    
    this.order = [];
    this.maxKeyLength = 0;
    this.maxEntriesPerTerm =
      Number.isFinite(options.maxEntriesPerTerm) && options.maxEntriesPerTerm > 0
        ? Math.trunc(options.maxEntriesPerTerm)
        : Infinity;
  }

  
  get size() {
    return this.entries.size;
  }

  
  get itemCount() {
    let n = 0;
    for (const list of this.entries.values()) n += list.length;
    return n;
  }

  
  add(term, items, opts = {}) {
    const key = normalize(term);
    if (key.length === 0) return this;
    const list = Array.isArray(items) ? items : [items];
    const incoming = [];
    for (const raw of list) {
      const entry = typeof raw === 'string' ? { text: raw } : raw;
      if (!entry || typeof entry.text !== 'string') continue;
      const text = displayTerm(entry.text);
      if (text.length === 0) continue;
      incoming.push({
        text,
        kind: typeof entry.kind === 'string' ? entry.kind : '释义',
        weight: Number.isFinite(entry.weight) ? entry.weight : 0,
        tags: Array.isArray(entry.tags) ? entry.tags.slice() : [],
      });
    }
    if (incoming.length === 0) return this;

    const existing = opts.replace === true ? [] : this.entries.get(key) || [];
    const merged = existing.concat(incoming).slice(0, this.maxEntriesPerTerm);
    // 稳定排序: 仅按 weight 降序, 同权重保持登记先后
    merged.sort((a, b) => b.weight - a.weight);
    // 重新编序号, 保证展示顺序与数据顺序一致
    merged.forEach((e, i) => {
      e.index = i + 1;
    });

    if (!this.entries.has(key)) {
      this.order.push(key);
      if (!this.byLength.has(key.length)) this.byLength.set(key.length, new Set());
      this.byLength.get(key.length).add(key);
      if (key.length > this.maxKeyLength) this.maxKeyLength = key.length;
    }
    this.entries.set(key, merged);
    this.display.set(key, displayTerm(term));
    return this;
  }

  
  load(table) {
    for (const term of Object.keys(table)) this.add(term, table[term]);
    return this;
  }

  
  has(keyOrTerm) {
    return this.entries.has(normalize(keyOrTerm));
  }

  
  lookup(term) {
    const list = this.entries.get(normalize(term));
    if (!list) return [];
    return list.map((e) => ({ ...e, tags: e.tags ? e.tags.slice() : [] }));
  }

  
  lookupAt(text, cursor, opts = {}) {
    const window = Math.min(
      Number.isFinite(opts.window) ? opts.window : 16,
      this.maxKeyLength > 0 ? this.maxKeyLength : 16,
    );
    let hit = tokenAt(text, cursor);
    // 光标没有落在词里时的两种情形:
    //  1) 紧跟在某个词右边的空白 -> 锚定该词, 面板保留用户刚看过的那个词;
    //  2) 被空白围住的纯空白位置 -> 向右跳到下一个词, 不越过它去猜左边的词;
    //  3) 其它非词字符 (标点) 且左侧紧邻词 -> 同样锚定左侧的词。
    if (!hit) {
      const pos = Math.max(0, Math.min(text.length, Math.trunc(cursor || 0)));
      const prev = pos > 0 ? text[pos - 1] : '';
      const staysLeft = (prev === ' ' || prev === '\t' || !isWordChar(text[pos] === undefined ? '' : text[pos])) && isWordChar(prev);
      if (staysLeft) {
        const left = tokenAt(text, pos - 1);
        if (left) hit = left;
      }
      if (!hit) {
        let next = pos;
        while (next < text.length && !isWordChar(text[next])) next += 1;
        if (next < text.length) return this.lookupAt(text, next, opts);
      }
    }
    const tokenStart = hit ? Math.min(hit.start, Math.max(0, Math.min(text.length, Math.trunc(cursor || 0)))) : 0;
    const tokenEnd = hit ? hit.end : 0;
    const anchored = hit !== null && hit !== undefined;
    // 扫描起点候选: 从光标所在 token 的首字符一直到光标本身。
    // 向左回溯是必要的 —— CJK 表格文字整段成一个 token, 光标压在 "世" 上时
    // 命中的应当是 "世卫组织" (从 "世" 开始), 而光标压在 "界" 上时应当
    // 仍能命中 "世界卫生组织" (从 "世" 开始)。
    // 不越过 token 首字符, 因此不会吞进前一个独立 token 的字。
    const starts = [];
    if (anchored) {
      const cursorPos = Math.max(0, Math.min(text.length, Math.trunc(cursor || 0)));
      for (let s = tokenStart; s <= cursorPos; s += 1) starts.push(s);
    }
    if (starts.length === 0) {
      starts.push(Math.max(0, Math.min(text.length, Math.trunc(cursor || 0))));
    }
    const cursorPos = anchored ? Math.max(0, Math.min(text.length, Math.trunc(cursor || 0))) : starts[0];
    const candidates = [];
    for (const start of starts) {
      // 每个起点最多向右读 "最长登记词" 个字符; 但光标所在 token 必须被读完,
      // 否则 "世界卫生组织发布报告" 这类长 token 的内部词会被截断。
      const stop = Math.min(text.length, Math.max(anchored && start === tokenStart ? tokenEnd : 0, start + Math.max(1, window)));
      let sawWordChar = false;
      for (let end = start + 1; end <= stop; end += 1) {
        const ch = text[end - 1];
        if (isWordChar(ch)) {
          sawWordChar = true;
          // 候选必须覆盖光标, 否则只是光标左侧的碎片
          if (end > cursorPos) {
            candidates.push({ key: normalize(text.slice(start, end)), start, end });
          }
          continue;
        }
        if (sawWordChar && (ch === ' ' || ch === '\t') && end < text.length && isWordChar(text[end])) continue;
        break;
      }
    }

    // 最长优先
    candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
    for (const candidate of candidates) {
      const list = this.entries.get(candidate.key);
      if (list && list.length > 0) {
        return {
          term: text.slice(candidate.start, candidate.end),
          key: candidate.key,
          start: candidate.start,
          end: candidate.end,
          entries: list.map((e) => ({ ...e, tags: e.tags ? e.tags.slice() : [] })),
        };
      }
    }
    // 兜底: 光标所在词整体
    if (hit) {
      const key = normalize(hit.term);
      const list = this.entries.get(key);
      if (list && list.length > 0) {
        return { term: hit.term, key, start: hit.start, end: hit.end, entries: list.map((e) => ({ ...e })) };
      }
    }
    return { term: hit ? hit.term : '', key: '', start: cursorPos, end: cursorPos, entries: [] };
  }

  
  list() {
    return this.order.map((key) => ({
      term: this.display.get(key) || key,
      key,
      entries: this.lookup(key),
    }));
  }

  
  validate() {
    const problems = [];
    for (const key of this.order) {
      const list = this.entries.get(key);
      if (!list || list.length === 0) problems.push(`${key}: 没有条目`);
      else list.forEach((e, i) => {
        if (e.index !== i + 1) problems.push(`${key}: 序号错位 (${e.index} != ${i + 1})`);
      });
      const bucket = this.byLength.get(key.length);
      if (!bucket || !bucket.has(key)) problems.push(`${key}: 未进入长度分桶`);
    }
    if (this.maxKeyLength > 0 && !this.byLength.has(this.maxKeyLength)) {
      problems.push(`maxKeyLength=${this.maxKeyLength} 无对应分桶`);
    }
    return { ok: problems.length === 0, problems };
  }
}


function createLexicon(table, options) {
  return new Lexicon(options).load(table || {});
}

/* ---- 预置词库 (来自 src/seed-data.mjs) ---- */
const SEED_TABLE = {
  // 需求给定的示例: 1 -> 2
  WHO: [
    { text: '世卫组织', kind: '缩写', weight: 100, tags: ['国际组织'] },
    { text: '谁', kind: '代词', weight: 10, tags: ['英文单词'] },
  ],
  API: [
    { text: '应用程序编程接口', kind: '缩写', weight: 100, tags: ['软件'] },
    { text: '空气污染指数', kind: '缩写', weight: 20, tags: ['环境'] },
    { text: '美国石油学会（标准代号）', kind: '缩写', weight: 10, tags: ['标准'] },
  ],
  DSH: [
    { text: 'DeepSeek Harness（本终端所在的产品）', kind: '缩写', weight: 100 },
    { text: '数字签名硬件', kind: '缩写', weight: 20, tags: ['硬件'] },
  ],
  Cordis: [
    { text: 'DSH 的插件运行时/依赖注入框架', kind: '术语', weight: 100, tags: ['框架'] },
    { text: '一种面向切面的轻量插件内核', kind: '术语', weight: 10 },
  ],
  LLM: [
    { text: '大语言模型', kind: '缩写', weight: 100, tags: ['AI'] },
    { text: '逻辑链路管理（网络层）', kind: '缩写', weight: 10, tags: ['网络'] },
  ],
  世卫组织: [
    { text: '世界卫生组织（WHO）', kind: '国际组织', weight: 100 },
    { text: '联合国专门机构之一，总部日内瓦', kind: '说明', weight: 50 },
  ],
  世界卫生组织: [{ text: '世界卫生组织（WHO），简称世卫组织', kind: '国际组织', weight: 100 }],
  'United Nations': [
    { text: '联合国（UN）', kind: '国际组织', weight: 100 },
    { text: '1945 年成立的政府间国际组织', kind: '说明', weight: 50 },
  ],
  DeepSeek: [
    { text: '深度求索（本模型的开发方）', kind: '专有名词', weight: 100 },
  ],
  PTY: [
    { text: '伪终端（pseudo-terminal）', kind: '缩写', weight: 100, tags: ['系统'] },
    { text: 'pty 是一个可持久化的交互式终端会话', kind: '功能', weight: 20, tags: ['DSH'] },
  ],
};

/* ===== 内联区结束 ===== */

    /** 词库索引: 纯客户端, 查询不再跨进程 */
    const INDEX = createLexicon(SEED_TABLE);

    const CSS = [
      '.hg-tip{position:fixed;z-index:2147483000;max-width:380px;pointer-events:none;',
      'padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);',
      'background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);',
      'box-shadow:0 6px 24px rgba(0,0,0,.28);font-size:12px;line-height:1.6;}',
      '.hg-tip-head{display:flex;align-items:baseline;gap:6px;margin-bottom:2px;}',
      '.hg-tip-word{font-weight:600;}',
      '.hg-tip-tag{color:var(--dsw-alias-label-secondary);font-size:11px;}',
      '.hg-tip ol{margin:0;padding-left:18px;}',
      '.hg-tip li{margin:1px 0;}',
      '.hg-tip .hg-tip-kind{color:var(--dsw-alias-label-secondary);font-size:11px;margin-left:6px;}',
      '.hg-diag{position:fixed;right:14px;bottom:14px;z-index:2147483000;max-width:460px;pointer-events:auto;',
      'padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);',
      'background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);',
      'box-shadow:0 6px 24px rgba(0,0,0,.28);font-size:11px;line-height:1.5;}',
      '.hg-diag pre{margin:4px 0 0;white-space:pre-wrap;word-break:break-all;font-size:11px;}',
      '.hg-diag .hg-diag-head{display:flex;align-items:center;gap:8px;}',
      '.hg-diag button{all:unset;cursor:pointer;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);',
      'border-radius:4px;color:var(--dsw-alias-label-secondary);}',
      '.hg-ok{color:var(--dsw-alias-state-success-primary);}',
      '.hg-bad{color:var(--dsw-alias-state-error-primary);}',
    ].join('');

    const hoverStore = {
      state: { visible: false, term: '', entries: [], x: 0, y: 0 },
      listeners: new Set(),
      publish(next) {
        this.state = next;
        for (const listener of this.listeners) listener(next);
      },
    };

    const diagStore = {
      state: null,
      listeners: new Set(),
      publish(next) {
        this.state = next;
        for (const listener of this.listeners) listener(next);
      },
    };

    const BROWSER = (() => {
      const doc = typeof document === 'undefined' ? null : document;
      if (!doc || typeof doc.addEventListener !== 'function') return null;
      return { root: window, doc };
    })();

    /** 交互控件与其它浮层内不查询 */
    const INTERACTIVE = { button: 1, a: 1, input: 1, textarea: 1, select: 1, option: 1, summary: 1 };

    /** 取某个文档坐标处的字符及其所在文本 */
    function charAtPoint(x, y) {
      if (!BROWSER) return null;
      const doc = BROWSER.doc;
      const element = doc.elementFromPoint(x, y);
      if (!element) return null;

      let node = null;
      let offset = -1;
      if (typeof doc.caretRangeFromPoint === 'function') {
        const range = doc.caretRangeFromPoint(x, y);
        if (range && range.startContainer && range.startContainer.nodeType === 3) {
          node = range.startContainer;
          offset = range.startOffset;
        }
      }
      if (!node && typeof doc.caretPositionFromPoint === 'function') {
        const position = doc.caretPositionFromPoint(x, y);
        if (position && position.offsetNode && position.offsetNode.nodeType === 3) {
          node = position.offsetNode;
          offset = position.offset;
        }
      }
      if (!node || offset < 0) return null;

      const data = typeof node.data === 'string' ? node.data : '';
      if (data.length === 0) return null;

      // caret 的 offset 可能落在所见字符右侧, 因此左右两侧都试
      const candidates = [];
      if (offset > 0 && isWordChar(data[offset - 1])) candidates.push(offset - 1);
      if (offset < data.length && isWordChar(data[offset])) candidates.push(offset);
      if (candidates.length === 0) return null;
      return { text: data, at: candidates[0], element };
    }

    /** 从命中元素向上走, 判断能否查询, 并记录原因 */
    function classify(element) {
      if (!element) return { ok: false, reason: 'no-element', chain: [] };
      const chain = [];
      let current = element;
      while (current && current !== BROWSER.doc.body && current !== BROWSER.doc.documentElement) {
        const tag = typeof current.tagName === 'string' ? current.tagName.toLowerCase() : '?';
        let cls = '';
        try {
          cls = typeof current.className === 'string' ? current.className : '';
        } catch (error) {
          cls = '';
        }
        chain.push(tag + (cls ? '.' + cls.split(' ').filter(Boolean).slice(0, 2).join('.') : ''));
        if (chain.length >= 6) break;
        if (INTERACTIVE[tag]) return { ok: false, reason: 'inside-' + tag, chain };
        current = current.parentElement;
      }
      return { ok: true, reason: 'text', chain };
    }

    /** 启动自检 */
    function selfCheck() {
      const trace = {};
      trace.index = INDEX.size + ' 词 / ' + INDEX.itemCount + ' 条';
      trace.hasElementFromPoint = !!(BROWSER && BROWSER.doc.elementFromPoint);
      trace.hasCaretRangeFromPoint = !!(BROWSER && BROWSER.doc.caretRangeFromPoint);
      trace.hasCaretPositionFromPoint = !!(BROWSER && BROWSER.doc.caretPositionFromPoint);
      if (BROWSER) {
        const w = BROWSER.root.innerWidth || 0;
        const h = BROWSER.root.innerHeight || 0;
        const probe = charAtPoint(Math.round(w * 0.5), Math.round(h * 0.35));
        trace.probe = probe
          ? { ok: true, text: probe.text.slice(0, 24), at: probe.at, glyph: probe.text[probe.at] }
          : { ok: false };
        if (probe) {
          const verdict = classify(probe.element);
          trace.classify = { ok: verdict.ok, reason: verdict.reason, chain: verdict.chain.join(' < ') };
          const token = tokenAt(probe.text, probe.at);
          trace.token = token ? token.term : null;
          trace.inLexicon = token ? INDEX.has(normalize(token.term)) : false;
        }
      }
      diagStore.publish(trace);
      if (typeof globalThis !== 'undefined') globalThis.__hoverGlossaryDiag__ = trace;
      console.log('[hover-glossary] 自检 ' + JSON.stringify(trace));
      return trace;
    }

    function GlossaryTip() {
      const [state, setState] = React.useState(hoverStore.state);
      React.useEffect(() => {
        const listener = (next) => setState(next);
        hoverStore.listeners.add(listener);
        return () => hoverStore.listeners.delete(listener);
      }, []);
      if (!state.visible) return null;
      const width = BROWSER ? BROWSER.root.innerWidth : 1200;
      const style = { left: Math.min(state.x + 14, width - 400) + 'px', top: state.y + 18 + 'px' };
      const head = React.createElement(
        'div',
        { className: 'hg-tip-head' },
        React.createElement('span', { className: 'hg-tip-word' }, state.term),
        React.createElement('span', { className: 'hg-tip-tag' }, state.entries.length + ' 条'),
      );
      const body = React.createElement(
        'ol',
        null,
        state.entries.map((entry, index) =>
          React.createElement(
            'li',
            { key: index },
            entry.text,
            entry.kind ? React.createElement('span', { className: 'hg-tip-kind' }, entry.kind) : null,
          ),
        ),
      );
      return React.createElement('div', { className: 'hg-tip', style: style }, head, body);
    }

    /**
     * 诊断卡片: 只在需要时出现, 正常情况静默自动消失,
     * 免得持久安装的插件在界面上长期占一块区域。
     */
    function DiagCard() {
      const [trace, setTrace] = React.useState(diagStore.state);
      React.useEffect(() => {
        const listener = (next) => setTrace(next);
        diagStore.listeners.add(listener);
        return () => diagStore.listeners.delete(listener);
      }, []);
      React.useEffect(() => {
        if (!trace) return undefined;
        const timer = setTimeout(() => diagStore.publish(null), 12000);
        return () => clearTimeout(timer);
      }, [trace]);
      if (!trace) return null;
      const lines = Object.keys(trace).map((key) => key + ': ' + JSON.stringify(trace[key]));
      return React.createElement(
        'div',
        { className: 'hg-diag' },
        React.createElement(
          'div',
          { className: 'hg-diag-head' },
          React.createElement('strong', null, '悬停词典自检'),
          React.createElement('span', { style: { flex: 1 } }),
          React.createElement('button', { onClick: () => selfCheck() }, '重测'),
          React.createElement('button', { onClick: () => diagStore.publish(null) }, '关闭'),
        ),
        React.createElement('pre', null, lines.join('\n')),
      );
    }

    function apply(ctx) {
      const slots = ctx.get('slots');
      if (slots === undefined) {
        console.error('slots 服务不可用: 悬停词典未注册');
        return;
      }
      const disposeStyles = styles.insert(CSS);
      ctx.effect(() => disposeStyles);

      slots.inject('shell.overlay', () =>
        slots.register({ name: 'shell.overlay', id: 'hover-glossary-tip', order: 200 }, () =>
          React.createElement(GlossaryTip),
        ),
      );
      slots.inject('shell.overlay', () =>
        slots.register({ name: 'shell.overlay', id: 'hover-glossary-diag', order: 201 }, () =>
          React.createElement(DiagCard),
        ),
      );

      if (!BROWSER) {
        console.error('当前环境没有 document: 悬停词典无法监听光标');
        return;
      }

      selfCheck();

      let seq = 0;
      let shown = '';
      let last = 0;

      const hide = () => {
        seq += 1;
        shown = '';
        if (hoverStore.state.visible) {
          hoverStore.publish({ visible: false, term: '', entries: [], x: 0, y: 0 });
        }
      };

      // 普通闭包节流, 不依赖任何注入服务
      const onMove = (event) => {
        const now = Date.now();
        if (now - last < 50) return;
        last = now;

        const x = event.clientX;
        const y = event.clientY;
        const hit = charAtPoint(x, y);
        if (!hit) {
          hide();
          return;
        }
        const verdict = classify(hit.element);
        if (!verdict.ok) {
          hide();
          return;
        }
        const token = tokenAt(hit.text, hit.at);
        if (!token) {
          hide();
          return;
        }
        const key = normalize(token.term);
        if (!INDEX.has(key)) {
          hide();
          return;
        }
        if (key === shown) {
          hoverStore.publish({ ...hoverStore.state, visible: true, x, y });
          return;
        }
        shown = key;
        seq += 1;
        const reason = seq;
        void reason;
        hoverStore.publish({ visible: true, term: token.term, entries: INDEX.lookup(key), x, y });
      };

      const onLeave = () => hide();

      BROWSER.doc.addEventListener('mousemove', onMove, { passive: true });
      BROWSER.doc.addEventListener('mouseleave', onLeave, { passive: true });
      ctx.effect(() => () => {
        BROWSER.doc.removeEventListener('mousemove', onMove);
        BROWSER.doc.removeEventListener('mouseleave', onLeave);
        if (typeof globalThis !== 'undefined') delete globalThis.__hoverGlossaryDiag__;
        hoverStore.publish({ visible: false, term: '', entries: [], x: 0, y: 0 });
      });
    }

    exports.apply = apply;
    // 不注入任何会话级服务: 整个能力都在浏览器侧
    exports.inject = [];
    return module.exports;
  },
});
