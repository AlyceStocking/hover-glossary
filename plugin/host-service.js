/**
 * hover-glossary / plugin/host-service.js
 *
 * Cordis Host 半的源码: 纯 JS 函数体 (无 import/require)。
 * "__INLINE_SOURCE__" 占位符由 scripts/build-client.mjs 替换为 src/ 的内联副本。
 *
 * 职责:
 *   - 在 Host 侧持有权威词库 (src/seed-data.mjs 的 SEED_TABLE)
 *   - 通过 harness.handle('glossary/resolve') 给 Client 提供 JSON 查询
 *   - 允许 Client 追加自定义词条 (glossary/define), 演示 1 -> N 可扩展
 */

/* ================= 内联区开始 (build-client.mjs 生成) ================= */
/*__INLINE_SOURCE__*/
/* ================= 内联区结束 ================= */

const INDEX = createLexicon(SEED_TABLE);

/** 把词条裁剪成只含纯字符串的最小 JSON, 避免把内部对象直接抛给 Client */
function project(entry) {
  return {
    index: entry.index,
    text: entry.text,
    kind: entry.kind,
    weight: entry.weight,
  };
}

function emptyAnswer(cursor) {
  return { ok: true, cursor, term: '', key: '', entries: [], empty: true };
}

return {
  apply(ctx) {
    if (typeof harness === 'undefined' || harness === null) {
      console.error('harness 不可用: 悬停词典未提供 RPC');
      return;
    }

    const dispose = harness.handle('glossary/resolve', (args) => {
      const payload = args && typeof args === 'object' ? args : {};
      const text = typeof payload.text === 'string' ? payload.text : '';
      const cursor = Number(payload.cursor) || 0;

      // 情况 A: Client 直接给出词 (悬停/点击预置词)
      if (typeof payload.term === 'string' && payload.term.length > 0) {
        const entries = INDEX.lookup(payload.term);
        const hit = tokenAt(text, cursor);
        return {
          ok: true,
          cursor,
          term: payload.term,
          key: normalize(payload.term),
          start: hit ? hit.start : cursor,
          end: hit ? hit.end : cursor,
          entries: entries.map(project),
          empty: entries.length === 0,
        };
      }

      // 情况 B: 用光标位置解析
      if (typeof text !== 'string' || text.length === 0) return emptyAnswer(cursor);
      const at = INDEX.lookupAt(text, cursor, { keepLeft: payload.keepLeft !== false });
      return {
        ok: true,
        cursor,
        term: at.term,
        key: at.key,
        start: at.start,
        end: at.end,
        entries: at.entries.map(project),
        empty: at.entries.length === 0,
      };
    });
    ctx.effect(() => dispose);

    const disposeDefine = harness.handle('glossary/define', (args) => {
      const payload = args && typeof args === 'object' ? args : {};
      const term = typeof payload.term === 'string' ? payload.term : '';
      const items = Array.isArray(payload.entries) ? payload.entries : [];
      if (term.length === 0 || items.length === 0) {
        return { ok: false, error: 'term 与 entries 都不可为空' };
      }
      INDEX.add(term, items);
      return { ok: true, term, total: INDEX.lookup(term).length, words: INDEX.size, items: INDEX.itemCount };
    });
    ctx.effect(() => disposeDefine);

    console.log('[hover-glossary] 词库就绪: ' + INDEX.size + ' 词 / ' + INDEX.itemCount + ' 条');
  },
};
