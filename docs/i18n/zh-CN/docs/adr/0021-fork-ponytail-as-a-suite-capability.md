<!-- translation-source: docs/adr/0021-fork-ponytail-as-a-suite-capability.md; translation-source-sha256: 4e5ad5d03b6feddbd7b6f063b0b26eb7e01154a2fadeb2eb2e715fc6643eed28 -->

---
status: accepted
---

# 将 Ponytail 分叉为套件能力

## 背景

`@dietrichgebert/ponytail@4.9.0` 通过四种模式、按模式过滤的指令、会话状态和六个 Skill，提供持续的 KISS/YAGNI 实现纪律。它作为一项完整能力很有价值，但上游扩展负责独立配置文件、状态指示、启动 UI 和 Agent 假设，这些都与 Pi Stuff 的单软件包、合并设置、共享状态栏、上下文提示词组合和委派 Agent 生命周期冲突。

精简重写会丢失上游可见行为。运行时 npm 依赖会保留冲突的 UI 和生命周期所有权，并使提示词组合与子 Agent 继承变得间接。不记录来源就复制上游，也会违反 MIT 声明义务。

## 决策

Pi Stuff 携带经过人工审查、功能完整的 Ponytail 4.9.0 分叉，作为内部 `ponytail` 能力模块。上游软件包不是运行时依赖。规范 Skill 正文、Frontmatter 和许可证资源保留已审查的上游字节，唯一例外是为每个 Skill 加入 Pi 的 `disable-model-invocation: true` 字段。该字段使原生发现只允许显式调用，从而让 Ponytail 按当前会话模式控制模型可见性。已提交的哈希清单覆盖未改编的上游基线，测试证明该字段是唯一资源差异。Pi Stuff 负责的适配器可以修正实现缺陷，但不得改变公开行为：`review` 是 Skill 而不是运行时模式，重载和恢复注册具有幂等性，无效合并配置会被保留，委派 Agent 会接收父模式。

Ponytail 负责模式、命令、设置、原始指令、Skill 和会话条目。上下文管理负责有序提示词投影和 Provider 请求回退。对话 UI 负责命令对话框和共享状态栏渲染。Agents 把有效父模式复制到每次子 Agent 启动。

提示词顺序是：宿主/基础上下文、Magic Context 约定、当前模式的紧凑 Ponytail Skill 目录、当前模式的紧凑指令。原生 Skill 发现保持六个命令全部可用，但对模型隐藏；在 `lite`、`full` 或 `ultra` 模式下，Ponytail 只为经过宿主过滤的 Skill 投影简洁描述。`off` 不贡献目录或指令。上下文使用稳定标记包装该贡献，并在 `before_agent_start` 与受支持 Provider 载荷上协调，使一次请求至多接收一次。

模式持久化保留上游兼容自定义条目 `ponytail-mode` / `{ mode }`。有效值为 `off`、`lite`、`full` 和 `ultra`。恢复优先级依次是：当前分支最新有效条目、子 Agent 启动快照、配置默认值。默认值为 `full`。

配置优先级依次是 `PONYTAIL_*`、合并 `pi-stuff.json` 中的 `ponytail`、命名空间不存在时的只读旧版 Ponytail 配置、默认值。只有合并设置可写。无效合并设置会安全关闭，Ponytail 绝不重写它。

不带参数的 `/ponytail` 打开共享命令对话框；带参数的模式与设置命令仍直接执行。五个上游命令别名使用 Pi 原生 Skill 展开来启动其打包 Skill。共享状态栏只显示 Pi Stuff 风格的 Nerd Font `󱖿 <mode>`。它不负责 Agent 活动；工作行仍是唯一活动权威。

## 后果

- Ponytail 为显式调用保留完整上游 Skill 内容，而其常驻投影是紧凑行为策略。活跃模式通过 Ponytail 目录让全部六个 Skill 对模型可见；`off` 是零贡献硬边界。
- 上下文管理现在公开一个通用的有序提示词贡献接缝，并支持已知 Anthropic、OpenAI、Google、Bedrock 和 Mistral 载荷形态。未知载荷形态会开放通过，并报告一条诊断记录。
- 软件包把 `src/ponytail/skills` 声明为 Pi 运行时资源。
- 专用隔离真实 Pi PTY 门槛覆盖对话框、64×28 与 48×16 布局、草稿与状态栏恢复、已保存设置与环境变量覆盖、会话账本、活跃紧凑提示词，以及硬关闭 Provider 边界。
- 人工认证的 ox-alpha 基准预先登记九组模式盲任务对，共 18 个一次性会话。其强效果门槛要求可见/隐藏完全正确、无受保护文件或提示词边界违规、九组可测量配对、至少六组非平局，并对代码行数采用 `p <= 0.05` 的单侧精确符号检验。认证运行的 18 个会话全部通过：`ultra` 赢得八组，汇总生产代码为 87 行而对照为 141 行（-38%），达到 `p = 0.01953125`；测得 token 代价为 148,513 对 113,012（+31%）。它不是 CI 门槛，也不构成跨模型和任务的一般结论。
- 上游更新继续由人工审查。显式 `ponytail:upstream:review` 命令会认证固定版本和候选 npm tarball、复查保留的本地基线，并准备清理后的软件包差异；许可证审查、资源/哈希更新、行为测试、提示词预算测量和真实宿主验收仍需人工完成。
- 该能力不增加独立软件包、运行时、状态页脚、设置文件或安装生命周期。
