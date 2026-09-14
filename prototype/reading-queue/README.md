# Reading queue prototype

A throwaway example of using Terminal Control with a real Pi interface. The three articles are sample data; read/unread state is kept only in memory. No model or network request is needed.

## Run it yourself

From this worktree's root:

```bash
bun run tui run reading -- bun prototype/reading-queue/run.ts
```

In Pi, type `/reading` and press Enter. Use the arrow keys to choose an article, then Enter to confirm. Escape cancels. Reopen `/reading` to see the changed read status. At the empty Pi editor, Ctrl+D exits.

The launcher isolates settings and sessions in a temporary directory, copies only the configured theme name, and uses fullscreen Pi. It removes the directory on normal exit. Built-in themes work; custom theme files are not copied. A forced kill can require manual cleanup of the printed temporary Pi directory.

## Let an agent control the same session

Keep the foreground terminal running. From another terminal in the same worktree, these commands target that same `reading` session:

```bash
bun run tui show reading
bun run tui send reading text:/reading enter
bun run tui wait reading 'Unread -'
bun run tui send reading down enter
bun run tui save reading --format png --out /tmp/reading.png
```

The agent sees the current terminal screen, sends input and checks the result. You can use the foreground terminal's normal keyboard controls. Coordinate turns so simultaneous input does not interfere. `run` follows the size of your terminal; it cannot later be attached from a detached session.

For agent-only work, replace `run reading` with `start reading-check --cols 122 --rows 36`. The background session can be resized with `bun run tui resize reading-check --cols 80 --rows 24`. Use `send ... ctrl-d` for normal Pi exit; `stop` terminates a stuck owned session.

CUA is unnecessary for this example. Captures show the terminal grid, not a native window/font rendering guarantee. TC 1.2.1 PNG output uses a dark default background, which gives the current Pi light theme poor contrast. Use text snapshots for interaction checks; this capture is not evidence of native theme fidelity.

## 中文

这是展示 TC 用法的临时原型, 使用真实 Pi 的选择和确认组件. 三篇文章是样例数据, 已读状态仅保存在内存, 不调用模型或网络.

在工作树根目录运行上面的 `run reading` 命令, 然后输入 `/reading`. 用方向键和 Enter 选择、确认, Escape 取消. 再次打开列表可以看到状态变化; 回到空编辑器后用 Ctrl+D 退出.

你使用前台终端, agent 用同名会话的 `show/send/wait/save` 读取和操作同一个界面. 双方轮流操作即可, 不必反复传截图. 前台尺寸跟随你的终端, 不支持事后 attach. 只有 agent 操作时用 `start`, 需要一起看时从一开始就用 `run`.

启动文件隔离临时数据并复制当前主题名称, 正常退出会清理目录. 自定义主题文件没有复制; 强制终止可能需要手动清理 Pi 显示的临时目录. 本例不需要 CUA, 截图只证明终端网格内容. TC 1.2.1 的 PNG 默认背景偏暗, 与当前 Pi light 主题搭配时对比度较低. 交互验证使用文本快照, 配色不能以这张截图作为原生终端验收依据.
