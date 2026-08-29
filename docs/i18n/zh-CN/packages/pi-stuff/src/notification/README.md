<!-- translation-source: packages/pi-stuff/src/notification/README.md; translation-source-sha256: d13b671d6f4a9c1c828c1b9b8f040312bdc0b33a5ec41f47ad9e8e26aa4036b0 -->

# Notification 能力

Notification 只会在用户启动的 Agent 工作稳定、达到配置的最短时长，并且 Pi 在宽限期内持续安静后，发送延迟的终端原生完成或失败提醒。用户或终端输入会取消待发提醒。扩展自动发起的工作不会创建提醒。

`/notifications` 打开共享全宽命令对话框，可启用提醒、选择 `auto`、Kitty OSC 99、OSC 9、Ghostty OSC 777 或 BEL 传输、控制响应预览与终端 BEL，并发送测试提醒。响应预览默认关闭，因为桌面通知历史可能在 Pi 之外可见。在 tmux 中，`Tmux notification` 是注意 BEL 的唯一权威。开启后会保留受支持的系统通知协议并增加一个原始 BEL；如果 `auto` 无法识别视觉协议，则回退到 BEL。关闭后仍保留受支持的系统通知，同时抑制 BEL，包括显式 `bell` 传输。tmux 继续负责标记外观和聚焦时清除。

设置位于 `<agentDir>/pi-stuff.json` 的 `notification` 命名空间。加载是只读的；旧版 `pi-stuff-notification.json` 文件只通过有文档记录的一次性迁移提升。传输是观察性的：不受支持的终端或写入失败会报告有界诊断，绝不会使 Agent 工作失败。
