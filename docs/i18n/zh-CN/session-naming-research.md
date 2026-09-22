# Session 命名: 规则、时机与任务稳定性

[English](../../session-naming-research.md). 调研日期: 2026-09-22. 本文是调研报告, 不是已批准的实现规格.

问题是: 当对话经历澄清、实现和排查时, Session 名称如何持续识别用户的主要任务. 源码检查可以确定输入、提示词、触发器和更新条件. 如果不把生成名称放到有代表性的对话中评测, 就不能确定实际名称质量.

本次修订替换了之前关于默认冷却期的建议. 冷却期可以限制请求频率, 但不能阻止标题跟随最新子任务. 反过来, 只生成一次的名称之后不会漂移, 但可能永久保留早期误解. 两种失败模式都需要考虑.

## 什么算作证据

我们比较的是持久化的 Session/任务标题, 以及用作 Session 列表标签的持久化摘要. 终端窗口状态、compaction 摘要和 commit 消息承担不同用途. 有源码依据的行会标出版本或 commit. 只来自文档的行为会明确标注. 公开 issue 报告是已观察到的失败示例, 不能证明每个用户或当前版本都有同样缺陷. 独立 package 会与同一命名实现的改编版本区分.

本次扩展调研没有安装或执行任何外部源码, 也没有发起实时命名模型请求. 之前针对 Pi 0.85.1 的内存元数据探针仍然有效, 但其用途限制见下文.

## 其他 harness

下表区分持久化身份和临时状态. 每一行有源码依据的内容都固定到了 commit. Claude Code 和 Codex 行只报告检查到的官方文档内容.

| Harness / 检查版本                     | 命名规则与输入                                                                                                                                                                                       | 何时命名或更新                                                                                                                                             | 稳定性与限制                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenCode 2.0.9, `6608799`              | 初始使用第一条可见用户消息. 单行, 使用用户语言, prompt 目标不超过 50 个字符, 保留技术术语和标识符, 实际存储上限为 100. 显式重新生成时保留首个请求, 最多 2,000 字符, 加近期用户/助手文本, 总计 8,000. | 根 Session 的输入变得可见且标题仍是默认时间戳时异步命名. 之后的重新生成是显式操作.                                                                         | 后续子任务不会自动替换标题. 提交时的标题相等检查和事件序号保护并发变化. 不明确的首个请求可能一直导致错误标题. [Prompt](https://github.com/anomalyco/opencode/blob/6608799d35d96c2821a48ac1d4b26a3b84b4e433/packages/core/src/plugin/agent.ts#L26-L69), [generation](https://github.com/anomalyco/opencode/blob/6608799d35d96c2821a48ac1d4b26a3b84b4e433/packages/core/src/session/title.ts), [trigger](https://github.com/anomalyco/opencode/blob/6608799d35d96c2821a48ac1d4b26a3b84b4e433/packages/core/src/session/runner/llm.ts#L162-L179).                                                |
| Goose 1.51.0, `1a4249a`                | 使用前三条可见用户消息. Prompt 目标是不超过 4 个词, 重点是任务主题而不是机械操作, 优先保留 issue/project/document 标识符, 不自行编造细节.                                                            | 普通 provider 会在前三条用户消息期间重新考虑. provider 管理的上下文只使用第一条. 在助手完成回复前开始.                                                     | 有限的早期修正, 然后冻结. 持久化的 `user_set_name` 只在入口处排除手动名称. 在检查的路径中没有找到写回时的顺序保护或手动来源复查, 因此较早请求可能覆盖较新的自动名称或手动名称. [Prompt](https://github.com/block/goose/blob/1a4249ac9f23c6e6e2526d4b54dbbf3bb09ba204/crates/goose/src/prompts/session_name.md), [input](https://github.com/block/goose/blob/1a4249ac9f23c6e6e2526d4b54dbbf3bb09ba204/crates/goose/src/session/session_naming.rs), [gate](https://github.com/block/goose/blob/1a4249ac9f23c6e6e2526d4b54dbbf3bb09ba204/crates/goose/src/session/session_manager.rs#L565-L651). |
| Gemini CLI, `d5b3e3a`                  | 持久化摘要要求用一句话表达用户的主要意图, 不超过 80 个字符. 最多 20 条 user/Gemini 消息, 消息超过 20 条时取前 10 条和后 10 条, 每条最多 500 字符.                                                    | 启动和 Session 列表可能为最近一次符合条件的旧 Session 生成摘要. 需要超过 1 条用户消息, 排除当前 Session、subagent Session 和 scratchpad. 已有摘要会被复用. | 持久化后, 后续输入不会持续重写它. 这个列表标签是延迟生成的. [Prompt/input](https://github.com/google-gemini/gemini-cli/blob/d5b3e3accb26000d273abf16e0f1dd83aa5428a9/packages/core/src/services/sessionSummaryService.ts), [selection/save](https://github.com/google-gemini/gemini-cli/blob/d5b3e3accb26000d273abf16e0f1dd83aa5428a9/packages/core/src/services/sessionSummaryUtils.ts#L321-L566), [display](https://github.com/google-gemini/gemini-cli/blob/d5b3e3accb26000d273abf16e0f1dd83aa5428a9/packages/cli/src/utils/sessionUtils.ts#L319-L335).                                    |
| Kimi CLI public 1.51.0, `5c7db06`      | 使用首个 wire turn 的 user 和 assistant 文本, 每一方只取前 300 个字符. 使用通用的简短标题提示, 上限 50 个字符.                                                                                       | Web 首轮 callback 在 idle/stopped 时触发. 后端首次成功后定名, 多次失败后则固定回退名称.                                                                    | 持久化的 `title_generated` 会冻结成功或手动设置的标题. 在模型 await 返回后重新读取, 保护已经完成的名称. 文本稳定性很强, 但修正机会有限. [Backend](https://github.com/MoonshotAI/kimi-cli/blob/5c7db06c24a175b17a3fb44fa58872235c1888e8/src/kimi_cli/web/api/sessions.py#L590-L901), [callback](https://github.com/MoonshotAI/kimi-cli/blob/5c7db06c24a175b17a3fb44fa58872235c1888e8/web/src/hooks/useSessionStream.ts#L517-L568).                                                                                                                                                             |
| oh-my-pi, `df624f5`                    | 使用提交消息中的任务, 大约五个词. 确定性低信号过滤器会在调用模型前拒绝问候语/填充语. 输出非法时 Session 可以保持未命名.                                                                              | 符合条件且未命名的输入开始命名. 已有名称或请求正在执行时跳过. 另有一个受设置控制的独立 replan refresh.                                                     | Session/名称重新读取保护首次生成. replan refresh 尊重持久化的用户标题来源. 低信号词汇主要是英文, 不是通用的多语言意图分类器. [Prompt](https://github.com/can1357/oh-my-pi/blob/df624f56b0508c51067a70422606cac898ac2bcb/packages/coding-agent/src/prompts/system/title-system.md), [filter](https://github.com/can1357/oh-my-pi/blob/df624f56b0508c51067a70422606cac898ac2bcb/packages/coding-agent/src/tiny/text.ts), [lifecycle](https://github.com/can1357/oh-my-pi/blob/df624f56b0508c51067a70422606cac898ac2bcb/packages/coding-agent/src/session/agent-session.ts#L7991-L8142).         |
| Claude Code, 2026-09-22 检查的官方文档 | 不带名称的 `/rename` 会根据对话历史生成名称. 支持显式名称和 hook 提供的标题. Changelog 描述了更短、更具体的自动名称.                                                                                 | Changelog 记录了特定界面上的首个 prompt/第三条消息变化. 这些内容不能确定 CLI、Desktop 和 Remote Control 之间有一个统一的更新时机.                          | 检查到的公开文档没有确定具体的自动 prompt、输入窗口和更新优先级. [Commands](https://code.claude.com/docs/en/commands), [hooks](https://code.claude.com/docs/en/hooks), [changelog](https://code.claude.com/docs/en/changelog).                                                                                                                                                                                                                                                                                                                                                                |
| Codex, 2026-09-22 检查的官方文档       | CLI 0.150.0 changelog 描述了未命名终端任务的描述性自动标题, 以及基于对话生成、可编辑的 `/rename` 建议.                                                                                               | 文档说明了用户控制, 没有确定具体的首次/更新事件或输入选择.                                                                                                 | 不要推断 Desktop 和 CLI 使用同一算法. `thread/name/set` 和独立的 goal API 不能证明标题来自 goal. [Changelog](https://learn.chatgpt.com/docs/changelog), [commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli), [app server](https://learn.chatgpt.com/docs/app-server).                                                                                                                                                                                                                                                                                                   |

Gemini 做了一个有用的区分: `update_topic` 在内存中跟踪逻辑章节或策略变化, 而持久化的 Session summary 提供可复用的 Session 标签. topic 指令明确允许从 research 变化到 implementation. 把这种更新频率 直接复制到 Session 标题会改变产品含义. 来源: [topic instructions](https://github.com/google-gemini/gemini-cli/blob/d5b3e3accb26000d273abf16e0f1dd83aa5428a9/packages/core/src/prompts/snippets.ts#L668-L684), [topic state](https://github.com/google-gemini/gemini-cli/blob/d5b3e3accb26000d273abf16e0f1dd83aa5428a9/packages/core/src/tools/topicTool.ts#L45-L102).

上面的 Kimi 公开源码是一个具体实现. 它较新的 [hosted server API 文档](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/server-api.html)描述了不同的 title endpoint 和输入模式, 本文不把这些细节拼成一个虚构的单一版本. oh-my-pi 也有终端状态标题, 表格行讨论的是持久化 Session 名称及其显式 replan 路径.

## Pi packages

下面十个 package 展示了不同于 旧版派生实现 的选择. 版本来自链接 commit 中的源码 manifest, 不表示它们与当前固定的 Pi runtime 兼容. 已检查 package 源码, 没有安装. 名称中共享一个短语的 repository 不因此成为同一个实现. 旧版 Pi Stuff 对 `pi-autoname` 的派生实现 不作为额外独立样本计算.

| Package / 版本                                                                                                                            | 输入与命名规则                                                                                                                                                                      | 触发时机、更新条件与手动策略                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`pi-session-namer` 0.3.2](https://github.com/joshua-zyy/pi-session-namer/blob/1d10dfd719438f457a29641ae05973af21e795d4/src/index.ts)     | 持久化 `type/topic/progress`. 使用 5,000 字符的最新文本预算和已有 segments. 当当前内容仍然有效时要求精确复用 type/topic, 支持 `KEEP`/`SKIP`.                                        | 首次 settled, 之后每四次 settled run 检查一次; compaction 会安排下一次 settled 检查. 持久化手动名称锁. progress 变化仍可能静默更新显示名称.   |
| [`pi-autoname` 0.6.8](https://github.com/ssdiwu/pi-autoname/tree/73d25caa9ff33dadfaa8187ad3f7d1495a01cec9)                                | 首次使用首轮对话; 周期检查使用最近六条消息. 输入当前标题并要求除非发生 material shift, 否则原样保留.                                                                                | settled 加冷却期, 支持显式 `/autoname`. 默认 `respectManualName=false`, 因此除非配置开启, 手动命名不是永久锁定.                               |
| [`patlux/pi-auto-session-name` 0.1.1](https://github.com/patlux/pi-auto-session-name/tree/19a83557d77638a25b065755be6779eaad901101)       | 使用当前分支 中最早的有界有效文本, 处理 compaction checkpoint. 标题具体描述任务/结果, 使用用户语言, 大约 3-8 个词, 保留标识符, 上限 80 字符.                                        | 只处理未命名 Session, 在 settled 或 60 秒 运行期间的超时触发 时触发. 冷却期只抑制重复尝试, 不会周期性替换已有名称. 显式 force 路径会确认替换. |
| [`@jhlabs/pi-auto-name` 0.1.1](https://github.com/jhlabs/pi-auto-name/tree/798da56ad23dde4658051604784f9091f1951823)                      | 使用首个用户请求加最新窗口. Prompt 强调完整对话和最新活动目标.                                                                                                                      | 先生成本地 fallback, 首次 settled 时修正, 之后每三条用户消息检查. 手动变化会禁用管理; 异步路径检查 session 文件和 leaf.                       |
| [`@fyeeme/pi-session-name` 1.0.4](https://github.com/fyeeme/pi-packages/tree/d5fb76cef700244bbd62a1a2bf206422c18257b1)                    | 最多八条非空 user/assistant 消息中的首条加最新七条, 每条最多 600 字符; 输入当前标题和 同级会话标题. Auto 决策可以返回 `KEEP`.                                                       | 默认是 `first`; 独立的 `auto` 模式 每次 settled 检查. 外部 rename 会形成持久锁定.                                                             |
| [`@camillof/pi-session-autoname` 0.1.2](https://github.com/camillof/pi-session-autoname/tree/5574493a147bfe5c99a3546ced7fc7eb57950a91)    | 使用首个用户请求加最终 assistant response, 上下文 4,000 字符. 关注持久任务/结果而不是临时回复, 使用用户语言.                                                                        | 新的未命名 Session 在首轮 settled exchange 后尝试一次. 显式 refresh 独立; 写入前检查 Session/request generation 和当前名称.                   |
| [`@furbyhaxx/pi-session-naming` 0.2.1](https://github.com/furbyhaxx/pi-session-naming/tree/5ae08175e317c4c50bf4a09fad071be7ea516a4c)      | 使用类似 Conventional Commits 的 type/scope/description, 包含用户输入中的具体名词. 输入模糊时使用中性的 日期时间占位名称. 可选项目/git 上下文; 范围更宽的对话记录 可能包含工具结果. | 首次 agent run 前触发. 临时标题在十次 settled 事件 后重试, 最多三次; 普通自动标题会冻结. 持久化手动名称锁.                                    |
| [`pi-auto-session-titles` 1.1.2](https://github.com/edxeth/pi-auto-session-titles/blob/6f8293d2776f01cef687aa9be00718f815d0ac87/index.ts) | 使用原始请求、最终 assistant summary、工具名称和有界的规范化文件路径. 排除工具结果/文件内容、bash 命令和 thinking.                                                                  | 只在首次 settled 时触发. resume/compaction 不触发周期性重命名. 任何 session-info 变化都会停止自动路径; 显式命令独立.                          |
| [`@nicknisi/pi-session-name` 0.1.10](https://github.com/nicknisi/pi-extensions/tree/0d6345c249ca7351f0203e53e5c8b02e3eff1c12)             | 默认启发式方法 使用首条用户消息的第一行; 可选 LLM 使用首个请求和首个助手回复的开头.                                                                                                 | 只在首次 settled 时触发. 手动命名/清空会形成会话级保护标记. 这里没有看到一般性的后续目标修正证据.                                             |
| [`pi-session-title` 1.1.0](https://github.com/djdembeck/pi-session-title/tree/5d2b75b21eaaf5a84072adfbf07bda34a7a13296)                   | 使用首个非 command 输入, 最多 2,000 字符; 默认约六个词, 可选 cwd/time 模板. 支持包括 oh-my-pi 在内的 Pi-compatible host.                                                            | 一次性的输入触发, print mode 有 fallback; 跳过已有名称, 在支持时使用 automatic title source.                                                  |

### 最相关的 package 实际保证了什么

`pi-session-namer` 是区分 任务身份字段和进度 的最清晰示例. 它比较 segments, 可以区分 仅进度变化和主题变化. 但是新 type/topic 仍由模型决定, 上下文也偏向最新内容. 相等检查 不能证明 topic 变化合理; `taskChanged` 只影响通知, 不影响写入资格. progress 仍属于渲染后的名称, 因此这是语义锚定, 不是不可变的标题文本. [Prompt and update path](https://github.com/joshua-zyy/pi-session-namer/blob/1d10dfd719438f457a29641ae05973af21e795d4/src/index.ts#L206-L315).

`patlux/pi-auto-session-name` 解决的是另一个问题: 提供有用的早期标签, 然后停止自动替换. 运行期间的超时触发 帮助较长的首轮运行, 同时保留开头上下文, 减少后续偶然工作带来的影响. compaction 后, summary 是输入锚点而不是原始请求的逐字内容, 因此 摘要忠实度 很重要. [Excerpt construction](https://github.com/patlux/pi-auto-session-name/blob/19a83557d77638a25b065755be6779eaad901101/src/title.ts#L56-L101), [eligibility](https://github.com/patlux/pi-auto-session-name/blob/19a83557d77638a25b065755be6779eaad901101/src/index.ts#L164-L255).

`@furbyhaxx/pi-session-naming` 和 oh-my-pi 都承认有些开场无法支持有意义的名称. 延迟命名或保留明确的临时占位名称, 比制造虚假的具体性更好. 十轮重试和英文填充词过滤器 都是实现选择, 不能证明它们是最优的澄清检测器.

## 值得评估的命名规则

反复出现且有用的规则是识别请求的结果及其对象, 保留少数能让任务可检索的标识符. 各来源对长度的规定差异很大: 四个词、五个词、3-8 个词、50/80 个字符. 这些是产品选择, 不是已建立的通用标准. 中文标题需要处理字符数/显示宽度, 不能套用英文词数规则.

针对本任务, 建议示例为 `Session 自动命名规则调研`, 如果范围之后明确进入实现, 则可用 `实现 Session 自动命名`. 搜索工具、lint 失败或 commit 步骤不应导致名称在原始命名任务仍然有效时变成 `修复 lint` 或 `提交代码`. 这些示例是拟议的验收案例, 不是本次调研观察到的模型输出.

候选 prompt 应指定: 用户的主要目标; 具体对象; 原始技术标识符; 用户语言; 不得编造细节; 不得加入状态或偶然步骤; 当前名称仍正确时原样保留; 区分澄清/纠正和目标替换. 可以由代码保证的输入选择和写入条件, 应由代码执行. 单靠 prompt 不能保证语义判断.

## 什么能防止漂移, 什么不能

| 机制                       | 实际控制内容                   | 剩余弱点                               |
| -------------------------- | ------------------------------ | -------------------------------------- |
| 生成一次后冻结             | 后续消息不能替换标题           | 模糊开场或早期错误理解会一直保留       |
| 使用固定的开头对话窗口     | 后续实现细节不会进入命名输入   | 窗口之外的纠正不可见                   |
| 保留原始请求加近期文本     | 保留对起始任务的明确引用       | 近期文本仍可能占主导; 初始误解仍需纠正 |
| 要求模型保留当前标题       | 通过 prompt 指导减少无必要变化 | 没有结构性保证; 是否应变化仍由模型决定 |
| 延迟或重复早期命名         | 让澄清有机会影响标题           | 固定轮数不能证明澄清已经完成           |
| 冷却期或每 N 轮检查        | 限制请求频率                   | 不说明任务身份是否发生变化             |
| 手动名称锁定和过期写入检查 | 保护用户意图和并发更新         | 不能让自动生成的标题在语义上变得正确   |

稳定标题和正确标题是两个属性. 限制后续写入或输入能直接约束名称变化. 最难解决的问题是: 哪些后续用户消息纠正或替换主要任务, 哪些只是描述通往它的一步.

## 对 Pi Stuff 的影响

调研到的规则应根据维护者的要求评估: 用主要请求的结果及其对象命名, 只有能区分任务时才加入 范围限制. 局部排查步骤、状态更新或工作阶段不应只因为最近就成为 Session 身份. 这是我们提出的评估标准, 不是每个 harness 都实现了这样的模型.

证据支持对"有限的早期命名/修正策略"和"一次性基线"进行测试. 它不支持把十分钟、三轮或五轮 当作最优阈值. 独立持久化的核心任务记录在生态中有结构化命名先例, 但其必要性仍未得到证明. 应将它与更简单的方案比较: 保留选定的初始用户指令和用户明确给出的后续纠正. 如果需要显示进度, 应提供独立字段, 让稳定的任务标签不会在普通阶段变化.

在选择策略前, 比较这些对话:

| 对话案例                                 | 期望属性                             |
| ---------------------------------------- | ------------------------------------ |
| 开场模糊, 之后出现明确目标               | 最终名称反映澄清结果, 而不是冻结开场 |
| 对同一功能进行调研、实现和测试           | 阶段变化保留任务身份                 |
| 临时 lint、环境或依赖阻塞                | 标题不会变成阻塞子任务的名称         |
| 用户纠正了被误解的目标                   | 错误的初始名称可以被修正             |
| 用户明确替换主要目标                     | 策略可以区分目标替换和附带请求       |
| 实际请求之前有很长的初始日志或注入上下文 | 输入截断不会丢掉任务                 |
| 中文内容 加英文技术标识符                | 标题保留含义和可识别的标识符         |
| 生成尚未结束时手动改名                   | 生成结果不能覆盖手动选择             |

应分别测量主要目标匹配、临时步骤污染、澄清后的纠正和不必要的标题变化. 同时跟踪命名请求数和延迟等运行成本. 这些是拟议的评估案例, 不是已完成的实验或虚构的分数.

## 已有的 Pi 接入 证据

当前 Pi Stuff 基线 `cd0f174f65bdbacdca265646b4e191943063d0ac` 注册 Web 和 RTK, 没有命名能力. 它的配置会拒绝未知字段, 因此不能直接把旧版 `sessionNaming` 设置复制到当前版本. Pi 0.85.1 提供名称读写和 模型 API, 不需要新的模型服务客户端.

[Pi lifecycle](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/agent-session.ts) 在 `finally` 中发出 `agent_settled`. settled 既不等于成功, 也不表示输入直接来自用户. 命名时机必须考虑这一点, 不能假定助手 turn 完成就表示用户任务完成.

[Session manager](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/session-manager.ts) 会读取所有条目 中最新的名称. 旧版派生实现 却从当前分支 恢复归属标记. 之前真实的内存探针退回名称和标记之前的分支后返回:

```json
{
  "name": "RTK Review",
  "branchTypes": ["message"],
  "allTypes": ["message", "session_info", "custom"]
}
```

使用固定版本的 Pi 依赖 重现:

```sh
bun -e 'import {SessionManager} from "@earendil-works/pi-coding-agent"; const s=SessionManager.inMemory(); const root=s.appendMessage({role:"user",content:"Investigate RTK",timestamp:0}); s.appendSessionInfo("RTK Review"); s.appendCustomEntry("research-marker",{name:"RTK Review"}); s.branch(root); console.log(JSON.stringify({name:s.getSessionName(),branchTypes:s.getBranch().map(e=>e.type),allTypes:s.getEntries().map(e=>e.type)}));'
```

这证明的是元数据范围, 不是模型质量或端到端覆盖. resume、树导航、fork 和 未完成请求 仍是实现验收案例. 公开接口和持久化变更需要单独约定实现范围.

## 旧版来源与范围

检查了本地旧版工作副本 `21b636eaccc487a08362165ec69ffe364e8730fb`: `packages/pi-stuff/src/session-naming/{index,controller,state,prompt,model,settings}.ts`、`conversation-ui/{index,agent-run-origin}.ts` 和 ADR 0020. 这些文件没有修改. GitHub 无法在当前仓库 中解析该 commit, 所以这部分只是本地证据. 该 fork 来自 `pi-autoname`, 要求英文 2-4 词标题和 3-30 ASCII 字符校验, 使用最近六条消息上下文和十分钟默认冷却期, 并默认关闭手动名称保护. 其历史 ADR 不约束重建后的仓库.

因此, 旧版关于成功 settled 和默认周期冷却的提案不作为本次扩展报告的结论. 在回复前、settled 后、早期澄清后以及 Session 结束后命名, 都是调研系统中的真实模式. 这里适合哪一种, 取决于早期可发现性和纠正初始模糊任务之间的取舍.

没有修改运行时行为、配置、依赖或持久化格式. 实时模型质量、成本和宿主端到端生命周期仍未测量. 本报告支持下一步设计讨论; 实现及其并发/持久化审查需要单独约定范围.

## 设计访谈: 已接受的决策

自动生成仅在会话开头生效. 后续任务变化、恢复会话和上下文压缩都不触发生成. 用户可通过显式命令生成替代名称, 但不会重新开启自动管理. 这替代了此前恢复自动管理、跟随后续目标变化的讨论. 手动名称持续具有优先权, 直到用户明确修改或请求生成替代名称.

生成名称统一英文, 使用 `type: Action object`, 不带括号范围字段. 维护者优先要求最少 token 消耗. Goose 的前三条用户消息方案只是设想, 未被选定; 没有约定三条消息门槛. 首轮交互结束后, 使用首条用户请求和有限的最终助手答复文本, 最多发起一次自动命名请求. 排除工具输出、过程日志和思考内容. 这不表示首轮已经完成全部澄清. 首轮取消或报错时跳过自动命名, 不顺延到后续成功交互.

自动生成失败或输出不合格后不重试, 保留默认显示, 用户可执行命令. 显式生成针对当前明确的主任务, 不固守开头任务, 也不罗列整场对话历史. 手动生成接受可选的目标说明, 有说明时优先使用; 无说明时使用有长度上限的开头及近期对话, 不发送全部历史.

允许单独配置命名模型, 未配置时使用当前会话模型. 默认命名规则为英文 `type: Action object`, 类型使用 `research / feat / fix / refactor / docs / chore`, 描述优先 4-8 个词, 完整名称最多 80 个字符. 保留技术标识符大小写, 不含括号范围、日期、进度和完成状态. 类型描述整项任务而非当前阶段. 用户通过配置修改命名规则, 无需修改扩展代码. 配置采用可替换的命名风格提示词, 另设 `maxLength`, 默认 80. 本地校验只约束非空、单行、长度等基本条件, 不强制默认类型列表或英文. 提示词修改不改变生命周期和重试规则.

仅新建空白主会话具有自动命名资格. 已有名称则跳过. 恢复会话、分叉会话 (包括无名称分叉) 和后台子 agent 会话均不自动生成. 显式命令为 `/autoname [目标说明]`, Pi 内置 `/name <name>` 继续负责直接设名.

维护者已接受默认开启自动命名、自动输入 2,000 字符、显式生成输入 4,000 字符和 15 秒截止时间. 这些是设计起点, 不是实测最优值或通用 token/账单上限. 主测试边界已确认采用真实隔离 Pi 宿主及本地可控模型 endpoint. 完整约定、审查补充的宿主限制和验收案例见[规格](session-naming-design.md)及[实现 issue #108](https://github.com/jczhang02/pi-stuff/issues/108). 本次调研/规格工作不实现功能.
