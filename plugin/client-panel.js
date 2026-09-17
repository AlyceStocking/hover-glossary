/**
 * hover-glossary / plugin/client-panel.js
 *
 * Cordis Client 半的源码: 一个纯 JS 函数体 (无 import/require)。
 * "__INLINE_SOURCE__" 占位符由 scripts/build-client.mjs 替换为 src/ 的内联副本,
 * 因此真实定义插件时交给 cordis_define 的是 plugin/cordis-define.json 里的成品。
 *
 * 交互:
 *   - 鼠标悬停 / 点击演示段落里预先设定好的词 -> 面板显示该词的 1..N 条联想
 *   - 模拟光标滑杆 + ←/→ 按钮 -> 逐字符移动光标, 观察定位与最长词优先
 *   - 所有查询都通过 host.call('glossary/resolve') 走 Host 侧的词库
 */

/* ================= 内联区开始 (build-client.mjs 生成) ================= */
/*__INLINE_SOURCE__*/
/* ================= 内联区结束 ================= */

/** 演示段落切分为可悬停单元与普通文本单元 */
const CELLS = [];
SAMPLE_TEXT.forEach((chunk) => {
  if (typeof chunk.term === 'string' && chunk.term.length > 0) {
    CELLS.push({ text: chunk.text, term: chunk.term });
  } else {
    for (const ch of chunk.text) CELLS.push({ text: ch, term: null });
  }
});

/** 由预置表构建客户端索引: 负责悬停高亮与词条清单 */
const INDEX = createLexicon(SEED_TABLE);
const TERMS = INDEX.list().map((row) => ({ term: row.term, count: row.entries.length }));
const FULL_TEXT = SAMPLE_TEXT.map((c) => c.text).join('');
const MAX_CURSOR = FULL_TEXT.length;

/** 第 index 个单元在整段文本中的起始下标 */
function cellStart(index) {
  let n = 0;
  for (let i = 0; i < index; i += 1) n += CELLS[i].text.length;
  return n;
}

/** 悬停某个单元: 直接按该单元的显式词查询 */
function payloadForCell(index) {
  const cell = CELLS[index];
  if (!cell || !cell.term) return { text: FULL_TEXT, cursor: 0 };
  return { text: FULL_TEXT, cursor: cellStart(index), term: cell.term };
}

/**
 * 模拟光标: 与 src/lexicon.mjs 的 lookupAt 同一套候选规则。
 * keepLeft=true 时保留左侧刚看过的词 (悬停语义), 由 Host 最终裁决。
 */
function payloadForCursor(cursor) {
  return { text: FULL_TEXT, cursor, keepLeft: true };
}

const CSS = [
  '.hg-panel{display:flex;flex-direction:column;gap:8px;padding:10px 12px;margin:0 0 8px;',
  'border:1px solid var(--dsw-alias-border-l1);border-radius:10px;',
  'background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1.6;',
  'color:var(--dsw-alias-label-primary);}',
  '.hg-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
  '.hg-title{font-weight:600;}',
  '.hg-meta{color:var(--dsw-alias-label-secondary);}',
  '.hg-pill{padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);',
  'color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;}',
  '.hg-pill.hg-on{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);}',
  '.hg-spacer{flex:1;}',
  '.hg-btn{all:unset;cursor:pointer;padding:2px 9px;border-radius:6px;',
  'border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);}',
  '.hg-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);}',
  '.hg-strip{display:flex;align-items:center;gap:2px;flex-wrap:wrap;font-size:15px;line-height:2;}',
  '.hg-cell{padding:1px 2px;border-radius:4px;}',
  '.hg-term{border-bottom:1px dashed var(--dsw-alias-brand-primary);cursor:pointer;}',
  '.hg-term:hover,.hg-under{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 22%,transparent);}',
  '.hg-caret{display:inline-block;width:0;height:16px;',
  'border-left:2px solid var(--dsw-alias-state-warn-primary);vertical-align:-3px;}',
  '.hg-card{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;',
  'background:var(--dsw-alias-bg-layer-2);}',
  '.hg-card-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:4px;}',
  '.hg-word{font-size:15px;font-weight:600;}',
  '.hg-ol{margin:0;padding-left:20px;}',
  '.hg-ol li{margin:1px 0;}',
  '.hg-kind{color:var(--dsw-alias-label-secondary);font-size:11px;margin-left:6px;}',
  '.hg-empty{color:var(--dsw-alias-label-secondary);}',
  '.hg-err{color:var(--dsw-alias-state-error-primary);}',
  '.hg-sim{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);}',
  '.hg-sim input[type=range]{width:220px;}',
].join('');

function ResultCard(props) {
  const result = props.result;
  if (!result) {
    return React.createElement(
      'div',
      { className: 'hg-card hg-empty' },
      '把鼠标移到下面带虚下划线的词上, 或拖动 "模拟光标" —— 例如 WHO。',
    );
  }
  if (result.error) {
    return React.createElement('div', { className: 'hg-card hg-err' }, '词库查询失败: ' + result.error);
  }
  if (result.loading) {
    return React.createElement('div', { className: 'hg-card hg-empty' }, '正在向 Host 查询…');
  }
  const head = React.createElement(
    'div',
    { className: 'hg-card-head' },
    React.createElement('span', { className: 'hg-word' }, result.term || '(空白)'),
    React.createElement('span', { className: 'hg-meta' }, '光标 ' + result.cursor),
    result.key
      ? React.createElement('span', { className: 'hg-meta' }, '键 ' + result.key)
      : null,
    result.start === undefined
      ? null
      : React.createElement(
          'span',
          { className: 'hg-meta' },
          '区间 [' + result.start + ',' + result.end + ')',
        ),
    React.createElement('span', { className: 'hg-pill hg-on' }, result.entries.length + ' 条'),
    React.createElement('span', { className: 'hg-meta' }, result.mode || ''),
  );
  const body = result.entries.length
    ? React.createElement(
        'ol',
        { className: 'hg-ol' },
        result.entries.map((entry, i) =>
          React.createElement(
            'li',
            { key: i },
            entry.text,
            entry.kind ? React.createElement('span', { className: 'hg-kind' }, entry.kind) : null,
          ),
        ),
      )
    : React.createElement('div', { className: 'hg-empty' }, '该位置没有收录的词。');
  return React.createElement('div', { className: 'hg-card' }, head, body);
}

const PANEL_CSS = CSS;

/**
 * 请求序号 (跨渲染保持)。只用 useState/useEffect 时没有 useRef,
 * 用一个闭包对象承载 "最新一次请求" 的判定, 丢弃过期响应。
 */
const latest = { seq: 0 };

return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots');
    if (slots === undefined) {
      console.error('slots 服务不可用: 悬停词典面板未注册');
      return;
    }
    const disposeStyles = styles.insert(PANEL_CSS);
    ctx.effect(() => disposeStyles);

    const ask = (payload, mode) =>
      host
        .call('glossary/resolve', payload)
        .then((answer) => {
          if (!answer || answer.ok !== true) {
            return { error: (answer && answer.error) || 'Host 返回异常', entries: [] };
          }
          answer.mode = mode;
          return answer;
        })
        .catch((error) => ({ error: String((error && error.message) || error), entries: [] }));

    function Panel() {
      const [result, setResult] = React.useState(null);
      const [cursor, setCursor] = React.useState(0);
      const [busy, setBusy] = React.useState(false);

      const settle = (payload, mode) => {
        latest.seq += 1;
        const mine = latest.seq;
        setBusy(true);
        setResult({ loading: true, cursor: payload.cursor, entries: [] });
        ask(payload, mode).then((answer) => {
          if (mine !== latest.seq) return; // 已被更新的移动取代, 丢弃过期结果
          setBusy(false);
          setResult(answer);
        });
      };

      const onEnter = (index) => {
        const payload = payloadForCell(index);
        setCursor(payload.cursor);
        settle(payload, '悬停');
      };
      const onCursor = (value) => {
        setCursor(value);
        settle(payloadForCursor(value), '模拟光标');
      };

      const strip = CELLS.map((cell, index) => {
        const marked = result && result.term && cell.term === result.term;
        const cls = ['hg-cell'];
        if (cell.term) cls.push('hg-term');
        if (marked) cls.push('hg-under');
        return React.createElement(
          'span',
          {
            key: index,
            className: cls.join(' '),
            onMouseEnter: cell.term ? () => onEnter(index) : undefined,
            onClick: cell.term ? () => onEnter(index) : undefined,
          },
          cell.text,
        );
      });
      if (cursor > 0 && cursor < MAX_CURSOR) {
        const at = CELLS.findIndex((cell, index) => cellStart(index) >= cursor);
        if (at >= 0 && cellStart(at) === cursor) {
          strip.splice(at, 0, React.createElement('span', { key: 'caret', className: 'hg-caret' }));
        }
      }

      const head = React.createElement(
        'div',
        { className: 'hg-head' },
        React.createElement('span', { className: 'hg-title' }, '悬停词典'),
        React.createElement('span', { className: 'hg-pill hg-on' }, INDEX.size + ' 词 / ' + INDEX.itemCount + ' 条'),
        React.createElement('span', { className: 'hg-meta' }, '一个词 → N 条联想'),
        React.createElement('span', { className: 'hg-spacer' }),
        busy ? React.createElement('span', { className: 'hg-meta' }, '查询中…') : null,
        React.createElement(
          'button',
          {
            className: 'hg-btn',
            onClick: () => {
              latest.seq += 1;
              setBusy(false);
              setResult(null);
            },
          },
          '清空',
        ),
      );

      const sim = React.createElement(
        'div',
        { className: 'hg-sim' },
        React.createElement('span', null, '模拟光标'),
        React.createElement('input', {
          type: 'range',
          min: 0,
          max: MAX_CURSOR,
          value: cursor,
          'aria-label': '模拟光标位置',
          onChange: (event) => onCursor(Number(event.target.value)),
        }),
        React.createElement('span', { className: 'hg-pill' }, cursor + ' / ' + MAX_CURSOR),
        React.createElement('button', { className: 'hg-btn', onClick: () => onCursor(Math.max(0, cursor - 1)) }, '←'),
        React.createElement(
          'button',
          { className: 'hg-btn', onClick: () => onCursor(Math.min(MAX_CURSOR, cursor + 1)) },
          '→',
        ),
        React.createElement('span', { className: 'hg-meta' }, '也可直接悬停/点击上面高亮的词'),
      );

      const legend = React.createElement(
        'div',
        { className: 'hg-head' },
        React.createElement('span', { className: 'hg-meta' }, '已收录:'),
        TERMS.map((row) =>
          React.createElement('span', { key: row.term, className: 'hg-pill' }, row.term + ' · ' + row.count),
        ),
      );

      return React.createElement(
        'div',
        { className: 'hg-panel' },
        head,
        React.createElement('div', { className: 'hg-strip' }, strip),
        React.createElement(ResultCard, { result: result }),
        sim,
        legend,
      );
    }

    slots.inject('conversation.input.dock', () =>
      slots.register({ name: 'conversation.input.dock', id: 'hover-glossary', order: 30 }, () =>
        React.createElement(Panel, null),
      ),
    );
  },
};
