# RTK UI 审查截图

[English](../../rtk-review-evidence.md)

截图复现 `ff92ddd787023d36e919adab7e2babadd355b7a7` 的五项 UI 问题. 后续修复轮次只改非 UI 行为, 以下问题仍未解决. 这些是缺陷证据, 不是已接受的设计.

环境: Linux, 编译版 Pi 0.85.1, Bun 1.4.0, RTK 0.45.0, Pi 深色主题, 字体为 `JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono`. 图片由真实 Pi 会话通过 Terminal Control 导出, 不是桌面窗口截图或重绘稿. 配置、HOME 和统计均隔离. History 使用实际 RTK 记录; 失败报告和延迟错误使用受控进程 fixture. 静态截图不能单独证明按键效果, 下文同时记录实际操作结果.

## 1. History 的部分记录和命令无法查看

准备十条记录, 打开 Usage / History. 100x30 能显示全部十条; 缩至 56x26 后只剩八条, 命令也被截断, 没有翻页入口查看隐藏记录.

![100x30 的 History](../../assets/rtk/review/issue-1-history-100x30.png)

![56x26 的 History](../../assets/rtk/review/issue-1-history-56x26.png)

## 2. 小终端退出提示未跟随按键设置

将取消键改为 Ctrl+G, 在 45x20 打开 RTK, 再按 Escape. 界面写着 `Esc close`, 但并未关闭; Ctrl+G 可以关闭.

![按 Escape 后仍停留在提示页](../../assets/rtk/review/issue-2-remap-escape-still-open.png)

## 3. Failures 提示的 PageDown 不起作用

在 56x26 打开多页失败报告 fixture. 按 PageDown 后仍显示 command-01 至 command-04; 改按 `]` 才滚动至 command-05 至 command-12.

![按 PageDown 后](../../assets/rtk/review/issue-3-failures-after-pagedown.png)

![按右方括号后](../../assets/rtk/review/issue-3-failures-after-right-bracket.png)

## 4. 失败原因被横向截断

同一条失败记录在 160x30 能看见原因. 缩至 56x26 后只显示到 `--porc...`, 原因被隐藏, 没有换行或横向查看入口.

![完整失败记录](../../assets/rtk/review/issue-4-failures-longline-160x30.png)

![窄屏截断后的记录](../../assets/rtk/review/issue-4-failures-longline-56x26.png)

## 5. 离开页面后仍收到旧请求的错误

启动延迟的 overview 请求, 切换到 Settings, 再让旧请求失败. 用户已经离开原页面, Settings 上方仍出现旧 overview 的错误通知.

![Settings 上方出现旧 overview 错误](../../assets/rtk/review/issue-5-pending-overview-notification-on-settings.png)
