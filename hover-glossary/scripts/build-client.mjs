/**
 * hover-glossary / scripts/build-client.mjs
 *
 * Cordis 的客户端代码是纯 JavaScript 函数体, 不允许 import/require。
 * 本脚本把 src/lexicon.mjs 与 src/seed-data.mjs 的实现内联成一段可直接嵌入
 * Client 闭包的源码, 输出到 plugin/client-inline.js。
 *
 * 这样 "词库数据结构" 只有一份实现: 测试跑 src/, 插件用内联副本,
 * 并由 build 的产物校验保证两者不会漂移。
 *
 * 运行: node scripts/build-client.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/** 去掉 JSDoc 块注释 (其中可能含有 `import` 字样, 会干扰闭包解析) */
function stripDocs(source) {
  return source.replace(/\/\*\*[\s\S]*?\*\//g, '');
}

/** 去掉 ESM 的 export 关键字, 保留实现 */
function stripExports(source) {
  return source.replace(/^export\s+(?=(class|function|const|let|var)\b)/gm, '');
}

/**
 * @param {string} relPath
 * @param {{keepHeader?:boolean}} [opts]
 */
function loadInline(relPath, opts = {}) {
  let code = readFileSync(resolve(root, relPath), 'utf8');
  code = stripDocs(code);
  if (!opts.keepHeader) {
    // 去掉文件顶部的说明注释块
    code = code.replace(/^\/\*[\s\S]*?\*\/\s*/, '');
  }
  code = stripExports(code);
  return code.trim();
}

/**
 * 生成内联源码 (导出以便测试直接复用, 避免测试与构建逻辑漂移)。
 * @returns {string}
 */
export function buildInlineSource() {
  const lexiconCode = loadInline('src/lexicon.mjs');
  const seedCode = loadInline('src/seed-data.mjs');
  return `/* 由 scripts/build-client.mjs 生成, 请勿手改; 改 src/ 后重新构建 */
${lexiconCode}

/* ---- 预置词库 (来自 src/seed-data.mjs) ---- */
${seedCode}
`;
}

/**
 * 把某个半边的模板替换成含内联副本的成品源码。
 * 模板里用下面的标记包住占位符, 替换时整块保留标记, 只换占位符内容。
 * @param {string} relPath
 * @returns {string}
 */
export function composeHalf(relPath) {
  const template = readFileSync(resolve(root, relPath), 'utf8');
  const marker = /\/\* =+ 内联区开始[^*]*\*\/\n\/\*__INLINE_SOURCE__\*\/\n\/\* =+ 内联区结束 =+ \*\//;
  if (!marker.test(template)) {
    throw new Error(`${relPath} 缺少内联区占位标记`);
  }
  const composed = template.replace(marker, `/* ===== 内联区开始 (由 build-client.mjs 从 src/ 生成) ===== */\n${buildInlineSource()}\n/* ===== 内联区结束 ===== */`);
  // 只检查内联区内部: 文件头注释里可能本来就提到过占位符名字
  const start = composed.indexOf('内联区开始');
  const end = composed.indexOf('内联区结束', start);
  if (start < 0 || end < 0 || composed.slice(start, end).includes('__INLINE_SOURCE__')) {
    throw new Error(`${relPath} 内联区仍有未替换的占位符`);
  }
  return composed;
}

/**
 * 校验一段动态插件源码是合法的函数体, 且不含 ESM 语法。
 * @param {string} source
 * @param {string} label
 */
export function assertPlainFunctionBody(source, label) {
  if (/^\s*(import|export)\s/m.test(source)) throw new Error(`${label}: 不应包含 import/export`);
  if (/\brequire\s*\(/.test(source)) throw new Error(`${label}: 不应包含 require`);
  // new Function 只做语法检查, 不执行
  // eslint-disable-next-line no-new-func
  new Function(source);
  return true;
}

const out = buildInlineSource();

mkdirSync(resolve(root, 'plugin'), { recursive: true });
const target = resolve(root, 'plugin/client-inline.js');
writeFileSync(target, out, 'utf8');

const hostSource = composeHalf('plugin/host-service.js');
const clientSource = composeHalf('plugin/client-panel.js');
assertPlainFunctionBody(hostSource, 'host-service.js');
assertPlainFunctionBody(clientSource, 'client-panel.js');

// 交给 cordis_define 的成品: 只含两个函数体字符串
const define = {
  name: 'Hover Glossary',
  purpose: '光标悬停在预置词上时显示该词的 1..N 条联想释义',
  code: { host: hostSource, client: clientSource },
};
writeFileSync(resolve(root, 'plugin/cordis-define.json'), JSON.stringify(define, null, 2), 'utf8');

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  console.log(`[build-client] wrote ${target} (${out.length} chars)`);
  console.log(`[build-client] wrote plugin/cordis-define.json (host ${hostSource.length} / client ${clientSource.length} chars)`);
}
