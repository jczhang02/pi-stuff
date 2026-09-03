<!-- translation-source: docs/capabilities/fast-resume.md; translation-source-sha256: 46597bccc0ef7a319186d58ba780ee51a26f7d8451e8bfc01e840533441d9af1 -->

# Fast Resume

[English](../../../../../docs/capabilities/fast-resume.md)

Fast Resume 保留 Pi 原生 Session 选择器，只替换其中开销较大的完整历史列表 loader。它在限制 transcript
解析的同时保留权威 Session 名称，返回 Pi 的 `SessionInfo` 行，再把选择和变更操作交给 Host 组件。

## 打开选择器

运行 `/resume`。Pi Stuff 只在当前 Host 进程内拦截原生选择器调用，然后挂载 Pi 导出的
`SessionSelectorComponent`，并提供轻量的 Current Folder 与 All Sessions loader。它不会修改 Pi 的安装文件。
如果经认证的 Host seam 不可用或打开失败，系统会运行原始选择器，并通过有界 Diagnostic Record 说明回退原因。

关闭 `fastResume.hijackResume` 后，Pi 会为 `/resume` 保留完整历史 loader，Pi Stuff 则注册
`/fast-resume`。可选的 `fastResume.shortcut` Pi key ID 会打开同一个使用轻量 loader 的原生组件。

## 原生选择器行为

Fast Resume 不添加视觉模式或额外控件。标题、Header、列表行、搜索框、选择、滚动、空状态、状态消息、
重命名表单、删除确认、颜色、响应式裁切和按键都来自 Pi 原生 UI。

| 按键 | 原生操作 |
| --- | --- |
| Up / Down | 移动一个 Session |
| Page Up / Page Down | 按可见窗口翻页 |
| Home / End | 选择第一个或最后一个可见 Session |
| Enter | 切换到选中的 Session |
| Escape | 关闭选择器并恢复编辑器 |
| Tab / Shift+Tab | 切换 Current Folder 与 All Sessions |
| Ctrl+S | 轮换 Threaded、Recent 和 Fuzzy 排序 |
| Ctrl+N | 切换仅显示 Named Session |
| Ctrl+P | 切换 Session 路径显示 |
| Ctrl+L | 刷新当前 scope |
| Ctrl+R | 重命名选中的 Session |
| Ctrl+D | 确认删除选中的 Session |

输入文字时使用 Pi 的选择器搜索。普通输入采用模糊匹配，完整引号包裹的查询采用精确子串匹配，
`re:<pattern>` 采用正则表达式匹配。Fast Resume 提供 Session ID、解析出的名称、cwd，以及前向窗口内找到的
可见用户和 Assistant 文字，但不构建无界 transcript 索引。

## 轻量加载

对于 transcript 元数据，Fast Resume 从每个候选文件头部最多读取 1 MiB，并且只解析完整行。文件能放入该
窗口时会完整解析；过大文件在取得 Session header 和首条非空用户消息后停止 transcript 解析。一次 scope
范围的字节扫描会找出所有有效 `session_info` 行，因此，即使后续消息把名称推到大文件中段，最新 Session
名称仍保持权威。认证 Host 使用系统标准 `grep` 执行该扫描；若该可执行文件不可用，或其有界输出超限，
则回退到 Pi 的完整历史 loader。文件按每批 50 个处理，并把进度交给原生 Header。Current Folder 完成后才可选；
只有用户切换 scope 时才会读取 All Sessions。

该 loader 保留精确 Session 名称，但仍有明确的 transcript 上限：

- 未在 1 MiB 前向窗口内结束的首条非空用户消息不会进入搜索；
- 过大文件中的后续文字不会进入搜索；
- 过大文件的消息数量可能小于完整历史数量；
- 前向读取看不到最后消息活动时间时，由文件系统修改时间决定排序，因此只追加元数据也可能移动 Session；
- 只有关闭拦截并使用 Pi 原始 loader，才能进行完整历史搜索并取得精确消息数量与活动时间。

Fast Resume 不创建持久 cache 或 sidecar 索引，不发起网络请求，扫描时也不重写 Session 文件。

## 恢复、重命名和删除

Enter 会把选中的路径返回 Pi Stuff，再调用 Pi 的 `switchSession`。验证、加载、transcript replay、cwd 变更和
终端行为仍由 Pi 负责。

重命名和删除沿用 Pi 原生选择器流程。重命名写入常规 Session 名称元数据并刷新当前 scope。删除会保护活动
Session、要求确认、先尝试平台回收站命令；如果回收站不可用或失败，则永久 unlink JSONL 文件。删除失败时保留
列表行，并使用原生的有界错误状态。

## 生命周期

每次打开选择器都会取得一个子 Effect owner，每次原生 loader 调用作为受管 operation 运行。关闭选择器会关闭
owner 并中断尚未完成的工作。loader 在用户切换视图后才返回时，仍以 Pi 原生的 scope 和序列检查为准。

## 配置

在 `<agentDir>/pi-stuff.json` 的 `fastResume` 命名空间中手动配置 Fast Resume。启动时只读取该命名空间，
不创建或重写文件。无效值回退到默认值，并生成 Diagnostic Record。字段定义见
[设置参考](../reference/settings.md#fastresume)。
