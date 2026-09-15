# RTK UI 审查截图

[English](../../rtk-review-evidence.md)

`99b7edf59aec91a692742e5e7ae9d3f055b97bd7` 之后的 UI 修复解决了下述五项问题. 原截图保留为修复前证据, 不是已接受的设计.

环境: Linux, 编译版 Pi 0.85.1, Bun 1.4.0, RTK 0.45.0, Pi 深色主题, 字体为 `JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono`. 图片由真实 Pi 会话通过 Terminal Control 导出, 不是桌面窗口截图或重绘稿. 配置、HOME 和统计均隔离. 上轮修复的 History 使用实际 RTK 记录, 失败报告和延迟错误使用受控进程 fixture. 本轮数据来源另列于下方. 静态截图不能单独证明按键效果, 下文同时记录实际操作结果.

## 短页面收紧

`ab0f97f` 后的修正移除了所有页面统一 22 行的下限. 编译 Pi 取图中, 根菜单为 15 行, Settings 在 100 列下为 18 行、56 列下为 19 行, Usage 和 Diagnostics 仍采用 22 行报表预算. 路径编辑使用紧凑页面与一个固定反馈行. 根页摘要和 Settings 说明只预留同页更新所需空间, 完整错误仍在 Pi 通知中显示.

最终取图覆盖根页、Settings、Usage, 内置浅深主题与 100x30、56x26 两种尺寸, 共 12 个状态. 配置和统计均为隔离 fixture. 首轮窄屏导出捕获了 resize 前旧帧的裁剪结果; 最终取图等待重排后的标题/版本出现再导出. 字体栈同上, 浅色使用白底, 深色使用 Pi 深色背景. 下方所有页面均为 22 行的描述属于历史版本, 不代表当前短页布局.

![浅色紧凑根页](../../assets/rtk/review/compact-root-light.png)

![深色窄屏紧凑根页](../../assets/rtk/review/compact-root-dark-narrow.png)

![浅色窄屏设置页与换行说明](../../assets/rtk/review/compact-settings-light-narrow.png)

## 顶部选择区与浅色对比度

下方修改前截图对应 `9771ed0`, 修改后截图对应其后的顶部选择区修复. 每组使用相同的 100x30 尺寸、数据、字体和白色终端背景. Scope/View 移至报告上方, 当前设置项说明仍可见, 分页在数据下方, 快捷键帮助固定在底部. 移除 Display 标题后, 同样的 22 行面板增加两行报告空间.

内置 light 的局部修正让强调色/成功色/警告色对白底的对比度从 4.34/4.32/4.33 提升到 6.40/6.36/6.15. 弱化文字从 4.54 提升到 5.25. 修正后的颜色对 #f8f8f8 背景也均超过 4.5. 这是配色数值验证, 不代表任意终端背景、字体栅格化或自定义主题均已验收. 深色主题及带来源元数据的自定义主题不变. 缺少来源元数据且名为 `light` 的内存主题无法与内置主题区分, 匹配原前景色序列的部分也会被修正. 最终 Pi 取图覆盖浅色和深色各 15 个 Usage 状态, 包括窄屏分页, 全部保持 22 行.

| Daily 修改前                                                    | Daily 修改后                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| ![Daily 修改前](../../assets/rtk/review/light-daily-before.png) | ![Daily 修改后](../../assets/rtk/review/light-daily-after.png) |

| Failures 修改前                                                       | Failures 修改后                                                      |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| ![Failures 修改前](../../assets/rtk/review/light-failures-before.png) | ![Failures 修改后](../../assets/rtk/review/light-failures-after.png) |

![浅色窄屏](../../assets/rtk/review/light-narrow-after.png)

![深色顶部选择区](../../assets/rtk/review/dark-top-controls-after.png)

## 上轮修复: 结构化报告与固定表头

`4040b986add263aa1cbb9c90c77513becc901ba6` 之后的修复让 Daily、Weekly、Monthly 和 History 每页保留标题与列名. Failures 将原生报告解析成汇总、最近记录和高频命令, 各分区每页保留自己的表头. 强调色标题、绿色节省量与回退成功、红色回退失败、弱化时间戳用于区分含义, 同时保留文字标识.

最终编译版 Pi 验收检查了 100x30 和 56x26 下的 15 个取图状态, 面板均为 22 行. 周期和 History 使用受控 fixture; Failures 逐字节回放隔离数据库导出的 RTK 0.45.0 原生报告, 包含 15 次失败、60% 回退成功. 图片是真实 Pi 终端导出, 不是个人使用数据. RTK 原生报告不提供错误原因, 且会截断命令, 扩展不能恢复已省略文本. 解析测试验证了多行命令中的空行和缩进保留.

![保留表头的 Daily 第 2 页](../../assets/rtk/review/structured-daily-page2.png)

![Weekly 第 2 页](../../assets/rtk/review/structured-weekly-page2.png)

![Monthly 第 2 页](../../assets/rtk/review/structured-monthly-page2.png)

![History 第 2 页](../../assets/rtk/review/structured-history-page2.png)

![解析后的最近失败记录](../../assets/rtk/review/structured-failures-recent.png)

![高频命令末页](../../assets/rtk/review/structured-failures-top-last.png)

## 上轮修复, 尚未采用结构化报告

根页、Settings、Usage 和 Diagnostics 均保持 22 行高度. 报告换行后通过 `[` / `]` 翻页, 不再撑大面板. Esc 返回或退出, 即使 Pi 取消键映射为 Ctrl+G 也不变; Ctrl+G 不退出 RTK. 功能快捷键和稳定面板尺寸已记录到 [design.md](design.md).

下图为 56x26 下原生 History 第 2 页, 隔离 RTK 0.45.0 的十条记录均可访问. 长命令 fixture 另行验证跨页文本完整保留; 原生 RTK 已省略的文本无法恢复.

![原生 History 末页](../../assets/rtk/review/fixed-history-last-56x26.png)

上轮修复对超过 240 字符的失败原文换行分页. 下图是历史证据, 已由上方的结构化报告替代. 当时 fixture 含有类似原因的长文本, 并非原生 RTK 输出的错误原因字段.

![失败报告末页](../../assets/rtk/review/fixed-failures-last-56x26.png)

从根页进入 Settings 会取消待完成的 overview 进程. 延迟错误用例确认其完成标记和通知均未出现. Settings 为探测和保存状态预留空间, 控件不再移动.

![取消根页查询后的 Settings](../../assets/rtk/review/fixed-stale-root-settings.png)

验收测量了 100x30 和 56x26 下的 23 个页面状态, 高度均为 22 行. 按键操作覆盖分页边界、History/失败原因/配置长文本尾部, 以及 45x20 下的 Esc 和重映射 Ctrl+G. 静态截图本身不证明这些交互.

取图修正: 首张窄屏 overview 在 resize 后立即导出, 捕获了终端裁剪的旧画面. 无按键采样确认约 50 ms 后自然重排正确, 持续至 3 秒, 使用说明已换成正确截图. 该诊断脚本最后的可选 reopen 步骤超时, 因此不计为整轮 E2E 通过.

## 原始问题

### 1. History 的部分记录和命令无法查看

准备十条记录, 打开 Usage / History. 100x30 能显示全部十条; 缩至 56x26 后只剩八条, 命令也被截断, 没有翻页入口查看隐藏记录.

![100x30 的 History](../../assets/rtk/review/issue-1-history-100x30.png)

![56x26 的 History](../../assets/rtk/review/issue-1-history-56x26.png)

### 2. 小终端退出提示未跟随按键设置

将取消键改为 Ctrl+G, 在 45x20 打开 RTK, 再按 Escape. 界面写着 `Esc close`, 但并未关闭; Ctrl+G 可以关闭.

![按 Escape 后仍停留在提示页](../../assets/rtk/review/issue-2-remap-escape-still-open.png)

### 3. Failures 提示的 PageDown 不起作用

在 56x26 打开多页失败报告 fixture. 按 PageDown 后仍显示 command-01 至 command-04; 改按 `]` 才滚动至 command-05 至 command-12.

![按 PageDown 后](../../assets/rtk/review/issue-3-failures-after-pagedown.png)

![按右方括号后](../../assets/rtk/review/issue-3-failures-after-right-bracket.png)

### 4. 失败 fixture 文本被横向截断

同一条 fixture 在 160x30 能看见类似原因的后缀. 缩至 56x26 后只显示到 `--porc...`, 后缀被隐藏, 没有换行或横向查看入口. 此 fixture 不能证明原生 RTK 提供错误原因.

![完整失败记录](../../assets/rtk/review/issue-4-failures-longline-160x30.png)

![窄屏截断后的记录](../../assets/rtk/review/issue-4-failures-longline-56x26.png)

### 5. 离开页面后仍收到旧请求的错误

启动延迟的 overview 请求, 切换到 Settings, 再让旧请求失败. 用户已经离开原页面, Settings 上方仍出现旧 overview 的错误通知.

![Settings 上方出现旧 overview 错误](../../assets/rtk/review/issue-5-pending-overview-notification-on-settings.png)
