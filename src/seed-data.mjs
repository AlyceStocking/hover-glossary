/**
 * hover-glossary / seed-data.mjs
 *
 * 预置词库 (term -> 1..N 条目)。
 * 这是插件唯一的映射来源: 它不出现在 GUI 里, 由 Host 持有并通过 RPC 提供查询。
 * 修改此文件后请执行 `node scripts/build-client.mjs` 重新生成内联副本。
 */

/**
 * 词库表。键 = 词 (大小写/标点不敏感), 值 = 有序联想条目数组。
 * weight 越大越靠前; 同权重保持书写顺序。
 * @type {Record<string, Array<{text:string, kind?:string, weight?:number, tags?:string[]}>>}
 */
export const SEED_TABLE = {
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
};
