# Subagent UI 决策审查

[English](../../subagents-redevelopment-ui-review.md). 以英文版为准.

Method: dual-agent (A: `/root/ui_spec_design_review` · B: `/root/ui_spec_native_review`). 日期: 2026-09-21. 对象为 `8520e4e303f46b0caa3ebcf9ca8db5788882e93c` 的 UIR01-UIR09 决策, 包含维护者随后对 UIR09 的接受. 使用 Impeccable 审查决策和静态概念图, 再核对源码, 不作为重新开发后的运行验收.

## 判断

保留视觉方向. 这套界面明确服务 Pi: 主对话保留, 底部用于查看, 先看到有用内容再深入证据. Claude 随焦点变化的帮助和详情信息顺序值得参考. 再增加宿主会话、overlay 框架或分类管理面板, 对已接受流程没有帮助.

主要缺口在实现契约, 不是视觉风格. 通过[正式规格](subagents-redevelopment-spec.md)补齐, 再用真实 Pi 宿主验证产品.

## 补齐前的设计评分

| 项目           | 分数 / 4 | 发现                               |
| -------------- | -------: | ---------------------------------- |
| 状态可见性     |        3 | 详情清楚, 紧凑状态仍需统一规则     |
| 符合用户任务   |        4 | 发现、问题及结果优先级正确         |
| 控制与退出     |        3 | 保留草稿及退出, 入口优先级不完整   |
| 一致性与惯例   |        3 | 希望使用原生绑定, 组件边界仍需明确 |
| 防止错误       |        3 | 目标检查和停止确认已定义, 尚未执行 |
| 识别优于记忆   |        2 | Info/历史/transcript 路径未完成    |
| 灵活与效率     |        3 | 键盘路径短, 完整焦点图仍待补齐     |
| 简洁与层次     |        3 | 主内容清楚, 操作帮助需分组         |
| 错误诊断与恢复 |        3 | 区分原因、已有工作和可用动作       |
| 帮助与文档     |        3 | 焦点帮助合理, 辅助阅读页缺少契约   |
| 总分           |    30/40 | 基础良好, 不作为运行质量分数       |

不宣称修改后分数提高. 写出更完整的规格, 不能证明 UI 已经可用.

## 优点和认知负担

- 同一详情优先显示最新有用回复、问题、失败或报告, 没有恢复被否定的分类目录.
- Message、Reply、Resume、Follow-up 共用局部输入, 同屏保留收件人和依据. 不把入队写成理解或遵从.
- Done 和 Commit failed 可以并存, 分别表达模型报告、Git 保存与父目录集成这些不同事实.

操作提示的负担中等: 部分图有五个并列动作. 按顺序和间距区分介入、阅读、返回即可; 为控制数量另加菜单会拖慢常用操作. 最弱的体验在续聊后: 没有清楚历史入口时, 用户可能以为旧工作被覆盖. 正式阅读契约补齐了这一点.

## 优先发现和处理

| 优先级 | 问题及影响                                                        | 正式规格中的处理                                                                               | 对应 skill 动作        |
| ------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------- |
| P1     | 编辑器/FleetView 入口和折叠动作归属模糊, 可能抢走历史或补全       | 原生输入优先, 未消费的边缘入口, 完整焦点表, 局部 Prompt/Activity 动作, 固定 Esc 和真实绑定提示 | `$impeccable clarify`  |
| P1     | Info、Transcript 和历史没有完整路径, 旧报告可能不可达             | 一页 Info、原生风格历史列表、只读历史报告、按时间 transcript 及恢复来源的返回                  | `$impeccable clarify`  |
| P1     | 固定概念画布不能保证内容增长后的输入/帮助可见                     | 有界底部、固定身份/帮助、正文分页、稳定阅读锚点、选中项可见和真实 resize 验收                  | `$impeccable harden`   |
| P1     | "复用原生" 可能错误承诺公共扩展输入不能提供的 footer/查看器       | 复用公开编辑/渲染/按键/主题, 隔离必要 footer 适配; 禁止伪造 AgentSession 和访问私有容器        | `$impeccable document` |
| P2     | 不同界面状态与指标语义不一致, Waiting 隐藏原因、Done 隐藏提交失败 | 共用状态映射, 本次输出指标, 缺值不编造零, 错误先于可选指标                                     | `$impeccable clarify`  |

这些作为规格缺口关闭, 不表示产品已经修复. 正式中英文草稿的独立复核又发现三个 P2: 正常 Git 收尾不能叫 Stopping, 当前详情分页也须防止内容被新回复替换, 终态 child 必须可重新打开. 规格已区分普通/停止收尾、保留所有分页内容锚点, 并将终态行保留在当前父会话的 retained run 集合中. 验收表已包含对应过程. 最终产品润色仍属于实现验证.

## Pi 原生复用及限制

固定 Pi 0.85.1 公开导出 `CustomEditor`、Pi TUI 的 `Editor`、原生用户/助手/工具组件、Markdown、语义主题和字符宽度工具. 按本来职责复用. 本功能仍负责收件人绑定、本次 request 选择、有界阅读、FleetView 和图布局, 原生导出不会自动提供这些产品语义.

有两个关键限制:

1. `belowEditor` widget 位于 footer 前. FleetView 要在 statusline 下方, 必须组合 footer.
2. 导出的 `FooterComponent` 需要完整 AgentSession, 扩展 footer factory 只有 TUI、theme 和只读 footer provider. 文档提供的 context 有 usage entries、context usage 和模型信息. 使用这些值做小型适配合理, 不能把残缺 context 当完整 session.

通用 custom component 不保证自动移除主界面所有底部组件. 使用公共 editor/footer 接口, 在真实宿主验证. 主 statusline 契约指 cwd/model/usage footer. Pi 其他 pending/status 行和无关扩展 widget 不属于本功能; `setWorkingVisible(false)` 只控制 working 指示. 规格已明确这一区别并计算其占用空间. 图片不能成为修改私有字段、复制编辑器引擎或虚构 agent 切换的理由. 组合后仍须保留其他扩展 status、主编辑器历史和补全.

来源: [Pi 扩展契约](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/extensions/types.ts)、[公共组件导出](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/modes/interactive/components/index.ts)、[footer](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/modes/interactive/components/footer.ts)、[宿主组合](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/modes/interactive/interactive-mode.ts)、[按键绑定](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/tui/src/keybindings.ts).

## Harness 借鉴

- **Claude Code FleetView:** 采用真实 CLI 中列表获得焦点后在上方显示帮助的方式, 区分键盘焦点与活动会话身份. 借鉴位置, 不复制它独立的指针/会话标记. 证据: [固定 CLI 调研及截图](https://github.com/jczhang02/pi-stuff/blob/42fe5afa96caf31a255b76ac6ec751999fc10413/docs/claude-subagent-ui-research.md).
- **Claude Agent View:** 最新输出或待答问题使预览立即有用, 支持当前详情顺序. Agent View 管理独立后台会话, 可以 attach, 与 subagent FleetView 不是同一个界面. 不引入其宿主 attach 机制. 证据: [官方 peek/reply 文档](https://code.claude.com/docs/en/agent-view#peek-and-reply), 2026-09-21 重新核对.
- **arhen:** 保留真实依赖和真实任务结果. 独立工作平铺, 串行/DAG 使用图. 同一源码也提供 UI 所需通信、停止、失败和 Git 结果区别. 证据: [graph](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/graph.ts)、[manager](https://github.com/arhen/pi-extensions/blob/676b11eb415cd46fbede712b5bbb075ff3f043bf/packages/core/pi-core-subagent/src/manager.ts).

- **Codex:** 统一行列、窄屏省略次要元数据、保持所选项可见、根据配置生成帮助, 都是可用的实现方式. 采用这些规则, 不复制整行高亮、侧栏或宿主任务切换. 固定 `4ca8e7afff4803ca98fa4d0f94bcd7dd4ccf2646` 证据: [行布局](https://github.com/openai/codex/blob/4ca8e7afff4803ca98fa4d0f94bcd7dd4ccf2646/codex-rs/tui/src/app/agent_center/rows.rs)、[局部帮助](https://github.com/openai/codex/blob/4ca8e7afff4803ca98fa4d0f94bcd7dd4ccf2646/codex-rs/tui/src/app/agent_center/hints.rs)、[详情优先级](https://github.com/openai/codex/blob/4ca8e7afff4803ca98fa4d0f94bcd7dd4ccf2646/codex-rs/tui/src/app/agents_overview_details.rs).

先前 Cursor review 链接现在跳转到文档首页. 保留为历史灵感, 不作为精确的当前证据; 没有规格条款依赖它.

## 使用者检查和细节

- **Alex, 熟练键盘用户:** 编辑器上下、历史和补全先处理, 再进入 FleetView. 展开动作及当前目标必须可从局部帮助发现.
- **Sam, 键盘/低视力用户:** 形状和文字提供非颜色线索, 但概念图浅色帮助不证明对比度合格. 验证真实 Pi 明暗/自定义主题和终端字形.
- **Riley, 中断/边界使用者:** 验证父回答与人类草稿竞争、阅读第二页时到达新输出、提交失败后继续交办. 必须保留正确文字和目标, 不能悄悄在别处成功.

工具轨迹统一叫 Activity, 继续交办统一用 follow-up. 产品文字保持英文. 更新 UIR09 接受状态, 原始图片生成提示词作为历史输入保留.

## 证据限制

A 在没有 detector 结果时阅读约定文档、十张代表概念图和两张较早真实 Pi 截图. B 独立执行 bundled detector, 并用 Bun import probe 验证公共导出. 原生 `ScrollView` 可提供滚动机制, 本功能仍负责阅读锚点及 request 分界. 公共键位 helper 是 `keyText`、`keyHint` 和 `rawKeyHint`, 不包含内部 `keyDisplayText`. 已安装 detector engine 报告 4.0.0, skill 文件报告 4.2.2, 本轮均未更改. Detector 退出码 0, 结果 `[]`: Markdown 决策目标没有命中规则. 这不能证明终端布局、键盘或可访问性通过. A 完成后, B 发现才进入父上下文综合.

没有运行中的重开发 DOM 可供检查或注入, 未启动浏览器 overlay 或 live detector server. 以静态图、已安装 Pi 声明/源码及固定 harness 证据核对; 实际宿主交互及新截图仍由 A08-A10 实现验收完成. 不将旧实现测试重复当作新版本证据.

两位独立审查者已复核最终文档修改, 无剩余发布阻断. 实际宿主组合、重映射、resize 和并发更新仍属于实现验收, 不作为已完成工作.

Questions skipped: 维护者已批准全部推荐, 要求直接整合正式规格, 不再访谈.
