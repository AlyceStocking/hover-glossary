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


function longestTermAt(lexicon, text, cursor, window = 16) {
  const hit = tokenAt(text, cursor);
  const start = hit ? hit.start : Math.max(0, Math.min(text.length, Math.trunc(cursor || 0)));
  const limit = Math.min(text.length, start + window);
  let best = null;
  for (let end = start + 1; end <= limit; end += 1) {
    if (!isWordChar(text[end - 1])) break;
    const key = normalize(text.slice(start, end));
    if (key.length > 0 && lexicon.has(key)) best = { key, start, end };
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Lexicon
 * ------------------------------------------------------------------ */



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
    const anchor = hit ? hit.start : Math.max(0, Math.min(text.length, Math.trunc(cursor || 0)));
    const span = Math.max(1, window);

    // 候选起点: 从光标所在词首向前回溯, 允许跨过短语内部空格 ("United Nations")。
    // 这样鼠标停在短语的第二个词上时, 也能整体命中短语。
    const starts = [anchor];
    let s = anchor;
    while (s > 0 && anchor - s < span) {
      const prev = text[s - 1];
      if (isWordChar(prev)) {
        s -= 1;
        starts.push(s);
        continue;
      }
      // 向前跨一个内部空格, 且空格之前还有词 -> 短语可能从这里开始
      if ((prev === ' ' || prev === '\t') && s - 2 >= 0 && isWordChar(text[s - 2]) && anchor - (s - 2) <= span) {
        s -= 2;
        starts.push(s);
        continue;
      }
      break;
    }

    // 候选终点: 从每个起点向右扩展; 只有跨过 "词-空格-词" 才能继续, 否则收束。
    // 只保留 "向右越过光标" 的候选 —— 即覆盖光标的子串。
    // 注意不能要求覆盖到整个 token 的末尾, 否则 "世界卫生组织发布报告" 这类
    // 长 token 的内部前缀 (世界卫生组织) 会被整体丢掉。
    const cursorPos = Number.isFinite(cursor) ? Math.max(0, Math.min(text.length, Math.trunc(cursor))) : anchor;
    const candidates = [];
    for (const from of starts) {
      let sawWordChar = false;
      const stop = Math.min(text.length, from + span);
      for (let end = from + 1; end <= stop; end += 1) {
        const ch = text[end - 1];
        if (isWordChar(ch)) {
          sawWordChar = true;
          if (end > cursorPos) {
            candidates.push({ key: normalize(text.slice(from, end)), start: from, end });
          }
          continue;
        }
        if (sawWordChar && (ch === ' ' || ch === '\t') && end < text.length && isWordChar(text[end])) continue;
        break;
      }
    }

    // 最长优先: 起点越靠前、终点越靠后 = 越长的候选
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
    return { term: hit ? hit.term : '', key: '', start: anchor, end: anchor, entries: [] };
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
};


const SAMPLE_TERMS = ['WHO', 'API', 'DSH', 'Cordis', 'LLM', '世卫组织', '世界卫生组织', 'United Nations'];


const SAMPLE_TEXT = [
  { text: '把光标停在 ' },
  { text: 'WHO', term: 'WHO' },
  { text: ' 上，会显示 ' },
  { text: '1、世卫组织 2、谁', term: null },
  { text: '。同样可以试 ' },
  { text: 'API', term: 'API' },
  { text: '、' },
  { text: 'DSH', term: 'DSH' },
  { text: '、' },
  { text: 'Cordis', term: 'Cordis' },
  { text: '、' },
  { text: 'LLM', term: 'LLM' },
  { text: '、' },
  { text: '世卫组织', term: '世卫组织' },
  { text: '、' },
  { text: '世界卫生组织', term: '世界卫生组织' },
  { text: '、' },
  { text: 'United Nations', term: 'United Nations' },
  { text: '。' },
];
