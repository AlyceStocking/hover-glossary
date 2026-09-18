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

    /* ================= 内联区开始 (build-client.mjs 生成) ================= */
    /*__INLINE_SOURCE__*/
    /* ================= 内联区结束 ================= */

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
      // slots 是已声明的注入依赖 (见 package.json 的 dsh.client.inject), 因此用 ctx.slots。
      // 不要退回可选取值写法: 它在服务未解析时会静默拿到 undefined,
      // 让插件无声失效 —— 那正是之前最难查的一点。
      const slots = ctx.slots;
      if (slots === undefined) {
        console.error('slots 服务不可用: 悬停词典未注册 (检查 dsh.client.inject 是否声明了 slots)');
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
