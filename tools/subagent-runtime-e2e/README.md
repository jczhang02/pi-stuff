# Arhen runtime verification

This throwaway artifact tests whether the agreed Fleet UI can observe and control **real child sessions without replacing the main Pi session**. It belongs to [issue #49](https://github.com/jczhang02/pi-stuff/issues/49) and [draft PR #52](https://github.com/jczhang02/pi-stuff/pull/52), outside main. The earlier [UI-only prototype](../subagent-ui-prototype/README.md) is retained separately.

The executed path is keyboard → Pi UI → patched Arhen manager → real child `AgentSession` → loopback model HTTP → real Pi `read`/`bash` → scratch files and worker processes → actual session events → native Pi message/tool components. The HTTP endpoint supplies deterministic model responses and usage. It does not launch tools, write the agent's results, or change the Fleet state. No live model, credentials or paid requests are used.

## Run

From this worktree:

```bash
bun install --frozen-lockfile --ignore-scripts
bun tools/subagent-runtime-e2e/run.ts --theme=light
```

Use `--theme=dark` for the dark canvas. Submit `检查任务取消流程` to start the three child tasks. Plain text follows this fixed local scenario; it is not interpreted by a live model. Main and reviewer execute actual output-producing processes for up to 90 seconds. Tester calls the real `ask_parent` tool; replying starts a process that exits with code 1. Explorer reads the scratch source and completes. Reopen a finished child to continue once its original batch has settled. Model output containing a tool failure is separate from the task's status: a child can report a failed test and still complete its assignment successfully.

The launcher creates temporary project, settings, model configuration and session storage. The visible `~/project` is that scratch project. Native `read` and `bash` run there, and normal exit deletes the scratch data. To exit from a child, Ctrl+C returns to main; Esc stops active main work, then Ctrl+D exits with an empty editor. Persistence is exercised only inside this disposable workspace; the printed native resume command cannot recover data after launcher cleanup.

The shared session is `subagent-runtime-e2e`. From the worktree:

```bash
bun run tui attach -s subagent-runtime-e2e
```

From the main checkout, use `bun run tui attach -s subagent-runtime-e2e` as well. If the session is absent, launch from the worktree:

```bash
bun run tui -s subagent-runtime-e2e --cols 140 --rows 42 --background -- bun tools/subagent-runtime-e2e/run.ts --theme=light
```

## What was verified

Environment: Linux, Bun 1.4.0, Pi SDK 0.85.1, `/opt/bin/pi` 0.85.1, Tuistory 0.11.0. Run these disposable probes explicitly; they are not added to the product CI suite:

```bash
bun test tools/subagent-runtime-e2e/verify.test.ts tools/subagent-runtime-e2e/lifecycle.test.ts
```

| Behavior                                                                     | SDK host                                      | Compiled Pi extension host                                                                                        |
| ---------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Arhen default tools, parallel background work and native peek                | Shared package path                           | Pass; original visible Follow-up queue reproduced                                                                 |
| Enter child view while main's real tool keeps producing output               | Pass                                          | Pass                                                                                                              |
| Observe actual tool output, expand it and scroll to earlier source           | Pass                                          | Pass                                                                                                              |
| Direct reviewer steering, tester question reply, child draft on return       | Pass                                          | Pass                                                                                                              |
| Model HTTP failure, native tool exit error and resumed session history       | Pass                                          | Pass                                                                                                              |
| Esc stops viewed child; `x` stops waiting child; repeated stop is harmless   | Pass, worker PID exits and main continues     | Pass, same checks                                                                                                 |
| `/new` disposes old work; `/reload` restores the adapter and new work starts | Pass                                          | Pass                                                                                                              |
| Main Esc keeps background child running; native Ctrl+D releases it           | Pass, actual PIDs checked                     | Pass, actual PIDs checked                                                                                         |
| Automatic notifications absent from visible Follow-up queue                  | Pass                                          | Pass                                                                                                              |
| Completed-child continuation                                                 | Pass after original batch settles             | Pass after original batch settles                                                                                 |
| Continue completed child while sibling is active                             | Explicit refusal; draft retained              | Same upstream restriction                                                                                         |
| Existing editor keybinding across wrapping and reload                        | Pass with a controlled companion              | Pass with the same companion                                                                                      |
| Existing custom footer                                                       | Replaced by the SDK native-footer composition | Preserved, with Fleet above it                                                                                    |
| Existing native statusline above Fleet                                       | Pass through SDK session access               | **Unavailable through the public append API**; compatibility probe leaves native footer intact and Fleet above it |
| 62-column resize and 40-column minimum-size exit                             | Pass                                          | Pass                                                                                                              |

The source fixes an ordering race found only with actual child startup: Fleet follows Arhen's declared task order rather than session startup completion order. A rejected send restores the native editor's cleared submission. Bash cards use observed execution timestamps rather than beginning their clock on viewer entry. Main abort/error states use the real last assistant stop reason.

The package was installed from scratch using the frozen lock and retained patch in a separate directory, and the probes were replayed there. The baseline test loads the same package with hooks disabled; the initial investigation also ran the pristine npm source. Set `PI_E2E_BASELINE=/absolute/path/to/pristine/src/index.ts` to reproduce that separate baseline (the pristine source must resolve the pinned peers).

Actual terminal captures: [main](evidence/main.png), [reviewer with live tool output](evidence/reviewer.png), [dark canvas](evidence/dark.png). These are Tuistory captures, not generated illustrations.

## Remaining boundaries

- This is a full-screen **conversation viewer/controller**, not Pi's `switchSession()`. Native runtime session replacement disposes the old runtime; Arhen's shutdown handler then stops its children. The tested viewer avoids that path.
- Ordinary extensions cannot obtain or append to an arbitrary existing footer through Pi 0.85.1's public API. The SDK host owns a real `AgentSession` and reconstructs the native footer before Fleet. This proves the layout is buildable; it does not prove a drop-in package can preserve an arbitrary custom statusline. A controlled companion confirmed that its editor binding survives wrapping and reload; its footer survives only in the compiled profile. Arbitrary extension combinations and shortcut conflicts remain unverified.
- Arhen resumes only after all siblings in the original run settle. The patch enables completed-task resume but keeps this scheduler restriction. Making each completed child immediately reusable while siblings run still needs a scheduler change and its own verification.
- Hidden notifications retain Arhen's wakeup semantics. They still reach main's model context and may cause additional turns. Removing the visible queue does not remove that cost or guarantee that a live model will never mention a notification.
- The tested view covers text, native read/bash output, generic child-tool results and current-session history. It does not provide child slash commands, session branching, arbitrary extension-specific tool renderers, images, compaction/retry presentation or process-crash recovery. Native tool truncation still applies; the full-output path is shown when Pi truncates. It is not a promise to display unlimited output inline.
- No live-provider intelligence/latency/billing, worktree-writing tasks, nested DAGs, multiple concurrent runs, cross-process restart, Node, other operating systems, custom terminal configurations or exact Claude Code interaction parity is established. The deterministic usage values validate event-to-display plumbing, not provider billing.

These findings support retaining Arhen's execution engine and building a live viewer around it. The two remaining product decisions are host support for Fleet placement and whether immediate continuation during sibling work is required. The artifact remains a verification branch; it does not install a production subagent into Pi Stuff.

## Fork provenance and reproducibility

The exact development dependency is `@arhen/pi-core-subagent@1.3.54`, published from [Arhen's package](https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent). Registry metadata identifies gitHead `de1c8783c2a39b1cbb0f86b412307193de9774c1`, tarball SHA-1 `caa33aca3da3d93a0c1fac3ba7bee3f608f9636f` and the integrity locked in `bun.lock`. The npm artifact, rather than an assumed Git checkout byte match, is the tested baseline. Its MIT `LICENSE` is retained by the dependency and is unchanged.

The [Bun patch](../../patches/@arhen%252Fpi-core-subagent@1.3.54.patch) adds optional manager/session hooks, an opt-out for the native widget, and an opt-in for completed-task continuation. Dispatch, dependency scheduling, child construction, actual execution, messages, cancellation, persistence and resume stay in the original package. With no hooks, original behavior remains the default. The adapter turns automatic user messages into hidden custom messages while retaining delivery and wakeup.

Generated declaration files and `types`/`exports` entrypoints let this repository type-check the dependency boundary without weakening its strict optional-property rules to match upstream. Regenerate declarations after editing the patched package using its strict compiler profile:

```bash
bun --bun tsc --ignoreConfig --declaration --emitDeclarationOnly --allowImportingTsExtensions --strict --skipLibCheck --target ESNext --module Preserve --moduleResolution Bundler --types bun --outDir node_modules/@arhen/pi-core-subagent node_modules/@arhen/pi-core-subagent/src/*.ts
```

Bun 1.4.0's patch application created a new `dist` directory with mode 0644 in the initial attempt, causing EACCES. Keeping generated declarations at the package root avoids that reproduced installer failure. No install lifecycle script is enabled. Upstream declares Pi peers `^0.84.2` and TypeBox `^1.3.14`; this repository pins Pi 0.85.1 and TypeBox 1.3.7. Only the executed compatibility matrix supports this pairing.

The launcher declares `TERM=xterm-256color` and `COLORTERM=truecolor` for the supported Tuistory terminal. Omitting the latter made Pi convert dark neutral colors to bright indexed green/blue backgrounds; actual captures were checked again after this correction.

## 中文说明

这次验证回答的是：**不替换主 Pi 会话，能否完整查看并控制正在运行的子代理？** 这里复用了固定版本的 Arhen 包，主代理和子代理都是实际 Pi `AgentSession`，读取文件、执行 Bash、工具输出、提问、取消和保存会话都走真实代码。只有模型 HTTP 边界使用本地确定性响应，不连接真实模型，也不使用账号或付费请求。旧的 UI 样例原型仍在相邻目录，本目录是新增的运行时验证产物，留在 #52 草稿分支。

运行和加入命令见上方。输入 `检查任务取消流程` 后启动三个任务；文字只继续固定场景。main 和 reviewer 的真实进程最多运行 90 秒；tester 会通过原包提问，收到回答后运行退出码为 1 的工具；explorer 读取临时源码后结束。工具测试失败与代理任务失败不同：代理正确报告测试失败，也可以正常完成任务。所有工具都在临时项目运行。退出时清理临时会话，所以 Pi 打印的恢复命令不能用于退出后的恢复。

两个宿主均通过了真实进程后台推进、定向补充、问题回答、工具展开与历史回看、草稿保存、模型故障恢复、单任务停止与重复停止、兄弟任务隔离、`/new` 清理、`/reload` 重载、已有 editor 按键保留、父代理取消、正常退出和缩放检查。已从干净目录按冻结锁与补丁安装后重跑。界面没有自动 `Follow-up:` 队列；隐藏通知仍交给主模型，可能触发额外轮次。截图来自实际终端。

验证也确定了两个产品限制。第一，SDK 宿主能实现“原生 statusline → Fleet”，普通编译版 Pi 扩展没有公开的底栏追加接口，本探针保留原生底栏时只能把 Fleet 放在它上方；受控扩展验证了已有 editor 按键在包装与 reload 后仍有效，已有 footer 只在编译版探针保留；任意扩展组合和快捷键冲突仍未验证。第二，原包只能在整批子任务结束后恢复其中一个任务；补丁允许继续已完成任务，但没有改变这个调度约束。提前发送会显示拒绝原因并保留草稿。

全屏视图复用原生消息、工具、editor 和 footer，没有调用会结束主运行时的 `switchSession()`。它仍不是完整的第二个 Pi 交互运行时：子代理斜杠命令、分支操作、图片、自定义工具渲染、压缩/重试提示和崩溃恢复不在本轮支持范围；工具长输出仍遵循 Pi 的截断及完整输出路径规则。没有验证真实模型的理解、费用、延迟、写入 worktree 的任务、嵌套依赖图、多批并发、跨进程重启、Node、其他系统、所有终端设置或 Claude Code 完全一致性。表中的 token 是本地模型返回的数据，用于检查真实事件能否正确显示，不代表真实账单。

因此，已验证的是“保留 Arhen 执行器，增加实时查看与控制界面”这条路径。Fleet 的宿主接入，以及兄弟任务仍运行时是否必须立即继续已完成任务，是剩余的产品接入问题。依赖版本、原始许可证、补丁、生成声明及安装故障规避均在上方留有可复现记录；本产物尚未作为正式 subagent 加载到 Pi Stuff。

Final check record: the five runtime scenarios passed from the frozen clean install; the expanded reload/companion lifecycle scenarios were then replayed there (2/2). `bun run check` and `git diff --check` passed. The product suite finished 50/50 after a local HTTP fixture fix: unrelated GET requests now return 404 instead of entering the model JSON decoder, with a direct regression assertion. Earlier whole-suite attempts failed on that empty-body parse; an unchanged isolated rerun passed before the fixture fix. Actual Tuistory attach displayed reviewer correctly and retained eleven nonempty blank rows with the expected light canvas background. Dark and light captures were visually inspected. Independent read-only review by Codex child `/root/review_fleet_v3` applied the mandatory thermo-nuclear skill and rechecked all fixes; no blocking findings remain. UI acceptance and production integration remain open.

最终检查：从冻结安装的全新目录跑通五个运行场景后，又在该目录复跑扩展后的 reload/共存生命周期场景，2/2 通过。仓库静态检查与差异检查通过；修复本地 HTTP 测试桩把无关 GET 当作模型 JSON 的问题并加入直接回归断言后，原有产品套件 50/50 通过。此前整套失败的空 body 解析和单独复跑通过的结果均保留记录。实际 Tuistory attach 正确显示 reviewer，十一条非空白背景行具有预期浅色背景；浅深色截图均已目视检查。独立只读代理按强制热核技能复核并重查所有修复，无剩余阻塞；UI 验收和正式接入仍待后续。
