# hover-glossary

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的可持久安装浏览器插件：鼠标停在用户或助手聊天正文中的词上，显示 **1 → N 条释义**。

例如 `WHO` 显示“1. 世卫组织（缩写）；2. 谁（代词）”。词库与查询在浏览器内完成，不发送模型请求、不注册模型工具、不添加系统提示词，没有额外的词库面板或启动诊断卡片。

## 安装与更新

用 dsh 自带的插件管理命令安装（包装好后会出现在「设置 → 插件」管理界面里，可启停、可移除）：

```bash
dsh plugin --profile web add github:AlyceStocking/hover-glossary
```

然后重启 `dsh web`，通过启动时打印的认证 URL 打开页面。仅更新浏览器 bundle 时通常刷新即可；变更 manifest 或装配后应重启并验证。包和词库在磁盘上，重启后重新装载。

> 不要用手动复制到 `node_modules` + 编辑 `cordis.patch.yml` 的方式安装：那样插件能运行，但因为不是 profile 的 pnpm 依赖，插件管理 UI 不会列出它。也不要用只驻留进程内存的 `cordis_define` / `cordis_run` 代替 profile 安装。

## 更新映射

唯一词库源文件是 `src/seed-data.mjs`：

```js
TERM: [
  { text: '第一解释', kind: '缩写', weight: 100 },
  { text: '第二解释', kind: '代词', weight: 10 },
],
```

`weight` 越大越靠前，相同权重保留登记顺序。改动后运行 `node scripts/build-client.mjs` 与 `node test/run.mjs`，重新安装并刷新验证。完整流程在 [glossary-mapping skill](.dsh/skills/glossary-mapping/SKILL.md)。

## 行为与边界

- `who`、`Who`、`ＷＨＯ` 匹配同一词；`WHOLE` 不会误匹配 `WHO`。
- 连续中文正文内按最长词匹配，如 `即世界卫生组织发布报告` 中的 `世界卫生组织`。
- 英文短语目前从第一个词命中，如悬停 `United Nations` 中的 `United`。
- 限于用户/助手聊天正文，跳过侧栏、设置、按钮、链接和编辑中的输入框。用户输入指已经发送的消息。
- 查询限定单个 DOM 文本节点；跨多个样式节点拆开的词或短语不拼接查询。
- 控制台 `globalThis.__hoverGlossaryDiag__` 可查看词库数量与取字 API 检查结果。

## 开发与验证

16 个 Node 用例覆盖词库、产物同步、依赖声明、鼠标查询与卸载清理。另有真实浏览器脚本，验证实际 Harness 激活和既有聊天消息，并检查五个词的用户/助手区域样本。详见[开发说明](DEVELOPMENT.md)。

已在本地 Harness CLI `0.1.5-rc.1`、客户端组件 `0.1.5-rc.2` 与 Edge 上验证；其他版本需检查聊天 DOM 标记与 Slot 契约。
