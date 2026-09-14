# Subagent 决策审查

[English](../../subagents-decision-review.md) · 英文为准.

审查日期: 2026-09-14. 基线为 [`1c75955`](https://github.com/jczhang02/pi-stuff/blob/1c75955b50b05330280d08586f2789befa2069ce/docs/i18n/zh-CN/subagents-design.md) 的已确认访谈记录. 维护者要求在 UI 前对照源码全面 review. 原始源码审查覆盖 Q1-Q60, 保留全部 F01-F33 能力并提出修订. 下文单独记录的 R1-R8 后续修订现已获批, 两轮审查均不代表运行验收.

主要问题是把生命周期不同的对象绑在了一起: 代理持续保留的上下文, 单次交办的结果, 活跃执行名额和工作区. 修订后的[设计](subagents-design.md), [验收场景](subagents-acceptance.md)和[术语表](CONTEXT.md)已区分这些对象. 仍基于 arhen fork, 按需借鉴机制, 不整体复刻 Codex 或 Claude 编排系统.

## 实际使用中会改变什么

下表是设计反例, 不是已执行的测试. 来源编号对应文末证据, 建议属于本项目的推断与取舍.

| 使用过程                                                | 原规则的问题                            | 本轮建议及代价                                                                                                             | 依据       |
| ------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 同一个实现代理连续做三轮修改.                           | 每次续聊新建 worktree, 闲置后自动删.    | 保留它的工作区和配置, 每次任务固定提交与结果, 工作区释放后再回收. 减少重新绑定和准备环境, 代价是占用更多磁盘.              | G1, L1, P1 |
| 修复代理报告没修好, 然后正常返回.                       | 完成的措辞容易把正常执行当作完成交办.   | 执行结束, 交办结果声明和验收分别记录. 已收尾且声明完成才放行依赖, 声明仍可能错, 不宣称自动判断代码正确.                    | C1, A1     |
| 两名负责人等下级, 其中一个同时还在跑测试工具.           | 一进入显式等待就释放名额.               | 本任务没有其他执行后才释放, 身份和累计额度不变, 恢复时重新取名额. 限制驻留上下文数量不能替代这个调度器.                    | C2, G2     |
| 当前轮还有未完成工具调用时派出子代理.                   | 完整复制可见历史, 没有定义协议边界.     | 保证合法调用与结果配对, 保留已完成内容, 标识分叉控制记录. 工具, 权限和文件状态独立处理.                                    | L1-L2, P1  |
| 角色只允许某扩展的一个工具, 该扩展还注册其他工具和钩子. | 只初始化所需工具, 并假定状态属于子代理. | 按入口选择扩展, 独立初始化后过滤暴露工具. 验证共享全局状态, 不支持的入口明确拒绝; 白名单不能撤销 factory 副作用.           | P1, G2     |
| 合理的实现任务需要超过三十分钟.                         | 未覆盖配置时, 所有任务三十分钟截断.     | 保留可配置执行期限, 未配置时关闭. 避免没有依据的统一截断, 代价是默认没有任务时长费用上限. 8/64/3 仍是试用值, 不是测量结论. | A3         |

Codex 自身也有 V1, V2 两条限制和控制规则不同的协作路径. 已读 V2 区分普通消息与触发执行的续聊, 等待工具仍保留运行轮次的执行 guard. 因此 Pi 的等待释放名额及逐代理持久交办队列须自行实现. 不把 V1 的深度或 close 规则, 或 Agents API 默认值混作 V2 行为, 见 C2-C4.

配置稳定是本项目的取舍, 并非上游共识. Claude 镜像在恢复时重新选择角色定义, arhen 在真正执行时解析角色文件. 我们固定已保留代理的配置, 避免改了文件就让同一 reviewer 默默换工具或模型. 显式受支持覆盖仍可使用, 当前权限限制始终生效.

另外保留几项各参考实现并不统一具备的行为: Git 写代理默认隔离, 只读代码默认稳定, 不默默退回父目录, 分支取消须确认停止, 普通消息不能恢复已结束任务, 异常后暂停队列, 旧图与结果保持不变. 这些是针对已选择工作方式的决定, 不是因为某个产品默认如此.

## 已确认的对抗审查修订

2026-09-14, 维护者接受对 `fff69469b0c0e93da9ccfcc94ae0d53114faa586` 的[对抗审查](https://github.com/jczhang02/pi-stuff/issues/64#issuecomment-5662362742)中全部 R1-R8 推荐, 要求修改文档. 两个配置为 GPT-6 Astra xhigh 的 reviewer 上下文独立审查后交叉反驳, 保留三项语义问题和五项澄清或组合验收缺口. 本次批准针对 R1-R8, 不追溯为此前所有源码审查建议均已获批. 下文原始 29/23/8 统计继续记录此前比较.

| 发现                   | 已确认处理                                                                                                                      | 规则与验收覆盖               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| R1, 代理复用与任务控制 | 负责人可复用保留下级承担自己新派的任务, 不能取消或纠正主代理交给该下级的工作. 历史代理关系不替代任务归属.                       | Q14/Q16/Q58; B10/B11         |
| R2, 收尾时 steering    | steering 先接纳就在同一任务处理后完成, 完成先成立则拒绝. 取消或失败时报告未处理指令; 普通未消费消息保留原关联且不重启.          | Q39/Q49; F12, B06            |
| R3, 收紧在途权限       | 当前上限约束排队工作和新调用. 显式撤销权限时请求取消受影响在途工作, 不声称立即停止或撤销副作用. 实际权限变化与接纳配置分别记录. | Q18/Q42/Q47/Q51; F19, B10    |
| R4, 并发重开           | 重开不能重复执行, 拆分共享额度或覆盖仍有效的执行归属. 接管前核实权限归属与未知活动, 不预选锁或协调器.                           | Q20/Q24/Q25/Q57; B09         |
| R5, 创建记录保存失败   | 执行前保存创建与接纳记录, 失败须报告, 保持可恢复身份, 归属, 配置和计数一致. 不新增任意副作用事务.                               | Q44/Q50/Q51; B01/B09         |
| R6, 正常离开           | 成功离开前停妥下级并保存中断记录. 慢停或保存失败时, 不释放工作区供冲突执行或清理.                                               | Q44/Q47/Q57; B04/B09         |
| R7, 取消与终态保存     | 验证两种先后顺序下只有一个权威终态: 已接纳取消不放行使用者, 晚取消不改写已可靠完成的结果. 术语表链接 Q60, 不重复完整判据.       | Q14/Q22/Q44/Q47/Q60; B04/B12 |
| R8, 隐式等待期间提问   | 下级提问唤醒父代理隐式等待, 重新取得名额, 同一任务回答后继续汇合, 不拖到答复超时.                                               | Q21/Q40/Q55; F08/F13, B11    |

交叉审查排除了恢复自锁指控, 因为 Q56 已允许补救先于暂停队列执行. 同代理依赖死锁需要未承诺的 FIFO 或跨图假设. R4 的级别存在分歧: 一位审查员把恢复执行权列为 S2, 另一位与负责人认为串行和共享额度已有要求, 归为 S3 组合验收缺口. 上述已确认约束明确应观察到的行为, 不替实现预选机制. F01-F33 与单一 `subagent` 入口保持不变. 文档修订不构成运行验收证据.

## 原始源码审查结果

"保留"不改行为, "澄清"明确约束或证据边界, "修改"改变此前默认值或生命周期. Q3-Q9 的七个回答均选择已有能力集, 因而合并一行. 原始问题全部覆盖: 29 项保留, 23 项澄清, 8 项修改. U 表示维护者的明确选择; 标为项目约束或推断时, 参考实现并不提供完全相同的保证.

| 决定  | 处理 | 审查结论                                                                      | 依据                    |
| ----- | ---- | ----------------------------------------------------------------------------- | ----------------------- |
| Q1    | 保留 | 每项功能各有真实场景, 一个顺利流程不足以验收全部能力.                         | U                       |
| Q2    | 保留 | 接口可以重设计, 上游名字不决定我们的领域模型.                                 | U, A1                   |
| Q3-Q9 | 保留 | F01-F29 全保留, 审查修正语义与成本假设, 不撤销明确范围选择.                   | U, A1-A3                |
| Q10   | 保留 | 完成后续聊需要保留身份, 新交办另记.                                           | G1, L1, C1              |
| Q11   | 保留 | 默认新上下文, 历史复制显式选择.                                               | L2, D1                  |
| Q12   | 保留 | 保留有限递归, 其他产品 fork/team 的限制不能替代我们的选择.                    | U, L2                   |
| Q13   | 澄清 | 保留扩展工具, 按已验证入口与会话支持, 不承诺普遍兼容.                         | P1, G2                  |
| Q14   | 澄清 | 分开代理身份, 交办归属和固定结果引用.                                         | A1, G1, T1              |
| Q15   | 澄清 | 执行名额, 保留上下文, 累计任务数与深度各有生命周期.                           | C2, G2                  |
| Q16   | 澄清 | 等待本次交办派出的下级, 不等待持久下级代理未来的全部工作.                     | C1, G1; 推断            |
| Q17   | 保留 | 取消归属本任务的分支, 请求中断前先阻止新的下级启动.                           | A3, L3; 项目约束        |
| Q18   | 澄清 | 分别执行工具和实际权限上限, 白名单不是沙箱.                                   | P1, C4, L3              |
| Q19   | 修改 | 使用合法分叉边界, 处理未配对工具, 不复制活跃权限和状态.                       | L1-L2, P1               |
| Q20   | 保留 | 同一保留代理每次执行一项交办, 续聊排队且与 steering 分开.                     | U, G1                   |
| Q21   | 澄清 | 只释放执行容量, 且其他活跃工具已结束; 恢复时重新取得.                         | C2-C3, G2; 项目调度要求 |
| Q22   | 澄清 | 已收尾依赖没有可放行完成结果时跳过其使用者, 无关工作继续.                     | A2                      |
| Q23   | 保留 | 下级失败交给父级补救, 不自动失败整树.                                         | U, A2; 明确取舍         |
| Q24   | 澄清 | 续聊计入原派发, 新调用外壳不发新额度.                                         | C2, A2; 项目策略        |
| Q25   | 保留 | 恢复记录与上下文, 中断工作显式继续, 不盲目重放写操作.                         | P1, L1, T1              |
| Q26   | 澄清 | 8/64/3 保留为可配置试用值, 不是已测最优默认.                                  | A2-A3, C2; 未测性能     |
| Q27   | 保留 | 执行, 等结果和等答复分别计时, 排除等待是我们的新增行为.                       | A3                      |
| Q28   | 保留 | 自身就绪即可启动, 替换 arhen 波次屏障.                                        | A2, G2                  |
| Q29   | 保留 | 补救产生新工作与结果, 不自动重开旧图.                                         | T1; 更有限的重跑策略    |
| Q30   | 修改 | 独立写代理跨交办拥有工作区, 不再每项交办新建一个.                             | G1, L1                  |
| Q31   | 澄清 | 依赖消费固定提交, 多份成果仍须显式整合.                                       | A1, T1                  |
| Q32   | 澄清 | 已收尾依赖无可放行结果时, 使用者以跳过结束, 直接取消仍单独记录.               | A2, T1                  |
| Q33   | 澄清 | 脏目录快照保护原暂存区, 检测捕获过程中的源变化.                               | P1, D1; 项目增强        |
| Q34   | 修改 | 复用保留工作区, 换基线须明确且重新绑定资源.                                   | G1, L1, P1              |
| Q35   | 澄清 | 范围内修改保存, 固定成果引用和交办完成分开; 保存失败明确报告.                 | A1, C1                  |
| Q36   | 修改 | 释放前保留工作区; 真正停止且内容已保存后回收, 包括检查忽略文件.               | A1, G1, L1              |
| Q37   | 保留 | 非 Git 直接写显式选择, 不默默退回无隔离执行.                                  | U, A1, L1               |
| Q38   | 保留 | 已知 ID 通信限于本派发, 跨派发转交是有意限制.                                 | U, D1                   |
| Q39   | 澄清 | 接收不等于消费, 普通消息不重启结束任务.                                       | C3, L1, D1; 有意不同    |
| Q40   | 保留 | 保留可配置十分钟等答复, 未答复结果及迟到回复关联.                             | A3, U                   |
| Q41   | 保留 | 显式选角色替换 arhen 文本重合匹配.                                            | A4, G2                  |
| Q42   | 修改 | 新建时优先级保留, 保留代理续聊采用保存配置加显式覆盖.                         | A4, G2, L1; 稳定性取舍  |
| Q43   | 保留 | 默认摘要和固定成果引用, 完整输出可读取.                                       | A2, D1                  |
| Q44   | 澄清 | 声称可靠交付前保存结果, 存储错误属核心错误而非观察者错误.                     | A1, T1                  |
| Q45   | 修改 | 选入口, 独立初始化后过滤工具, 不承诺按工具抑制 factory 副作用.                | P1, G2                  |
| Q46   | 修改 | 撤销统一三十分钟截断, 保留显式配置执行期限与分支取消.                         | A3; 产品取舍            |
| Q47   | 保留 | 请求取消不等于停止, 确认停止前保留活跃容量与工作区.                           | A3, L3, C2              |
| Q48   | 澄清 | 六十秒限制单次等待, 不规定反复轮询未变化状态.                                 | A3                      |
| Q49   | 保留 | steering 在下一安全模型边界生效, 拒绝对结束任务 steering.                     | A3, P1                  |
| Q50   | 澄清 | 已知错误整体校验不等于启动和运行副作用具有事务性.                             | A1-A2, G2               |
| Q51   | 修改 | 冻结任务实际配置, 角色文件修改影响新代理, 不默默改变保留代理续聊.             | A4, G2, L1              |
| Q52   | 保留 | 即使快照有成本, 仍默认稳定只读代码, 实时读取显式选择.                         | P1, D1; 项目取舍        |
| Q53   | 澄清 | 恢复已保存代码并重新绑定资源, 报告未保存内容缺失, 不替换父 cwd.               | L1, P1                  |
| Q54   | 澄清 | 仅可选观察者独立失败, 必需持久化不是这种观察者.                               | G2, T1                  |
| Q55   | 澄清 | 汇合并处理未读下级结果, 已显式汇合后不强制再总结.                             | C1, G1; 项目约束        |
| Q56   | 澄清 | 保留异常后暂停队列, 允许明确选定补救先于释放队列执行.                         | U, G1; 明确策略         |
| Q57   | 澄清 | 真正离开 Pi 会话才停止下级, 回复或焦点变化不算; 崩溃后未知活动须核实.         | P1, L3; 项目约束        |
| Q58   | 保留 | 控制沿归属授权, 知道代理 ID 不够, 消息不授予管理权.                           | U, L3                   |
| Q59   | 保留 | 默认只读排除任意 shell, worktree 和工具过滤不能约束所有副作用.                | P1, C4, L3              |
| Q60   | 澄清 | 运行结束, 声明完成和验收是三个事实. 错误完成声明可能放行依赖, 仍会被审查否决. | C1, A1                  |

## 证据来源与可信度

U 为文首已确认基线与维护者本次审查要求. 官方项目源码和固定版本 npm 产物是直接实现证据, 静态阅读不证明运行验收, 也不证明每条受开关控制的路径都已启用. 下列版本只标识证据, 不讨论兼容性.

Claude 材料须单独区分. `6f6f12b37f529488b10e53928dd5508bb93535c7` 是社区修改的镜像, 含 internal stubs 和 feature shims. private package 的 `1.0.0` 不能绑定到经过认证的 Claude Code 发布版. L1-L3 仅是该快照的结构线索, 不是已验证的产品保证. 没有把镜像源码导入本仓库. 本机官方 2.0.76 bundle 没有可用 source map, 不能据此认证镜像.

D1: 2026-09-14 核对的当前官方 [subagents](https://code.claude.com/docs/en/sub-agents), [agent teams](https://code.claude.com/docs/en/agent-teams) 与 [worktrees](https://code.claude.com/docs/en/worktrees) 文档. Named agents, teams 和 fork 是不同路径. 当前子代理文档描述通过 SendMessage 显式恢复和可选 worktree 隔离, 不能据此要求我们的普通消息自动恢复结束任务, 也不能说 Claude 每个子代理默认使用 worktree. 当前带版本条件的文档不能认证较早镜像或其 feature flags.

| 编号 | 来源与固定版本                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 核实到的事实                                                                                                                                                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1   | [arhen 会话与工作区生命周期](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/manager.ts#L997-L1050), [续接代码](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/manager.ts#L1326-L1405), [关联代码](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/worktree.ts#L254-L283). `1.3.54, de1c878`.                                                                                                                          | 任务 finally 释放子会话, resume 仅接受失败或中止任务并复用旧记录. worktree 回收可先提交修改再删除目录.                                                                                                                       |
| A2   | [arhen 依赖图与任务状态](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/graph.ts#L91-L115), [关联代码](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/types.ts#L1-L20). `1.3.54, de1c878`.                                                                                                                                                                                                                                                                                                    | 调度器等待整批就绪波次. 它返回 skipped 节点, 持久化 TaskStatus 却没有 skipped 分支, 与本项目的就绪即启动和跳过终态要求不同.                                                                                                  |
| A3   | [arhen 计时, 等待与取消](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/manager.ts#L927-L1023), [默认值](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/manager.ts#L58-L62), [关联代码](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/manager.ts#L1453-L1588). `1.3.54, de1c878`.                                                                                                                                   | 执行默认六小时, autoLimit 下为一小时; 计时包含等待父答复, 非正值关闭. 等结果到期不取消工作. 取消状态收尾不证明所有工具已经停止.                                                                                              |
| G1   | [gotgenes 保留会话](https://github.com/gotgenes/pi-packages/blob/bebfa283fc6a0b8867399b4fcc9dc5997817e9ca/packages/pi-subagents/src/lifecycle/subagent.ts#L464-L512), [关联代码](https://github.com/gotgenes/pi-packages/blob/bebfa283fc6a0b8867399b4fcc9dc5997817e9ca/packages/pi-subagents/src/lifecycle/subagent.ts#L638-L691). `21.7.0, bebfa283`.                                                                                                                                                                                                                                                                                          | 提问期间可保留会话与工作区供继续. 重资源释放另行处理, 之后的 resume 可明确拒绝. 这是生命周期参考, 不等于已完整支持 F30.                                                                                                      |
| G2   | [gotgenes 限流与扩展装配](https://github.com/gotgenes/pi-packages/blob/bebfa283fc6a0b8867399b4fcc9dc5997817e9ca/packages/pi-subagents/src/lifecycle/concurrency-limiter.ts#L12-L54), [关联代码](https://github.com/gotgenes/pi-packages/blob/bebfa283fc6a0b8867399b4fcc9dc5997817e9ca/packages/pi-subagents/src/lifecycle/create-subagent-session.ts#L232-L312). `21.7.0, bebfa283`.                                                                                                                                                                                                                                                            | 小型 FIFO limiter 分开排队闭包和活跃执行. 会话装配重新加载扩展入口, 再应用工具排除并绑定生命周期, 不能证明按单个工具选择性初始化.                                                                                            |
| P1   | [Pi SDK 会话与扩展加载](https://unpkg.com/@earendil-works/pi-coding-agent@0.85.1/dist/core/extensions/loader.js), [关联代码](https://unpkg.com/@earendil-works/pi-coding-agent@0.85.1/dist/core/resource-loader.js). `published 0.85.1`. [SessionManager](https://unpkg.com/@earendil-works/pi-coding-agent@0.85.1/dist/core/session-manager.js), lines 1201-1303.                                                                                                                                                                                                                                                                              | 已审查固定版本发布产物: loader 458-493 行调用扩展 factory, resource-loader 316-319 和 741-758 行选择并加载入口. SessionManager 的 open/forkFrom 恢复或复制会话日志, 不产生文件系统快照. 分开调用 factory 不证明模块全局隔离. |
| C1   | [Codex 执行状态](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/status.rs#L6-L23), [关联代码](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/status.rs#L26-L32). `6b9826e3`.                                                                                                                                                                                                                                                                                                                                                      | 无错误的 TurnComplete 转成 Completed(last_agent_message). 这是执行信号, 不能验证修复正确或已经验收.                                                                                                                          |
| C2   | [Codex V2 驻留上下文](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/control/residency.rs#L44-L72), [关联代码](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/control/residency.rs#L127-L161). `6b9826e3, V2 path`.                                                                                                                                                                                                                                                                                                               | V2 预留驻留容量, 可持久化, 关闭并卸载符合条件的非活跃会话; 资格检查还考虑活跃轮次及未处理收件箱. 身份, 驻留上下文与活跃执行是不同资源, 这不能证明本项目等待释放名额的调度器已经存在.                                         |
| C3   | [Codex V2 执行计数](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/control/execution.rs#L13-L69), [等待](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs#L39-L116), [消息与续聊模式](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/tools/handlers/multi_agents_v2/message_tool.rs#L12-L24), [运行任务归属](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/tasks/mod.rs#L282-L410). `6b9826e3`. | 运行轮次在等待工具中仍持有执行 guard. QueueOnly 和 TriggerTurn 是不同投递模式. 可借鉴消息与续聊分离, 但没有实现我们要求的等待释放名额或持久交办队列.                                                                         |
| C4   | [Codex 子代理重新加载策略](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/control/spawn.rs#L400-L559), [角色模型](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agent/role.rs#L36-L128). `6b9826e3`.                                                                                                                                                                                                                                                                                                                                   | 环境和执行权限继承与角色配置分别处理. 已读 Rust 角色模型不是通用的逐角色工具名白名单, 我们的逐层收窄工具仍须自行执行约束.                                                                                                    |
| A4   | [arhen 执行时解析角色](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/manager.ts#L723-L766), [接受派发](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/manager.ts#L1053-L1172), [角色匹配](https://github.com/arhen/pi-extensions/blob/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent/src/agentfile.ts#L119-L151). `1.3.54, de1c878`.                                                                                                                                | 真正执行时再次解析角色, 文件模型可覆盖输入模型. 这是接受时配置稳定的反例, 不是应继承的规则.                                                                                                                                  |
| L1   | [Claude 镜像续聊](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/resumeAgent.ts#L63-L114), [关联代码](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/resumeAgent.ts#L150-L205). `6f6f12b3, unverified mirror`.                                                                                                                                                                                                                                                                                                        | 镜像读取日志和元数据, 可复用已保存工作区, 过滤未完成工具调用并重新选择角色定义. worktree 缺失时退回父 cwd, 本项目不采用这一退路.                                                                                             |
| L2   | [Claude 镜像分叉](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/forkSubagent.ts#L14-L88), [关联代码](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/forkSubagent.ts#L91-L169). `6f6f12b3, gated mirror path`.                                                                                                                                                                                                                                                                                                        | Fork 受开关控制. 它为当前 assistant 消息的工具调用构造占位结果, 并非替换所有历史工具结果, 还限制再次 fork. 复制会话需要处理协议, 不能仅复制数组.                                                                             |
| L3   | [Claude 镜像控制边界](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tools/AgentTool/AgentTool.tsx#L568-L577), [关联代码](https://github.com/tanbiralam/claude-code/blob/6f6f12b37f529488b10e53928dd5508bb93535c7/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L278-L303). `6f6f12b3, unverified mirror`.                                                                                                                                                                                                                                                                                           | 镜像组装子工具池时可超出父工具过滤范围, 本地代理 abort 后立即标为 killed. 这两种行为都不足以成为放宽本项目继承上限或确认停止规则的理由.                                                                                      |
| T1   | [Taskflow 不可变工作流恢复](https://github.com/heggria/taskflow/blob/d9652629c46ad15f4898dd458867f8e0460f98b5/packages/taskflow-core/src/resume.ts#L140-L202), [关联代码](https://github.com/heggria/taskflow/blob/d9652629c46ad15f4898dd458867f8e0460f98b5/packages/taskflow-core/src/store.ts#L88-L104). `0.3.0-beta.1.2, d9652629`.                                                                                                                                                                                                                                                                                                          | 恢复新建 runId/parentRunId, 保留原运行, 可在新运行中重跑下游阶段. 借鉴不可变结果历史, 不能混同工作流重跑和代理续聊, 也不直接采用自动重跑下游.                                                                                |

## 仍须验证什么

本轮使用 Codex, Claude 和 Pi packages 三个只读研究上下文, 执行者随后复核关键源码路径及完整决定清单. 没有运行导入产品, 安装依赖, 实现调度器或执行验收场景.

后续实现证据需要解决 Pi 合法历史分叉, 扩展安全初始化, 脏基线捕获, 进程实际停止以及中断后的状态恢复. 保留上下文的内存与磁盘成本需要测量, 8/64/3 没有校准证据. B01-B12 已加入等待与工具同时活跃, 暂停队列前明确补救, 旧提交不变, 可选观察者与核心存储失败分开, 以及错误完成声明等检查, 目前均未验证.

本轮源码审查已整理为可整体讨论的方案. 理解这份修订及验收覆盖之前继续暂缓 UI, 不再靠逐题机械确认来代替审查.
