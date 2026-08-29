<!-- translation-source: docs/research/pi-xdg-base-directory-20260811.md; translation-source-sha256: 79c9822de9a568be26551d29b3f419974e66c3995bdff9fc1906d880c5fdc608 -->

# Pi / Pi Stuff XDG 化报告

日期：2026-08-11（2026-08-12 已按实现更新）
核查版本：[Pi 0.84.1](https://github.com/earendil-works/pi/releases/tag/v0.84.1)

## 总结

| 对象 | 当前能否严格 XDG 化 | 现在应该怎么做 |
| --- | --- | --- |
| Pi 本体 | 不能。Pi 只有一个全局 Agent 目录，未按 config/data/state/cache 分类 | 用 `PI_CODING_AGENT_DIR` 把整个目录搬到 `$XDG_CONFIG_HOME/pi`，再用 `PI_CODING_AGENT_SESSION_DIR` 把 Session 搬到 `$XDG_STATE_HOME/pi/sessions` |
| Pi Stuff | 已统一。Pi 范围配置跟随 Host，自有 state/cache/runtime 按 XDG 分类 | 设置 Pi 的两个官方目录变量；Pi Stuff 不需要额外的 config-root 变量 |

这里区分两个目标：

- **实用 XDG 化**：用户目录中不再使用 `~/.pi/agent`，文件全部搬入 XDG 根目录。现在可以做到。
- **严格 XDG 化**：配置、数据、状态、缓存、运行时文件按 XDG 类别分别存放。Stock Pi 0.84.1 做不到。

---

## 1. Pi 本身能不能 XDG 化，怎么做

### 1.1 结论

Pi 0.84.1 可以把 `~/.pi/agent` **整体搬走**，但不能把其中每类文件分别放入标准 XDG 目录。

官方只提供三个相关变量：

| 变量 | 作用 |
| --- | --- |
| `PI_CODING_AGENT_DIR` | 覆盖全局 Agent 目录；默认 `~/.pi/agent` |
| `PI_CODING_AGENT_SESSION_DIR` | 单独覆盖 Session 目录；`--session-dir` 的优先级更高 |
| `PI_PACKAGE_DIR` | 指向 Pi 程序自身附带的包和资源，不是用户配置或用户安装包的 XDG 目录 |

依据：Pi 0.84.1 的[官方环境变量文档](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/README.md#environment-variables)和[路径解析源码](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/src/config.ts#L438-L531)。

Pi 的 `getAgentDir()` 只检查 `PI_CODING_AGENT_DIR`；变量未设置时直接使用 `~/.pi/agent`，不读取 `XDG_CONFIG_HOME`、`XDG_DATA_HOME`、`XDG_STATE_HOME` 或 `XDG_CACHE_HOME`。

### 1.2 为什么不算严格 XDG

Pi 把以下内容放在同一个 Agent 目录：

- `settings.json`、`models.json`、`auth.json`、`trust.json`；
- Extensions、Skills、Prompts、Themes、全局 AGENTS/SYSTEM 文件；
- 用户安装的 `git/`、`npm/` Package；
- 工具和辅助二进制；
- 默认的 `sessions/` 和调试日志。

XDG 规范则要求区分 config、data、state、cache，并要求 `XDG_*` 路径为绝对路径。依据：[XDG Base Directory Specification 0.8](https://specifications.freedesktop.org/basedir/latest/)。

因此，把整个 Agent 目录放进 `$XDG_CONFIG_HOME` 可以清理 `HOME`，但其中仍混有 Package data、Session state 和 cache；这不是严格分类。

### 1.3 唯一推荐的当前方案

在 shell 配置中设置：

```sh
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
export XDG_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"

export PI_CODING_AGENT_DIR="$XDG_CONFIG_HOME/pi"
export PI_CODING_AGENT_SESSION_DIR="$XDG_STATE_HOME/pi/sessions"
```

结果：

```text
$XDG_CONFIG_HOME/pi/          # Pi 全局 Agent 目录
$XDG_STATE_HOME/pi/sessions/  # Pi Session
```

这两个路径必须是绝对路径。

### 1.4 现有数据怎么迁移

1. 停止所有 Pi 进程。
2. 创建目标目录，权限设为仅当前用户可访问。
3. 先复制，不删除旧目录。
4. 启用上述环境变量并重新启动 Pi。
5. 验证认证、Package、设置和 Session。
6. 验证完成后再归档旧目录。

示例：

```sh
pi_config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/pi"
pi_state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/pi"

install -d -m 700 "$pi_config_dir" "$pi_state_dir/sessions"
cp -a "$HOME/.pi/agent/." "$pi_config_dir/"
cp -a "$HOME/.pi/agent/sessions/." "$pi_state_dir/sessions/"
```

上述复制会暂时在 config 目录保留一份 Session 副本；确认新的 state 路径工作后，再归档或清理该副本。

复制后先不要删除 `~/.pi/agent`。至少检查：

- `pi auth check` 能找到原认证；
- `pi list` 能找到原 Package；
- `/settings` 能保存设置；
- `/session` 显示 `$XDG_STATE_HOME/pi/sessions/...`；
- `settings.json` 内的相对路径仍指向正确位置。

### 1.5 明确边界

- 项目内 `.pi/settings.json`、`.pi/extensions/`、`.pi/skills/`、`.pi/npm/` 等是项目级文件，不受 XDG 用户目录规则控制。
- `PI_PACKAGE_DIR` 不能用于移动用户安装的 `git/`、`npm/` Package。
- 如果要求 Pi 本体严格分离 config/data/state/cache，只能修改上游 Pi 或维护 fork。

---

## 2. Pi Stuff 是否统一、有哪些配置、怎么 XDG 化

### 2.1 当前是否统一

**已经统一。**

Pi Stuff 的路径规则现在是：

- Pi 范围配置统一调用 Pi 导出的 `getAgentDir()`，因此跟随 `PI_CODING_AGENT_DIR`；
- Pi Stuff 自有持久状态进入 `$XDG_STATE_HOME/pi-stuff`；
- 可重建缓存进入 `$XDG_CACHE_HOME/pi-stuff`；
- 锁和 Subagent 临时运行文件优先进入 `$XDG_RUNTIME_DIR/pi-stuff`；
- Pi Session 和项目文件继续由 Host、Session 或项目拥有，不搬入 Pi Stuff 目录；
- XDG 变量只有在值为绝对路径时才生效。

相关实现：

- [`conversation-ui/settings.ts`](../../../../../packages/pi-stuff/src/conversation-ui/settings.ts#L10)
- [`web/runtime/utils.ts`](../../../../../packages/pi-stuff/src/web/runtime/utils.ts#L5)
- [`goal/src/persistence.ts`](../../../../../packages/pi-stuff/src/goal/src/persistence.ts#L9)
- [`mcp/runtime/agent-dir.ts`](../../../../../packages/pi-stuff/src/mcp/runtime/agent-dir.ts#L4)
- [`subagents/src/shared/utils.ts`](../../../../../packages/pi-stuff/src/subagents/src/shared/utils.ts#L97)

### 2.2 Pi Stuff 可能有哪些用户配置

下面只列用户可编辑配置，不包含状态、缓存、锁、Session 或认证缓存。

假设：

```text
PI_AGENT_DIR = $PI_CODING_AGENT_DIR
```

未设置环境变量时，Pi 默认使用 `~/.pi/agent`。

#### Pi Agent 目录中的配置

| 文件 | 所属 Capability | 内容 | 是否自动创建 |
| --- | --- | --- | --- |
| `$PI_AGENT_DIR/pi-stuff-ui.json` | Conversation UI | Statusline、欢迎头、输入高亮、图标和密度 | 只在用户修改 `/ui` 后写入 |
| `$PI_AGENT_DIR/pi-stuff-tools.json` | Tool Display | 是否显示实时耗时 | 只在用户修改设置后写入 |
| `$PI_AGENT_DIR/pi-stuff-rtk.json` | RTK | 命令重写、输出投影 | 只在 `/rtk settings` 修改后写入 |
| `$PI_AGENT_DIR/pi-stuff-codex.json` | Codex | `fast` 开关 | 只在设置变化后写入 |
| `$PI_AGENT_DIR/pi-goal.json` | Goal | Tool 可见性、自动轮次限制、RPC 和实验开关 | 只在 Goal 设置变化后写入 |
| `$PI_AGENT_DIR/web-search.json` | Web | Provider、Curator、快捷键、SSRF 规则和可能的 API Key | 手动配置或显式设置时写入 |
| `$PI_AGENT_DIR/mcp.json` | MCP | Pi 专属全局 MCP server/settings 覆盖 | 手动创建或 `/mcp setup` 写入 |
| `$PI_AGENT_DIR/agents/*.md` | Subagents | 用户自定义 Agent 定义 | 用户手动创建 |

实现依据：

- [`pi-stuff-ui.json`](../../../../../packages/pi-stuff/src/conversation-ui/settings.ts#L10)
- [`pi-stuff-tools.json`](../../../../../packages/pi-stuff/src/tool-display/settings.ts#L7)
- [`pi-stuff-rtk.json`](../../../../../packages/pi-stuff/src/rtk/settings.ts#L7)
- [`pi-stuff-codex.json`](../../../../../packages/pi-stuff/src/codex/settings.ts#L13)
- [`pi-goal.json`](../../../../../packages/pi-stuff/src/goal/src/settings.ts#L7)
- [`web-search.json`](../../../../../packages/pi-stuff/src/web/runtime/utils.ts#L5)
- [`mcp.json`](../../../../../packages/pi-stuff/src/mcp/runtime/config.ts#L161)
- [Subagent discovery](../../../../../packages/pi-stuff/src/subagents/src/agents/agents.ts#L82-L100)

这些文件大多有内置默认值；没有修改对应设置时，文件可以不存在。Pi Stuff 不应为了“补齐配置”在启动时创建它们。

#### Agent 目录之外的配置

| 文件 | 用途 |
| --- | --- |
| `$XDG_CONFIG_HOME/cortexkit/magic-context.jsonc` | Magic Context 用户配置；首次显式启用时可创建 |
| `<project>/.cortexkit/magic-context.jsonc` | Magic Context 项目配置 |
| `$XDG_CONFIG_HOME/mcp/mcp.json` | MCP 共享全局配置；未设置时使用 `~/.config/mcp/mcp.json` |
| `<project>/.mcp.json` | 推荐的共享项目 MCP 配置 |
| `<project>/.pi/mcp.json` | Pi 专属项目 MCP 覆盖 |

Magic Context 路径依据：[`context-management/config.ts`](../../../../../packages/pi-stuff/src/context-management/config.ts#L12-L55)。MCP 加载顺序依据：[`mcp/runtime/config.ts`](../../../../../packages/pi-stuff/src/mcp/runtime/config.ts#L350-L417)。

`settings.json`、`auth.json`、`models.json`、`trust.json` 和 `sessions/` 属于 Pi Host，不属于 Pi Stuff。`packages/pi-stuff/suite.json` 是开发期组合清单，也不是用户配置。

### 2.3 哪些文件不是配置

| 文件或目录 | 类型 | 迁移处理 |
| --- | --- | --- |
| `$PI_AGENT_DIR/pi-goal-state.json` | 旧版 Goal cleanup 兼容文件；当前 Goal 状态在 Pi Session JSONL 中 | 不迁移，只有兼容清理会读取 |
| `$XDG_CACHE_HOME/pi-stuff/mcp/mcp-cache.json` | MCP metadata cache | 旧 cache 不迁移，按需重建 |
| `$XDG_CACHE_HOME/pi-stuff/mcp/mcp-npx-cache.json` | MCP npx 解析缓存 | 旧 cache 不迁移，按需重建 |
| `$XDG_STATE_HOME/pi-stuff/mcp/mcp-onboarding.json` | MCP onboarding 状态 | 新路径缺失时回读旧文件；写入只使用新路径 |
| `$XDG_CACHE_HOME/pi-stuff/code-mode/` | Code Mode 可重建二进制缓存 | 旧 cache 不迁移，按需重新下载 |
| `$XDG_RUNTIME_DIR/pi-stuff/pi-stuff-ui.json.lock` | UI 设置写锁 | 不迁移；无 runtime dir 时沿用相邻锁文件 |
| `$XDG_STATE_HOME/pi-stuff/work/` | Background Work authority state | 必须保留 |
| `$XDG_STATE_HOME/pi-stuff/agents/session-governor/` | Subagent governor state | 保留 |
| `<project>/.pi/tasks/` | 项目级 Background Work 运行记录 | 留在项目内 |

这些内容的生命周期与配置不同；不要把 cache、lock 和持久状态当成同一类文件处理。

### 2.4 Pi Stuff XDG 化后的目标目录

推荐目标只有一套，不新增 `PI_STUFF_CONFIG_DIR`：

```text
$XDG_CONFIG_HOME/
├── pi/                              # PI_CODING_AGENT_DIR
│   ├── settings.json                # Pi Host
│   ├── auth.json                    # Pi Host，敏感
│   ├── pi-stuff-ui.json
│   ├── pi-stuff-tools.json
│   ├── pi-stuff-rtk.json
│   ├── pi-stuff-codex.json
│   ├── pi-goal.json
│   ├── web-search.json              # 可能含密钥，权限 0600
│   ├── mcp.json                     # 可能含密钥，权限 0600
│   └── agents/*.md
├── cortexkit/magic-context.jsonc
└── mcp/mcp.json

$XDG_STATE_HOME/
├── pi/sessions/
└── pi-stuff/
    ├── mcp/
    ├── work/
    └── agents/session-governor/

$XDG_CACHE_HOME/
└── pi-stuff/
    ├── code-mode/
    └── mcp/

$XDG_RUNTIME_DIR/
└── pi-stuff/
    ├── pi-stuff-ui.json.lock
    └── agents-<user-scope>/
```

项目内 `.pi/`、`.mcp.json` 和 `.cortexkit/` 保持项目级，不搬入用户 XDG 目录。

### 2.5 已实现的改造

| 当前问题 | 修改 |
| --- | --- |
| MCP、Subagents、Web、Goal 各自解析 Agent 目录 | 删除重复解析，统一调用 `@earendil-works/pi-coding-agent` 的 `getAgentDir()` |
| `web-search.json` fallback 为 `~/.pi` | 改为 `join(getAgentDir(), "web-search.json")` |
| Goal 旧 cleanup 文件自行解析 Agent 目录 | 跟随 Host `getAgentDir()`；当前 Goal 状态继续由 Pi Session JSONL 持有 |
| MCP cache/onboarding 混在 Agent config 目录 | cache 放 `$XDG_CACHE_HOME/pi-stuff/mcp/`，onboarding state 放 `$XDG_STATE_HOME/pi-stuff/mcp/` |
| Code Mode cache 位于 `AgentDir/cache` | 移到 `$XDG_CACHE_HOME/pi-stuff/code-mode/` |
| MCP 共享配置硬编码 `~/.config` | 使用绝对的 `XDG_CONFIG_HOME`，未设置时 fallback 到 `~/.config` |
| UI lock 与配置文件同目录 | 严格模式下放 `$XDG_RUNTIME_DIR/pi-stuff/`；未设置时使用安全 fallback |

兼容原则：

1. 新路径优先。
2. MCP onboarding 的旧路径只在新文件不存在时回读，写入不删除或覆盖旧文件。
3. cache 和 runtime 文件不迁移，缺失时按需重建。
4. 不在 Extension import、初始化或普通 Session 启动时自动搬文件。
5. Pi Session 和项目文件不改归属。

### 2.6 现在设置 Pi 环境变量后会发生什么

如果现在设置：

```sh
export PI_CODING_AGENT_DIR="$XDG_CONFIG_HOME/pi"
export PI_CODING_AGENT_SESSION_DIR="$XDG_STATE_HOME/pi/sessions"
```

那么：

- Pi 本体的全局目录和 Session 会搬走；
- Pi Stuff 的 UI、Tool、RTK、Codex、Goal settings、MCP override、Agent definitions 和 Web config 会跟随；
- Magic Context、Background Work 和 Subagent governor 已经使用各自的 XDG config/state；
- MCP state/cache、Code Mode cache、UI lock 和 Subagent runtime 已按 XDG 分类；
- Goal 的当前状态仍在 Pi Session JSONL 中，不另造一份 Pi Stuff state；
- 项目内 `.pi/` 不变。

## 最终建议

1. **Pi 本体做实用 XDG 化**：设置两个 Pi 官方变量并迁移现有目录。
2. **Pi Stuff 不新增自己的 config-root 环境变量**：配置始终跟随 Pi `getAgentDir()`。
3. **Pi Stuff 自有 state/cache/runtime 分别使用 XDG_STATE_HOME/XDG_CACHE_HOME/XDG_RUNTIME_DIR**。
4. **上游 Pi 未拆分之前，不宣称 Pi 本体已严格 XDG 合规**。
