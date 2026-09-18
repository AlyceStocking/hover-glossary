# hover-glossary 开发说明

可持久安装的浏览器插件：在用户与助手聊天正文中悬停，显示词语的多个释义。安装见[仓库首页](../README.md)，维护见[glossary-mapping skill](../.dsh/skills/glossary-mapping/SKILL.md)。

## 源码与构建

- `src/seed-data.mjs`：唯一持久词库，词 → 条目数组。
- `src/lexicon.mjs`：`Map<normalizedKey, Entry[]>`、归一化、光标处最长匹配。
- `plugin/client-panel.js`：浏览器模块模板，字符几何命中、聊天范围、浮层与监听器生命周期。
- `scripts/build-client.mjs`：生成内联副本与 `plugin/package/`。导入构建函数不会修改产物。
- `plugin/host-service.js`、`plugin/cordis-define.json`：保留的旧实验产物；当前安装与查询不使用它们。

```powershell
node scripts/build-client.mjs
node test/run.mjs
```

测试不会自动重建产物，因此能发现忘记构建的改动。

## 两种依赖声明

`package.json` 的 `dsh.client.inject` 是模块图依赖，指向提供运行时服务的 `@deepseek-ai/dsh-client-ui-renderer`。
浏览器 factory 导出的 `inject = ['slots']` 才是 Cordis 服务依赖声明，允许 `apply(ctx)` 访问 `ctx.slots`。
缺失后者会出现 `cannot get property "slots" without inject`。纯前端插件同样需要声明客户端服务依赖。

浮层等待 `shell.overlay` 声明后注册；CSS 用 React `<style>` 管理，没有 `styles` 全局。卸载时移除鼠标、滚动和失焦监听器。

依据：[服务依赖](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/service)、[Slot 生命周期](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/slots)、[Web Client 加载链](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/web-client)。

## 真实浏览器验证

需要已安装的 Playwright、Edge 和运行中的 Harness：

```powershell
$env:DSH_TEST_LOG = '<Harness 启动日志路径>'
# 或设置 DSH_TEST_URL 为启动时打印的认证 URL；测试不会输出该 URL。
$env:PLAYWRIGHT_MODULE = '<playwright/index.mjs 的绝对路径>'
node test/browser.mjs
```

测试打开“DeepSeek 词联想插件开发”既有会话，验证原有助手消息的 WHO 浮层，再用临时 DOM 样本检查用户/助手两种区域的五个示例词、中文词、短语、排除区域、滚动和刷新。样本不会保存到会话或请求模型。可用 `DSH_TEST_SESSION` 指定另一个含 WHO 的会话。

持久化验证须另外重启 Harness 进程后再运行浏览器测试；只确认服务端发出 bundle 不能证明插件能激活。
