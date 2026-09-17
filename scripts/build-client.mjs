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

const out = buildInlineSource();

mkdirSync(resolve(root, 'plugin'), { recursive: true });
const target = resolve(root, 'plugin/client-inline.js');
writeFileSync(target, out, 'utf8');

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  console.log(`[build-client] wrote ${target} (${out.length} chars)`);
}
