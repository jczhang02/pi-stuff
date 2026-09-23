# Statusline 实施决策

[English](../../statusline-spec.md) · 英文为准.

设计访谈进行中. 本文记录已接受的决策, 还不是完整实施合同. 维护者确认共同理解后才开始正式实现.

## 已接受

- 沿用 `59589c467215ec7394b36c2f60cea27e522316ad` 的双行原型: 第一行左目录/ctx/hit、右 Git; 第二行左模型/思考强度. 其他状态字段放第二行右侧, 让位于必要的 Git 重排.
- 默认启用自定义 statusline, 提供恢复原生 footer 的开关. 首版不增加逐字段配置.
- Git 覆盖分支或 detached HEAD 身份、暂存/修改/未跟踪/冲突文件数、领先/落后提交数, 以及 rebase/merge 等进行中的操作. 窄屏优先保留身份、操作和冲突信息, 可选 ctx 统计退让.
- ctx 百分比仍为已用 token / 模型窗口容量. 自动 compact 开启时, T = 窗口容量 - 当前模型生效的 reserveTokens: 低于 0.9T 使用强调色, 从 0.9T 起使用警示色, 从 T 起使用错误色. 自动 compact 关闭时, 从窗口容量的 80% 起警示、90% 起错误色. 百分比和已用进度条同色, 切换模型或生效配置变化后更新阈值.
- 不开发新的 goal 或账号用量 provider.

## 待决策

ctx/cache hit 统计口径; compact 配置无效或不可取得时的处理; 缺失或过期数据; Git 刷新与失败状态; 第三方字段兼容和 footer 所有权; 配置及验收细节.

## 跟踪

[正式实施 Issue #117](https://github.com/jczhang02/pi-stuff/issues/117), Beads `pi-stuff-wv0`. [原型 #110](https://github.com/jczhang02/pi-stuff/issues/110) 与[草稿 PR #111](https://github.com/jczhang02/pi-stuff/pull/111) 单独保留. 本文不代表正式实现或合并已经完成.
