<!-- translation-source: docs/compatibility.md; translation-source-sha256: 63766889c809f1c54956c6162c2a0e9577ca2f05d70adce0323fff9c28d028a0 -->

# 兼容性

## 已认证 Host

| 契约 | 已认证版本 |
| --- | --- |
| Pi standalone Host | `0.85.0`，上游 `107d79f11072bbc8a3a757ed7fd69596bee7d68c`，Linux x64 |
| Pi Release archive | SHA-256 `a7e7c65f1dc528d2e17e7d946ad2b61df0e2b0f9952faee77807c2484b464d6e` |
| Pi Release executable | SHA-256 `0cfd1bf3e9468f1052d172502fa388e8e8e53dcdeb9fa97f1ef828fdd7757072`，105,764,992 bytes |
| Pi Host 内嵌 Bun runtime | 1.3.14 |
| 仓库 Bun 工具链 | 1.4.0 |
| Pi Stuff Package | 0.3.3 |
| 仓库开发 Package | 0.0.0 |
| 系统工具基线 | Ubuntu 24.04，包含 Bash、curl、tar、gzip 和标准 Unix 工具；不含 `pwsh` |
| PTY 验证工具 | Ubuntu 24.04 的 Expect 与 tmux package |
| TypeScript checker | 5.9.3 |
| Code Mode Host | OpenAI Codex `rust-v0.145.0`，Linux x64 |
| Code Mode Host Release archive | SHA-256 `ac23177956c30cc1f9f180c27bd80f5bb5b76780db55fb94dcc22644d490852e` |
| 可选 RTK runtime | 官方 `0.45.0`，源码 `b34be37caf3796b69a50952a28e60e32b5daad43`，Linux x64 |
| RTK Release archive | SHA-256 `c4c036fbf181fc55ef329786c8c17e0d427972b053b825944d968a6aafef1ba4` |
| RTK Release executable | SHA-256 `99e0cff729d52297a23eb832f809d9773ba7c32de818dfe76b2cdd900a951535` |

认证的上游 Host 是由上述提交构建、并报告 `0.85.0` 的 `v0.85.0` Linux x64 Release。每条验收路径都会先
哈希可执行文件并拒绝不在已审核 allowlist 中的文件，再覆盖完整 Suite 契约，包括公开
`registerMarkdownTransformer()`、常规与 fullscreen UI 行为，以及保留空格的原生设置搜索。可执行文件身份由
精确二进制哈希确定，而不是可复用的版本字符串。Pi Stuff 不重建或分发 Pi Host。

CI 提供两个稳定检查。`Fast` 始终验证冻结依赖图、仓库格式、anti-slop lint、类型接口、未使用代码分析、生成的
组合以及公开 Release 安全。对 pull request，范围分类器会在可执行行为或可执行文档变化时启动 `Acceptance`；
直接 push 到 `main` 只运行 `Fast`，手动触发则运行两者。`Acceptance` 下载并验证认证 Host Release、Code Mode
Host 和 RTK runtime，然后在网络隔离 namespace 中逐个以全新 Bun 进程运行所有测试文件、真实 TUI 验证、Tool Activity
benchmark 和 Package 验证。逐文件进程隔离可防止某个重进程或 PTY 测试污染后续测试使用的原生资源。只有
Beads 元数据以及已记录的 PNG、GIF、HTML 或 ANSI 证据可以跳过 `Acceptance`；可执行文档仍须完整认证。每周
另有上游观察任务报告 npm `latest` 是否超过当前 Host，但绝不会自动改变认证。

认证执行配置包含两个职责分离的 Bun 版本。已审核 standalone Host 内嵌 Bun 1.3.14；provenance 会先在已审核
字节偏移处检查精确 runtime banner，再对完整可执行文件计算哈希。仓库脚本、CI 测试及通过 PATH 解析 Bun 的
Suite subprocess helper 使用 1.4.0。升级仓库工具链不会重新标记 Host 产物的内嵌 runtime。

Bun 依赖升级必须由维护者明确执行，因为冻结 Bun lockfile、精确仓库工具链、`@types/bun`、CI 和可执行文档
必须协调移动。Host Bun 版本只随新的精确 Release 产物和重新认证而改变。Dependabot 仅覆盖固定版本的 GitHub
Actions；它不会创建遗漏或绕过仓库 Bun lockfile 的 npm pull request。

已认证 Host profile 同时标识 Release 版本、审核过的上游源码提交、Linux x64 Release 二进制哈希和内嵌 Bun
版本。仓库工具链行单独标识仓库命令和 CI 使用的 Bun。CI 在可以联网时下载固定 GitHub Release、完成验证，
随后断网运行验收。Release archive 在解压前检查哈希，Pi 可执行文件在使用前再次检查。升级 Pi 必须一起审查并更新这些
常量；本仓库不声称能复现上游编译过程。

Pi core import 保持 wildcard peer dependency，因为它们由 Host 提供。开发依赖固定到已发布的 `0.85.0` 类型
接口。已发布的 `pi-coding-agent` SDK 通过主入口导入 `pi-server`，却没有在 manifest 中声明该依赖。仓库以开发
依赖补齐精确的 `@earendil-works/pi-server@0.85.0`；Knip 中的单项声明记录了这条由 SDK 拥有的运行时导入。
SDK 源码和 standalone Host 均不打补丁，已安装的 Suite 也不增加该依赖。后续认证 SDK 正确声明依赖后移除
这一临时处理。

User Message 呈现适配 Pi 0.85.0 的原生消息插入和重放方法，保留原生卡片与 Markdown 组件。
行内 Skill 放置观察卡片实例的原生 Markdown token renderer，不使用第二套解析器。精确的 standalone Host 必须通过 Skill＋prompt、纯 Skill、`Ctrl+O`、resize、重放和 reload 验收。结构预检和运行时异常保护保留
原生消息；正常认证输入发生回退不能算通过。Tool 对齐认证限于 `outputPad=1`；其他值仍可设置。

Pi 0.85.0 将 Thinking 内容放在原生可点击 `MouseRegion` 内。经过版本校验的 Thinking 适配器只投影该容器的
子组件，保留 Host 的可见性回调和点击路由。真实 Host PTY 验收覆盖鼠标与键盘展开/收起、最新行呈现，以及
canonical Session 内容保持不变。

版本敏感验证脚本读取共享的认证 Host 契约，不维护各自的 Pi 版本常量。PowerShell 会作为 Pi 内置 Tool
参与生命周期、MCP 名称冲突和 Child Agent 可用性策略，但认证 Linux 基线不包含 `pwsh`，因此不声明
PowerShell 执行或 Windows 行为。真实 RPC Provider fixture 按 Pi 0.85.0 RPC 序列化契约的要求，在
`toolcall_start.partial` 中填充每个 Tool call。Pi 0.85.0 还拥有实时 compaction replay，以及 Tool result 与下一次
Assistant 请求之间的原生阈值检查：它验证持久化边界，通过 `buildContextEntries()` 重建，并只渲染一次摘要。
Suite 不拦截这两条 Host 路径。打包验收证明，大型 Tool result 会触发一次原生阈值压缩，而活跃 Goal 只安排一次
continuation。

Pi 0.85.0 负责 RPC `clear_queue`、终端设置、非触发 Custom Message 排序、Session 与 Provider。Pi Stuff 不包装或
遮蔽这些契约。`clear_queue` 会返回移除的队列，但不发出 Extension event，所以 Conversation UI 无法同步修剪其
观察性归属镜像。下一次无法判定的 user/automatic 混合投递会清空该镜像并 fail closed 为 automatic；真实 RPC
验收覆盖了这个缺口。Host 也会把 Tool 执行期间排入的 `sendMessage({ triggerTurn: false })` 内容推迟到该轮所有
Tool result 持久化之后。

Codex 生成图像的内联使用 Pi 0.85.0 公开 `detectSupportedImageMimeTypeFromFile()` 接缝，从文件字节识别 JPEG、
PNG、GIF、WebP 与 BMP。原有最多四张、每张 25 MiB、仅普通文件和 best-effort 文本回退限制保持不变。内联图像
结果认证的是模型可见媒体和 Host 渲染行为，并不证明 tmux 内能显示图像；实际显示仍取决于 Host、终端协议与
multiplexer passthrough。Pi Stuff 不改终端设置，也不声称 tmux 自身能够渲染这些图像。

Pi 0.84 会为独立加载的 Extension 提供不同的 `ExtensionAPI.events` facade 对象，但它们位于同一个 Host event
bus 上。因此 Suite-wide registry 使用同步 event-bus discovery handoff，只把以 facade 为键的 WeakMap 当作本地
缓存；任何单个 facade 的对象身份都不能当作 Host 身份。真实 PTY 和 cross-facade 单元测试覆盖 Command Dialog
恢复、Tool Activity 元数据、Context 所有权、`/ui` 设置、status channel、Current Work source 和重复生命周期
抑制。

升级 Pi 必须作为一次专门变更：审查相关 Extension 和 Package 接口，同时更新固定开发依赖、源码提交和 Release
二进制哈希，并通过 standalone-host 认证。完成这些工作前，不声明兼容其他 Pi 构建。

changelog、归档验收报告、研究笔记和已捕获 prototype 中的旧版本字符串描述的是产生这些历史证据的 Host。
不得改写它们来暗示旧证据来自当前 Host。当前源码、Package manifest、CI、fixture 与验证脚本遵循上表中适用
的 Host 或仓库工具链行。`CERTIFIED_PI_BUN_VERSION` 描述的是已审核 Host 产物，而不是仓库工具链。

Codex Capability 只为认证 Linux x64 profile 打包保留的原生 helper。在其他目标上，命令和普通 Pi turn 仍然
可用，不可用的 Tool 会返回有界恢复错误。
