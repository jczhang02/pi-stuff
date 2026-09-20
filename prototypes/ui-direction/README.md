# Pi Stuff UI direction prototype

This is a throwaway, offline design artifact for [issue #99](https://github.com/jczhang02/pi-stuff/issues/99). It is retained on `codex/ui-research-preview`, outside main. The product entrypoint does not load it.

[Open the preview gallery](gallery.html) · [Research and surface inventory](../../docs/research/ui-direction-2026-09-20.md) · [中文研究](../../docs/i18n/zh-CN/research/ui-direction-2026-09-20.md)

## Reproduce

From this branch's checkout, with the pinned Bun 1.4.0 dependencies installed:

```sh
bun prototypes/ui-direction/capture.ts welcome
bun prototypes/ui-direction/capture.ts work
bun prototypes/ui-direction/capture.ts diff
bun prototypes/ui-direction/capture.ts failure
bun prototypes/ui-direction/capture.ts complete
bun prototypes/ui-direction/capture.ts work-narrow
bun prototypes/ui-direction/capture.ts baseline
```

The runner starts the installed Pi 0.85.1 CLI under Bun in a fresh temporary home, agent directory, working directory and session directory. It disables discovered extensions, skills, prompts and tools, loads only the prototype extension and selected theme, and uses an offline fixture model. It exports actual Terminal Control frames as PNG, ANSI and text, then stops the session/driver and deletes its temporary state. `--theme catppuccin-latte` or `--theme catppuccin-mocha`, `--cols`, `--rows` and `--out` select the capture conditions. The baseline omits the prototype extension and preserves native startup information.

For a shared foreground session, use the complete isolated launch block below. The capture runner itself is headless and does not expose a later attach route. Its screenshots are terminal exports, not evidence of a native Ghostty window or compositor.

## Controls and evidence boundary

- Pi's native `Ctrl+O` expands/collapses sample tool messages.
- `/ui` opens the native SettingsList. `Ctrl+Alt+U` opens the same settings while preserving the editor draft. Enter changes a value; Esc closes.
- `/tools` opens all retained output in the old inspector: a wide view uses a left tool list and right detail pane, while a narrow view opens the list first. Arrows select in the list; Enter or Tab focuses details, where arrows scroll. Esc returns to the list, then closes. `[` and `]` also select tools. Selection and confirmation follow Pi keybindings; these are the defaults.
- The host owns the actual editor, transcript viewport, completion and footer placement. The prototype supplies header/footer components and fixture message renderers.

The sample is one pagination task shown at selected stages. Its messages, paths, model, costs, inventory counts, durations and test results are fixtures, not real work. Session identity/naming, Goal, Todo, subagents, background work, BTW and notifications are outside this preview. The extension executes no shell/test commands. Typing an ordinary request is not a supported coding workflow in this artifact. The captured failure describes a sample failed test, not failure of the UI verification.

The renderer uses custom messages. It proves the proposed layout can run inside Pi; it does not prove native built-in tools or assistant/thinking have been replaced. The report documents the separate public built-in-tool override route and the limits of assistant/thinking customization. Image protocols, history replay and live streaming remain outside this visual artifact.

The export font stack is `JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono`. Palettes are the repository's Catppuccin Latte and Mocha themes. Terminal default foreground/background are set from those palettes before launch; exported colors are checked against the live terminal frame. No screenshot is painted over to change the layout.

## Findings

The useful change is consistent hierarchy across the whole transcript: action/target, outcome, then a useful excerpt. Full output remains inspectable. The old Pi Stuff boxed welcome, transcript prefixes, inline tool heading and native input are retained as references. Compact versus expanded tool output can be tried directly.

The first smoke run exposed startup resource listings that displaced task content, duplicate settings hints and a tool-expansion setting that did not track native Ctrl+O. Those were corrected through normal Pi configuration and component state. Independent review also found a scrolling bound based on source rather than rendered rows and insufficient draft-preservation verification; the code and verification were corrected before the retained capture pass.

The revision also corrected hardcoded tool-navigation keys. Wide/narrow captures and an isolated `j`/`k`/`ctrl+j` remapping check passed selection, confirmation, Escape and draft restoration.

The prototype does not select a final design. Statusline fields, tool-family grouping, `/tools` list/detail behavior and large-diff navigation remain discussion items supported by the previews.

## 中文说明

这是 #99 的一次性设计原型, 保留在 `codex/ui-research-preview` 分支, 生产入口不加载. 上面的命令在隔离目录中运行真实 Pi 0.85.1, 导出终端图片、ANSI 和文本后清理临时状态. 图片采用仓库里的 Catppuccin 明暗主题和明确的字体栈, 不是绘制的终端示意图.

样例中的执行、测试、费用、时长和加载清单都是示例数据. 普通输入不会启动真实编码任务. 宿主提供真实输入框、会话区域和布局; 原型提供自定义消息、header/footer 和设置组件. 会话身份/命名、Goal、Todo、subagents、后台工作、BTW 和通知不在本次预览范围内. 这不等于生产工具或 Thinking 已实现.

修订同时修正了硬编码工具导航键. 宽窄截图检查及隔离的 `j`/`k`/`ctrl+j` 重映射实验通过选择、确认、Esc 和草稿恢复验证.

可以用 Ctrl+O 展开工具, `/ui` 或 Ctrl+Alt+U 打开设置, Enter 切换值, Esc 返回. `/tools` 的宽窗口显示左侧工具列表和右侧详情, 窄窗口先显示列表. 方向键选择工具, Enter/Tab 进入详情后方向键滚动, Esc 先回列表再关闭; `[ ]` 也可切换工具. 选择与确认沿用 Pi 的按键配置, 此处为默认键; 会话内保留旧版 `Tool(target)` 标题. 本次保留实际终端截图与检查结果, 继续讨论状态栏字段、工具分组、大 diff, 不自动确定生产方案.

## Shared foreground launch

Run this complete block from the task-branch checkout. It opens the `work` scene in a named Terminal Control session; Ctrl+D on an empty editor exits Pi. Change only `PI_UI_SCENE` to select another fixture. All Pi state stays in the temporary directory. The subshell limits the cleanup trap to this launch. The live terminal must already use a matching Mocha palette; capture color verification does not cover this foreground terminal.

```sh
(
preview_root="$PWD"
preview_bun="$(command -v bun)"
preview_tmp="$(mktemp -d)"
trap 'rm -rf "$preview_tmp"' EXIT
mkdir -p "$preview_tmp/agent" "$preview_tmp/sessions"
printf '%s\n' '{"quietStartup":true,"theme":"catppuccin-mocha"}' > "$preview_tmp/agent/settings.json"
printf '%s\n' '{"providers":{"preview":{"baseUrl":"http://127.0.0.1:9/v1","api":"openai-completions","apiKey":"preview-only-no-network","models":[{"id":"preview"}]}}}' > "$preview_tmp/agent/models.json"
bun run tui run ui-direction -- env -i \
  HOME="$preview_tmp" PATH=/usr/bin:/bin TERM=xterm-256color COLORTERM=truecolor \
  PI_CODING_AGENT_DIR="$preview_tmp/agent" PI_CODING_AGENT_SESSION_DIR="$preview_tmp/sessions" \
  PI_UI_SCENE=work PI_OFFLINE=1 PI_TELEMETRY=0 \
  /bin/sh -c 'cd "$1"; shift; exec "$@"' pi-ui "$preview_tmp" \
  "$preview_bun" "$preview_root/node_modules/@earendil-works/pi-coding-agent/dist/cli.js" \
  --offline --no-extensions --no-skills --no-prompt-templates --no-themes \
  --no-context-files --no-approve --no-builtin-tools --provider preview --model preview \
  --theme "$preview_root/themes/catppuccin-mocha.json" --use-theme catppuccin-mocha \
  --tui-mode fullscreen -e "$preview_root/prototypes/ui-direction/extension.ts"
)
```

在任务分支目录执行上面完整代码块, 即可打开共享的 `ui-direction` 终端. Pi 数据只写入临时目录, subshell 会在结束时清理, 不覆盖调用者的 EXIT trap. 实际前台终端应预先使用匹配的 Mocha 配色; 截图的色值验证不覆盖该前台终端. 空输入时 Ctrl+D 退出. 这条命令用于操作界面, 自动截图和交互检查仍使用前面的 capture 命令.
