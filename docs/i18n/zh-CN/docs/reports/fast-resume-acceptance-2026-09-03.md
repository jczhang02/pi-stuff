<!-- translation-source: docs/reports/fast-resume-acceptance-2026-09-03.md; translation-source-sha256: 3cff5f9519584c84b9006ebb9e3b877981647929360cb457a4fb7015b0ff4e1a -->

# Fast Resume 验收——2026-09-03

本报告记录 Fast Resume 在认证 Pi 0.84.4 发布制品上的最终性能、原生 UI 一致性与真实 Host 验收证据。当前
行为以 [Capability 指南](../capabilities/fast-resume.md)和 [ADR 0026](../adr/0026-add-fast-resume.md)为准。

## 测量边界

延迟从交互式 `/resume` 的提交 Enter 到达 Pi 开始，到 Pi 原生选择器显示完整、稳定且可选择的 Current
Folder 列表为止。原生组件不发布局部列表，因此首次可选择与 Current 完整列表是同一个边界。

测试工具每 5 ms 轮询一个隔离的 tmux socket，并启用 `extended-keys=on` 与
`extended-keys-format=csi-u`。测试使用 SHA-256 为
`ce91e1f8bff6176c6a23a690bd0bc4c6e1f5bee1b1183cd2a3b1e92d88c9038a` 的认证 Linux x64 可执行文件。
生成的语料不含私有 Session 内容，测试工具只保留汇总计时与一致性计数。

每个计时变体先预热一次，再交替运行 20 次，即原生与 Fast Resume 各 10 次。测试未清理页缓存；每组仅
有 10 个样本，因此 P95 等于该组最大值。

## 确定性代表语料

真实 Host 测试工具生成了 75 个有效 Session，共 432,016,397 字节。大型 Assistant 条目使 Pi 原生
loader 处理具有代表性的字节量，而 Fast Resume 只读取有界的列表行元数据。

| 变体 | Current 完整列表中位数 | Current 完整列表 P95 |
| --- | ---: | ---: |
| Pi 原生 `/resume` | 1,003.6 ms | 1,181.3 ms |
| Pi Stuff Fast Resume | 96.3 ms | 119.0 ms |

按中位数计算，Fast Resume 得到完整可选列表的速度约为原生的 10 倍，并保持在登记的 300 ms P95 门槛
以内。

## 原生 UI 与行为

测试工具在匹配的 fixture 上比较了原生 Pi 与 Fast Resume 的完整可见选择器 cell 和 ANSI 样式。四种
场景的 cell 差异与 ANSI 差异均为零：深色 120×40、浅色 120×40、深色 64×40，以及深色 120×16。

同一次认证 Host 运行还验证了交互式 `/resume`、配置后的 Host resume action、重复 reload 与设置切换、
关闭拦截时带初始查询的 `/fast-resume`、可选独立快捷键、启动阶段 `--resume` 隔离、Current 与 All
scope 控制、排序与 Named 过滤、路径显示、选择、重命名、当前 Session 删除保护、确认删除后的刷新，以及编辑器恢复。

## 消融

挂载 Pi 导出的 `SessionSelectorComponent` 后，平行选择器实现及其重复的 controller、dialog、搜索、
Session model 和 mutation workflow 均被移除。Fast Resume 生产 TypeScript 从 2,204 个物理行降至 872 行
（减少 1,332 行，即 60%）；聚焦测试从 895 行降至 506 行（减少 389 行，即 43%）。剩余 Module 只负责
设置、有界 Session 加载、Effect operation owner、认证拦截 adapter，以及原生组件挂载。

## Capability 合同结果

| 合同 | 结果 |
| --- | --- |
| `fast-resume.selector` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` |
| `fast-resume.navigation` | `normal=pass; failure=pass; recovery=pass; boundary=pass` |
| `fast-resume.mutations` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` |
| `fast-resume.host-integration` | `normal=pass; failure=pass; recovery=pass; persistence=pass; boundary=pass` |
| `fast-resume.latency` | `normal=pass; failure=pass; recovery=pass; boundary=pass` |

## 结果

Fast Resume 在认证制品上通过了延迟、原生 UI 一致性、生命周期、mutation、入口、设置和响应式真实 Host
门槛。本基准不声称支持完整历史搜索或精确的局部读取元数据；这些仍是 Capability 文档中明确说明的
边界。
