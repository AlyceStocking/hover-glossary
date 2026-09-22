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
        // 拉丁词必须完整匹配: WHO 不应命中 WHOLE, API 不应命中 RAPID。
        // 汉字没有这种边界, 仍允许在连续正文中寻找已登记的多字词。
        const latin = /[\p{Script=Latin}\p{N}_]/u;
        if (latin.test(text[candidate.start]) && candidate.start > 0 && latin.test(text[candidate.start - 1])) continue;
        if (latin.test(text[candidate.end - 1]) && candidate.end < text.length && latin.test(text[candidate.end])) continue;
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

  // ===== 模型推理词库（整理自 GLM-5.3-Flash / vLLM Ascend 文档与源码） =====

  // —— 推理基础概念 ——
  token: [
    { text: '词元：模型一次处理的离散单位，可能是字、词片段或特殊符号；ID 只是编号', kind: '术语', weight: 100, tags: ['推理基础'] },
  ],
  词元: [
    { text: '即 token，模型一次处理的离散单位；不能把汉字数量当作 token 数', kind: '术语', weight: 100, tags: ['推理基础'] },
  ],
  tokenizer: [
    { text: '分词器：把文字转为整数编号，也把生成编号还原为文字；聊天模板会加入角色等特殊标记', kind: '术语', weight: 100, tags: ['推理基础'] },
  ],
  分词器: [
    { text: '即 tokenizer，文字与 token ID 之间的双向转换器', kind: '术语', weight: 100, tags: ['推理基础'] },
  ],
  embedding: [
    { text: '嵌入：查权重表，把 token ID 变成一串可计算的数字向量', kind: '术语', weight: 100, tags: ['推理基础'] },
  ],
  嵌入: [
    { text: '即 embedding，把 token ID 映射为可计算向量', kind: '术语', weight: 100, tags: ['推理基础'] },
  ],
  'hidden state': [
    { text: '隐藏状态：每层加工后的内部表示，不是可直接阅读的答案', kind: '术语', weight: 100, tags: ['推理基础'] },
  ],
  隐藏状态: [
    { text: 'hidden state，各 Decoder 层之间传递的内部表示', kind: '术语', weight: 100, tags: ['推理基础'] },
  ],
  logits: [
    { text: '输出分数：词表中每个候选下一 token 的未归一化分数，经 LogitsProcessor 后才用于采样', kind: '术语', weight: 100, tags: ['推理基础'] },
  ],
  sampling: [
    { text: '采样：根据 logits、温度及 top-k/top-p 等规则选下一 token；温度 0 通常采用贪心选择', kind: '术语', weight: 100, tags: ['推理基础'] },
  ],
  采样: [
    { text: '即 sampling，按分数与温度等规则从词表中选出下一 token', kind: '术语', weight: 100, tags: ['推理基础'] },
  ],
  'top-k': [
    { text: '只在分数最高的 k 个候选中采样；MoE 路由中的 top-k 指每 token 选中的专家数，是另一回事', kind: '术语', weight: 100, tags: ['采样'] },
  ],
  'top-p': [
    { text: '核采样：只从累计概率达到 p 的最小候选集合中采样', kind: '术语', weight: 100, tags: ['采样'] },
  ],
  prefill: [
    { text: '预填充：一次处理提示词的多个 token，同时建立历史状态；GLM 中对应 KDA 的 chunk 分支', kind: '术语', weight: 100, tags: ['推理阶段'] },
  ],
  预填充: [
    { text: '即 prefill，一次并行处理整段提示并建立缓存/状态', kind: '术语', weight: 100, tags: ['推理阶段'] },
  ],
  decode: [
    { text: '逐步解码：把上一步选出的 token 输入模型，得到再下一个 token；对应 KDA recurrent 分支', kind: '术语', weight: 100, tags: ['推理阶段'] },
    { text: '解码：把 token ID 还原为文字（分词器侧含义）', kind: '术语', weight: 10, tags: ['推理基础'] },
  ],
  逐步解码: [
    { text: '即 decode 阶段，逐 token 自回归生成', kind: '术语', weight: 100, tags: ['推理阶段'] },
  ],
  'chunked prefill': [
    { text: '分块预填充：把长提示拆成多轮计算，后块必须读取前块留下的 conv/recurrent/tail 状态', kind: '术语', weight: 100, tags: ['推理阶段'] },
  ],
  分块预填充: [
    { text: '即 chunked prefill，受 max-num-batched-tokens 预算控制的长提示分轮处理', kind: '术语', weight: 100, tags: ['推理阶段'] },
  ],
  'prefix caching': [
    { text: '前缀缓存：复用已计算前缀的缓存；混合模型需各类可缓存状态在共同边界命中，tail 不参与 hash 命中', kind: '术语', weight: 100, tags: ['缓存'] },
  ],
  前缀缓存: [
    { text: '即 prefix caching；开启不等于任意长度的前缀都可复用全部状态', kind: '术语', weight: 100, tags: ['缓存'] },
  ],
  batch: [
    { text: '批次：一次调度中一起计算的多个请求或 token；请求数与 token 数不是同一个数', kind: '术语', weight: 100, tags: ['调度'] },
  ],
  批次: [
    { text: '即 batch；批次变大可能提高总吞吐，却增加排队和单人等待', kind: '术语', weight: 100, tags: ['调度'] },
  ],
  forward: [
    { text: '前向计算：用固定参数计算表示，不自动等于完整聊天服务', kind: '术语', weight: 100, tags: ['推理基础'] },
  ],
  前向计算: [
    { text: '即 forward，模型从输入到 hidden states/logits 的一次计算', kind: '术语', weight: 100, tags: ['推理基础'] },
  ],
  'KV cache': [
    { text: '键值缓存：保存注意力读历史所需的键/值表示，避免每步重算；GLM 的 MLA 使用压缩潜变量表示', kind: '术语', weight: 100, tags: ['缓存'] },
  ],
  键值缓存: [
    { text: '即 KV cache；KDA 的递归/卷积状态是另一类历史，不算 KV cache', kind: '术语', weight: 100, tags: ['缓存'] },
  ],
  权重: [
    { text: 'weights：训练后保存的参数，由 load_weights 装入设备；与激活不同', kind: '术语', weight: 100, tags: ['推理基础'] },
  ],
  激活: [
    { text: 'activations：本次输入在 forward 中算出的中间数值，主线为 BF16', kind: '术语', weight: 100, tags: ['推理基础'] },
  ],
  量化: [
    { text: 'quantization：用低位宽表示部分权重/激活以减少资源需求，可能影响精度；不是全模型一刀切', kind: '术语', weight: 100, tags: ['量化'] },
  ],
  投机解码: [
    { text: 'speculative decoding：草稿模型先提议多个 token，目标模型验证后只提交接受的部分', kind: '术语', weight: 100, tags: ['投机解码'] },
  ],
  'speculative decoding': [
    { text: '投机解码：draft 提议 + 目标模型验证；vLLM 用 --speculative-config 启用', kind: '术语', weight: 100, tags: ['投机解码'] },
  ],
  draft: [
    { text: '草稿（模型/token）：投机解码中提议候选 token 的小模型或头部；GLM 草稿被强制 eager 模式', kind: '术语', weight: 100, tags: ['投机解码'] },
  ],
  草稿: [
    { text: '投机解码中由 MTP 头提议的候选 token；被拒绝草稿的末状态不能当历史', kind: '术语', weight: 100, tags: ['投机解码'] },
  ],
  scheduler: [
    { text: '调度器：决定本轮算哪些请求、各处理多少 token，并分配缓存块', kind: '术语', weight: 100, tags: ['调度'] },
  ],
  调度器: [
    { text: '即 scheduler，负责 token 预算、请求状态与缓存分配', kind: '术语', weight: 100, tags: ['调度'] },
  ],
  'model runner': [
    { text: '模型执行器：准备张量和元数据并调用模型 forward，随后采样', kind: '术语', weight: 100, tags: ['框架'] },
  ],
  loader: [
    { text: '加载器：把磁盘权重装进模块并转换为算子要求的布局；加载不等于推理', kind: '术语', weight: 100, tags: ['框架'] },
  ],
  加载器: [
    { text: '即 loader，负责权重映射、分片、量化布局处理', kind: '术语', weight: 100, tags: ['框架'] },
  ],
  safetensors: [
    { text: '一种安全张量权重文件格式；vLLM 默认加载器迭代 safetensors 交给模型权重映射', kind: '术语', weight: 100, tags: ['权重'] },
  ],

  // —— 性能指标 ——
  TTFT: [
    { text: '首 token 时延（Time To First Token）：从请求发出到首 token 到达，含排队、输入处理和 prefill', kind: '缩写', weight: 100, tags: ['性能指标'] },
  ],
  TPOT: [
    { text: '每输出 token 时间（Time Per Output Token）：(总生成时长−首token时延)/(输出token数−1)', kind: '缩写', weight: 100, tags: ['性能指标'] },
  ],
  ITL: [
    { text: 'token 间时延（Inter-Token Latency）：相邻输出到达间隔，适合观察卡顿和尾延迟', kind: '缩写', weight: 100, tags: ['性能指标'] },
  ],
  throughput: [
    { text: '吞吐量：每秒完成多少请求或 token；应写明输入/输出、并发和统计口径', kind: '术语', weight: 100, tags: ['性能指标'] },
  ],
  吞吐量: [
    { text: '即 throughput；不能仅凭一个 tokens/s 判断体验', kind: '术语', weight: 100, tags: ['性能指标'] },
  ],
  峰值显存: [
    { text: 'peak device memory：峰值设备内存占用，含权重、缓存、激活、图和工作区', kind: '术语', weight: 100, tags: ['性能指标'] },
  ],

  // —— 模型架构机制 ——
  KDA: [
    { text: 'Kimi Delta Attention（Kimi Delta 线性注意力）：用递归矩阵状态汇总历史，配短因果卷积保存最近投影窗口', kind: '缩写', weight: 100, tags: ['注意力'] },
    { text: 'prefill 走 chunk 分支、decode 走 recurrent 分支；实现强制 BF16 激活、head_dim=128', kind: '说明', weight: 50, tags: ['GLM'] },
  ],
  MLA: [
    { text: 'Multi-head Latent Attention（多头潜变量注意力）：用低秩压缩的 latent KV 表示注意力历史', kind: '缩写', weight: 100, tags: ['注意力'] },
    { text: 'MLA 投影含低秩 Q 与 latent KV；当前 GLM 路径为 NoPE（rope 维度为 0）', kind: '说明', weight: 50, tags: ['GLM'] },
  ],
  DSA: [
    { text: 'DeepSeek Sparse Attention（DeepSeek 稀疏注意力）：选择部分历史位置读取而非全部', kind: '缩写', weight: 100, tags: ['注意力'] },
  ],
  SFA: [
    { text: 'Sparse Flash Attention（稀疏 Flash 注意力）：接收稀疏索引并读主 latent KV 的共享后端', kind: '缩写', weight: 100, tags: ['注意力'] },
    { text: 'A5 走 cann_ops_transformer.sparse_flash_mla，A2/A3 走 npu_sparse_flash_attention', kind: '说明', weight: 50, tags: ['Ascend'] },
  ],
  KPool: [
    { text: 'key pooling（键池化）：每 R 个索引 key 汇成一个池向量用于 top-k 选择，不是另一份完整文本', kind: '术语', weight: 100, tags: ['注意力'] },
    { text: 'index_topk=2048、R=4 时最多选 512 个完整池加至多 3 个 tail token', kind: '说明', weight: 50, tags: ['GLM'] },
  ],
  键池化: [
    { text: '即 KPool；被压缩的是用于挑选位置的索引 K，主缓存仍保留完整 latent KV', kind: '术语', weight: 100, tags: ['注意力'] },
  ],
  'lightning indexer': [
    { text: '闪电索引器：稀疏注意力中计算索引分数并做 top-k 选择的轻量索引模块', kind: '术语', weight: 100, tags: ['注意力'] },
  ],
  'latent KV': [
    { text: 'MLA 压缩后的潜变量键值表示；主缓存按块保存，供稀疏索引选中后读取', kind: '术语', weight: 100, tags: ['注意力'] },
  ],
  潜变量: [
    { text: 'latent：低秩压缩后的内部表示，如 MLA 的 latent KV', kind: '术语', weight: 100, tags: ['注意力'] },
  ],
  MoE: [
    { text: 'Mixture of Experts（混合专家）：router 为每个 token 选 top-k 个前馈专家，再加共享专家结果', kind: '缩写', weight: 100, tags: ['架构'] },
    { text: '总参数约 320B、每 token 活跃约 18B 说明只激活部分专家，不意味着只需装 18B 权重', kind: '说明', weight: 50, tags: ['GLM'] },
  ],
  混合专家: [
    { text: '即 MoE；GLM 前三层 MLP 为 dense，其余层为 sparse/MoE', kind: '术语', weight: 100, tags: ['架构'] },
  ],
  router: [
    { text: '路由器/门控：MoE 中产生 [T,E] 路由分数并选 top-k 专家的模块，官方配置为 FP32', kind: '术语', weight: 100, tags: ['架构'] },
  ],
  共享专家: [
    { text: 'shared expert：所有 token 都经过的常驻专家，与路由专家结果相加', kind: '术语', weight: 100, tags: ['架构'] },
  ],
  mHC: [
    { text: 'Manifold-Constrained Hyper-Connections（流形约束超连接）：在多条残差流间做受约束混合', kind: '缩写', weight: 100, tags: ['架构'] },
    { text: '残差流 [T,n,H]，混合参数 FP32，Sinkhorn 迭代约束混合矩阵；MTP 层不使用', kind: '说明', weight: 50, tags: ['GLM'] },
  ],
  MTP: [
    { text: 'Multi-Token Prediction（多 token 预测）：给投机解码提供草稿 token 的附加预测头', kind: '缩写', weight: 100, tags: ['投机解码'] },
    { text: 'num_nextn_predict_layers=1 不等于只能提议一个 token：proposer 可迭代调用同一层', kind: '说明', weight: 50, tags: ['GLM'] },
  ],
  MLP: [
    { text: 'Multi-Layer Perceptron（多层感知机）：gate/up 投影、SiLU 门控相乘、down 投影的前馈网络', kind: '缩写', weight: 100, tags: ['架构'] },
  ],
  RMSNorm: [
    { text: 'Root Mean Square Layer Normalization（均方根层归一化）：控制数值尺度，不是把激活变成概率', kind: '缩写', weight: 100, tags: ['架构'] },
  ],
  RoPE: [
    { text: 'Rotary Position Embedding（旋转位置编码）：用旋转变换编码位置', kind: '缩写', weight: 100, tags: ['位置编码'] },
  ],
  NoPE: [
    { text: 'No Positional Embedding：不使用 RoPE 维度的路径；GLM KPool 要求 qk_rope_head_dim=0', kind: '缩写', weight: 100, tags: ['位置编码'] },
    { text: 'rope 宽度为 0 并不意味着请求 position 和因果 mask 不再需要', kind: '说明', weight: 50, tags: ['GLM'] },
  ],
  旋转位置编码: [
    { text: '即 RoPE，用旋转变换把位置信息编码进 Q/K', kind: '术语', weight: 100, tags: ['位置编码'] },
  ],
  GEMM: [
    { text: 'General Matrix Multiply（通用矩阵乘法）；KDA 把 q/k/v/beta/gate 六路投影合并为一个 GEMM', kind: '缩写', weight: 100, tags: ['算子'] },
  ],
  SiLU: [
    { text: 'Sigmoid Linear Unit：MLP 中常用的门控激活函数', kind: '缩写', weight: 100, tags: ['算子'] },
  ],
  SwiGLU: [
    { text: '带 SwiGLU 门控的前馈路径；swiglu_limit 非空时使用带截断的变体', kind: '术语', weight: 100, tags: ['算子'] },
  ],
  'causal convolution': [
    { text: '因果卷积：只混合最近几个位置的短卷积；KDA 卷积宽度 2～4，MTP 时必须为 4', kind: '术语', weight: 100, tags: ['算子'] },
  ],
  因果卷积: [
    { text: '即 causal convolution，KDA 中保存最近投影滑动窗口的短卷积', kind: '术语', weight: 100, tags: ['算子'] },
  ],
  递归状态: [
    { text: 'recurrent state：KDA 每头一张 [d,d] 矩阵的历史汇总，默认 FP32，大小不随历史长度线性增长', kind: '术语', weight: 100, tags: ['KDA'] },
  ],
  卷积状态: [
    { text: 'conv state：KDA 短卷积的最近投影滑动窗口，默认随模型 BF16', kind: '术语', weight: 100, tags: ['KDA'] },
  ],
  视觉塔: [
    { text: 'vision tower：图像 patch 经 Conv3d patch embedding、视觉 Transformer、下采样、PatchMerger 变成宽度 H 的视觉向量', kind: '术语', weight: 100, tags: ['多模态'] },
  ],

  // —— 并行策略 ——
  TP: [
    { text: 'Tensor Parallelism（张量并行）：把同一层的头/矩阵拆到多卡', kind: '缩写', weight: 100, tags: ['并行'] },
    { text: 'GLM 主线 TP8；减少每 rank 权重/头数但增加通信', kind: '说明', weight: 50, tags: ['GLM'] },
  ],
  张量并行: [
    { text: '即 TP，按层内维度切分到多卡', kind: '术语', weight: 100, tags: ['并行'] },
  ],
  DP: [
    { text: 'Data Parallelism（数据并行）：不同 rank 处理不同请求', kind: '缩写', weight: 100, tags: ['并行'] },
  ],
  数据并行: [
    { text: '即 DP，按请求维度分工', kind: '术语', weight: 100, tags: ['并行'] },
  ],
  EP: [
    { text: 'Expert Parallelism（专家并行）：把 MoE 专家分布到不同设备，需要跨 rank 专家通信', kind: '缩写', weight: 100, tags: ['并行'] },
  ],
  专家并行: [
    { text: '即 EP；GLM 教程要求 --enable-expert-parallel', kind: '术语', weight: 100, tags: ['并行'] },
  ],
  PP: [
    { text: 'Pipeline Parallelism（流水线并行）：按模型层分段', kind: '缩写', weight: 100, tags: ['并行'] },
    { text: 'GLM 当前源码明确 gated off，支持矩阵勾号不足以证明能跑', kind: '说明', weight: 50, tags: ['GLM'] },
  ],
  流水线并行: [
    { text: '即 PP，按层切分模型到不同设备', kind: '术语', weight: 100, tags: ['并行'] },
  ],
  CP: [
    { text: 'Context Parallelism（上下文并行）：按长序列历史分工', kind: '缩写', weight: 100, tags: ['并行'] },
  ],
  上下文并行: [
    { text: '即 CP；GLM KPool backend 对 PCP/DCP 大于 1 直接拒绝', kind: '术语', weight: 100, tags: ['并行'] },
  ],
  PCP: [
    { text: 'Prefill Context Parallelism：prefill 阶段的上下文并行', kind: '缩写', weight: 100, tags: ['并行'] },
  ],
  DCP: [
    { text: 'Decode Context Parallelism：decode 阶段的上下文并行', kind: '缩写', weight: 100, tags: ['并行'] },
  ],
  SP: [
    { text: 'Sequence Parallelism（序列并行）：按 token 维切分，注意力前 gather、后 reduce-scatter；不等于 CP 缓存分片', kind: '缩写', weight: 100, tags: ['并行'] },
  ],
  序列并行: [
    { text: '即 SP，token 维切分', kind: '术语', weight: 100, tags: ['并行'] },
  ],
  'all-gather': [
    { text: '集合通信原语：把各 rank 的分片拼成全量', kind: '术语', weight: 100, tags: ['通信'] },
  ],
  'reduce-scatter': [
    { text: '集合通信原语：归约后把结果分片散回各 rank', kind: '术语', weight: 100, tags: ['通信'] },
  ],
  'all-to-all': [
    { text: '集合通信原语：各 rank 两两交换数据，MoE 专家路由常用', kind: '术语', weight: 100, tags: ['通信'] },
  ],

  // —— 数值类型与量化 ——
  dtype: [
    { text: '张量数值类型（如 BF16/FP32）；不是 shape 的组成部分', kind: '术语', weight: 100, tags: ['数值'] },
  ],
  BF16: [
    { text: 'Brain Floating Point 16：16 位脑浮点格式；GLM 主线激活 dtype，KDA 强制要求', kind: '缩写', weight: 100, tags: ['数值'] },
  ],
  FP32: [
    { text: '32-bit Floating Point：32 位浮点；mHC 混合参数、KDA recurrent 状态、KPool tail 默认使用', kind: '缩写', weight: 100, tags: ['数值'] },
  ],
  FP16: [
    { text: '16 位半精度浮点；GLM KDA 会拒绝 FP16 激活', kind: '缩写', weight: 100, tags: ['数值'] },
  ],
  FP8: [
    { text: '8 位浮点量化格式；官方 GLM 配置为原生 FP8，与 ModelSlim 量化是两条加载路径', kind: '缩写', weight: 100, tags: ['量化'] },
  ],
  MXFP8: [
    { text: '微缩放矢量 FP8 量化格式；950 主线用 ModelSlim GLM-5.3-Flash-w8a8-mxfp8 权重', kind: '缩写', weight: 100, tags: ['量化'] },
  ],
  W8A8: [
    { text: '权重 8 位、激活 8 位的量化方案；A2/A3 与 950 的 scheme 不同', kind: '缩写', weight: 100, tags: ['量化'] },
  ],
  W4A4C8: [
    { text: '权重 4 位、激活 4 位、缓存 8 位的量化方案；属 GLM-5.2 配置，不能迁移到 GLM-5.3-Flash', kind: '缩写', weight: 100, tags: ['量化'] },
  ],
  INT8: [
    { text: '8 位整数量化；GLM 中不应把所有激活都说成 INT8，每层 scheme 由量化描述决定', kind: '缩写', weight: 100, tags: ['量化'] },
  ],
  C8: [
    { text: 'KV cache 8 位量化；GLM SFA NoPE 主 KV 明确拒绝 enable_sparse_sfa_c8', kind: '缩写', weight: 100, tags: ['量化'] },
  ],
  ModelSlim: [
    { text: '昇腾模型压缩工具链及其量化产物；按 quant_model_description.json 选每层 linear/MoE scheme', kind: '专有名词', weight: 100, tags: ['量化'] },
  ],
  反量化: [
    { text: 'dequant：把量化权重还原为高比特表示；FP8 checkpoint 的部分 MLA/indexer 权重加载时反量化为 BF16', kind: '术语', weight: 100, tags: ['量化'] },
  ],

  // —— 缓存与调度 ——
  'block table': [
    { text: '块表：为每个请求记录逻辑块到物理块 ID 的映射', kind: '术语', weight: 100, tags: ['缓存'] },
  ],
  块表: [
    { text: '即 block table；位置 p 对应逻辑块 p//L、块内偏移 p%L', kind: '术语', weight: 100, tags: ['缓存'] },
  ],
  'slot mapping': [
    { text: '槽映射：给本轮每个 token 一个具体缓存写入位置；主 slot = block_id*L + p%L', kind: '术语', weight: 100, tags: ['缓存'] },
  ],
  槽映射: [
    { text: '即 slot mapping，由 metadata builder 生成供算子使用', kind: '术语', weight: 100, tags: ['缓存'] },
  ],
  BlockPool: [
    { text: 'vLLM 物理缓存块池：各缓存组从同一池取不同 ID；共享底层 tensor 不代表两个活跃请求共用状态槽', kind: '术语', weight: 100, tags: ['缓存'] },
  ],
  KVCacheManager: [
    { text: 'vLLM 缓存管理器：负责请求块的分配与释放；GLM 显式拒绝 hybrid KV cache manager', kind: '术语', weight: 100, tags: ['缓存'] },
  ],
  tail: [
    { text: 'KPool 尾部缓存：请求私有的 FP32 环形块，保存未完成池的 raw K/gate；不进 prefix cache、不共享', kind: '术语', weight: 100, tags: ['KPool'] },
  ],
  状态槽: [
    { text: 'state slot：KDA 每请求一份的递归/卷积状态位置；新请求必须逻辑清零，不能继承旧残留', kind: '术语', weight: 100, tags: ['KDA'] },
  ],

  // —— 执行模式与优化 ——
  eager: [
    { text: '逐次执行模式：不录制计算图，便于排查；--enforce-eager 强制启用', kind: '术语', weight: 100, tags: ['执行模式'] },
  ],
  'CUDA graph': [
    { text: '图执行：录制/回放设备调用减少 launch 开销；Ascend 上对应 ACL Graph，CLI 字段仍叫 cudagraph_mode', kind: '术语', weight: 100, tags: ['执行模式'] },
  ],
  'ACL Graph': [
    { text: 'Ascend Computing Language 图执行；教程选 FULL_DECODE_ONLY，会增加预热时间和内存', kind: '术语', weight: 100, tags: ['执行模式'] },
  ],
  图模式: [
    { text: 'graph 模式：录制回放设备调用；不要和 enforce-eager 同时期望图生效', kind: '术语', weight: 100, tags: ['执行模式'] },
  ],
  融合: [
    { text: 'fusion：合并算子减少中间张量和 launch 次数；六次变一次是结构变化，不是六倍加速', kind: '术语', weight: 100, tags: ['优化'] },
  ],
  overlap: [
    { text: '重叠：让独立计算/通信同时执行；multistream_overlap_shared_expert 默认关闭', kind: '术语', weight: 100, tags: ['优化'] },
  ],
  stream: [
    { text: '流：设备任务队列，用于计算与通信重叠', kind: '术语', weight: 100, tags: ['优化'] },
  ],

  // —— 硬件与平台 ——
  NPU: [
    { text: 'Neural Processing Unit（神经网络处理器）：昇腾 AI 加速卡；GLM 主计算运行在 NPU 上', kind: '缩写', weight: 100, tags: ['硬件'] },
  ],
  CANN: [
    { text: 'Compute Architecture for Neural Networks（昇腾异构计算架构）：驱动/算子库软件栈', kind: '缩写', weight: 100, tags: ['Ascend'] },
    { text: 'A5 共享 SparseFlashMla 适配器要求匹配 CANN 9.2 及 cann_ops_transformer', kind: '说明', weight: 50, tags: ['Ascend'] },
  ],
  AscendC: [
    { text: '昇腾自定义算子开发语言/框架；承担 KDA、卷积、mHC、稀疏注意力等底层计算', kind: '术语', weight: 100, tags: ['Ascend'] },
  ],
  torch_npu: [
    { text: '让 PyTorch 使用 NPU 的适配库，提供设备算子接口', kind: '专有名词', weight: 100, tags: ['Ascend'] },
  ],
  Triton: [
    { text: '编写设备核的 Python 化编译工具；GLM 用于池化索引、tail 写入、MTP 输入融合等', kind: '专有名词', weight: 100, tags: ['算子'] },
  ],
  HCCL: [
    { text: 'Huawei Collective Communication Library（华为集合通信库）：多卡/多节点通信底座', kind: '缩写', weight: 100, tags: ['Ascend'] },
  ],
  Gloo: [
    { text: 'CPU 侧集合通信库；双节点部署需正确设置 GLOO_SOCKET_IFNAME 网卡', kind: '专有名词', weight: 100, tags: ['通信'] },
  ],
  '950DT': [
    { text: 'Ascend 950DT：GLM 教程主线机型，8×96GB、TP8、DP1、EP，MXFP8 专用镜像', kind: '型号', weight: 100, tags: ['硬件'] },
  ],
  '910B': [
    { text: '昇腾 910B 加速卡；通用 Dockerfile 基础镜像所用型号，不等于 950 镜像清单', kind: '型号', weight: 100, tags: ['硬件'] },
  ],
  OOM: [
    { text: 'Out Of Memory（内存不足）：先区分发生在加载、cache 分配还是 graph capture 阶段', kind: '缩写', weight: 100, tags: ['故障'] },
  ],
  'npu-smi': [
    { text: '昇腾设备管理命令行工具，用于现场确认物理卡与逻辑设备', kind: '工具', weight: 100, tags: ['硬件'] },
  ],

  // —— 框架与模型 ——
  vLLM: [
    { text: '开源大模型推理与服务框架；本目录研究其 Ascend 插件分支', kind: '专有名词', weight: 100, tags: ['框架'] },
  ],
  'vllm-ascend': [
    { text: 'vLLM 的昇腾平台插件：注册 NPUPlatform、定制算子与模型实现', kind: '专有名词', weight: 100, tags: ['框架'] },
  ],
  'GLM-5.3-Flash': [
    { text: '智谱多模态生成模型：约 320B 总参数、每 token 活跃约 18B；KDA+MLA 混合架构', kind: '专有名词', weight: 100, tags: ['模型'] },
    { text: '45 个文本层：34 个 linear_attention（KDA）、11 个稀疏注意力层', kind: '说明', weight: 50, tags: ['模型'] },
  ],
  glm5_next: [
    { text: 'GLM-5.3-Flash 的顶层 model_type；文本子配置 glm5_next_text，视觉 glm5_next_vision', kind: '标识符', weight: 100, tags: ['模型'] },
  ],
  Glm5Next: [
    { text: 'vllm-ascend 中 GLM-5.3-Flash 的本地实现类前缀；架构名 Glm5NextForConditionalGeneration', kind: '标识符', weight: 100, tags: ['模型'] },
  ],
  EngineArgs: [
    { text: 'vLLM 引擎参数集：CLI 参数经它按模型、硬件、usage context 派生最终配置', kind: '标识符', weight: 100, tags: ['框架'] },
  ],
  AsyncLLM: [
    { text: 'vLLM 异步引擎客户端：请求流、进程通信和引擎步进的入口', kind: '标识符', weight: 100, tags: ['框架'] },
  ],
  transformers: [
    { text: 'Hugging Face 模型库；GLM 分析锁定 transformers 5.14.1，官方配置写 5.16.0 不能据此静默升级', kind: '专有名词', weight: 100, tags: ['框架'] },
  ],
  LoRA: [
    { text: 'Low-Rank Adaptation（低秩适配）：附加小矩阵微调权重的技术；GLM 主线未验证其组合', kind: '缩写', weight: 100, tags: ['框架'] },
  ],
  EAGLE: [
    { text: '一种投机解码草稿方法；coordinator 对 EAGLE 回放有版本分支', kind: '术语', weight: 100, tags: ['投机解码'] },
  ],
  'PD分离': [
    { text: 'disaggregated prefill：prefill 与 decode 拆到不同实例/节点部署；GLM 主线同机未验证', kind: '术语', weight: 100, tags: ['部署'] },
  ],
  'disaggregated prefill': [
    { text: 'PD 分离：预填充与解码分离部署的架构', kind: '术语', weight: 100, tags: ['部署'] },
  ],
  推理: [
    { text: 'inference：用固定参数计算答案；下载、加载、推理是三个不同阶段', kind: '术语', weight: 100, tags: ['推理基础'] },
  ],
  训练: [
    { text: 'training：通过损失和反向传播更新权重，与推理相对', kind: '术语', weight: 100, tags: ['推理基础'] },
  ],

  // ===== 补充：覆盖《GLM5.3-Flash 新人上手与源码导读》出现的专有名词与缩写 =====

  // —— 通用缩写与协议 ——
  CPU: [
    { text: '中央处理器：host 侧描述（如 KDA chunk 分段）保留 CPU 副本；像素处理通常从 CPU 开始', kind: '缩写', weight: 100, tags: ['硬件'] },
  ],
  CLI: [
    { text: 'Command-Line Interface（命令行接口）：vllm serve 参数的读取入口', kind: '缩写', weight: 100, tags: ['框架'] },
  ],
  HTTP: [
    { text: 'Hypertext Transfer Protocol（超文本传输协议）：客户端与 API 服务之间的网络传输', kind: '缩写', weight: 100, tags: ['协议'] },
  ],
  SSE: [
    { text: 'Server-Sent Events（服务器发送事件）：聊天流式响应使用的推送格式', kind: '缩写', weight: 100, tags: ['协议'] },
  ],
  JSON: [
    { text: 'JavaScript Object Notation：API 请求/响应数据格式；验收时确认返回合法 JSON、有 choices', kind: '缩写', weight: 100, tags: ['协议'] },
  ],
  URL: [
    { text: '统一资源定位符：图片/视频输入失败时先确认 URL 可达性', kind: '缩写', weight: 100, tags: ['协议'] },
  ],
  UT: [
    { text: 'Unit Test（单元测试）：单个 mock UT 通过不能代替 NPU 核精度、长文本、多并发验证', kind: '缩写', weight: 100, tags: ['测试'] },
  ],
  NaN: [
    { text: 'Not a Number（非数）：非法数值；NaN×0 仍是 NaN，所以新请求状态用 torch.where 清零而非乘 0；Inf 同理', kind: '术语', weight: 100, tags: ['数值'] },
  ],

  // —— 导读中的模型与硬件名称 ——
  GLM: [
    { text: '智谱 General Language Model 系列；名称相似不代表配置可交换', kind: '缩写', weight: 100, tags: ['模型'] },
  ],
  'GLM-5.3': [
    { text: 'GLM 系列另一型号；与 GLM-5.3-Flash 在支持矩阵中是两行，机制与硬件结论不互继承', kind: '型号', weight: 100, tags: ['模型'] },
  ],
  'GLM-5.2': [
    { text: 'GLM 前代型号；其 W4A4C8 启动脚本与稀疏 KV C8 开关不适用于 GLM-5.3-Flash', kind: '型号', weight: 100, tags: ['模型'] },
  ],
  'GLM-4.7-Flash': [
    { text: 'GLM 前代 Flash 型号；tool-call-parser glm47 的命名来源，不表示本模型是 GLM4.7', kind: '型号', weight: 100, tags: ['模型'] },
  ],
  'GLM-4.1V': [
    { text: '上游多模态模型；GLM-5.3-Flash 包装类继承其 glm4_1v 实现的视觉输入解析/合并', kind: '型号', weight: 100, tags: ['模型'] },
  ],
  A2: [
    { text: '昇腾硬件代际：教程为双节点 64GB×16、DP2×TP8、W8A8 量化', kind: '型号', weight: 100, tags: ['硬件'] },
  ],
  A3: [
    { text: '昇腾硬件代际：教程 TP16、CANN 9.1.0 示例；卡数口径有文档差异，现场用 npu-smi 确认', kind: '型号', weight: 100, tags: ['硬件'] },
  ],
  A5: [
    { text: '昇腾硬件代际（950 系列）：FP8_OPTIMIZED profile 走 sparse_flash_mla，要求匹配 CANN 9.2', kind: '型号', weight: 100, tags: ['硬件'] },
  ],
  Ascend: [
    { text: '昇腾：华为 AI 计算平台，含 NPU 硬件与 CANN 软件栈', kind: '专有名词', weight: 100, tags: ['硬件'] },
  ],
  昇腾: [
    { text: 'Ascend 的中文名；昇腾异构计算架构即 CANN', kind: '专有名词', weight: 100, tags: ['硬件'] },
  ],
  CUDA: [
    { text: 'NVIDIA 的 GPU 计算平台；Ascend 上图字段仍叫 cudagraph_mode，不代表运行在 CUDA', kind: '专有名词', weight: 100, tags: ['硬件'] },
  ],
  PyTorch: [
    { text: '开源深度学习框架：负责模块连接、张量和元数据，经 torch_npu 使用 NPU', kind: '专有名词', weight: 100, tags: ['框架'] },
  ],
  openEuler: [
    { text: '开源 Linux 发行版；950 教程专用镜像基于 openEuler，与通用 Ubuntu 镜像不同', kind: '专有名词', weight: 100, tags: ['系统'] },
  ],
  Ubuntu: [
    { text: '常见 Linux 发行版；通用 Dockerfile 用 910B Ubuntu 基础镜像，不等于 950 镜像清单', kind: '专有名词', weight: 100, tags: ['系统'] },
  ],
  Dockerfile: [
    { text: '容器镜像构建脚本；通用 Dockerfile 的 CANN 9.1.0 不能自动套到 950', kind: '术语', weight: 100, tags: ['部署'] },
  ],
  镜像: [
    { text: '容器镜像：封装运行环境；教程镜像内部版本需现场采集，保存 digest 便于复现', kind: '术语', weight: 100, tags: ['部署'] },
  ],
  digest: [
    { text: '镜像摘要：容器镜像的内容哈希，排查问题时随启动命令一起保存', kind: '术语', weight: 100, tags: ['部署'] },
  ],

  // —— 框架角色与组件 ——
  worker: [
    { text: '工作进程：持有设备资源，执行模型加载与推理', kind: '术语', weight: 100, tags: ['框架'] },
  ],
  executor: [
    { text: '执行器：vLLM 引擎侧管理 worker 的组件', kind: '术语', weight: 100, tags: ['框架'] },
  ],
  rank: [
    { text: '分布式进程编号：通信挂起先看最先失败的 rank；节点 rank 重复可能挂起', kind: '术语', weight: 100, tags: ['并行'] },
  ],
  'entry points': [
    { text: 'Python 包入口点：vllm-ascend 的平台插件与 general 插件经它被发现', kind: '术语', weight: 100, tags: ['框架'] },
  ],
  patch: [
    { text: '补丁：对上游代码的修改层，如配置注册、MLA 识别、缓存兼容补丁', kind: '术语', weight: 100, tags: ['框架'] },
    { text: '图像块：视觉模型把图片切成的小块，是视觉塔的输入单位', kind: '术语', weight: 50, tags: ['多模态'] },
  ],
  Decoder: [
    { text: '解码器层：一层的总调度员——注意力混合历史，MLP/MoE 加工 token，残差连接保留原表示', kind: '术语', weight: 100, tags: ['架构'] },
  ],
  'LM head': [
    { text: '输出头：把最终隐藏状态 [T,H] 投影到词表；ParallelLMHead 做并行局部词表分片', kind: '术语', weight: 100, tags: ['架构'] },
  ],
  LogitsProcessor: [
    { text: 'logits 处理器：管理并行输出及缩放，位于 LM head 之后、采样之前', kind: '标识符', weight: 100, tags: ['框架'] },
  ],
  proposer: [
    { text: '提议器：投机解码中迭代调用草稿层产生候选 token 的组件；GLM draft 被强制 eager', kind: '术语', weight: 100, tags: ['投机解码'] },
  ],
  Mamba: [
    { text: '状态空间模型家族；vLLM 沿用其名管理线性注意力缓存（MambaSpec、mamba cache），KDA 状态走这套分组', kind: '专有名词', weight: 100, tags: ['缓存'] },
  ],
  checkpoint: [
    { text: '权重快照：训练保存的模型参数文件', kind: '术语', weight: 100, tags: ['权重'] },
    { text: '缓存检查点：Mamba/prefix 场景的状态对齐点，前缀复用需对齐', kind: '术语', weight: 50, tags: ['缓存'] },
  ],

  // —— 导读中的机制与术语 ——
  attention: [
    { text: '注意力：按 Q/K 相关性加权读取 V 的机制；GLM 混合使用 KDA 线性注意力与稀疏 MLA', kind: '术语', weight: 100, tags: ['注意力'] },
  ],
  注意力: [
    { text: '即 attention；本模型稀疏层先由索引器选位置再读主缓存', kind: '术语', weight: 100, tags: ['注意力'] },
  ],
  QKV: [
    { text: 'Q（Query 查询）想找什么、K（Key 键）怎样被匹配、V（Value 值）取回的信息', kind: '缩写', weight: 100, tags: ['注意力'] },
  ],
  索引器: [
    { text: 'indexer：只回答“值得读哪些位置”，不替代主 MLA 的值聚合', kind: '术语', weight: 100, tags: ['注意力'] },
  ],
  indexer: [
    { text: '索引器：稀疏注意力的位置选择模块，含 query/key/gate 投影', kind: '术语', weight: 100, tags: ['注意力'] },
  ],
  GDN: [
    { text: 'Gated Delta Net 相关命名：KDA 调度使用 GDNAttentionMetadata 区分投机验证与普通 token', kind: '缩写', weight: 100, tags: ['KDA'] },
  ],
  残差: [
    { text: 'residual：跨层保留原表示的加法通道；mHC 把它扩展为多条残差流 [T,n,H]', kind: '术语', weight: 100, tags: ['架构'] },
  ],
  门控: [
    { text: 'gate：逐元素调制信号的机制；KDA 有 forget/output gate，MLP 有 gate/up 投影', kind: '术语', weight: 100, tags: ['架构'] },
  ],
  gate: [
    { text: '门控；KPool 中 gate 还参与池内 key 加权，与索引 K 一起缓存', kind: '术语', weight: 100, tags: ['架构'] },
  ],
  Sinkhorn: [
    { text: 'Sinkhorn 迭代：mHC 中约束混合矩阵 comb 的迭代算法，次数由 mhc_sinkhorn_iterations 控制', kind: '术语', weight: 100, tags: ['架构'] },
  ],
  'grouped matmul': [
    { text: '分组矩阵乘：MoE 多专家批量计算的算子形态，MXFP8 MoE scheme 使用', kind: '术语', weight: 100, tags: ['算子'] },
  ],
  'patch embedding': [
    { text: '图像块嵌入：GLM 视觉塔用 Conv3d 把 patch 转为向量 [P,Dv]', kind: '术语', weight: 100, tags: ['多模态'] },
  ],
  下采样: [
    { text: 'downsample：降低分辨率的压缩步骤；视觉塔经 Conv2d 下采样和 PatchMerger 输出 [P/m²,H]', kind: '术语', weight: 100, tags: ['多模态'] },
  ],
  聊天模板: [
    { text: 'chat template：把对话消息渲染成带角色等特殊标记的模型输入文本', kind: '术语', weight: 100, tags: ['推理基础'] },
  ],
  'causal mask': [
    { text: '因果掩码：阻止 token 注意到未来位置；NoPE 不等于不需要因果 mask', kind: '术语', weight: 100, tags: ['注意力'] },
  ],
  因果掩码: [
    { text: '即 causal mask，自回归生成的基本约束', kind: '术语', weight: 100, tags: ['注意力'] },
  ],
  padding: [
    { text: '填充：对齐批次/图规格补的无效位置；必须保留无效状态，图模式 padding 不能污染结果', kind: '术语', weight: 100, tags: ['算子'] },
  ],
  预热: [
    { text: 'warmup：正式服务前的试跑；图模式预热做 capture，首 token 慢先区分冷启动与稳态', kind: '术语', weight: 100, tags: ['执行模式'] },
  ],
  抢占: [
    { text: 'preemption：资源不足时请求被暂时换出；tail 块在结束/抢占时归还 BlockPool', kind: '术语', weight: 100, tags: ['调度'] },
  ],
  回放: [
    { text: 'replay：图执行重放录制的设备调用；MTP 语境指从接受边界恢复状态继续推进', kind: '术语', weight: 100, tags: ['执行模式'] },
  ],
  FULL_DECODE_ONLY: [
    { text: 'cudagraph_mode 取值：只对 decode 阶段录制完整图，教程主模型采用', kind: '标识符', weight: 100, tags: ['执行模式'] },
  ],
  cudagraph_mode: [
    { text: 'vLLM 图模式配置字段：历史命名沿用 CUDA，Ascend 上实际对应 ACL Graph', kind: '标识符', weight: 100, tags: ['执行模式'] },
  ],
  MC2: [
    { text: '昇腾 Matmul 与通信融合路线；MoE 具体走 all-to-all 还是 MC2 由硬件和 runner 配置决定', kind: '缩写', weight: 100, tags: ['通信'] },
  ],
};

/* ===== 内联区结束 ===== */

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
