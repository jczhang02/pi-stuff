<!-- translation-source: packages/pi-stuff/src/todo/README.md; translation-source-sha256: 251725231e8b90327220a1ad85def30db87ddfd90ab9f31f72a0713e58e9f05a -->

# Todo 模块

Pi Stuff 套件中的会话尺度 Todo 能力。

该模块向 Agent 提供四个增量工具——`TaskCreate`、`TaskGet`、`TaskList` 和 `TaskUpdate`——后端由一个可按分支重放的状态权威支持。只有当前工作存在时，编辑器上方才显示有界清单。

## 行为

- 稳定的字符串任务 ID 在一个会话权威内绝不重复使用。
- 依赖经过校验并原子提交。
- 重载、压缩和树变化后，状态会从 Pi 对话记录恢复。
- 普通清单只让 `N tasks (D done, O open)` 摘要复用 Transcript activity 的一格共享 padding；最多五个任务行及一个溢出行保持既有的两格次级缩进。
- `in_progress` 行与折叠的 `Next:` 行使用经过清理且非空的 `activeForm`，为空时回退到 `subject`。pending、blocked、completed 与 deleted 展示始终保留 `subject` 语义。
- 可运行待办使用柔和的 `□`；被阻塞待办保持相同 `□` 形状但使用警告色，因此在深浅主题下都无需只依赖浅色文字即可区分。已完成工作有意保持暗淡。
- 已完成工作短暂停留后，组件消失，但不删除状态。
- 不增加浮动窗口、状态栏、项目待办或独立任务数据库。
- 成功的 Task 工具调用在 Compact 中保持静默，因为清单已经显示其效果。Expanded 只保留一次 Tool Activity 摘要以及任何额外结果证据；错误使用共享工具行，完整套件中的每项操作都可通过 `/tools` 检查。

单一 Pi Stuff 软件包会安装此模块。源码来源与维护的本地差异见 [UPSTREAM.md](./UPSTREAM.md)。
