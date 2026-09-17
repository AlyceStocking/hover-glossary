/**
 * hover-glossary / test/lexicon.test.mjs
 *
 * 五个用例覆盖: 1->N 多条目、最长词优先、大小写/标点/空白归一、
 * 光标定位(中英混排)、未收录词的兜底。
 *
 * 运行: node --test test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { Lexicon, createLexicon, normalize, tokenAt } from '../src/lexicon.mjs';
import { SEED_TABLE } from '../src/seed-data.mjs';

const lexicon = createLexicon(SEED_TABLE);

/* ------------------------------------------------------------------ *
 * 用例 1: 1 -> N 多条目, 保持给定顺序与编号
 * ------------------------------------------------------------------ */
test('用例1: 一个词映射到多个联想条目 (WHO => 1、世卫组织 2、谁)', () => {
  const entries = lexicon.lookup('WHO');

  assert.equal(entries.length, 2, 'WHO 应有两个条目');
  assert.deepEqual(
    entries.map((e) => e.text),
    ['世卫组织', '谁'],
  );
  assert.deepEqual(
    entries.map((e) => e.index),
    [1, 2],
    '条目必须带连续编号, 供 UI 渲染 "1、... 2、..."',
  );
  assert.equal(entries[0].kind, '缩写');
  assert.equal(entries[1].kind, '代词');

  // 1 -> 3 也要成立 (不是只支持两条)
  assert.equal(lexicon.lookup('API').length, 3);

  // N 个条目互不合并、互不去重
  const dup = new Lexicon().add('X', ['同一个解释', '同一个解释']);
  assert.equal(dup.lookup('X').length, 2, '重复文本不应被静默去重');
});

/* ------------------------------------------------------------------ *
 * 用例 2: 最长词优先 (世界卫生组织 优先于 世卫组织)
 * ------------------------------------------------------------------ */
test('用例2: 光标查询按最长词优先命中', () => {
  const text = '世界卫生组织发布报告';

  // 光标在 "世界卫生组织" 内任意位置
  const atSecond = lexicon.lookupAt(text, 1);
  assert.equal(atSecond.term, '世界卫生组织');
  assert.equal(atSecond.entries[0].text, '世界卫生组织（WHO），简称世卫组织');

  const atLast = lexicon.lookupAt(text, 5);
  assert.equal(atLast.term, '世界卫生组织', '词内任意位置都应命中同一个词');

  // "世卫组织" 本身也仍然是独立可命中的词
  const short = lexicon.lookupAt('世卫组织总部', 0);
  assert.equal(short.term, '世卫组织');
  assert.equal(short.entries[0].text, '世界卫生组织（WHO）');

  // 多词短语 "United Nations": 光标在短语起点上时整体命中
  const phrase = lexicon.lookupAt('joined United Nations in 1945', 9);
  assert.equal(phrase.term, 'United Nations');
  assert.equal(phrase.start, 7);
  assert.equal(phrase.end, 21);

  // 光标在短语的第二个词上时, 命中该词本身 (未收录故为空); 不影响第一个词的命中
  assert.equal(lexicon.lookupAt('joined United Nations in 1945', 15).entries.length, 0);

  // CJK: 光标压在多字词的任意一个字上, 都从该词真正的起点开始命中
  const cjk = lexicon.lookupAt('即世卫组织', 1);
  assert.equal(cjk.term, '世卫组织', '光标在 "世" 上时命中的是 "世卫组织"');
  assert.equal(cjk.start, 1);
  assert.equal(cjk.end, 5);
  assert.equal(lexicon.lookupAt('即世卫组织', 4).term, '世卫组织', '光标在词尾字上同样命中');
  // 光标压在前一个独立字上时不会替它扩张成后面的词
  assert.equal(lexicon.lookupAt('即世卫组织', 0).entries.length, 0);
});

/* ------------------------------------------------------------------ *
 * 用例 3: 归一化 —— 大小写 / 标点 / 全角 / 空白
 * ------------------------------------------------------------------ */
test('用例3: 大小写、标点、全角、空白归一后命中同一词', () => {
  assert.equal(normalize('  WHO，'), 'who');
  assert.equal(normalize('ＷＨＯ'), 'who', 'NFKC 全角 -> 半角');
  assert.equal(normalize('United   Nations!'), 'united nations');
  assert.equal(normalize('世 卫 组织'), '世卫组织', 'CJK 之间的排版空格应折叠');

  for (const spelling of ['who', 'Who', 'WHO', 'ＷＨＯ', '(WHO)', '“WHO”', 'WHO.']) {
    const entries = lexicon.lookup(spelling);
    assert.equal(entries.length, 2, `${spelling} 应命中 WHO 的 2 个条目`);
    assert.equal(entries[0].text, '世卫组织');
  }

  // 英文词中间的空格不折叠: "unitednations" 不应误命中短语
  assert.equal(lexicon.lookup('unitednations').length, 0);
  assert.equal(lexicon.lookup('').length, 0);
  assert.equal(lexicon.lookup(null).length, 0, '非字符串输入安全返回空');
});

/* ------------------------------------------------------------------ *
 * 用例 4: 光标定位 —— 中英混排、词尾光标、非词位置
 * ------------------------------------------------------------------ */
test('用例4: tokenAt / lookupAt 能正确定位光标所在词', () => {
  const text = 'use the API 和 DSH 都行';

  // "API" 位于索引 8..11
  assert.deepEqual(tokenAt(text, 9), { term: 'API', start: 8, end: 11 });
  assert.equal(lexicon.lookupAt(text, 9).entries[0].text, '应用程序编程接口');

  // 光标停在词尾右侧的空白上: tokenAt 不归属任何词, lookupAt 保留左侧刚看过的词
  assert.equal(text[11], ' ');
  assert.equal(tokenAt(text, 11), null);
  assert.equal(lexicon.lookupAt(text, 11).term, 'API');

  // 被空白围住的位置: 向右前移到下一个词再解析, 不越过它去猜左边的词
  const sparse = 'use  the API';
  assert.equal(sparse[3], ' ');
  assert.equal(tokenAt(sparse, 3), null);
  assert.equal(lexicon.lookupAt(sparse, 3).entries.length, 0);
  assert.equal(lexicon.lookupAt(text, 3).term, 'use', '单个空格上仍归属左侧完整的词');
  assert.equal(tokenAt('', 0), null);
  assert.equal(tokenAt(text, Number.NaN), null);

  // 中英混排: "和" 是 CJK, 单字成词; DSH 在 14..17
  assert.deepEqual(tokenAt(text, 12), { term: '和', start: 12, end: 13 });
  assert.deepEqual(tokenAt(text, 15), { term: 'DSH', start: 14, end: 17 });
  assert.equal(lexicon.lookupAt(text, 15).entries[0].text, 'DeepSeek Harness（本终端所在的产品）');

  // 越界光标被夹取, 不抛错 (CJK 连续成 token, 这是刻意设计: 多字词靠最长匹配切出来)
  assert.deepEqual(tokenAt(text, 999), { term: '都行', start: 18, end: 20 });
  assert.deepEqual(tokenAt(text, -5), { term: 'use', start: 0, end: 3 });
});

/* ------------------------------------------------------------------ *
 * 用例 5: 完整链路 —— 真实正文上的逐光标查询 + 词库结构自检
 * ------------------------------------------------------------------ */
test('用例5: 真实正文里每个收录的词都能被光标命中, 且词库结构自检通过', () => {
  // 结构自检
  const report = lexicon.validate();
  assert.equal(report.ok, true, `词库自检失败: ${report.problems.join('; ')}`);

  // 统计口径一致
  assert.equal(lexicon.size, Object.keys(SEED_TABLE).length);
  assert.equal(
    lexicon.itemCount,
    Object.values(SEED_TABLE).reduce((n, list) => n + list.length, 0),
  );

  // 词库里的每个词都必须至少有一条解释, 否则悬停会出现 "有词无内容"
  for (const [term, items] of Object.entries(SEED_TABLE)) {
    const entries = lexicon.lookup(term);
    assert.equal(entries.length, items.length, `"${term}" 条目数不一致`);
    assert.ok(entries.every((e) => e.text.length > 0), `"${term}" 有空条目`);
    assert.deepEqual(
      entries.map((e) => e.index),
      entries.map((_, i) => i + 1),
      `"${term}" 的编号不连续`,
    );
  }

  // 用真实正文复刻端到端链路: 光标停在任何位置, 命中词必须覆盖光标
  // 注意 CJK 没有分词边界, 连续汉字整段成一个 token: "即世卫组织" 里 "即" 会
  // 成为该 token 的首字符, 因此收录词自然写作 "即 世卫组织" (或前面是标点/行首)。
  const full = [
    '我输入: 请解释 WHO 与 United Nations 的关系',
    '我输出: WHO 即 世卫组织, 也叫 世界卫生组织; DSH 的 Cordis 插件负责扩展。',
    '再输入: API 和 LLM 分别是什么? DeepSeek 也收录了吗',
  ].join('\n');

  const expected = [
    ['WHO', 2],
    ['世卫组织', 2],
    ['世界卫生组织', 1],
    ['United Nations', 2],
    ['DSH', 2],
    ['Cordis', 2],
    ['API', 3],
    ['LLM', 2],
    ['DeepSeek', 1],
  ];
  let probes = 0;
  for (const [term, count] of expected) {
    const start = full.toLowerCase().indexOf(term.toLowerCase());
    assert.ok(start >= 0, `正文中缺少 ${term}`);
    // 短语只能从它的第一个词开始命中 (光标停在第二个词上时按那个词自身查询),
    // 所以探针只覆盖第一个词。
    const firstWord = term.split(' ')[0];
    for (let cursor = start; cursor < start + firstWord.length; cursor += 1) {
      const found = lexicon.lookupAt(full, cursor);
      probes += 1;
      assert.ok(found.entries.length >= 1, `光标 ${cursor} 应命中条目`);
      // 命中区间必须覆盖光标, 且命中的词必须是正文的真实子串
      assert.ok(
        found.start <= cursor && cursor < found.end,
        `光标 ${cursor}: 命中区间 ${found.start}-${found.end} 未覆盖光标`,
      );
      assert.equal(full.slice(found.start, found.end), found.term);
      // 多字词 (CJK) 从词内任意位置都应解析回该词本身
      if (!term.includes(' ')) {
        assert.equal(found.term, term, `光标 ${cursor} 应命中 ${term}`);
        assert.equal(found.entries.length, count, `${term} 应有 ${count} 条`);
      }
    }
  }
  assert.ok(probes > 30, '探针数量应覆盖全部收录词');

  // 顺序稳定: 同样输入重复查询结果一致
  assert.deepEqual(lexicon.lookup('WHO'), lexicon.lookup('WHO'));
});
