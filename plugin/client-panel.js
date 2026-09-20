/**
 * hover-glossary / plugin/client-panel.js
 *
 * DSH 客户端插件包 (browser module) 的源码模板, 由 scripts/build-client.mjs 生成
 * profile 包 lib/client.js。契约与 @local/dsh-yukimi-theme 一致:
 *   window.__ModuleLoader__.load({ id, factory })
 *   factory(require) 内 require 只解析包名/平台原语, 不支持相对路径 -> 逻辑必须内联。
 *
 * 纯客户端: 词库内联在浏览器侧, 不需要 host 半边、不需要 RPC、不依赖任何会话级
 * 服务; 仅通过 inject 声明客户端 slots 服务。profile 安装使其重启后依然生效。
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

    /* ================= 内联区开始 (build-client.mjs 生成) ================= */
    /*__INLINE_SOURCE__*/
    /* ================= 内联区结束 ================= */

    /** 词库索引: 纯客户端, 查询不再跨进程 */
    const INDEX = createLexicon(SEED_TABLE);

    const CSS = [
      '.hg-tip{position:fixed;z-index:2147483000;max-width:min(380px,calc(100vw - 24px));pointer-events:none;box-sizing:border-box;',
      'padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);',
      'background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);',
      'box-shadow:0 6px 24px rgba(0,0,0,.28);font-size:12px;line-height:1.6;}',
      '.hg-tip-head{display:flex;align-items:baseline;gap:6px;margin-bottom:2px;}',
      '.hg-tip-word{font-weight:600;}',
      '.hg-tip-tag{color:var(--dsw-alias-label-secondary);font-size:11px;}',
      '.hg-tip ol{margin:0;padding-left:18px;}',
      '.hg-tip li{margin:1px 0;}',
      '.hg-tip .hg-tip-kind{color:var(--dsw-alias-label-secondary);font-size:11px;margin-left:6px;}',
    ].join('');

    const hoverStore = {
      state: { visible: false, term: '', entries: [], x: 0, y: 0 },
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
      for (const at of candidates) {
        // caret API 会把行尾空白也吸附到最近文字; 验证指针确实落在字符矩形内。
        const glyph = doc.createRange();
        glyph.setStart(node, at);
        glyph.setEnd(node, at + 1);
        if (Array.from(glyph.getClientRects()).some(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) {
          return { text: data, at, element: node.parentElement || element };
        }
      }
      return null;
    }

    /** 从命中元素向上走, 判断能否查询, 并记录原因 */
    function classify(element) {
      if (!element) return { ok: false, reason: 'no-element', chain: [] };
      const chain = [];
      let current = element;
      let inConversation = false;
      while (current && current !== BROWSER.doc.body && current !== BROWSER.doc.documentElement) {
        const tag = typeof current.tagName === 'string' ? current.tagName.toLowerCase() : '?';
        let cls = '';
        try {
          cls = typeof current.className === 'string' ? current.className : '';
        } catch (error) {
          cls = '';
        }
        if (chain.length < 6) chain.push(tag + (cls ? '.' + cls.split(' ').filter(Boolean).slice(0, 2).join('.') : ''));
        if (INTERACTIVE[tag]) return { ok: false, reason: 'inside-' + tag, chain };
        if (current.getAttribute && current.getAttribute('contenteditable') === 'true') return { ok: false, reason: 'editable', chain };
        const kind = current.getAttribute && current.getAttribute('data-chat-flow-kind');
        if (kind === 'user' || kind === 'assistant-step' || kind === 'steering') inConversation = true;
        current = current.parentElement;
      }
      return { ok: inConversation, reason: inConversation ? 'conversation' : 'outside-conversation', chain };
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
      const height = BROWSER ? BROWSER.root.innerHeight : 800;
      const below = state.y < height / 2;
      const style = { left: Math.max(12, Math.min(state.x + 14, width - 392)) + 'px',
        top: below ? state.y + 18 + 'px' : undefined,
        bottom: below ? undefined : height - state.y + 12 + 'px',
        maxHeight: Math.max(40, (below ? height - state.y - 30 : state.y - 24)) + 'px', overflow: 'auto' };
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
      return React.createElement('div', { className: 'hg-tip', role: 'tooltip', style: style }, head, body);
    }

    function apply(ctx) {
      // 模块图依赖在 package.json 中; 服务依赖由下面导出的 inject 声明。
      const slots = ctx.slots;

      slots.inject('shell.overlay', () =>
        slots.register({ name: 'shell.overlay', id: 'hover-glossary-tip', order: 200 }, () =>
          React.createElement(React.Fragment, null,
            React.createElement('style', { 'data-hover-glossary': '' }, CSS),
            React.createElement(GlossaryTip)),
        ),
      );

      if (!BROWSER) {
        console.error('当前环境没有 document: 悬停词典无法监听光标');
        return;
      }

      selfCheck();

      let shown = '';
      let last = 0;

      const hide = () => {
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
        const match = INDEX.lookupAt(hit.text, hit.at);
        const key = match.key;
        if (match.entries.length === 0) {
          hide();
          return;
        }
        if (key === shown) {
          hoverStore.publish({ ...hoverStore.state, visible: true, x, y });
          return;
        }
        shown = key;
        hoverStore.publish({ visible: true, term: match.term, entries: match.entries, x, y });
      };

      const onLeave = () => hide();

      BROWSER.doc.addEventListener('mousemove', onMove, { passive: true });
      BROWSER.doc.addEventListener('mouseleave', onLeave, { passive: true });
      BROWSER.doc.addEventListener('scroll', onLeave, true);
      BROWSER.root.addEventListener('blur', onLeave);
      ctx.effect(() => () => {
        BROWSER.doc.removeEventListener('mousemove', onMove);
        BROWSER.doc.removeEventListener('mouseleave', onLeave);
        BROWSER.doc.removeEventListener('scroll', onLeave, true);
        BROWSER.root.removeEventListener('blur', onLeave);
        if (typeof globalThis !== 'undefined') delete globalThis.__hoverGlossaryDiag__;
        hoverStore.publish({ visible: false, term: '', entries: [], x: 0, y: 0 });
      });
    }

    exports.apply = apply;
    // Cordis 的服务访问授权, 与 manifest 中的模块依赖不是同一个列表。
    exports.inject = ['slots'];
    return module.exports;
  },
});
