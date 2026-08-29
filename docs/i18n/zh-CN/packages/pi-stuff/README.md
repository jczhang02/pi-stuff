<!-- translation-source: packages/pi-stuff/README.md; translation-source-sha256: 759bca93a02056c2555777962cc54a69d295018afbc0f820b5ef021df1081f80 -->

# `@jczhang02/pi-stuff`

完整 Pi Stuff Suite 的唯一一个本地 Pi Package。

## 契约

- 通过 Pi 原生 Package 系统加载，并导出一个默认 Extension factory。
- 按一个明确顺序安装 `suite.json` 中列出的内部 Module。
- 面向仓库记录的已认证 Pi 0.84.4 Host profile。
- 必要 Module 无法初始化时立即失败。
- import 期间不联网、不写文件、不启动 subprocess，也不修改 Host 设置。
- 仅私有、本地使用；没有 npm 发布契约。

## 包含的 Module

- [`conversation-ui`](src/conversation-ui/README.md)：Statusline、Welcome、实时 Thought、终端 `chart`/`tree`
  fence、输入呈现、`/ui` 和 Command Dialog 生命周期。
- [`session-naming`](src/session-naming/README.md)：用户直接发起的工作 settled 后生成有界语义 Session 名称，
  保存可恢复的所有权状态，并提供 `/autoname` 控制。
- [`tool-display`](src/tool-display/README.md)：紧凑呈现 Pi built-in 与参与其中的 Suite Tool。
- [`code-mode`](src/code-mode/README.md)：通过模型可见的 `codemode` 与 `tool_search` 在本地组合 active Suite
  Tool，而不改变 Tool UI。
- [`context-management`](src/context-management/README.md)：集成已配置的官方 Magic Context，提供 `/ctx`
  控制中心，并保留 Pi JSONL 作为原始 Session 权威。
- [`ponytail`](src/ponytail/README.md)：功能完整的 Ponytail fork，提供 Session mode、六个 Skill、共享
  Statusline 状态和 `/ponytail` 控制。
- [`rtk`](src/rtk/README.md)：fail-open Bash 改写和仅面向模型的 Bash/Grep 输出 projection。
- [`codex`](src/codex/README.md)：`/codex`、Fast mode、订阅用量、`apply_patch`、`view_image` 与 `imagegen`。
- [`goal`](src/goal/README.md)：持久目标、continuation、accounting，以及基于证据的完成/阻塞判定。
- [`web`](src/web/README.md)：有界搜索、公开 HTTP(S)/PDF 读取和 continuation retrieval。
- [`mcp`](src/mcp/README.md)：按需 proxy gateway、显式认证、stdio/HTTP transport 和 `/mcp` status。
- [`background-work`](src/background-work/README.md)：当前 Session 的 Background Shell、Monitor 与 `/tasks` 管理。
- [`subagents`](src/subagents/README.md)：当前 Session 的 foreground/background Agent 与共享 roster。
- [`todo`](src/todo/README.md)：可按 branch replay 的 Task Tool 与 Pi editor 上方的紧凑 checklist。
- [`btw`](src/btw/README.md)：使用实际 conversation context、但不改变主 transcript 的一次性侧边问题。
- [`notification`](src/notification/README.md)：延迟终端原生完成/失败提醒，以及自有 `/notifications` 设置与测试。

这些名称是内部维护边界，不是 npm 依赖或可独立安装的 Package。修改吸收或适配的源码前，阅读最近的 Module
README，以及相邻 `UPSTREAM.md`、`SECURITY.md` 和第三方 notice（如有）。

## Context 控制

使用 `/ctx` 打开 Pi Stuff Context Dialog。它的 action 与 `/ctx flush`、`/ctx wrapup [N]`、
`/ctx recomp [start-end]` 和 `/ctx upgrade` 共用一个 dispatcher。operation progress 保存为模型不可见的
Context Activity entry；Magic Context 自己的全局 UI 仍被抑制。

## Ponytail 控制

使用 `/ponytail` 打开 mode 与配置 Dialog。直接形式包括 `/ponytail lite|full|ultra|off`、
`/ponytail default <mode>`、`/ponytail status show|hide` 和 `/ponytail startup show|quiet`。打包的
`/ponytail-review`、`/ponytail-audit`、`/ponytail-debt`、`/ponytail-gain` 与 `/ponytail-help` 别名保留
上游 Skill 行为。`off` 是硬模型边界：移除 Ponytail 指令与模型可见 Ponytail Skill，同时保留显式 Skill 命令。

## 存储

Pi Stuff 把用户配置放在 Pi Agent 目录或所属项目旁，并使用 XDG 目录保存派生 state、cache 与 runtime 文件：

| 数据 | 位置 |
| --- | --- |
| Pi Host 设置 | `<agentDir>/settings.json` |
| Pi Stuff 设置（`ui`、`tools`、`rtk`、`codex`、`notification`、`goal`、`sessionNaming`、`codeMode`、`ponytail`、`web`） | `<agentDir>/pi-stuff.json` |
| 共享标准 MCP 配置 | `$XDG_CONFIG_HOME/mcp/mcp.json` |
| Pi 专用 MCP override | `<agentDir>/mcp.json` 与 `<project>/.pi/mcp.json` |
| 项目 Code Mode 选择 | `<project>/.pi/code-mode.json` |
| Pi Stuff state | `$XDG_STATE_HOME/pi-stuff` |
| Pi Stuff cache | `$XDG_CACHE_HOME/pi-stuff` |
| 临时 lock 与 Agent runtime 文件 | `$XDG_RUNTIME_DIR/pi-stuff` |
| Session 与项目产物 | Pi Session 目录或所属项目 |

只接受绝对 XDG 环境路径。config、state 和 cache 分别回退到 `~/.config`、`~/.local/state` 与 `~/.cache`；
`XDG_RUNTIME_DIR` 不可用时，现有 lock/temp fallback 继续生效。只有当 XDG state 文件不存在时才从 Pi Agent
目录读取旧 MCP onboarding state；后续写入使用 XDG state，且不删除旧文件。

当 canonical namespace 不存在时，旧的逐 Capability 设置文件只作为只读 startup fallback。显式设置变更会
写入自己拥有的 namespace，但不删除旧文件。只有 Web 可以在直接 Web 配置更新期间提升完整旧对象，并且只在
canonical write 成功后删除旧文件。上游 `pi-autoname.json` 不会被读取或迁移；Session Naming 从合并
namespace 只读启动，只在用户直接执行 `/autoname settings` 后写入。

## Theme

Package 包含 `catppuccin-latte`、`catppuccin-frappe`、`catppuccin-macchiato` 和 `catppuccin-mocha`。
可在 Pi `/settings` theme 菜单中选择，也可把名称写入 `settings.json` 的 `"theme"`。Pi 在可用时渲染
truecolor，并执行原生低色彩 fallback；Package 不覆盖终端或用户 theme 设置。

## 本地安装

从仓库根目录运行：

```bash
pi install ./packages/pi-stuff
```

Package 绝不会自行修改 Pi 设置。
