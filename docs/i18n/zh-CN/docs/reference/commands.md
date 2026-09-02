<!-- translation-source: docs/reference/commands.md; translation-source-sha256: b5953dd460bb3850ca44f290b7a74006656016c7c2fe0b61bf53920f86b14c61 -->

# 命令参考

[English](../../../../../docs/reference/commands.md)

Pi Stuff 命令从 Pi 编辑器中运行。不带参数的命令通常打开交互界面；带参数的形式适合直接调用。

## 界面与查看

| 命令 | 操作 |
| --- | --- |
| `/ui` | 配置 Welcome 卡片、Statusline、行内 slash 补全、输入高亮、密度和 Tool 计时器 |
| `/diagnostics` | 显示当前进程中有界、脱敏的 Suite 诊断 |
| `/tools` | 列出 Retrieval Group 成员和独立 Tool Activity |
| `/tools <id>` | 查看一个 Tool Activity |
| `/notifications` | 配置通知策略并发送测试通知 |

Pi 自带的 `/settings` 命令控制活动主题等 Host 设置。

## Session 与支线问题

| 命令 | 操作 |
| --- | --- |
| `/resume` | 默认打开 Fast Resume；拦截不可用时回退到 Pi 原生选择器 |
| `/fast-resume` | 原生拦截关闭或不可用时打开 Fast Resume |
| `/autoname` | 为当前 Session 生成新名称 |
| `/autoname settings` | 配置自动命名、冷却期、手动名称策略与主要 model |
| `/btw <question>` | 提出不使用 Tool 的支线问题，不加入主 transcript |

## 工作控制

| 命令 | 操作 |
| --- | --- |
| `/goal [--tokens 100k] <objective>` | 启动 Goal，可选显式 token budget |
| `/goal status` | 显示活动 Goal 与进度 |
| `/goal edit [--tokens 100k] <objective>` | 修改活动 Goal 的目标或 token budget |
| `/goal pause` | 暂停 Goal 自动 continuation |
| `/goal resume` | 恢复暂停的 Goal |
| `/goal clear` 或 `/goal stop` | 从 Session 中清除当前 Goal 状态 |
| `/tasks` | 打开 Background Shell 与 Monitor 控制 |
| `/agents` | 打开当前 Session 中委派 Agent 的控制 |

启用 `goal.experimental.goals` 后，Goal 还接受队列控制：

| 命令 | 操作 |
| --- | --- |
| `/goal add <objective>` 或 `/goal push <objective>` | 在队列末尾加入目标 |
| `/goal prioritize <objective>` 或 `/goal unshift <objective>` | 激活新目标，并把当前 Goal 放到队列最前 |
| `/goal drop-last` 或 `/goal pop` | 移除最后一个排队 Goal；队列为空时移除当前 Goal |
| `/goal skip` 或 `/goal shift` | 清除当前 Goal，并激活队首目标 |

## Context

| 命令 | 操作 |
| --- | --- |
| `/ctx` 或 `/ctx status` | 显示当前 Context 状态与可用维护操作 |
| `/ctx flush` | 刷新待处理的 Context 持久化工作 |
| `/ctx wrapup [N]` | 整理近期历史，可选只使用最后 `N` 条消息 |
| `/ctx recomp [range]` | 重新压缩选定的历史范围 |
| `/ctx upgrade` | 执行受支持的 Context 数据升级 |

Context 检索操作以 Tool 形式出现，只有已配置的 Context engine 提供时才会显示。

## Codex 与 RTK

| 命令 | 操作 |
| --- | --- |
| `/codex` | 为当前受支持 model 显示 Codex 用量和 Fast mode 控制 |
| `/codex fast` | 切换 Codex Fast mode |
| `/codex usage` | 刷新 Codex 用量 |
| `/rtk` | 查看 RTK 可用性和命令改写策略 |

## Ponytail

| 命令 | 操作 |
| --- | --- |
| `/ponytail` | 显示当前模式与控制 |
| `/ponytail on` | 启用配置的默认模式 |
| `/ponytail off` | 关闭 Ponytail |
| `/ponytail lite` | 使用轻量的反过度工程指导 |
| `/ponytail full` | 使用标准的反过度工程指导 |
| `/ponytail ultra` | 使用最严格的反过度工程指导 |
| `/ponytail default <lite|full|ultra>` | 设置 `/ponytail on` 使用的模式 |
| `/ponytail status <show|hide>` | 显示或隐藏 Ponytail 状态 |
| `/ponytail startup <show|quiet>` | 显示或隐藏启动提示 |
| `/ponytail-review` | 检查当前变更中的过度工程 |
| `/ponytail-audit` | 审计仓库中的可避免复杂度 |
| `/ponytail-debt` | 列出记录的 Ponytail 延后项 |
| `/ponytail-gain` | 显示 Ponytail 影响卡片 |
| `/ponytail-help` | 显示 Ponytail 命令卡片 |

## MCP

| 命令 | 操作 |
| --- | --- |
| `/mcp` 或 `/mcp status` | 显示已配置 server 与连接状态 |
| `/mcp setup` | 打开 MCP 配置 |
| `/mcp auth <server>` | 认证一个 server |
| `/mcp reconnect <server>` | 重新连接一个 server |
| `/mcp logout <server>` | 移除 server 认证 |
| `/mcp disable <server>` | 禁用一个 server |
| `/mcp enable <server>` | 启用一个 server |
| `/mcp auto-connect <server>` | 自动连接 server |
| `/mcp on-demand <server>` | 只在使用时连接 server |

## Code Mode

`/codemode` 打开交互控制界面。直接形式适合可重复的项目设置和 ledger 维护：

| 命令 | 操作 |
| --- | --- |
| `/codemode on` | 为当前受信项目启用 Code Mode |
| `/codemode off` | 为当前受信项目禁用 Code Mode |
| `/codemode global on` | 启用全局默认值 |
| `/codemode global off` | 禁用全局默认值 |
| `/codemode history` | 显示执行 ledger |
| `/codemode pending` | 显示等待批准的 operation |
| `/codemode approve <id>` | 批准待处理 operation |
| `/codemode reject <id> <sequence>` | 在当前 sequence 拒绝待处理 operation |
| `/codemode snippets` | 列出保存的 snippet |
| `/codemode save <id> <name> [description]` | 把 ledger operation 保存为 snippet |
| `/codemode delete <name>` | 删除保存的 snippet |
| `/codemode abandon <id>` | 放弃未完成 operation |
| `/codemode rollback <id>` | 回滚已完成且可逆的 operation |
| `/codemode compensate <id>` | `rollback` 的别名 |
| `/codemode expire` | 让过期 ledger 状态失效 |

## 没有 slash 命令的 Tool

Web access 和 Todo 通过 Tool 而非用户 slash 命令提供。它们是否可用取决于当前 Suite 配置和 Host Tool 策略。

## 相关文档

- [入门](../getting-started.md)
- [设置参考](settings.md)
- [故障排查](../troubleshooting.md)
