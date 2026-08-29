<!-- translation-source: packages/pi-stuff/src/ponytail/README.md; translation-source-sha256: 9dba5bf42d9a736bcd8621d9512ff11bf1bc935ef36e57233df5b6f0030351a4 -->

# Ponytail 模块

Ponytail 是 Pi Stuff 对 `@dietrichgebert/ponytail@4.9.0` 的功能完整内部分叉。它保留上游实现纪律规则、会话模式、自然语言停用、五个命令别名和六个 Skill，同时让呈现与配置适配套件。上游软件包不是运行时依赖。已审查源码来源、许可证义务和字节一致资源哈希记录在 [UPSTREAM.md](./UPSTREAM.md) 与[英文第三方声明](../../../../../../../packages/pi-stuff/src/ponytail/THIRD_PARTY_NOTICES.md)。

## 行为

有效运行时模式为 `off`、`lite`、`full` 和 `ultra`；`full` 是上游默认值。`review` 仍是 Skill，绝不接受为模式。模式变化会追加上游兼容、对模型不可见的会话条目 `ponytail-mode`，内容为 `{ "mode": "..." }`。恢复时依次选择当前分支最新有效条目、委派 Agent 的启动快照、配置默认值。`stop ponytail` 和 `normal mode` 只有作为独立直接用户输入时才停用 Ponytail。

上下文管理在 Magic Context 约定后投影 Ponytail。稳定标记使每次 Provider 激活中的贡献保持幂等。全部六个打包 Skill 都可作为显式命令使用，但选择退出宿主常驻目录。在 `lite`、`full` 和 `ultra` 中，Ponytail 会在紧凑模式指令前投影简洁的模型可见描述；在 `off` 中既不贡献目录，也不贡献指令。完整且经过审查的上游规则可通过 `/skill:ponytail` 使用。

委派 Agent 在启动时接收父级有效模式快照，包括显式 `off`。快照只通过子进程环境携带，不修改全局设置。

Ponytail 有自己的提示词预算，不增加上下文管理预算。`off` 贡献零字符和 token。紧凑活跃模式策略加六 Skill 目录在 `full` 中测得 795 个 o200k tokens（`lite`：796；`ultra`：802），低于分叉基线合计贡献的 2,437 tokens。`test/ponytail/prompt-budget.test.ts` 分别限制策略与目录。

## 命令与 UI

不带参数的 `/ponytail` 打开共享 Pi Stuff 命令对话框。它控制当前会话模式、配置默认值、状态栏可见性、启动通知，并可启动五个专用 Skill；普通设置变更无需离开对话框。带参数命令仍直接执行：

```text
/ponytail on|off|lite|full|ultra
/ponytail default off|lite|full|ultra
/ponytail status [show|hide]
/ponytail startup show|quiet
/ponytail-review [focus]
/ponytail-audit [focus]
/ponytail-debt
/ponytail-gain
/ponytail-help
```

共享状态栏只显示 Nerd Font `󱖿 <mode>` 身份；模式为 `off` 或禁用状态栏可见性时隐藏。Pi Stuff 工作行仍是唯一活动权威。对话框打开时抑制共享持久框架，关闭时恢复编辑器草稿，Escape 从次级列表返回，并让环境变量覆盖保持可见但只读。

## 配置

Ponytail 按以下顺序读取配置：

1. `PONYTAIL_DEFAULT_MODE`、`PONYTAIL_HIDE_STATUS` 和 `PONYTAIL_QUIET_STARTUP` 环境变量；
2. `<agentDir>/pi-stuff.json` 中的 `ponytail` 命名空间；
3. 只有合并命名空间不存在时，读取只读旧版 `~/.config/ponytail/config.json`（或其 XDG/Windows 等价路径）；
4. 上游默认值。

合并命名空间接受 `defaultMode`、`hideStatus` 和 `quietStartup`。对话框和命令写入只在共享设置锁下更新该命名空间。它们绝不更改环境变量覆盖或旧版文件。无效合并 JSON 或无效 `ponytail` 命名空间会安全关闭到默认值，发送一条静默诊断记录，且不能通过 Ponytail 覆盖。

## 行为基准

`bun run benchmark:ponytail --output <absolute-path>` 针对已验证 Pi 宿主和 `jcapi/openrouter/stealth/ox-alpha` 运行固定真实模型验收研究。它使用三个对 YAGNI 敏感的任务、三次独立成对 `off`/`ultra` 重复、中性用例路径、不变提示词与用例、隐藏正确性检查、固定工具，并且失败会话不重试或替换。输出省略会话路径和对话记录。

预声明强效果门槛要求全部 18 个会话通过可见与隐藏检查，且没有受保护文件或提示词边界违规；九组配对都可测量；至少六组生产代码行数不是平局；单侧精确符号检验结果 `p <= 0.05` 且有利于 `ultra`。已验证运行的 18 个会话全部通过：`ultra` 汇总生产代码为 87 行，`off` 为 141 行（-38%）；`ultra` 赢得九组中的八组，结果为 `p = 0.01953125`。它还把结构声明从六个降到三个，把 Assistant 回复字符数从 3,821 降到 2,007，但总 token 从 113,012 增至 148,513（+31%）。这是人工认证基准，不是 CI 门槛，也不构成对所有模型和任务的结论。

## 上游审查

在仓库根目录运行 `bun run ponytail:upstream:review`，比较固定基线与 npm 当前候选。传入 `--version <version>` 可检查指定发布。它会在提取前验证两个 tarball，复查本地单字段 Skill 适配和保留许可证，并输出供人工审查的清理后软件包差异；绝不更新分叉。
