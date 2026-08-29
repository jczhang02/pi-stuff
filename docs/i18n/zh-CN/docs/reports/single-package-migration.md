<!-- translation-source: docs/reports/single-package-migration.md; translation-source-sha256: caffbce2c402ac16cd530ca3c9f03fb50c9707713b731a0683a1c00847eb345f -->

# 已完成的单软件包迁移清单

> **历史架构记录。** 本清单保留已完成迁移所用拓扑和 Pi `0.84.1` 依赖基线，不是当前兼容性声明；见 [`docs/compatibility.md`](../compatibility.md)。

本记录把 `ps-7lq` 开始时冻结的源码拓扑映射到已完成单软件包布局，包括紧随其后落地的代码模式集成。每个列出的运行时资源、行为、提示词、原生辅助程序、来源记录和验证接缝都有明确目的地。

## 源码到模块映射

| 当前目录 | 目的地 | 运行时职责 |
| --- | --- | --- |
| `packages/pi-stuff` | `packages/pi-stuff` | 一个软件包清单、一个默认扩展、有序组合 |
| `packages/pi-stuff-ui` | `packages/pi-stuff/src/conversation-ui` | Welcome、状态栏、Thought、输入、设置、命令对话框和共享 UI 生命周期 |
| `packages/pi-stuff-tools` | `packages/pi-stuff/src/tool-display` | 内置工具呈现、套件工具约定、活动分组、详情对话框和恢复重建 |
| `packages/pi-stuff-context` | `packages/pi-stuff/src/context-management` | Magic Context 集成、有界投影和 Context 工具呈现 |
| `packages/pi-stuff-rtk` | `packages/pi-stuff/src/rtk` | RTK 命令重写、投影、设置和诊断对话框 |
| `packages/pi-stuff-codex` | `packages/pi-stuff/src/codex` | Codex Fast/用量控制和保留的原生工具辅助程序 |
| `packages/pi-stuff-goal` | `packages/pi-stuff/src/goal` | 持久目标、继续、核算、完成/阻塞和 Goal UI |
| `packages/pi-stuff-web` | `packages/pi-stuff/src/web` | 有界套件 Web 界面、URL 政策、假 IP 兼容和工具呈现 |
| `packages/pi-web-access` | `packages/pi-stuff/src/web/runtime` | 改编搜索、提取、存储、PDF 与 SSRF 实现 |
| `packages/pi-stuff-mcp` | `packages/pi-stuff/src/mcp` | 有界套件 MCP 界面、状态对话框和工具呈现 |
| `packages/pi-mcp-adapter` | `packages/pi-stuff/src/mcp/runtime` | 改编传输、发现、OAuth、生命周期、输出防护和协议实现 |
| `packages/pi-stuff-work` | `packages/pi-stuff/src/background-work` | 后台 Shell、Monitor、任务对话框和实时运行时注册表 |
| `packages/pi-stuff-agents` | `packages/pi-stuff/src/subagents` | Agent 发现、执行、引导、会话所有权、名册和对话框 |
| `packages/pi-stuff-todo` | `packages/pi-stuff/src/todo` | Todo 状态、任务图、Task 工具和清单 UI |
| `packages/pi-stuff-btw` | `packages/pi-stuff/src/btw` | 一次性旁支问题、隔离模型请求、历史和命令对话框 |
| 并发 `feat/code-mode` 实现 | `packages/pi-stuff/src/code-mode` | 选择加入的单 Schema 工具封装、隔离 V8 执行、宿主获取和未变化嵌套工具呈现 |

目的地目录名称就是内部模块名称。除 `packages/pi-stuff` 外，任何目的地都不获得 `package.json`、版本、npm 导出或 Pi `extensions` 声明。

## 非 TypeScript 运行时资源

以下资源随所属模块移动，并继续保留在软件包文件许可列表中，除非后续产品决策显式删除：

- `btw/prompts/btw-system.txt`
- `codex/native/{apply-patch,imagegen,view-image}/linux-x64/*`
- `codex/LICENSES/Apache-2.0.txt` 和 `codex/THIRD_PARTY_NOTICES.md`
- `rtk/upstream/techniques/*.ts`
- `background-work/process-supervisor.mjs`
- `mcp/runtime/app-bridge.bundle.js`
- `mcp/runtime/mcp-script-worker.mjs`
- `mcp/runtime/mcp-keyring-helper.cjs`
- `mcp/runtime/banner.png`
- `code-mode/LICENSES/Apache-2.0.txt`、`code-mode/THIRD_PARTY_NOTICES.md` 和 `code-mode/UPSTREAM.md`
- 每个保留 `UPSTREAM.md`、`SECURITY.md` 和第三方许可证正文

临时捆绑的 `subagents/agents/general-purpose.md` 资源后来已删除；Pi Stuff 现在不交付 Agent 定义。

历史逐软件包 Changelog 可通过 Git 历史查看。迁移后维护一个软件包 Changelog。

## 依赖清单

自有 `@jczhang02/pi-*` 依赖消失。Pi 核心软件包继续作为通配 Peer 和精确 `0.84.1` 开发依赖。直接外部运行时依赖集合从源码导入派生，而不是沿用此前完整捆绑的传递清单：

- `@cortexkit/pi-magic-context`
- `@modelcontextprotocol/ext-apps`
- `@modelcontextprotocol/sdk`
- `@mozilla/readability`
- `@napi-rs/keyring`
- `@napi-rs/keyring-linux-x64-gnu`
- `ajv`
- `ajv-formats`
- `cross-spawn`
- `linkedom`
- `open`
- `p-limit`
- `proxy-from-env`
- `promise.try`
- `smol-toml`
- `strip-json-comments`
- `turndown`
- `typebox`
- `unpdf`
- `zod`

删除任何此前直接依赖前，迁移必须确认动态导入和可选平台辅助程序。冻结 Bun 锁文件继续作为完整传递依赖记录。

## 组合与接口不变量

安装顺序保持：

1. Conversation UI
2. Tool Display
3. RTK
4. Codex
5. Goal
6. Context Management
7. Web
8. MCP
9. Background Work
10. Subagents
11. Todo
12. BTW
13. Code Mode，在完整工具目录注册后安装

每个模块保留一个接受 Pi `ExtensionAPI` 的安装接口。Subagents 还接收用于启动子进程的单一软件包入口路径。套件工具注册跟踪器和必需、延后、可选工具清单继续作为权威。工具 Schema、活跃工具政策、注册顺序和活动元数据覆盖不得漂移。

内部依赖方向为：

```text
软件包入口 -> 能力模块 -> conversation-ui
                        \-> tool-display -> conversation-ui
web -> web/runtime
mcp -> mcp/runtime
btw -> context-management
subagents -> context-management + background-work
code-mode -> tool-display
```

`conversation-ui` 与 `tool-display` 不得导入能力模块。跨模块协调继续通过现有共享事件总线、模块负责的注册表和显式导入接口。套件启动就绪由 `conversation-ui` 负责，使用模块局部宿主注册表，不增加第二运行时或软件包全局协调器。

## 验证目的地

现有测试保留行为家族（`ui`、`tools`、`context`、`rtk`、`codex`、`goal`、`web`、`mcp`、`work`、`agents`、`todo`、`btw` 和 `code-mode`），同时把导入改为内部模块路径。专用 Agent、Goal 与 RTK TypeScript 配置继续保留，直到其上游派生源码可以在不改变行为的情况下满足一个共同严格配置。

最终必需接缝为：

- 确定性有序组合和完整工具活动元数据；
- 仓库安全与显式软件包文件许可列表；
- 一个提取后的本地软件包通过 Pi 软件包加载器加载；
- Pi 0.84.1 公开 RPC 工具与命令发现；
- 100x32 与 64x28 的真实 PTY 覆盖；
- 重载/恢复、压缩、长会话重建和后台终结；
- MCP stdio/HTTP 用例、Web 集成、Magic Context、RTK 和原生 Codex 工具检查；
- 代码模式直接/封装等价、嵌套媒体、取消、恢复、Schema 缩减和宽/窄真实 Pi TUI 检查；
- 无模型请求或凭据要求的网络隔离验收。

## 已删除维护界面

一个软件包通过等价验证后，删除：

- 原十二个能力清单和两个私有实现清单（代码模式直接作为内部模块进入，从未增加另一个清单）；
- 自有依赖与 `bundledDependencies` 版本同步；
- 作为活跃发布输入的 Changesets 与逐软件包 Changelog；
- 注册表发布与多归档发布脚本；
- 基于软件包名称的套件生成与 Schema 校验；
- 只为桥接工作区软件包导入而存在的类型声明。

单软件包打包与本地安装验证继续保留。代码模式通过同一个内部工具注册接口集成，不恢复另一个软件包边界。

## 完成证据——更新于 2026-08-11

- `packages/pi-stuff/package.json` 是 `packages/` 下唯一清单；十三个模块没有清单、版本、npm 导出、生命周期脚本或自有软件包依赖。
- Web 与 MCP 实现源码现在位于 `src/web/runtime` 和 `src/mcp/runtime`。提取后软件包审计要求其许可证、来源、原始文档、Web 安全政策、MCP Banner 与运行时辅助程序、每个保留 RTK 技术，以及 Codex Apache 许可证与声明。
- 单一依赖边界把 TypeBox 收敛到 `1.3.10`，即吸收 Web 实现已使用且 Magic Context 已解析的精确版本。只重复传递 SDK 依赖的原 MCP 清单项已删除；SDK 已选嵌套版本现在去重。下方完整 Schema 与运行时矩阵验证收敛边界。
- 仓库安全现在会拒绝 `packages/` 下新增软件包、嵌套清单、发布生命周期状态，或违反已接受共享到能力依赖方向的内部模块导入。
- `bun run typecheck`、`bun run knip`、生成组合、仓库安全、格式和工具活动基准通过。完整隔离测试矩阵在分离 Bun 进程中通过，之后 Goal 上游套件通过。
- `bun run pack:verify` 使用源码证明的 Pi 0.84.1 宿主验证一个本地归档。它覆盖软件包加载、命令与工具、恢复、Magic Context、Goal、Web、MCP、RTK、Subagents、后台工作、BTW 和已接受宽/窄 TUI 界面。
- 代码模式是第十三个内部模块。它通过 `suite.json` 和套件工具注册跟踪器进入，保留直接工具 UI/会话/媒体行为，并由同一软件包与真实宿主验证矩阵覆盖。
