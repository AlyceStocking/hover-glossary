/**
 * hover-glossary / lexicon.mjs
 *
 * 词语 -> 联想条目 (1 -> N) 的核心数据结构与查询算法。
 *
 * 设计要点
 * --------
 * 1. 存储:  Map<normalizedKey, Entry[]>
 *      - key  = normalize(term): 去首尾标点、折叠内部空白、case-fold。
 *      - value= 有序条目数组, 索引 0 为最佳解释, 顺序对外稳定可见 (示例里的 "1、世卫组织 2、谁")。
 *      - 这是本次需求的核心: 一个词显式对应 N 个条目, 不做去重合并。
 * 2. 索引:  按 key 长度分桶 (Map<length, Set<key>>) + maxKeyLength。
 *      查询时只从 min(maxKeyLength, cursor + MAX_SCAN) 长度向下试探,
 *      命中即返回 —— 即 "最长词优先"(最长匹配)。
 * 3. 游标定位: tokenAt(text, cursor)
 *      以光标/鼠标位置为中心向两侧扩，得到所在词；中英混排都能工作
 *      (CJK 表格文字按字切分, 拉丁词连续读取)。
 *
 * 该文件是纯函数模块, 无任何运行时依赖, 因此同一份实现既能被 Node 测试直接 import,
 * 也能被 scripts/build-client.mjs 内联进 Cordis 客户端闭包 (客户端不允许 import)。
 */

/* ------------------------------------------------------------------ *
 * 文本规范化
 * ------------------------------------------------------------------ */

const APOSTROPHES = /[\u2018\u2019\u02bc\u02b9`]/g;
const PUNCT_EDGE = /^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu;
const CJK_SPACE = /(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu;

/**
 * 把任意书写形式收敛成查询键。
 * `WHO` / `who` / `"who,"` / `ＷＨＯ` 都归一到同一个键 `who`。
 * @param {unknown} input
 * @returns {string}
 */
export function normalize(input) {
  if (typeof input !== 'string') return '';
  let s = input.normalize('NFKC');
  s = s.replace(APOSTROPHES, "'");
  s = s.replace(/\s+/g, ' ');
  // 中文之间的空格视为排版噪声 ("世 卫 组织" -> "世卫组织")
  s = s.replace(CJK_SPACE, '');
  s = s.replace(PUNCT_EDGE, '');
  return s.toLowerCase();
}

/**
 * 规范化展示词: 只裁掉首尾空白, 保留原始大小写 (展示用, 不参与比较)。
 * @param {unknown} input
 * @returns {string}
 */
export function displayTerm(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ *
 * 游标 -> 词
 * ------------------------------------------------------------------ */

const WORD_CHAR =
  /[\p{L}\p{N}\p{M}\u2019\u02bc'\u05f3\u30fb\u30fc\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/u;

/** @param {string} ch @returns {boolean} */
export function isWordChar(ch) {
  if (typeof ch !== 'string' || ch.length === 0) return false;
  return WORD_CHAR.test(ch);
}

/**
 * 取出 `text` 中 `cursor` 位置所在的词。
 * `cursor` 可以指向词内任意字符, 也可以是词后一位 (紧跟结尾的光标)。
 * @param {string} text
 * @param {number} cursor
 * @returns {{term:string,start:number,end:number}|null}
 */
export function tokenAt(text, cursor) {
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

/**
 * 光标处的 "最长已知词": 不超过 window 个字符, 返回命中索引里最长的键。
 * 处理 "United Nations" / "世卫组织" 这类内含分词边界的多字词。
 * @param {Lexicon} lexicon
 * @param {string} text
 * @param {number} [cursor]
 * @param {number} [window]
 * @returns {{key:string,start:number,end:number}|null}
 */
export function longestTermAt(lexicon, text, cursor, window = 16) {
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

/**
 * @typedef {object} GlossaryEntry
 * @property {string} text    条目正文 (解释 / 联想)
 * @property {string} [kind]  条目类型, 例如 缩写 / 术语 / 人名
 * @property {number} [weight] 越大越靠前; 同权重保持插入顺序
 * @property {string[]} [tags]
 */

export class Lexicon {
  /**
   * @param {{maxEntriesPerTerm?:number}} [options] 单个词最多保留多少条目 (默认不限, 即 1 -> N)
   */
  constructor(options = {}) {
    /** @type {Map<string, GlossaryEntry[]>} */
    this.entries = new Map();
    /** @type {Map<string, string>} 规范化键 -> 展示词 (保留大小写) */
    this.display = new Map();
    /** @type {Map<number, Set<string>>} 键长度 -> 键集合 */
    this.byLength = new Map();
    /** @type {string[]} 插入顺序, 便于确定性遍历 */
    this.order = [];
    this.maxKeyLength = 0;
    this.maxEntriesPerTerm =
      Number.isFinite(options.maxEntriesPerTerm) && options.maxEntriesPerTerm > 0
        ? Math.trunc(options.maxEntriesPerTerm)
        : Infinity;
  }

  /** 已登记的词数 */
  get size() {
    return this.entries.size;
  }

  /** 条目总数 */
  get itemCount() {
    let n = 0;
    for (const list of this.entries.values()) n += list.length;
    return n;
  }

  /**
   * 登记一个词及其 1..N 个条目。
   * @param {string} term
   * @param {Array<string|GlossaryEntry>} items
   * @param {{replace?:boolean}} [opts]
   * @returns {Lexicon} this (链式)
   */
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

  /**
   * 批量登记 { term: [entries] } 字典。
   * @param {Record<string, Array<string|GlossaryEntry>>} table
   */
  load(table) {
    for (const term of Object.keys(table)) this.add(term, table[term]);
    return this;
  }

  /** @param {string} keyOrTerm @returns {boolean} */
  has(keyOrTerm) {
    return this.entries.has(normalize(keyOrTerm));
  }

  /**
   * 查询: 一个词 -> N 个条目 (副本, 调用方无法篡改内部结构)。
   * @param {string} term
   * @returns {GlossaryEntry[]}
   */
  lookup(term) {
    const list = this.entries.get(normalize(term));
    if (!list) return [];
    return list.map((e) => ({ ...e, tags: e.tags ? e.tags.slice() : [] }));
  }

  /**
   * 光标查询: 从最长候选开始试探, 命中即返回。
   * @param {string} text
   * @param {number} cursor
   * @param {{window?:number}} [opts]
   * @returns {{term:string,key:string,start:number,end:number,entries:GlossaryEntry[]}}
   */
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

  /**
   * 列出全部词条 (确定性顺序: 登记先后 -> 同长度分组)。
   * @returns {Array<{term:string,key:string,entries:GlossaryEntry[]}>}
   */
  list() {
    return this.order.map((key) => ({
      term: this.display.get(key) || key,
      key,
      entries: this.lookup(key),
    }));
  }

  /**
   * 极简自检: 任何键的长度必须与分桶一致, 且条目序号连续。
   * @returns {{ok:boolean, problems:string[]}}
   */
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

/**
 * 由表构建 Lexicon 的便捷入口。
 * @param {Record<string, Array<string|GlossaryEntry>>} table
 * @param {{maxEntriesPerTerm?:number}} [options]
 * @returns {Lexicon}
 */
export function createLexicon(table, options) {
  return new Lexicon(options).load(table || {});
}
