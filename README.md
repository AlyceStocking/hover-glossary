# hover-glossary

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的**动态 Cordis 插件**：把鼠标停在对话正文里的某个词上，就在光标旁浮出该词的 **1..N 条联想（释义）**。

正文既包括**你输入的内容**，也包括**模型输出的内容**。

演示：光标停在 `WHO` 上 →

```
WHO                     2 条
1. 世卫组织      缩写
2. 谁            代词
```

## 特性

- **词 → 1..N 条**：一个词显式对应多个条目，顺序与编号稳定可见。
- **只作用于真实对话正文**：没有额外面板，词库维护不出现在界面里。
- **中英混排**：拉丁词连续读取；多字词按最长匹配切分（`世界卫生组织` 优先于 `世卫组织`）。
- **归一化匹配**：`who` / `Who` / `ＷＨＯ` / `(WHO)` 命中同一条目。
- **纯浏览器侧**：词库内联在客户端 bundle 里，不发 RPC、不注册模型工具，也不占模型上下文。

## 工作原理

| 半边 | 位置 | 职责 |
| --- | --- | --- |
| Client | 浏览器 | 用 `elementFromPoint` + `caretRangeFromPoint` 取光标下的字符，截出所在的词，查内联词库后在 `shell.overlay` 里渲染浮层 |
| Host | DSH Node 进程 | 只提供一个空的加载入口；词典与查询都在浏览器侧完成 |

判定范围不依赖任何锚点元素：只要命中的是文本、且不在按钮/输入框等控件内，就参与查询。

## 安装（可持久，扛得住重启）

插件以**本地客户端插件包**的形式安装，重启后依然生效：

```powershell
# 1. 安装包 (目录名必须等于 package.json 的 name)
$dst = "$env:USERPROFILE\.dsh\profiles\node_modules\hover-glossary"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item hover-glossary\plugin\package\* $dst -Recurse -Force

# 2. 装配行 (仅首次安装需要; 之后重启 dsh web 生效)
#    在 ~/.dsh/profiles/web/cordis.patch.yml 追加:
#      - insert:
#          - id: hover-glossary
#            name: hover-glossary
```

> ⚠️ 不要用动态 Cordis 插件（`cordis_define` / `cordis_run`）来"安装"它。那种形式只活在
> 当前进程的内存里，`dsh web` 一重启就消失 —— 这正是它第一次丢失的原因。

## 目录结构

```
.dsh/skills/glossary-mapping/SKILL.md   更新/安装词典映射的操作技能
hover-glossary/
├── src/lexicon.mjs                     词→N 条目的数据结构与光标查询算法（唯一实现）
├── src/seed-data.mjs                   预置词库：映射只在这里维护
├── plugin/host-service.js              Host 半模板（仅动态插件版本使用）
├── plugin/client-panel.js              Client 半模板（悬停引擎 + 浮层 + 自检）
├── plugin/cordis-define.json           成品：交给 cordis_define 的 { host, client }
├── scripts/build-client.mjs            把 src/ 内联进产物并校验语法
├── plugin/package/                     可持久安装的包 (package.json + lib/)
└── test/                               13 个用例
```

## 词典数据

改 `hover-glossary/src/seed-data.mjs` 即可增删词条：

```js
TERM: [
  { text: '第一解释', kind: '缩写', weight: 100 },
  { text: '第二解释', kind: '代词', weight: 10 },
],
```

`weight` 越大越靠前，同权重保持书写顺序；`index` 由构建脚本按排序结果赋值，不要手写。

完整的更新流程、匹配规则与注意事项见技能文档
[`.dsh/skills/glossary-mapping/SKILL.md`](.dsh/skills/glossary-mapping/SKILL.md)。

## 开发

```bash
cd hover-glossary
node test/run.mjs               # 全部 13 个用例
node scripts/build-client.mjs   # 改 src/ 后重新生成 plugin/ 下的全部产物
```

沙箱禁止 `node --test` 启动子进程（spawn EPERM），因此 `test/run.mjs` 用动态 import
在同一个进程里加载各测试文件。

## 已知边界

- 唯一的持久化路径是改 `hover-glossary/src/seed-data.mjs` → 重建 → 重装包。
  `glossary/define` 只改某个运行进程的内存，重启即失，不是持久化 API。
- CJK 没有分词边界，连续汉字整段成一个 token：收录的多字词前应当是空格、标点或行首，
  否则会像 `即世卫组织` 里的 `即` 那样占住词首导致匹配不到。
- 跨空格短语（`United Nations`）从第一个词开始命中；光标停在第二个词上时按该词自身查询。
- 首次安装新增的装配行需要重启 `dsh web` 才生效；只替换包文件则不必。
