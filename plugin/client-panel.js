/**
 * hover-glossary / plugin/client-panel.js
 *
 * Cordis Client 半的源码: 一个纯 JS 函数体 (无 import/require)。
 * "__INLINE_SOURCE__" 占位符由 scripts/build-client.mjs 替换为 src/ 的内联副本。
 *
 * 行为:
 *   - 鼠标停在你输入的正文或我输出的正文里的某个词上, 该词若在词库中,
 *     就在光标旁浮出行内联想 (1、... 2、... 3、...)。
 *   - 不渲染任何面板; 词库的维护不出现在 GUI 里, 只由 Host 的词库决定。
 *   - 判定范围限制在会话正文区域: 通过两个不可见锚点标记 (每轮 turnTail +
 *     输入区 dock), 只有落在锚点内部的字符才会被查询。
 */

/* ================= 内联区开始 (build-client.mjs 生成) ================= */
/*__INLINE_SOURCE__*/
/* ================= 内联区结束 ================= */

/** 锚点属性: 标记 "允许悬停查询" 的会话正文区域 */
const ZONE_ATTR = 'data-hg-zone';

/** 客户端词库索引: 用于快速判断光标处的词是否收录 (查询结果仍以 Host 为准) */
const INDEX = createLexicon(SEED_TABLE);

const CSS = [
  '.hg-tip{position:fixed;z-index:2147483000;max-width:360px;pointer-events:none;',
  'padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);',
  'background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);',
  'box-shadow:0 6px 24px rgba(0,0,0,.28);font-size:12px;line-height:1.6;}',
  '.hg-tip-head{display:flex;align-items:baseline;gap:6px;margin-bottom:2px;}',
  '.hg-tip-word{font-weight:600;}',
  '.hg-tip-tag{color:var(--dsw-alias-label-secondary);font-size:11px;}',
  '.hg-tip ol{margin:0;padding-left:18px;}',
  '.hg-tip li{margin:1px 0;}',
  '.hg-tip .hg-tip-kind{color:var(--dsw-alias-label-secondary);font-size:11px;margin-left:6px;}',
  '.hg-zone{display:none!important;}',
].join('');

/** 当前悬停状态, 由引擎写入、由浮层组件订阅 */
const hoverStore = {
  state: { visible: false, term: '', entries: [], x: 0, y: 0, loading: false },
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

/**
 * 取某个文档坐标处的字符及其所在文本。
 * 优先使用 elementFromPoint 拿到最上层元素, 再用 caretRangeFromPoint /
 * caretPositionFromPoint 定位到具体的文本节点与偏移。
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
  // 光标点在字符右半边时 offset 指向下一个字符, 向左退一格归入所见字符
  let at = Math.min(offset, data.length - 1);
  if (at > 0 && at < data.length && !isWordChar(data[at]) && isWordChar(data[at - 1])) at -= 1;
  if (at < 0 || !isWordChar(data[at])) return null;
  return { text: data, at, node, element };
}

/** 该元素是否位于被锚点标记的会话正文区域内 */
function insideZone(element) {
  if (!element) return false;
  let current = element;
  while (current && current !== BROWSER.doc.body) {
    if (typeof current.hasAttribute === 'function' && current.hasAttribute(ZONE_ATTR)) return true;
    // 交互控件与其它浮层不参与查询
    const tag = typeof current.tagName === 'string' ? current.tagName.toLowerCase() : '';
    if (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'textarea' || tag === 'select') {
      return false;
    }
    current = current.parentElement;
  }
  return false;
}

/** 浮层列表组件: 订阅悬停状态, 在光标旁渲染编号条目 */
function GlossaryTip() {
  const [state, setState] = React.useState(hoverStore.state);

  React.useEffect(() => {
    const listener = (next) => setState(next);
    hoverStore.listeners.add(listener);
    return () => hoverStore.listeners.delete(listener);
  }, []);

  if (!state.visible) return null;

  const style = { left: state.x + 14 + 'px', top: state.y + 18 + 'px' };
  const head = React.createElement(
    'div',
    { className: 'hg-tip-head' },
    React.createElement('span', { className: 'hg-tip-word' }, state.term),
    React.createElement('span', { className: 'hg-tip-tag' }, state.loading ? '查询中…' : state.entries.length + ' 条'),
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

/** 不可见锚点: 标出会话正文区域, 自身不占空间、不显示 */
function ZoneAnchor() {
  return React.createElement('span', { className: 'hg-zone', 'aria-hidden': 'true', [ZONE_ATTR]: '1' });
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

    slots.inject('shell.overlay', () =>
      slots.register({ name: 'shell.overlay', id: 'hover-glossary-tip', order: 200 }, () =>
        React.createElement(GlossaryTip, null),
      ),
    );

    // 会话正文区域锚点: 每一轮对话的尾部一个 + 输入区一个
    slots.inject('conversation.chat.turnTail', () =>
      slots.register({ name: 'conversation.chat.turnTail', select: () => 'zone' }, () =>
        React.createElement(ZoneAnchor, null),
      ),
    );
    slots.inject('conversation.input.dock', () =>
      slots.register({ name: 'conversation.input.dock', id: 'hover-glossary-zone', order: 1000 }, () =>
        React.createElement(ZoneAnchor, null),
      ),
    );

    if (!BROWSER) {
      console.error('当前环境没有 document: 悬停词典无法监听光标');
      return;
    }

    let seq = 0;
    let shown = '';
    let pending = null;

    const hide = () => {
      seq += 1;
      shown = '';
      pending = null;
      if (hoverStore.state.visible) {
        hoverStore.publish({ visible: false, term: '', entries: [], x: 0, y: 0, loading: false });
      }
    };

    const onMove = (event) => {
      const x = event.clientX;
      const y = event.clientY;
      const hit = charAtPoint(x, y);
      if (!hit || !insideZone(hit.element)) {
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
        // 同一个词: 只跟随光标移动, 不重复查询
        hoverStore.publish({ ...hoverStore.state, visible: true, x, y });
        return;
      }
      shown = key;
      pending = { x, y, term: token.term };
      seq += 1;
      const mine = seq;
      hoverStore.publish({ visible: true, term: token.term, entries: [], x, y, loading: true });
      host
        .call('glossary/resolve', {
          text: hit.text,
          cursor: hit.at,
          term: token.term,
          keepLeft: true,
        })
        .then((answer) => {
          if (mine !== seq || !pending) return;
          const entries = answer && answer.ok === true && Array.isArray(answer.entries) ? answer.entries : [];
          hoverStore.publish({
            visible: true,
            term: token.term,
            entries,
            x: pending.x,
            y: pending.y,
            loading: false,
          });
        })
        .catch(() => {
          if (mine !== seq) return;
          shown = '';
          hoverStore.publish({ visible: false, term: '', entries: [], x: 0, y: 0, loading: false });
        });
    };

    const move = ctx.timer.throttle(onMove, 60);
    const onLeave = () => hide();

    BROWSER.doc.addEventListener('mousemove', move, { passive: true });
    BROWSER.doc.addEventListener('mouseleave', onLeave, { passive: true });
    ctx.effect(() => () => {
      BROWSER.doc.removeEventListener('mousemove', move);
      BROWSER.doc.removeEventListener('mouseleave', onLeave);
      if (typeof move.dispose === 'function') move.dispose();
      hoverStore.publish({ visible: false, term: '', entries: [], x: 0, y: 0, loading: false });
    });
  },
};
