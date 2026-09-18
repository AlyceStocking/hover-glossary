/**
 * hover-glossary / scripts/build-client.mjs
 *
 * 从 src/ 的单一实现生成两套产物:
 *
 * 1. plugin/cordis-define.json —— 动态插件 (进程内, 重启消失) 的 { host, client } 函数体。
 * 2. plugin/package/ —— 可持久安装的 profile 包:
 *      package.json      声明 dsh.client.platform=web
 *      lib/index.js      host 半边: 空 apply (纯客户端能力)
 *      lib/client.js     browser module: window.__ModuleLoader__.load({ id, factory })
 *
 * 之所以能纯客户端: 词库内联在浏览器侧, 不需要 RPC, 也不依赖会话级服务。
 *
 * 运行: node scripts/build-client.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const PKG_NAME = 'hover-glossary';
const PKG_VERSION = '1.0.0';

/** 去掉 JSDoc 块注释 (其中可能含有 import 字样, 会干扰闭包解析) */
function stripDocs(source) {
  return source.replace(/\/\*\*[\s\S]*?\*\//g, '');
}

/** 去掉 ESM 的 export 关键字, 保留实现 */
function stripExports(source) {
  return source.replace(/^export\s+(?=(class|function|const|let|var)\b)/gm, '');
}

/** @param {string} relPath */
function loadInline(relPath) {
  let code = readFileSync(resolve(root, relPath), 'utf8');
  code = stripDocs(code);
  code = code.replace(/^\/\*[\s\S]*?\*\/\s*/, '');
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

const INLINE_MARKER =
  /\/\* =+ 内联区开始[^*]*\*\/\n[ \t]*\/\*__INLINE_SOURCE__\*\/\n[ \t]*\/\* =+ 内联区结束 =+ \*\//;

/**
 * 把模板里的内联占位符替换成 src/ 的副本。
 * @param {string} relPath
 * @returns {string}
 */
export function composeTemplate(relPath) {
  const template = readFileSync(resolve(root, relPath), 'utf8');
  if (!INLINE_MARKER.test(template)) throw new Error(`${relPath} 缺少内联区占位标记`);
  const composed = template.replace(
    INLINE_MARKER,
    `/* ===== 内联区开始 (由 build-client.mjs 从 src/ 生成) ===== */\n${buildInlineSource()}\n/* ===== 内联区结束 ===== */`,
  );
  const start = composed.indexOf('内联区开始');
  const end = composed.indexOf('内联区结束', start);
  if (start < 0 || end < 0 || composed.slice(start, end).includes('__INLINE_SOURCE__')) {
    throw new Error(`${relPath} 内联区仍有未替换的占位符`);
  }
  return composed;
}

/**
 * 校验一段源码是合法的函数体 (new Function 只做语法检查, 不执行)。
 * @param {string} source
 * @param {string} label
 */
export function assertParses(source, label) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(source);
  } catch (error) {
    throw new Error(`${label} 语法检查失败: ${error.message}`);
  }
  return true;
}

/** 动态插件版本的 host 半边 (harness.handle RPC, 仅供进程内使用) */
function buildDynamicHostSource() {
  const composed = composeTemplate('plugin/host-service.js');
  if (/^\s*(import|export)\s/m.test(composed)) throw new Error('host 半边不应包含 import/export');
  assertParses(composed, 'dynamic host');
  return composed;
}

/** 静态 profile 包的 host 半边: 纯客户端能力, host 侧无事可做 */
export function buildPackageHostSource() {
  return [
    '// hover-glossary profile package: host loader entry.',
    '// 本插件是纯浏览器侧能力 (词库内联在 client bundle 里), host 侧不提供任何服务。',
    'function apply() {}',
    'export { apply };',
    '',
  ].join('\n');
}

/** 静态 profile 包的 package.json */
export function buildPackageManifest() {
  return (
    JSON.stringify(
      {
        name: PKG_NAME,
        version: PKG_VERSION,
        private: true,
        description: 'DSH 客户端插件: 光标停在对话正文的词上, 显示该词的 1..N 条联想',
        type: 'module',
        main: 'lib/index.js',
        exports: {
          '.': './lib/index.js',
          './client': './lib/client.js',
          './package.json': './package.json',
        },
        dsh: {
          client: {
            platform: 'web',
            // `slots` 服务由 @deepseek-ai/dsh-client-ui-renderer 提供, 但本地客户端插件
            // 约定用这个模块 id 声明依赖 (与 dsh-web-ui-notify 的写法一致)。
            // 不声明的话 ctx.slots 解析不到 —— 这正是插件第一次在浏览器里
            // 报 "slots 服务不可用" 并静默退出的原因。
            inject: ['@deepseek-ai/dsh-client-ui-slots'],
          },
        },
        license: 'MIT',
      },
      null,
      2,
    ) + '\n'
  );
}

const out = buildInlineSource();

mkdirSync(resolve(root, 'plugin'), { recursive: true });
writeFileSync(resolve(root, 'plugin/client-inline.js'), out, 'utf8');

// ---- 产物 1: 动态插件 ----
const dynamicHost = buildDynamicHostSource();
const browserModule = composeTemplate('plugin/client-panel.js');
assertParses(browserModule, 'browser module');

writeFileSync(
  resolve(root, 'plugin/cordis-define.json'),
  JSON.stringify(
    {
      name: 'Hover Glossary',
      purpose: '光标悬停在对话正文的词上时显示该词的 1..N 条联想释义',
      code: { host: dynamicHost, client: browserModule },
    },
    null,
    2,
  ),
  'utf8',
);

// ---- 产物 2: 可持久安装的 profile 包 ----
const pkgRoot = resolve(root, 'plugin/package');
mkdirSync(resolve(pkgRoot, 'lib'), { recursive: true });
writeFileSync(resolve(pkgRoot, 'package.json'), buildPackageManifest(), 'utf8');
writeFileSync(resolve(pkgRoot, 'lib/index.js'), buildPackageHostSource(), 'utf8');
writeFileSync(resolve(pkgRoot, 'lib/client.js'), browserModule, 'utf8');

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  console.log(`[build] plugin/client-inline.js (${out.length} chars)`);
  console.log(`[build] plugin/cordis-define.json (host ${dynamicHost.length} / client ${browserModule.length})`);
  console.log('[build] plugin/package/ (package.json + lib/index.js + lib/client.js)');
}
