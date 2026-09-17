/**
 * hover-glossary / test/run.mjs
 *
 * 顺序加载全部测试文件。
 * 说明: 沙箱禁止 node --test 启动子进程 (spawn EPERM), 因此这里用动态 import
 * 在同一个进程里加载各测试文件, 再由 node:test 汇总输出。
 *
 * 运行: node test/run.mjs   (或 npm test)
 */
import test from 'node:test';

const files = ['./lexicon.test.mjs', './inline-artifact.test.mjs', './plugin-source.test.mjs'];

for (const file of files) {
  await import(file);
}

// 顶层 await 之后, node:test 会在事件循环清空时汇总输出全部用例结果
await new Promise((done) => test.after(() => done()));
