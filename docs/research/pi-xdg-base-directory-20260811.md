# Pi / Pi Stuff 文件位置总表

日期：2026-08-12
核查版本：[Pi 0.84.1](https://github.com/earendil-works/pi/releases/tag/v0.84.1)、Pi Stuff 当前源码、Magic Context 0.33.1

这份表只回答三个问题：会出现什么文件、现在写到哪里、Pi Stuff 改完后写到哪里。它列的是程序决定的默认路径；`--session-dir`、`PI_TUI_WRITE_LOG`、MCP `trace.file` 等用户显式指定的路径仍以用户输入为准。

本机当前路径已经确定：

- Pi 配置目录：`$PI_CODING_AGENT_DIR = $XDG_CONFIG_HOME/pi = ~/.config/pi`
- Pi Session 目录：`$PI_CODING_AGENT_SESSION_DIR = $XDG_STATE_HOME/pi/sessions = ~/.local/state/pi/sessions`
- Pi Stuff 状态目录：`$XDG_STATE_HOME/pi-stuff = ~/.local/state/pi-stuff`
- Pi Stuff 缓存目录：`$XDG_CACHE_HOME/pi-stuff = ~/.cache/pi-stuff`
- Pi Stuff 运行目录：`$XDG_RUNTIME_DIR/pi-stuff = /run/user/1000/pi-stuff`

表中的“改造后”是计划结果，不代表当前代码已经完成这些改动。

## 总表

| 归属 | 文件或目录 | 当前代码会写到 | Pi Stuff 改造后 | 处理方式 |
| --- | --- | --- | --- | --- |
| Pi | `settings.json` | `~/.config/pi/settings.json`，本机已存在 | 不变 | Pi 配置 |
| Pi | `auth.json` | `~/.config/pi/auth.json`，本机已存在 | 不变 | Pi 凭据，保留并设为 `0600` |
| Pi | `models.json` | `~/.config/pi/models.json`，按需手动创建 | 不变 | Pi 模型配置 |
| Pi | `models-store.json` | `~/.config/pi/models-store.json`，本机已存在 | 不变 | 这是 Pi 的动态模型目录缓存；Pi 0.84.1 没有单独的 cache 路径变量，Pi Stuff 无权移动 |
| Pi | `trust.json` | `~/.config/pi/trust.json`，本机已存在 | 不变 | Pi 信任设置 |
| Pi | `AGENTS.md`、`CLAUDE.md`、`SYSTEM.md`、`APPEND_SYSTEM.md`、`extensions/`、`skills/`、`prompts/`、`themes/` | `~/.config/pi/` 下 | 不变 | Pi Runtime Resources 和用户指令 |
| Pi | `npm/`、`git/` 及其中的 Package、`package.json`、锁文件 | `~/.config/pi/npm/`、`~/.config/pi/git/` | 不变 | Pi 管理的 Package data；受上游单一 Agent 目录限制 |
| Pi | `tools/`、`bin/` | `~/.config/pi/tools/`、`~/.config/pi/bin/` | 不变 | Pi 下载或管理的工具和二进制；受上游限制 |
| Pi | Session `*.jsonl` | `~/.local/state/pi/sessions/--<project>--/*.jsonl` | 不变 | 已由 `PI_CODING_AGENT_SESSION_DIR` 正确放入 XDG state |
| Pi | `pi-debug.log` | `~/.config/pi/pi-debug.log`，仅启用调试日志时出现 | 不变 | 上游没有独立 state/log 路径 |
| Pi | `tmp/extensions/` | `~/.config/pi/tmp/extensions/`，安装临时 Package 时出现 | 不变 | 上游没有独立 runtime 路径 |
| Pi Stuff 配置 | `pi-stuff-ui.json`、`pi-stuff-tools.json`、`pi-stuff-rtk.json`、`pi-stuff-codex.json`、`pi-goal.json` | 全部在 `~/.config/pi/`；本机已有 UI、Codex 两个文件，其余按需创建 | 不变 | 全部跟随 Pi 的 `getAgentDir()`；不新增 Pi Stuff 配置目录 |
| Pi Stuff 配置 | `web-search.json` | 当前环境下代码读取 `~/.config/pi/web-search.json`；本机旧文件仍在 `~/.pi/web-search.json` | `~/.config/pi/web-search.json` | 修正实现为统一调用 Pi `getAgentDir()`；旧文件需人工复制或合并，不能静默覆盖 |
| Pi Stuff 配置 | Pi 专属 `mcp.json` | `~/.config/pi/mcp.json`，按需创建 | 不变 | 跟随 Pi 配置目录，可能含密钥，设为 `0600` |
| Pi Stuff 配置 | `agents/*.md` | `~/.config/pi/agents/*.md`，用户手动创建 | 不变 | Subagent 定义，跟随 Pi 配置目录 |
| Pi Stuff 配置 | 共享 MCP `mcp.json` | 代码硬编码 `~/.config/mcp/mcp.json` | `$XDG_CONFIG_HOME/mcp/mcp.json`；本机仍是 `~/.config/mcp/mcp.json` | 只修正自定义 `XDG_CONFIG_HOME` 的支持 |
| Magic Context 配置 | `magic-context.jsonc` 或 `.json` | `$XDG_CONFIG_HOME/cortexkit/`；本机已有 `~/.config/cortexkit/magic-context.jsonc` | 不变 | 已符合 XDG config |
| Magic Context 数据 | `context.db`、`context.db-wal`、`context.db-shm`、模型文件和版本记录 | `$XDG_DATA_HOME/cortexkit/magic-context/`；本机数据库已存在 | 不变 | 这是可跨 Session 使用的长期数据，已经位于 XDG data |
| Pi Stuff Session 状态 | Goal、Todo、BTW 等自定义 Session entries | 写进上面的 Pi Session `*.jsonl` | 不变 | 不再为这些状态创建第二套全局文件 |
| Goal 旧格式 | `pi-goal-state.json` | 当前代码只在 `~/.config/pi/pi-goal-state.json` 存在时读取并清理；本机未发现 | 不再生成新文件；只保留旧文件兼容清理 | 不创建 `$XDG_STATE_HOME/pi-stuff/goal/`；当前 Goal 权威状态已经在 Pi Session 中 |
| Conversation UI | `pi-stuff-ui.json.lock` | `~/.config/pi/pi-stuff-ui.json.lock`，本机已存在 | `$XDG_RUNTIME_DIR/pi-stuff/pi-stuff-ui.json.lock` | 锁文件不迁移；确认无 Pi 进程后可删除旧锁 |
| MCP 状态 | `mcp-onboarding.json` | `~/.config/pi/mcp-onboarding.json`，本机未发现 | `$XDG_STATE_HOME/pi-stuff/mcp/mcp-onboarding.json` | 新路径优先，旧路径只读兼容，不自动覆盖 |
| MCP 缓存 | `mcp-cache.json`、`mcp-npx-cache.json` | `~/.config/pi/`，本机未发现 | `$XDG_CACHE_HOME/pi-stuff/mcp/` | 不迁移，缺失时自动重建 |
| Code Mode 缓存 | `pi-stuff-code-mode/<release>/<platform-arch>/<binary>` | `~/.config/pi/cache/pi-stuff-code-mode/`，本机未发现 | `$XDG_CACHE_HOME/pi-stuff/code-mode/` | 不迁移，缺失时重新下载；安装锁和 staging 文件跟随缓存目录 |
| Background Work 状态 | `runtime-auth.key` | `$XDG_STATE_HOME/pi-stuff/work/runtime-auth.key`，本机已存在 | 不变 | 已符合 XDG state；必须保留并设为 `0600` |
| Subagents 状态 | `session-governor/<session-hash>/{ledger.json,ledger.lock,...}` | `$XDG_STATE_HOME/pi-stuff/agents/session-governor/`，本机已存在 | 不变 | 已符合 XDG state |
| Subagents 运行数据 | `async-subagent-runs/`、`foreground-runs/`、`nested-subagent-runs/`、`session-leases/`、`supervisor-channels/`、`async-cfg-*.json` 及其中的状态、事件和日志 | `$TMPDIR/pi-stuff-agents-<scope>/`；本机 `/tmp` 下已有运行目录 | `$XDG_RUNTIME_DIR/pi-stuff/agents-<scope>/`；没有可用的绝对 `XDG_RUNTIME_DIR` 时才退回 `$TMPDIR` | 运行数据不迁移，旧目录由维护逻辑清理 |
| Subagent 结果 | `*_input.md`、`*_output.md`、`*.jsonl`、`*_transcript.jsonl`、`*_meta.json` | 默认在 Session 同级 `subagent-artifacts/`；显式选择 project 时在 `<project>/.pi-subagents/artifacts/`；temp 模式在上面的运行目录 | Session 和 project 两种不变；temp 模式跟随新的 XDG runtime 根 | 这些是运行结果，不是用户配置 |
| Subagent 清理元数据 | `.artifact-cleanup-*`、`.last-cleanup` 等 | 默认扫描根错误地使用 `~/.config/pi/sessions/`；本机旧 `~/.pi/agent/sessions/` 下已有清理锁 | 跟随真实 Pi Session 根：`~/.local/state/pi/sessions/` | 旧清理标记不迁移，可重建 |
| Background Work 项目数据 | `runtime.json`、`<task>.output`、`<task>.command` | `<project>/.pi/tasks/pi-stuff-<session>-<pid>-<token>/` | 不变 | 项目本地运行记录，不属于用户 XDG 目录 |
| MCP 项目数据 | `.mcp.json`、`.pi/mcp.json`、`.pi/mcp-traces/*.jsonl` | `<project>/` 下 | 不变 | 项目配置和显式 trace 留在项目内 |
| Magic Context 项目数据 | `.cortexkit/magic-context.{jsonc,json}`、`.cortexkit/.gitignore`、按需生成的 `magic-context/` 内容 | `<project>/.cortexkit/` | 不变 | 项目配置和派生内容留在项目内 |
| Codex 图片 | 生成的图片文件 | `<project>/.pi/openai-codex-images/` | 不变 | 用户请求生成的项目产物 |
| 临时文件 | `pi-subagent-*`、`pi-subagent-structured-*`、`pi-mcp-output-*`、`pi-stuff-code-mode-*`、`pi-chrome-cookies-*`、Magic Context 临时日志 | `$TMPDIR/` | 不变 | 单次操作临时文件可以继续使用系统临时目录 |
| MCP OAuth | OAuth token/client 信息 | 新凭据写入操作系统 credential store；旧明文可能残留在 `~/.config/pi/mcp-oauth/.../tokens.json` | 不变 | 旧明文只用于导入，导入成功后删除；不再新建明文 token 文件 |

## 真正需要改动的路径

Pi Stuff 的配置不搬家。代码改造只做这些事：

1. `web-search.json`、Pi MCP 配置和 Agent 定义统一跟随 Pi `getAgentDir()`。
2. `mcp-onboarding.json` 移到 XDG state。
3. MCP cache 和 Code Mode binary 移到 XDG cache。
4. UI lock 和 Subagent 长生命周期运行目录移到 XDG runtime。
5. Subagent 清理元数据跟随真实的 Pi Session 根。
6. Goal、Todo、BTW 状态继续写入 Pi Session，不另建全局 state 文件。

不会增加 `$XDG_CONFIG_HOME/pi-stuff`，也不会增加 `PI_STUFF_CONFIG_DIR`。

## 本机还需要注意

当前 `~/.config/pi` 和 `~/.local/state/pi/sessions` 的目录权限是 `0755`。其中有认证、信任信息和 Session，建议改成 `0700`。这份报告没有自动修改权限或搬动任何文件。

`~/.pi/web-search.json` 是本机目前唯一确认需要人工处理的旧配置。新代码在当前环境下会读取 `~/.config/pi/web-search.json`，所以旧文件不能继续原地放着。

本机还存在 `~/.local/state/pi/codex-iq-sync.json`、`~/.cache/pi-sessions/`、`~/.cache/pi-notify/` 和 `~/.pi/workflows/`。当前 Pi 0.84.1 与 Pi Stuff 源码没有把它们列为核心文件，因此没有把它们混进上表；它们属于其他本地 Extension 或工具，应该按各自 owner 处理。

## 依据

- Pi AgentDir、Session、配置、资源和日志路径：Pi 0.84.1 [`config.js`](../../node_modules/@earendil-works/pi-coding-agent/dist/config.js) 与 [`session-manager.js`](../../node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js)
- Pi 官方环境变量说明：[Pi 0.84.1 README](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/README.md#environment-variables)
- Pi Stuff 配置：[`conversation-ui/settings.ts`](../../packages/pi-stuff/src/conversation-ui/settings.ts)、[`tool-display/settings.ts`](../../packages/pi-stuff/src/tool-display/settings.ts)、[`rtk/settings.ts`](../../packages/pi-stuff/src/rtk/settings.ts)、[`codex/settings.ts`](../../packages/pi-stuff/src/codex/settings.ts)、[`goal/src/settings.ts`](../../packages/pi-stuff/src/goal/src/settings.ts)
- Goal Session 状态与旧文件清理：[`goal/src/persistence.ts`](../../packages/pi-stuff/src/goal/src/persistence.ts)
- Web 配置：[`web/runtime/utils.ts`](../../packages/pi-stuff/src/web/runtime/utils.ts)
- MCP 配置、状态与缓存：[`mcp/runtime/config.ts`](../../packages/pi-stuff/src/mcp/runtime/config.ts)、[`mcp/runtime/onboarding-state.ts`](../../packages/pi-stuff/src/mcp/runtime/onboarding-state.ts)、[`mcp/runtime/metadata-cache.ts`](../../packages/pi-stuff/src/mcp/runtime/metadata-cache.ts)、[`mcp/runtime/npx-resolver.ts`](../../packages/pi-stuff/src/mcp/runtime/npx-resolver.ts)
- Code Mode cache：[`code-mode/host/binary.ts`](../../packages/pi-stuff/src/code-mode/host/binary.ts)
- Background Work：[`background-work/src/storage.ts`](../../packages/pi-stuff/src/background-work/src/storage.ts)
- Subagent state、runtime 和 artifacts：[`subagents/src/shared/types.ts`](../../packages/pi-stuff/src/subagents/src/shared/types.ts)、[`subagents/src/shared/artifacts.ts`](../../packages/pi-stuff/src/subagents/src/shared/artifacts.ts)
- Magic Context 配置接入：[`context-management/config.ts`](../../packages/pi-stuff/src/context-management/config.ts)；数据目录来自锁定依赖 `@cortexkit/pi-magic-context@0.33.1` 的官方 README
- XDG 路径规则：[XDG Base Directory Specification 0.8](https://specifications.freedesktop.org/basedir/latest/)
