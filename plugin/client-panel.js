/**
 * hover-glossary / plugin/client-panel.js
 *
 * Cordis Client 半的源码: 一个纯 JS 函数体 (无 import/require)。
 * "__INLINE_SOURCE__" 占位符由 scripts/build-client.mjs 替换为 src/ 的内联副本。
 *
 * 行为:
 *   - 鼠标停在你输入的正文或我输出的正文里的某个词上, 该词若在词库中,
 *     就在光标旁浮出行内联想 (1、... 2、... 3、...)。
 *   - 不渲染任何面板; 词库维护不出现在 GUI 里。
 *   - 范围判定不依赖任何锚点元素 (turnTail 是 selector chain, 与框架自带条目存在
 *     竞争, 锚点不一定渲染): 改为 "命中文本 + 不在控件/浮层内" 的判定。
 *   - 启动时做一次自检 (host RPC + 取字函数), 结果写进 console 与 globalThis,
 *     并在浮层上短暂显示, 便于诊断 "为什么没有反应"。
 */

/* ================= 内联区开始 (build-client.mjs 生成) ================= */
/*__INLINE_SOURCE__*/
/* ================= 内联区结束 ================= */

/** 客户端词库索引: 用于快速判断光标处的词是否收录 (条目内容仍以 Host 为准) */
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
  '.hg-diag .hg-ok{color:var(--dsw-alias-state-success-primary);}',
  '.hg-diag .hg-bad{color:var(--dsw-alias-state-error-primary);}',
].join('');

/** 悬停状态 */
const hoverStore = {
  state: { visible: false, term: '', entries: [], x: 0, y: 0, loading: false, note: '' },
  listeners: new Set(),
  publish(next) {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  },
};

/** 自检结果 */
const diagStore = {
  state: null,
  listeners: new Set(),
  publish(next) {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  },
};

const BROWSER = (() => {
  const root = typeof globalThis === 'undefined' ? undefined : globalThis;
  const doc = root && root.document;
  if (!doc || typeof doc.addEventListener !== 'function') return null;
  return { root, doc };
})();

/** 交互控件与其它浮层内不查询 */
const INTERACTIVE = { button: 1, a: 1, input: 1, textarea: 1, select: 1, option: 1, summary: 1 };

/**
 * 取某个文档坐标处的字符及其所在文本。
 * @returns {{text:string, at:number, node:Text, element:Element}|null}
 */
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

  // caret 的 offset 可能落在所见字符的右侧 (半个字宽以内都会如此),
  // 因此左右两侧都试一次, 取那个真在词里的位置。
  const candidates = [];
  if (offset > 0 && isWordChar(data[offset - 1])) candidates.push(offset - 1);
  if (offset < data.length && isWordChar(data[offset])) candidates.push(offset);
  if (candidates.length === 0) return null;
  return { text: data, at: candidates[0], node, element };
}

/** 从命中的元素向上走, 判断能否查询, 并记录原因 */
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

/** 启动自检: host RPC + 取字 + 分类 */
function selfCheck() {
  const trace = {};
  trace.index = INDEX.size + ' 词 / ' + INDEX.itemCount + ' 条';
  trace.ua = BROWSER ? String(BROWSER.root.navigator && BROWSER.root.navigator.userAgent) : 'no-document';
  trace.hasElementFromPoint = !!(BROWSER && BROWSER.doc.elementFromPoint);
  trace.hasCaretRangeFromPoint = !!(BROWSER && BROWSER.doc.caretRangeFromPoint);
  trace.hasCaretPositionFromPoint = !!(BROWSER && BROWSER.doc.caretPositionFromPoint);

  // 在会话正文中心取一个点, 看能否取到字
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
  if (BROWSER && BROWSER.root && BROWSER.root.globalThis) {
    BROWSER.root.globalThis.__hoverGlossaryDiag__ = trace;
  }
  console.log('[hover-glossary] 自检 ' + JSON.stringify(trace));
  return trace;
}

/** 悬停浮层 */
function GlossaryTip() {
  const [state, setState] = React.useState(hoverStore.state);

  React.useEffect(() => {
    const listener = (next) => setState(next);
    hoverStore.listeners.add(listener);
    return () => hoverStore.listeners.delete(listener);
  }, []);

  if (!state.visible) return null;
  const style = { left: Math.min(state.x + 14, (BROWSER ? BROWSER.root.innerWidth : 1200) - 400) + 'px', top: state.y + 18 + 'px' };
  const head = React.createElement(
    'div',
    { className: 'hg-tip-head' },
    React.createElement('span', { className: 'hg-tip-word' }, state.term),
    React.createElement(
      'span',
      { className: 'hg-tip-tag' },
      state.loading ? '查询中…' : state.entries.length + ' 条' + (state.note ? ' · ' + state.note : ''),
    ),
  );
  const body = state.entries.length
    ? React.createElement(
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
      )
    : React.createElement('div', { className: 'hg-tip-tag' }, state.loading ? '' : '词库中暂无该词');
  return React.createElement('div', { className: 'hg-tip', style: style }, head, body);
}

/** 自检卡片: 让 "为什么没反应" 直接可见, 可关闭 */
function DiagCard() {
  const [trace, setTrace] = React.useState(diagStore.state);

  React.useEffect(() => {
    const listener = (next) => setTrace(next);
    diagStore.listeners.add(listener);
    return () => diagStore.listeners.delete(listener);
  }, []);

  if (!trace) return null;
  const lines = Object.keys(trace).map((key) => key + ': ' + JSON.stringify(trace[key]));
  const good = trace.hasCaretRangeFromPoint || trace.hasCaretPositionFromPoint;
  return React.createElement(
    'div',
    { className: 'hg-diag' },
    React.createElement(
      'div',
      { className: 'hg-diag-head' },
      React.createElement('strong', null, '悬停词典自检'),
      React.createElement('span', { className: good ? 'hg-ok' : 'hg-bad' }, good ? '取字可用' : '取字不可用'),
      React.createElement('span', { style: { flex: 1 } }),
      React.createElement('button', { onClick: () => selfCheck() }, '重测'),
      React.createElement('button', { onClick: () => diagStore.publish(null) }, '关闭'),
    ),
    React.createElement('pre', null, lines.join('\n')),
  );
}

return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots');
    if (slots === undefined) {
      console.error('slots 服务不可用: 悬停词典未注册');
      return;
    }
    const disposeStyles = styles.insert(CSS);
    ctx.effect(() => disposeStyles);

    // 浮层
    slots.inject('shell.overlay', () =>
      slots.register({ name: 'shell.overlay', id: 'hover-glossary-tip', order: 200 }, () =>
        React.createElement(GlossaryTip, null),
      ),
    );
    // 自检卡片 (仍注册在 shell.overlay, 只是另一个 id)
    slots.inject('shell.overlay', () =>
      slots.register({ name: 'shell.overlay', id: 'hover-glossary-diag', order: 201 }, () =>
        React.createElement(DiagCard, null),
      ),
    );

    if (!BROWSER) {
      console.error('当前环境没有 document: 悬停词典无法监听光标');
      return;
    }

    selfCheck();

    let seq = 0;
    let shown = '';
    let lastMiss = '';

    const hide = () => {
      seq += 1;
      shown = '';
      if (hoverStore.state.visible) {
        hoverStore.publish({ visible: false, term: '', entries: [], x: 0, y: 0, loading: false, note: '' });
      }
    };

    const onMove = (event) => {
      const x = event.clientX;
      const y = event.clientY;
      const hit = charAtPoint(x, y);
      if (!hit) {
        lastMiss = 'point:no-glyph';
        hide();
        return;
      }
      const verdict = classify(hit.element);
      if (!verdict.ok) {
        lastMiss = 'point:' + verdict.reason;
        hide();
        return;
      }
      const token = tokenAt(hit.text, hit.at);
      if (!token) {
        lastMiss = 'point:no-token';
        hide();
        return;
      }
      const key = normalize(token.term);
      if (!INDEX.has(key)) {
        lastMiss = 'not-in-lexicon';
        hide();
        return;
      }
      lastMiss = '';
      if (key === shown) {
        hoverStore.publish({ ...hoverStore.state, visible: true, x, y });
        return;
      }
      shown = key;
      seq += 1;
      const mine = seq;
      hoverStore.publish({ visible: true, term: token.term, entries: [], x, y, loading: true, note: '' });
      host
        .call('glossary/resolve', { text: hit.text, cursor: hit.at, term: token.term, keepLeft: true })
        .then((answer) => {
          if (mine !== seq) return;
          const entries = answer && answer.ok === true && Array.isArray(answer.entries) ? answer.entries : [];
          const note = answer && answer.ok === true ? '' : 'Host 无响应';
          hoverStore.publish({ visible: true, term: token.term, entries, x, y, loading: false, note });
        })
        .catch((error) => {
          if (mine !== seq) return;
          shown = '';
          hoverStore.publish({
            visible: true,
            term: token.term,
            entries: [],
            x,
            y,
            loading: false,
            note: 'RPC 失败: ' + String((error && error.message) || error),
          });
        });
    };

    const move = ctx.timer.throttle(onMove, 50);
    const onLeave = () => hide();
    const onMove2 = (event) => {
      try {
        move(event);
      } catch (error) {
        console.error('移动处理失败: ' + String((error && error.message) || error));
      }
    };

    BROWSER.doc.addEventListener('mousemove', onMove2, { passive: true });
    BROWSER.doc.addEventListener('mouseleave', onLeave, { passive: true });
    ctx.effect(() => () => {
      BROWSER.doc.removeEventListener('mousemove', onMove2);
      BROWSER.doc.removeEventListener('mouseleave', onLeave);
      if (typeof move.dispose === 'function') move.dispose();
      if (BROWSER.root && BROWSER.root.globalThis) {
        delete BROWSER.root.globalThis.__hoverGlossaryDiag__;
      }
      hoverStore.publish({ visible: false, term: '', entries: [], x: 0, y: 0, loading: false, note: '' });
    });
  },
};
