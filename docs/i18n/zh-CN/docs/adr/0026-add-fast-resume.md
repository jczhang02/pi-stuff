<!-- translation-source: docs/adr/0026-add-fast-resume.md; translation-source-sha256: eb77267f81e54fdb8ebc59dbe9900e585ea933c4ff1001a324d8db1fbc745f50 -->

---
status: accepted
---

# 添加 Fast Resume

## 背景

Pi 原生 `/resume` 选择器会先构建完整的可搜索元数据，再显示当前项目的 Session 列表。在实测本地语料中，
75 个 Session 约占 432 MB；即使已经按 cwd 划分 Session 布局，原生选择器仍需约 1.7 秒才能使用。延迟的结构性
原因不是 Pi Stuff，而是 Host 在应用 Current Folder 过滤前就解析了完整 JSONL 历史。

`pi-fast-resume@1.4.9` 证明了有界加载策略足够有效：通过文件元数据发现候选项，只读取有界 header 和尾部区域，
同一语料可在几十毫秒内交互。把它作为另一个 Package 安装会引入第二套独立配置的 Extension；只注册另一个
slash command 又无法让日常 `/resume` 变快。

Pi Stuff 的第一版实现把外部项目的选择器复刻成自定义 Command Dialog。后续验收明确了更严格的可见要求：接管
`/resume` 不能替换、近似模拟或扩展 Pi 原生 UI。

## 决策

把 Fast Resume 作为 Repository-owned Capability Module 加入唯一的 Pi Stuff Package。在进程内接管
`/resume`，但原样实例化 Pi 导出的 `SessionSelectorComponent`。Pi Stuff 只提供轻量的 Current Folder 和
All Sessions loader callback、选中 Session 的 callback，以及 Pi 的重命名 callback。渲染、搜索和排序、键盘处理、
响应式布局、重命名、确认、删除、刷新与错误显示全部由 Host 组件统一负责。

Fast Resume 限制的是 transcript 解析，而不是 Session 名称查找。它从 Pi 的活动 Session 目录发现候选项，
并从每个文件头最多读取 1 MiB，只解析完整 JSONL 行。文件能放入该窗口时会完整解析；过大文件在取得
Session header 和首条非空用户消息后停止 transcript 解析。随后，一次 scope 范围的字节扫描会在完整的过大
文件中查找有效 `session_info` 行，因此最新 Session 名称无论位于何处都保持权威。认证 Ubuntu Host 使用
`/usr/bin/grep` 执行扫描；若该可执行文件失败或其有界输出超限，则由 Pi 的公共完整历史 loader
保持正确性。Fast
Resume 不构建全文索引、不保留 transcript 正文，也不写 cache。文件按每批 50 个处理，并通过原生 loader
contract 报告进度。Current Folder 优先加载；只有原生组件请求 All Sessions 时才加载该 scope。

返回的 `SessionInfo` 只有有界的可搜索文字。文件能放入前向窗口时，搜索覆盖 Session ID、权威解析名称、
cwd，以及全部可见的用户和 Assistant 文字。对于过大文件，更靠后的消息可能缺失，消息数量可能小于完整历史
数量；无法取得最后消息活动时间时则使用文件系统修改时间，因而只追加元数据也可能改变排序。原生组件不会收到
额外的标签或控件来标注这些限制，因为视觉完全一致是已接受的 contract。需要完整历史搜索或精确消息数量与
活动时间时，可以关闭拦截并使用 Pi 原始 loader。

Pi 仍是 Session 生命周期 Owner。Fast Resume 把选中结果交给 `switchSession`；验证、加载、transcript replay、
cwd 变更和终端行为由 Pi 负责。重命名和确认删除使用原生组件行为。删除会保护活动 Session、尝试平台回收站命令，
并在回收站不可用或失败时永久 unlink Session 文件，符合明确的产品决策。

Fast Resume 默认通过一个窄而经认证的 Host adapter 接管 `/resume`；该 adapter 只在进程内替换
`InteractiveMode.showSessionSelector`，从不修改 Pi 的安装文件。adapter 保留原方法；拿不到当前 command
context 时调用原方法；cleanup 时仅在仍持有该 slot 时恢复；认证 seam 缺失时生成 Diagnostic Record。关闭拦截或
安装失败时，Pi Stuff 注册 `/fast-resume`；可选的 Host key ID 会打开同一个使用轻量 loader 的原生组件。这个
private adapter 是明确的兼容性例外，不代表可以普遍覆盖内置命令。

每次打开选择器都会从共享 Effect Foundation 获得一个子 owner。loader 调用作为受管 operation 运行；关闭原生
界面时关闭 owner 并中断尚未完成的工作。迟到结果仍以原生组件自己的 scope 和序列检查为准。同步文件系统调用与有界输出的元数据扫描留在 native
adapter 中，因为 Host 同步打开选择器，而 Effect 无法抢占不配合取消的原生操作。

`<agentDir>/pi-stuff.json` 中的 `fastResume` 命名空间保留上游含义：`hijackResume` 默认为 `true`，可选
`shortcut` 是 Pi key ID。启动时只读取，不创建、迁移或重写设置。命名空间值不合法时，整体回退到默认值并生成
有界 Diagnostic Record。

加载设计源自 `monotykamary/pi-fast-resume` 1.4.9，commit 为
`aa7a4dbe1be9f9c74b1110f6b797fa1e45a61572`。Module 的第三方声明保留其 MIT 许可和署名。适配后的 Source
不会因来源获得质量豁免。

## 考虑过的方案

- **把 `pi-fast-resume` 作为另一个 Package 安装：**拒绝。这样会重复 Package、配置、生命周期、UI 和发布 Owner。
- **保留 Pi Stuff 自定义选择器：**消融后拒绝。它重复了 Host 的渲染、搜索、排序、导航、重命名、删除和响应式行为，
  也无法保证原生 UI 一致。
- **只注册 `/fast-resume`：**不作为默认方案，因为日常入口必须是 `/resume`；拦截关闭或不可用时仍保留为公共回退。
- **修改已安装的 Pi Host：**拒绝。升级会替换制品，Pi Stuff 也不得安装或重写 Host。
- **临时替换 `SessionManager.list`：**拒绝。它会把 Host 内部修改扩大到选择器调用之外，并引入恢复竞态；给导出的
  组件提供 loader 更窄。
- **只保留固定的头部与尾部读取：**拒绝。真实回归表明，`session_info` 位于文件中段时，已有名称的 Session
  会回退到首条 prompt，而 Pi 原生 loader 会显示权威名称。
- **增加持久完整历史索引：**拒绝。scope 范围的元数据扫描能在延迟门槛内保留精确名称，无需增加隐私、
  失效、迁移或生命周期状态。
- **只允许回收站删除：**按明确产品决策拒绝；确认后的永久 unlink 继续沿用原生 Host 行为。

## 结果

日常 resume 使用 Pi 真正的选择器，同时避开完整历史 JSON 解析。实现不再包含自定义选择器状态机、搜索引擎或变更服务，
也不增加网络、cache、数据库、独立 Package 或 Host 文件修改。

该 Capability 依赖经认证的 private 拦截 seam 和导出的原生选择器 contract。未来 Pi 版本变化时，可以先停用拦截，
直到两者重新认证；原生 `/resume` 与公共 `/fast-resume` 仍是恢复路径。视觉完全一致也意味着，除非另作产品决策，
Fast Resume 不能在界面中增加有界元数据提示。
