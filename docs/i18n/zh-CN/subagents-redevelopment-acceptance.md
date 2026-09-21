# 子代理重写验收

[English](../../subagents-redevelopment-acceptance.md). 以英文版为准.

本记录对应 [Issue #97](https://github.com/jczhang02/pi-stuff/issues/97)、[PR #103](https://github.com/jczhang02/pi-stuff/pull/103) 和 [A01-A10 合同](subagents-redevelopment-spec.md#测试决策). 实现基线为 `cd0f174f65bdbacdca265646b4e191943063d0ac`. 行为参考为 arhen `pi-core-subagent` 1.3.55, 固定于 `676b11eb415cd46fbede712b5bbb075ff3f043bf`, 改编行为与代码保留[上游许可证](../../../src/subagent/LICENSE).

## 证据映射

`tests/system/` 中的测试在隔离 Pi 宿主中加载真实包入口. 本地 HTTP provider 提供模型响应, 不替换子代理会话、工具调用、终端、Git 或持久化. 对于时序和纯计算, 在比终端断言更清楚时使用组件测试.

| 验收                    | 证据                                                                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01: 派发与配置         | `subagent-dispatch`, `configuration`, `batch-input`, `model`, `settings`, `status`, `queued-ui`, `background-notification` 系统测试, 以及验证图合法性和波次顺序的 graph 组件测试.                                            |
| A02: 已安装项目         | `subagent-readonly` 覆盖被忽略的依赖树, 下方真实模型流程也在已安装依赖的工作树中启动只读子代理.                                                                                                                              |
| A03: 写入与分支         | `subagent-write`, `multiple-writers`, `writer-continuation` 使用真实仓库、工作树、父目录未提交文件、选定依赖分支和清理. Workspace 组件测试覆盖初始化、恢复和保存失败.                                                        |
| A04: 通信               | `subagent-communication`, `mailbox`, `steer-async-input`, `intervention-ui` 和 question-race UI 回归覆盖真实工具调用及草稿保留. Provider 实际收到消息工具说明中的同伴地址.                                                   |
| A05: 取消与失败         | `subagent-lifecycle`, `provider-failure`, `extension-startup`, `steer-finalization`. 真实 gated `prepare-commit-msg` hook 让取消跨越 Git 收尾, 释放前持续 Stopping, hook 错误退出后报告、错误和文件仍可访问.                 |
| A06: 续聊               | `subagent-continuation`, `continuation-boundary`, `writer-continuation`, `restoration` 覆盖保存上下文、执行边界与历史、自有分支、用量和中断恢复.                                                                             |
| A07: 扩展               | `subagent-extensions`, `extension-startup` 覆盖真实选定工具、范围收窄、必需工具启动失败和不支持的子代理 UI.                                                                                                                  |
| A08: 焦点与阅读         | `subagent-keybindings-ui`, `intervention-ui`, `readers-ui`, `transcript-ui`, `ui` 覆盖原生编辑、重映射按键、准确收件人、历史与 Transcript 导航、返回主对话及草稿保留.                                                        |
| A09: 布局与可观测性     | `subagent-fleet-layout` 在 150x50、120x36、80x24 驱动 16 个子代理, 检查 cell 位置、尾部 tokens、溢出和选择. `graph-ui`, `activity-ui`, `queued-ui` 和阅读测试覆盖图溢出、真实工具证据、调度原因和冻结阅读. 下方提供真实截图. |
| A10: 编译宿主和真实模型 | 下方带日期的记录使用编译 Pi、tmux、已安装依赖和真实模型, 包含续聊、问答、停止与恢复及记录恢复.                                                                                                                               |

表中省略 `.test.ts`, 所有系统测试位于 [tests/system](../../../tests/system/). 完整套件结果和独立审查范围记录在 PR. 截图中的模型报告用于证明上下文保留, 不替代执行报告建议的测试.

## 截至 2026-09-21 的验证

本地完整套件通过 231 项, 有 2 项预期跳过, 0 失败, 共 66 个文件、2,033 个断言. 两项异步 steer 用例需要编译宿主, 已在独立 profile 通过. 编译宿主定向批次分别通过 10 项/105 个断言、8 项/69 个断言, 以及 question-race 的 7 个断言. `bun run check` 和 `git diff --check` 通过. 最终 question-race 测试已独立审查并重跑.

## 2026-09-22 实测修复

本轮基线为 `a70080522eede76c7f022f9267747648756adfbd`. 真实使用暴露了内部报告刷屏、面板缺少分隔、耗时只显示秒、问题/任务文字重复和 Activity 难以访问. 修复保留发送给模型的报告, 将编排通知显示为可展开的紧凑摘要, 面向用户的结论由父代理给出. 续聊完成只报告本次执行的任务.

本轮真实流程使用编译 Pi `0.86.1`、Bun `1.4.0`、tmux `3.6a` 和真实 `openai-codex/gpt-6-astra`, thinking 为 low. 设置及记录隔离, 只读项目包含复制的源码和已安装依赖的链接. 在专用 tmux server 中通过箭头、Enter、Esc 和局部字母操作. Terminal Control 使用前述 Ghostty 字体栈, 在 150x50、120x36、80x24 捕获真实 Latte/Mocha 画面.

- 两个同名 explorer 并行提问, 经 Esc 和缩放后回复草稿仍保留, 问题没有重复显示. Reviewer 等两份报告到齐后启动.
- 定向 steering 在 Fleet 显示待处理数量, 由正确的 child 消费. 报告包含两次 steering 的确认标记.
- 续聊、撤回停止确认、确认停止及恢复保留 reviewer 上下文. 历史和 Transcript 可访问. 后续 45 项报告验证分页及直接打开 Activity.
- 第二组工作中, 停止一个 child 没有停止独立同伴. 同伴收到 UI 回复后完成, 被停止 child 的依赖节点跳过.
- 串行链将 `SubagentUI.handleInput` 从第一个 child 传给第二个. Auto-await 直接返回结果, 没有额外后台完成回合.
- Reload 保留记录. 恢复的内置工具证据使用 Pi 公共 renderer factory, 不启动新 child. 最后两次续聊回忆先前发现, 分别返回 `FINAL-REVISION-ACK` 和最终修复 reload 后的 `DELIVERY-CONTEXT-ACK`.

[脱敏执行证据](../../assets/subagents-redevelopment-acceptance/ux-live-run.json)包含三组流程的 13 条执行记录, 其中一条是依赖跳过. 子代理记录费用为 **$0.976440**, 父代理为 **$0.532160**, 属于模型用量统计而非账单. 截图是真实终端输出, 不是生成概念图或原生 Ghostty 窗口. 流程中模型给出的代码判断属于任务输出, 不作为本轮测试结论. 自建终端及 tmux server 已停止, 临时凭据副本已删除.

独立审查复现了完成通知/续聊竞态、切换 Activity 丢失冻结阅读内容、图中文字挤掉名称及指标. 通知修复让续聊等待前次收尾, 每次通知保留自己的任务范围. 回归还覆盖展开后的错误证据和缺失报告措辞. 最终离线全套为 245 通过、2 项编译宿主专用跳过、0 失败, 共 68 文件、2,113 断言. 编译宿主全部 subagent 测试为 66 通过、896 断言, 包含上述跳过项. 最后收紧翻页等待和面板横线断言后, 独立编译宿主复跑为 6 通过、23 断言. 静态检查和 `git diff --check` 通过. 审查范围记录在 PR #103.

![80x24 下单份问题与保留的草稿](../../assets/subagents-redevelopment-acceptance/ux-reply-80x24.png)

![80x24 下列对齐及待处理 steering](../../assets/subagents-redevelopment-acceptance/ux-queued-fleet-80x24.png)

![暗色 120x36 下恢复的原生 Activity 位于长报告前](../../assets/subagents-redevelopment-acceptance/ux-activity-dark-120x36.png)

![暗色 120x36 下保留上下文的最后一次续聊](../../assets/subagents-redevelopment-acceptance/ux-final-detail-dark.png)

## 2026-09-21 真实流程

环境为 Linux, 维护者的 Bun 编译版 Pi `0.86.1`, Bun `1.4.0`, tmux `3.6a`, provider `openai-codex`, 模型 `gpt-6-astra`, thinking `low`. 包的固定 SDK 测试使用 Pi `0.85.1`. 流程运行于已安装依赖的开发工作树, 使用隔离设置、会话存储和专用 tmux server. Server 设置为 `escape-time 10` 并启用 extended keys. 输入只用箭头、Enter、Esc 和局部字母, 不依赖 Alt+A 或功能键区.

1. 父代理并行派出 `lifecycle` 和 `packages`, 再启动依赖二者的 `reviewer`. 三者均完成. 子代理读取当前项目文件, 没有执行旧的 ignored 文件 Git 扫描.
2. 从审查员详情返回主对话, 完成独立的父代理回合, 然后重新打开同一审查员.
3. 续聊要求审查员使用 `ask_parent`, 待答问题显示于详情. 局部回复选择关注保留报告, 后续报告保留了先前发现.
4. 再次续聊提出问题, 内联 Stop 取消该次执行. Resume 继续同一审查员, 明确回忆了原来的发现.
5. `/reload` 恢复三个子代理和审查员历史, 没有再次调用模型. 缩放后明暗主题检查界面和依赖图仍可用.

[脱敏运行证据](../../assets/subagents-redevelopment-acceptance/live-run.json)记录两名调查员各一次执行, 审查员四次执行且始终使用同一个已保存会话. 审查员历史为已完成、已完成、已停止, 当前恢复执行为已完成. 子代理记录费用合计 **$0.731920**, 属于 Pi 的模型用量统计, 不是账户账单, 不包含父对话费用. 自建终端和 tmux server 已停止, 临时凭据副本已删除.

PNG 来自 Terminal Control 的真实 PTY frame, 使用已配置的 Ghostty 字体栈 `JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono`. 它们不是 ImageGen 概念图, 也不是原生 Ghostty 窗口截图. Catppuccin Latte/Mocha 是实际加载的包主题. 截图保留真实终端内容, 没有绘入 UI 文本.

![明亮主题的真实依赖图, 150x50](../../assets/subagents-redevelopment-acceptance/live-graph-light.png)

![暗色主题下保留上下文的恢复审查员, 120x36](../../assets/subagents-redevelopment-acceptance/live-resume-dark.png)

![明亮主题下的恢复审查员, 80x24](../../assets/subagents-redevelopment-acceptance/live-resume-light-80x24.png)

## 复现

```bash
bun run check
bun run test
git diff --check
```

单独的编译宿主 fixture profile:

```bash
PI_TEST_HOST=/absolute/path/to/pi bun test tests/system/subagent-*.test.ts
```

真实模型验证按[子代理](subagents.md#试用源码)加载源码, 使用并行调查后审查的提示, 再执行上述流程. Provider 访问和费用都是真实的. 确定性测试不证明其他 provider 或操作系统兼容.

## 审查与限制

独立只读的代码规范和需求审查均将完整实现与基线比较, 应用必需的可维护性 skill. 审查身份、准确提交和处理结果记录在 PR. 需求审查发现并独立复查了长名称遮挡状态、批量配置位置错误、缺少同伴地址、丢失原生 append-system 指令、完成通知缺失或重复的修复.

这些检查不授权合并或发布. 工具选择不构成沙箱, 依赖仍然共享, 多个写入前序不代表合并了代码基线. 已完成报告可以伴随代码保存失败. 已接受的合同不提供递归委派、自动集成代码或持久化编辑草稿.
