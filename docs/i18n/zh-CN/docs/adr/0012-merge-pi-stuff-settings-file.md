<!-- translation-source: docs/adr/0012-merge-pi-stuff-settings-file.md; translation-source-sha256: 3439a75d251081ef2c4107943b2602b240e6e62ae1153c6c783098f46a622f7d -->

---
status: accepted
---

# 使用一个合并设置文件，并保持启动只读

## 背景

本 ADR 之前，Pi Stuff 在 Pi 的 Agent 目录（`getAgentDir()`）中拥有 **六个** 分离的逐能力设置文件，每个文件都有临时实现的读取器、写入器、锁和原子重命名逻辑：

| 文件 | 能力 | 命名空间 |
| --- | --- | --- |
| `pi-stuff-ui.json` | conversation-ui | `ui` |
| `pi-stuff-tools.json` | tool-display | `tools` |
| `pi-stuff-rtk.json` | rtk | `rtk` |
| `pi-stuff-codex.json` | codex | `codex` |
| `pi-stuff-notification.json` | notification | `notification` |
| `pi-goal.json` | goal | `goal` |

每个模块都重新实现了：路径解析器、基于 `JSON.parse` 的读取器、采用 `0o600` 权限并通过临时文件 `rename` 的写入器、基于 `flock` 的排他锁（并发相关时），以及文件损坏时报告诊断并回退到默认值的逐文件逻辑。这些重复代码很多，文件数还在增长，并且没有共享位置处理跨能力设置问题。

Web 最初使用 `web-search.json`，第一次合并实现又在套件启动时迁移其他旧文件。这两个例外都与期望的单文件形态或纯净启动边界冲突。

## 决策

把 Pi Stuff 设置合并到 `<agentDir>/pi-stuff.json` 的单个 JSON 文档中。ADR 0009 的全局代码模式默认值也使用该文档，不新增旧版文件。每项能力在该文件中负责一个顶层 **命名空间**（一个 JSON 对象键），并且只读写自己的部分。写入时保留同级命名空间，因此一项能力绝不会编辑另一项能力的部分。

### 共享 I/O 层

新增的 `packages/pi-stuff/src/shared/settings-io/` 模块负责所有持久化问题：

- `paths.ts`——纯路径辅助函数（`mergedSettingsPath`、`resolveSettingsLockPath`、`MERGED_SETTINGS_FILE`）。该文件不导入运行时能力，因此可以安全加载到仅 Node 的模块图中（编译后的 Goal 上游测试在 Node 下运行）。
- `file.ts`——`readSettingsFile`/`writeSettingsFile`（异步）、`readSettingsFileSync`/`writeSettingsFileSync`（同步，用于 Goal 热路径加载），以及 `readNamespace`/`mergeNamespaceRecord`（和同步变体）。读写使用普通 JSON（`JSON.parse` / `JSON.stringify`）；文件就是普通 `pi-stuff.json`，不支持注释。写入器输出使用制表符缩进的 JSON，以生成确定性的机器输出。
- `lock.ts`——基于 `flock` 的排他锁和加锁合并辅助函数，从旧版逐能力锁中提取。它导入 `bun:ffi`，因此 **不会** 通过 `index.js` 汇总入口重新导出。基于 Bun 的能力写入器直接导入它；Goal 只通过动态生产适配器访问它。这样可避免 `bun:ffi` 进入仅 Node 的模块图；Goal 上游 Node 配置中包含的能力模块，只从 Bun 专用写入路径加载它。
- `store.ts`——可选的高层存储 `NamespacedSettingsStore<T>`（由 codex 使用），把命名空间读取器、写入器、锁（注入而不是静态导入）、订阅和只读旧版回退连接起来。

### 单文件锁

所有设置命名空间共用 **一个** 针对 `pi-stuff.json` 的 `flock` 锁（或旁边的 `pi-stuff.json.lock`；如果可用，则放在 `$XDG_RUNTIME_DIR/pi-stuff/` 下）。来自不同能力的并发写入通过同一个租约串行化，而不是每个文件一把锁。这是可接受的，因为设置写入频率很低且由用户触发；串行化开销可以忽略。

### 格式

文件使用普通 JSON（`JSON.parse` / `JSON.stringify`，无注释）。读取与写入都是普通 JSON，不支持 JSONC。根据项目决策，已拒绝将 jsonc 用作写入格式：写入保持普通 JSON，读取器也只读取普通 JSON，不容忍注释。

### 只读旧版兼容

套件导入和会话启动绝不会锁定、创建、重写、重命名、迁移或删除用户配置。规范命名空间不存在时，能力可以通过 `legacyReader` 把有效旧版文件读取为内存回退。之后的显式设置操作由其所有者写入规范命名空间，保留同级命名空间，并保持旧版文件不变。后续加载以规范命名空间为准。

Web 遵循相同启动规则，但显式更新有一个例外：规范命名空间不存在时，直接 Web 配置更新可以在共享锁下提升完整旧版对象，并且只有规范写入成功后才删除旧版文件。

### Web 凭据

Web 负责 `web` 设置命名空间，并保留既有字段名和嵌套形态。凭据字段可以包含字面值、环境变量引用、旧版显式命令来源，或 1Password `op://` 引用。只有选定 Provider 请求凭据时，密钥引用才会生效。解析时通过参数向量而非 Shell 调用 `op read`，只转发文档规定的最小环境，对等待时间和输出设限，遵守取消，并从诊断中排除引用、参数、stderr 和解析后的值。解析值既不持久化，也不会在该 Provider 操作结束后保留。

## 后果

- 新设置持久化在一个 `<agentDir>/pi-stuff.json` 文档中。显式变更创建规范命名空间前，现有旧版文件继续作为只读回退；不会自动删除。
- 能力模块不再重新实现读取、写入、锁和原子重命名，而是调用 `shared/settings-io`。新增能力负责的设置只增加命名空间，不增加文件。
- 整个文件是一个加锁并原子替换的文档。一项能力的写入可能短暂等待另一项能力使用的同一把锁，但这是低频路径，成本可以忽略。
- `bun:ffi`（flock 锁）被隔离在 `lock.ts`，不会由汇总入口引入，因此在 Node 下运行的编译后 Goal 上游测试不会加载它。
- `schemaVersion` 仍属于各命名空间（每项能力负责自己的版本控制与迁移逻辑）。没有顶层文件 Schema 版本；该文件只是独立命名空间的普通容器。
- 套件启动保持观察性：不能仅因存在旧版状态就在加载软件包时修改配置。
- 密钥只在使用时解析，且不能通过诊断或存储泄露密钥来源或值。

## 被拒绝的替代方案

- **每项能力一个设置文件：** 会重复解析、锁、原子写入和诊断，却没有有用的独立生命周期。
- **JSONC 输出：** 机器负责的合并文档可使用确定性的普通 JSON，无需第二个解析器或注释保留策略。
- **启动时自动迁移：** 软件包加载不能在直接交互或 RPC 输入前修改用户配置。

## 合并历史

本 ADR 吸收了原 ADR 0013 记录的 Web 命名空间和按需密钥决策，以及原 ADR 0023 记录的只读启动规则。这两个决策现在共同定义同一个合并设置边界，因此删除原文件。

## 参考资料

- ADR 0009——代码模式项目覆盖、全局默认值和有效优先级。
