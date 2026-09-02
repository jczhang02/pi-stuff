<!-- translation-source: docs/reports/fast-resume-acceptance-2026-09-03.md; translation-source-sha256: 1a92b84b1e71d712f3412d957bafc46cddf321decc12e48b190a995bb4134a0a -->

# Fast Resume 验收——2026-09-03

本报告记录 Fast Resume 在认证 Pi 0.84.4 上的最终性能与真实 Host 验收证据。当前行为以
[Capability 指南](../capabilities/fast-resume.md)和 [ADR 0026](../adr/0026-add-fast-resume.md)为准。

## 测量边界

延迟从交互式 `/resume` 的提交 Enter 到达 Pi 开始，到 Current Folder 首个完整、稳定且可选择的列表为止；
另行记录 Fast Resume 第一帧出现的时间。测试工具每 5 ms 轮询一个隔离的 120×40 tmux pane，并启用扩展
CSI-u 按键。

私有语料通过一个临时目录提供给基准进程，其中包含只读符号链接和一个临时活动 fixture。测试没有选择、
重命名、删除或修改任何 Session。工具只保留数量、字节总量和计时值，没有保留私有 Session 名称、消息、
终端捕获或截图。

每个变体先预热一次，再交替运行 20 次，即原生与 Fast Resume 各 10 次。测试未清理页缓存；每组仅有
10 个样本，因此 P95 等于该组最大值。

## 真实本地语料

镜像后的当前项目语料包含 81 个 Session，共 467,675,212 字节。

| 变体 | 首帧中位数 | 首帧 P95 | Current 完整列表中位数 | Current 完整列表 P95 |
| --- | ---: | ---: | ---: | ---: |
| Pi 原生 `/resume` | — | — | 1,579.5 ms | 1,676.3 ms |
| Pi Stuff Fast Resume | 47.2 ms | 54.9 ms | 49.2 ms | 59.5 ms |

按中位数计算，Fast Resume 得到完整可选列表的速度约为原生的 32 倍，并满足首帧 P95 不超过 100 ms、
完整列表 P95 不超过 300 ms 的登记门槛。

## 确定性代表语料

仓库中的真实 Host 测试工具还生成了 75 个有效 Session，共 432,000,000 字节。大型 Assistant 条目使
Pi 原生选择器处理具有代表性的字节量，而 Fast Resume 只读取列表行所需的元数据。

| 变体 | 首帧中位数 | 首帧 P95 | Current 完整列表中位数 | Current 完整列表 P95 |
| --- | ---: | ---: | ---: | ---: |
| Pi 原生 `/resume` | — | — | 644.5 ms | 675.8 ms |
| Pi Stuff Fast Resume | 47.5 ms | 53.7 ms | 49.0 ms | 55.6 ms |

同一测试还在真实深色和浅色 Host 主题下验证了交互式 `/resume`、配置后的 Host resume action、连续两次
reload、关闭拦截时带初始查询的 `/fast-resume`、可选独立快捷键、启动阶段 `--resume` 隔离，以及宽、
窄、低三种 Command Dialog 布局。

## 结果

Fast Resume 在认证制品上通过了延迟、生命周期、入口、设置和响应式真实 Host 门槛。本基准不声称支持
完整历史搜索或精确的局部读取元数据；这些仍是 Capability 文档中明确说明的边界。
