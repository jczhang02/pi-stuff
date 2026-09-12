# Subagent UI prototype

Throwaway design artifact for [issue #49](https://github.com/jczhang02/pi-stuff/issues/49), retained on `codex/prototype-subagent-ui`. Do not merge this prototype into main or promote its simulated task logic to production.

The maintainer selected Arhen's `pi-core-subagent` as the future fork source, then confirmed three UI behaviors: the selected agent gets a full conversation view, other agents keep working, and completed agents can continue their original conversations. This prototype exercises those behaviors with real Pi TUI components and in-memory sample data. It does not import the Arhen runtime.

## Run and join

From this worktree, with the pinned Bun 1.4.0 dependencies installed:

```sh
bun tools/subagent-ui-prototype/run.ts --variant=A
```

The default host is `/opt/bin/pi`. Set `PI_PROTOTYPE_HOST` to a compatible Pi executable when needed. The launcher uses an isolated temporary directory, ephemeral Pi session, offline startup, no tools and no discovered extensions, skills, prompts, themes or context files. Only the prototype extension loads. It does not receive the launching shell's provider credentials. Temporary launch data is removed after a normal host exit. All agent activity and replies are simulated; no model is called by the prototype.

Start a shared terminal:

```sh
bun run tui -s subagent-ui-prototype --cols 116 --rows 38 --background -- bun tools/subagent-ui-prototype/run.ts --variant=A
bun run tui attach -s subagent-ui-prototype
```

## Try the flow

1. Select `reviewer` and press Enter. Use Ctrl+O to expand the sample tool result.
2. Type a message, press Esc, then enter the same agent again. The unsent draft remains.
3. Send the message. A local canned reply appears and a simulated work round completes about four seconds later. Other agents' counters keep advancing.
4. Enter the already completed `explorer` and send another request. It continues the same conversation.
5. Enter `tester`, which is waiting for input, and reply. It resumes simulated work.
6. Use PgUp/PgDn to inspect history and Ctrl+End to return to the latest messages.
7. Ctrl+X requests stopping a running agent; confirm with `y`. The conversation remains available, and other agents continue.
8. Esc returns from a conversation to the fleet. In the fleet, `m` opens the simulated main agent. Esc in the fleet or Ctrl+Q closes the prototype overlay and returns to the isolated Pi host. `/fleet-prototype` opens a fresh demo; Ctrl+C twice exits Pi when its editor is empty.

F2 focuses the prototype controls. Left/right cycle A (compact list), B (grouped by status), and C (list with preview). Press F2 again to return to normal input. The layouts share data and all open the same full conversation view. While the controls are focused, `r` resets the simulated scenario. `--variant=B` or `--variant=C` selects a layout at launch.

## Evidence and limits

Exercised on Linux in the maintainer's compiled Pi 0.85.1 host, launched with Bun 1.4.0 and driven through repository Tuistory 0.11.0. Inspected at 116×38 and 62×26 cells. Below 44×18, the prototype shows a size notice and retains exit controls.

This verifies a custom full-screen interaction surface in the actual host. It does not verify live parent/child scheduling, streaming model output, notification delivery, restart recovery, all native Pi commands, or terminal platforms other than this host. The user has not yet selected a fleet layout or accepted the final interaction design. `bun run check` is the repository verification command; this throwaway artifact intentionally adds no test suite.

Captured terminal views: [fleet A](evidence/fleet-a.png), [conversation](evidence/conversation.png), [fleet B](evidence/fleet-b.png), [fleet C](evidence/fleet-c.png), [narrow view](evidence/narrow.png).

## 中文说明

这是 [Issue #49](https://github.com/jczhang02/pi-stuff/issues/49) 的一次性设计原型，保留在 `codex/prototype-subagent-ui` 分支，不合入 main，也不把模拟任务逻辑直接用于正式功能。后续正式 fork 已选定 Arhen 的 `pi-core-subagent`；本原型没有导入其运行时。

已确认的交互：选中代理后使用整个对话区域；其他代理继续运行；已完成的代理可以在原对话中继续交流。界面使用真实 Pi TUI 组件，任务、工具内容、计数和回复全部在内存中模拟，不调用模型。

在此 worktree 中运行上方启动命令即可打开原型；默认使用 `/opt/bin/pi`，可以通过 `PI_PROTOTYPE_HOST` 指定兼容宿主。启动器使用隔离临时目录和临时会话，只加载原型扩展，关闭工具、自动资源加载和启动联网，不传入当前 shell 的模型凭据。宿主正常退出后删除临时启动数据。

通过上方 `bun run tui attach` 命令加入正在运行的共享终端。建议先进入 reviewer，展开工具详情，输入一句话后返回，再进入确认草稿保留；接着发送消息，观察模拟回复和后台计数。也可以进入已完成的 explorer 继续追问，或回复等待输入的 tester。

| 按键                  | 操作                                |
| --------------------- | ----------------------------------- |
| ↑ / ↓，Enter          | 选择并进入代理                      |
| 输入文字，Enter       | 给当前代理发送模拟消息              |
| Ctrl+O                | 展开或收起工具详情                  |
| PgUp / PgDn，Ctrl+End | 浏览记录，回到最新                  |
| Ctrl+X，y             | 停止当前运行中的代理，保留历史      |
| Esc                   | 从对话返回列表；从列表返回隔离的 Pi |
| m                     | 在列表中进入模拟主代理              |
| F2，← / →，F2         | 聚焦原型控制、切换布局、返回输入    |
| r                     | 仅在原型控制聚焦时重置模拟场景      |
| Ctrl+Q                | 关闭原型浮层，返回隔离的 Pi         |

A 是紧凑列表，B 按状态分组，C 在列表旁提供预览；窄终端中 C 上下排列。三种布局都进入相同的完整对话视图。返回 Pi 后用 `/fleet-prototype` 打开新场景，空输入框下按两次 Ctrl+C 退出宿主。

实际检查环境是 Linux、维护者编译的 Pi 0.85.1、Bun 1.4.0 和 Tuistory 0.11.0，检查了 116×38 与 62×26 两种尺寸；小于 44×18 时显示尺寸提示并保留退出操作。上述截图均来自真实终端运行。

这证明了自定义全屏交互界面在实际宿主中的可操作性。真实父子代理调度、模型流式输出、通知投递、重启恢复、所有 Pi 原生命令和其他平台仍未验证。维护者尚未选择列表布局或验收最终交互。原型不新增测试套件，仓库检查使用 `bun run check`。
