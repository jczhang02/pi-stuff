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
bun run tui save reading --format png --out /tmp/reading.png --font-family 'JetBrainsMono Nerd Font Mono, LXGW WenKai Mono, monospace'
```

The agent sees the current terminal screen, sends input and checks the result. You can use the foreground terminal's normal keyboard controls. Coordinate turns so simultaneous input does not interfere. `run` follows the size of your terminal; it cannot later be attached from a detached session.

For agent-only work, replace `run reading` with `start reading-check --cols 122 --rows 36`. The background session can be resized with `bun run tui resize reading-check --cols 80 --rows 24`. Use `send ... ctrl-d` for normal Pi exit; `stop` terminates a stuck owned session.

TC 1.2.1 initializes a dark terminal background, so a light Pi theme can have poor contrast in captures of an ordinary shared session. Use the background capture command below for a readable light-theme screenshot.

## Capture in the background

```bash
bun prototype/reading-queue/capture.ts
```

The command starts its own detached TC session at 122x36, uses Pi's `/new` to clear the missing-model warning, opens the reading queue, resizes to 122x24 and saves a PNG in a temporary artifact directory. It prints the path and stops the owned session afterward. This forced stop can leave the launcher's temporary Pi data, as described above. It uses the current built-in Pi `light` or `dark` theme with Catppuccin Latte or Mocha terminal colors, respectively. Custom Pi themes are rejected by this capture command. The font list names the fonts installed on the development host; another machine needs matching installed fonts.

Actual captures: [light](captures/light.png), [dark](captures/dark.png).

OSC 10/11/12 sets foreground, background and cursor colors inside that detached terminal before Pi starts. The invoking terminal receives no color control sequences. Do not copy this initialization into the foreground `run` command: it mirrors application output into your terminal and would change its colors. No TC patch or CUA is needed. The PNG is a terminal-grid rendering, not evidence of native font rasterization or a compositor window.

## 中文

这是展示 TC 用法的临时原型, 使用真实 Pi 的选择和确认组件. 三篇文章是样例数据, 已读状态仅保存在内存, 不调用模型或网络.

在工作树根目录运行上面的 `run reading` 命令, 然后输入 `/reading`. 用方向键和 Enter 选择、确认, Escape 取消. 再次打开列表可以看到状态变化; 回到空编辑器后用 Ctrl+D 退出.

你使用前台终端, agent 用同名会话的 `show/send/wait/save` 读取和操作同一个界面. 双方轮流操作即可, 不必反复传截图. 前台尺寸跟随你的终端, 不支持事后 attach. 只有 agent 操作时用 `start`, 需要一起看时从一开始就用 `run`.

启动文件隔离临时数据并复制当前主题名称, 正常退出会清理目录. 自定义主题文件没有复制; 强制终止可能需要手动清理 Pi 显示的临时目录.

后台截图运行 `bun prototype/reading-queue/capture.ts`. 它启动 122x36 独立 TC 会话, 通过 Pi 的 `/new` 清除缺少模型的警告, 打开列表并缩放到 122x24, 保存 PNG、打印路径, 随后停止自己创建的会话. 这种强制停止可能残留前述临时 Pi 数据. 使用当前 Pi 内置 light/dark 主题, 分别搭配 Catppuccin Latte/Mocha 终端配色; 自定义 Pi 主题会被拒绝. 字体列表使用开发机已安装字体, 其他机器需要匹配的字体. 实际截图见上面的 light/dark 链接.

普通共享会话的 TC 截图仍可能出现浅色主题对比不足. 后台截图命令用 OSC 10/11/12 初始化隔离终端的前景、背景和光标颜色, 不向你的终端输出配色控制序列. 不要把这段初始化移到前台 `run`, 它会同步输出并改变你的终端颜色. 本例无需 patch TC 或使用 CUA; PNG 是终端网格渲染, 不代表原生字体栅格化或窗口显示效果.
