# RTK UI 审查截图

[English](../../rtk-review-evidence.md)

`99b7edf59aec91a692742e5e7ae9d3f055b97bd7` 之后的 UI 修复解决了下述五项问题. 原截图保留为修复前证据, 不是已接受的设计.

环境: Linux, 编译版 Pi 0.85.1, Bun 1.4.0, RTK 0.45.0, Pi 深色主题, 字体为 `JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono`. 图片由真实 Pi 会话通过 Terminal Control 导出, 不是桌面窗口截图或重绘稿. 配置、HOME 和统计均隔离. History 使用实际 RTK 记录; 失败报告和延迟错误使用受控进程 fixture. 静态截图不能单独证明按键效果, 下文同时记录实际操作结果.

## 修复后行为

根页、Settings、Usage 和 Diagnostics 均保持 22 行高度. 报告换行后通过 `[` / `]` 翻页, 不再撑大面板. Esc 返回或退出, 即使 Pi 取消键映射为 Ctrl+G 也不变; Ctrl+G 不退出 RTK. 功能快捷键和稳定面板尺寸已记录到 [design.md](design.md).

下图为 56x26 下原生 History 第 2 页, 隔离 RTK 0.45.0 的十条记录均可访问. 长命令 fixture 另行验证跨页文本完整保留; 原生 RTK 已省略的文本无法恢复.

![原生 History 末页](../../assets/rtk/review/fixed-history-last-56x26.png)

失败报告保留超过 240 字符的行, 换行后分页. 末页截图显示最后一条记录; 操作验收另外访问了前一页中的长原因尾部.

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

### 4. 失败原因被横向截断

同一条失败记录在 160x30 能看见原因. 缩至 56x26 后只显示到 `--porc...`, 原因被隐藏, 没有换行或横向查看入口.

![完整失败记录](../../assets/rtk/review/issue-4-failures-longline-160x30.png)

![窄屏截断后的记录](../../assets/rtk/review/issue-4-failures-longline-56x26.png)

### 5. 离开页面后仍收到旧请求的错误

启动延迟的 overview 请求, 切换到 Settings, 再让旧请求失败. 用户已经离开原页面, Settings 上方仍出现旧 overview 的错误通知.

![Settings 上方出现旧 overview 错误](../../assets/rtk/review/issue-5-pending-overview-notification-on-settings.png)
