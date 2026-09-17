# hover-glossary

DSH 动态 Cordis 插件：**把鼠标停在对话正文里的某个词上，就显示该词的 1..N 条联想（释义）。**

正文既包括**你输入的内容**，也包括**我输出的内容**。没有额外面板，词库的维护也不出现在 GUI 里。

示例：光标停在 `WHO` 上 → 浮出

```
WHO            2 条
1. 世卫组织     缩写
2. 谁           代词
```

## 它做什么

- 鼠标移动时用 `document.elementFromPoint` + `caretRangeFromPoint` 取到光标下的字符，
  截出所在的词（中英混排都能工作：拉丁词连续读取，汉字按多字词最长匹配切分）。
- 词在词库里 → 用 `host.call('glossary/resolve')` 向 Host 查询，在光标旁浮出编号条目。
- 词不在词库 → 不显示任何东西。
- 判定范围限于会话正文：每轮对话尾部与输入区各放一个不可见锚点，只有锚点内部的字符会被查询，
  侧边栏、设置页等区域不会触发。

## 文件结构

```
src/lexicon.mjs          词语 -> 1..N 条目的数据结构与光标查询算法 (唯一实现)
src/seed-data.mjs        预置词库 (映射只在这里维护, 不进 GUI)
test/lexicon.test.mjs    用例 1-5: 数据结构、最长匹配、归一化、光标定位、真实正文链路
test/inline-artifact.test.mjs  用例 6-7: 客户端内联副本与 src/ 一致、产物未过期
test/plugin-source.test.mjs    用例 8-11: 源码合法性、Host RPC、只装饰正文、Host/Client 一致
scripts/build-client.mjs 把 src/ 内联进两半源码, 产出 plugin/cordis-define.json
plugin/host-service.js   Host 半模板: harness.handle 提供词库 RPC
plugin/client-panel.js   Client 半模板: 悬停引擎 + 浮层
plugin/cordis-define.json 成品: 交给 cordis_define 的 { host, client } 函数体
```

## 数据结构

`Map<规范化键, Entry[]>` —— 一个词显式对应 N 个条目，条目带 `index / text / kind / weight`，
按 `weight` 降序稳定排序后重新编号，因此 UI 上的 `1、2、3` 顺序与数据顺序永远一致。
另有 `Map<键长度, Set<键>>` 长度分桶，让查询从最长候选往下试探（最长词优先）。

归一化负责把 `who` / `Who` / `ＷＨＯ` / `(WHO)` / `WHO.` 收敛到同一个键。

## 开发

```bash
node test/run.mjs          # 全部用例 (11 个)
node scripts/build-client.mjs   # 改动 src/ 后重新生成 plugin/cordis-define.json
```

沙箱禁止 `node --test` 启动子进程（spawn EPERM），所以 `test/run.mjs` 用动态 import
在同一个进程里加载各测试文件。

## 已知边界

- CJK 没有分词边界：连续汉字整段视为一个 token，因此收录的多字词前应是一个边界
  （空格、标点或行首）。写 `即 世卫组织` 能命中，写 `即世卫组织` 时 `即` 会占住词首。
- 跨空格短语（`United Nations`）从第一个词开始命中；光标停在第二个词上时按该词自身查询。
