<!-- translation-source: docs/adr/0026-add-fast-resume.md; translation-source-sha256: 5d3a946513c6d7bbcf2f28d4fbc9d6cf66e42e20f381cdfe8b61d360e3d3f330 -->

---
status: accepted
---

# 添加 Fast Resume

## 背景

Pi 原生 `/resume` 选择器会先构建完整的可搜索元数据，随后才显示当前项目的 Session 列表。在实测本地语料中，
75 个 Session 约占 432 MB；即使 Session 已按 cwd 分区，原生选择器仍需约 1.7 秒中位数才能使用。加载
Pi Stuff 并不能解释这一结构性延迟：Host 仍在应用 Current Folder 过滤器之前解析完整 JSONL 历史。

`pi-fast-resume@1.4.9` 证明了足够好的替代方案。它按元数据发现文件，只读取有界的 header 与尾部区域，在同一
语料上约 44 ms 即可首次交互。它也确定了所需功能面：Current 与 All scope、平面与目录视图、三种搜索模式、
排序、仅 Named 过滤、刷新、重命名、确认删除、可配置快捷键、渐进加载，以及在进程内拦截 Pi 原生选择器。

把该 Package 与 Pi Stuff 并列安装，会引入第二个独立配置的 Extension，并重复视觉、设置、生命周期和兼容性
权威。只注册另一个 slash command 虽然能避开私有 Host 集成，却不能满足日常 `/resume` 使用快速选择器的要求。

## 决策

把 Fast Resume 作为 Repository-owned Capability Module 加入唯一的 Pi Stuff Package。保留
`pi-fast-resume@1.4.9` 可观察的交互与配置契约，同时把所有权适配到 Pi Stuff 的 Command Dialog、合并设置、
诊断、Effect scope、测试和 Suite 组合。

Fast Resume 只读取有界 Session 区域。它从 Pi 的活动 Session 目录发现候选项，按文件系统修改时间排序，从文件
开头读取完整 JSONL 行，直到获得 Session header 与首条用户消息，再检查有界尾部窗口中的最新名称元数据。它
不建立全文索引、不保留 transcript 正文，也不写 cache。最新的 30 个 Current Folder 候选项形成首帧；其余
Current Folder 工作完成后才开始 All Sessions，随后以有界批次加载 All Sessions。

选择器提供 Current Folder 与 All scope、Threaded 目录呈现、平面的 Recent 与 Fuzzy 呈现、仅 Named 过滤、
模糊搜索、完整引号精确搜索、`re:<pattern>` 正则搜索、手动刷新、重命名和确认删除。搜索只覆盖 Session ID、
解析后的名称、cwd 与首条用户消息。尾部窗口之外的名称可能缺失，消息数量仍是局部读取的估算值。这些是可见的
速度与完整性取舍，而不是暗示与 Pi 完整历史索引等价。

Pi 仍是 Session 生命周期 Owner。Fast Resume 把选择交给 `switchSession`；验证、加载、transcript replay、
cwd 切换和终端行为都由 Pi 负责。重命名使用 Pi 的 Session 元数据写入器。删除保护活动 Session，并先要求确认；
随后限时尝试平台回收站命令，回收站不可用或失败时永久 unlink Session 文件，与已接受的上游行为一致。

Fast Resume 默认通过一个窄而经认证的 Host adapter 接管 `/resume`；该 adapter 只在进程内替换
`InteractiveMode.showSessionSelector`，绝不修改 Pi 安装文件。它保留原方法；当前 command context 不可用时
委托原方法；cleanup 时仅在仍拥有该位置时恢复；认证 seam 不存在时记录 Diagnostic Record。关闭拦截或安装失败
时，Pi Stuff 注册 `/fast-resume`；可选的 Host key ID 打开同一选择器。这个私有 adapter 是明确的兼容性例外，
并不允许随意覆盖其他内置命令。

共享 Command Dialog 拥有可见状态。它保留编辑器 draft 与 Suite chrome，使用 Pi theme role 和 cell-width fitting，
在渐进更新时按 Session 路径保持焦点，并在同一界面中承载搜索、scope、视图、排序、过滤、加载、重命名、确认和
错误状态。控制字符与不安全路径文字会在显示前规范化。

Effect 负责 Capability 与 Dialog 生命周期、有 scope 的后台批次、debounce 计时、中断意图、generation fence、
文件系统/进程失败投影和 cleanup。有界的同步文件系统与子进程调用仍放在 Fast Resume native adapter 后，因为
Host 选择器同步打开，而 Effect interruption 无法抢占不配合取消的原生操作。因此每项操作保持小规模或有时间
上限；新批次发布前检查 generation。Session 替换、reload、Dialog 关闭、刷新和 Host shutdown 会取消过期工作，
阻止迟到 UI 更新。

`<agentDir>/pi-stuff.json` 中的 `fastResume` 命名空间保留上游含义：`hijackResume` 默认为 `true`，可选
`shortcut` 是 Pi key ID。启动时只读取，不创建、迁移或重写设置。格式错误的命名空间会安全回退到默认值，并
产生有界 Diagnostic Record。

移植设计源自 `monotykamary/pi-fast-resume` 1.4.9 版、commit
`aa7a4dbe1be9f9c74b1110f6b797fa1e45a61572`。其 MIT 声明与署名保留在 Module 的第三方说明中。适配后的 Source
不因来源而获得任何质量豁免。

## 备选方案

- **将 `pi-fast-resume` 作为另一个 Package 安装：** 拒绝，因为它会重复 Package、配置、生命周期、UI 与发布所有权。
- **只注册 `/fast-resume`：** 拒绝作为默认方案，因为日常入口要求为 `/resume`；拦截关闭或不可用时仍保留为公开回退。
- **修改已安装的 Pi Host：** 拒绝，因为升级会替换制品，Pi Stuff 也不得安装或重写 Host。
- **增加持久完整历史索引：** 拒绝，因为有界读取已满足延迟目标，索引会引入当前行为不需要的数据生命周期、隐私、失效与迁移工作。
- **让有界元数据精确：** 拒绝，因为精确名称、数量与完整历史搜索需要更多 I/O 或持久索引。选择器会说明近似值，并保留原生 resume 作为完整路径。
- **只允许回收站删除：** 根据明确的产品决策拒绝；确认后的永久 unlink 回退属于已接受行为。

## 结果

日常 resume 在完整 Session 历史尚无法解析完时即可交互，而 Host 继续拥有选中的 Session。实现不新增网络、cache、
database、独立 Package 或 Host 文件变更。

该 Capability 依赖经认证的私有 Host seam。未来 Pi 版本可在 adapter 重新认证之前关闭拦截；原生 `/resume` 和公开
`/fast-resume` 仍是恢复路径。有界读取也意味着：当精确完整历史搜索或元数据比延迟更重要时，用户必须选择
原生 resume。
