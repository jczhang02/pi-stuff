<!-- translation-source: docs/compatibility.md; translation-source-sha256: c206880fdd115c4f72b811a969f72b2c467e18d89a2bbf0193e0c96d04bc7fca -->

# 兼容性

## 受支持的 Host

| 契约 | 已认证版本 |
| --- | --- |
| Pi standalone Host | `0.85.0`，上游 `107d79f11072bbc8a3a757ed7fd69596bee7d68c`，Linux x64 |
| 仓库 Bun 工具链 | 1.4.0 |
| Pi Stuff Package | 0.3.3 |
| 仓库开发 Package | 0.0.0 |
| 系统工具基线 | Ubuntu 24.04，包含 Bash、curl、tar、gzip 和标准 Unix 工具；不含 `pwsh` |
| PTY 验证工具 | Ubuntu 24.04 的 Expect 与 tmux package |
| TypeScript checker | 5.9.3 |
| Code Mode Host | OpenAI Codex `rust-v0.145.0`，Linux x64 |
| Code Mode Host Release archive | SHA-256 `ac23177956c30cc1f9f180c27bd80f5bb5b76780db55fb94dcc22644d490852e` |
| Code Mode Host executable | SHA-256 `60bf16414be5333f09ff082540082304c7352931ef64bdeb170d4c35a82e6ef8` |
| 可选 RTK runtime | 官方 `0.45.0`，源码 `b34be37caf3796b69a50952a28e60e32b5daad43`，Linux x64 |
| RTK Release archive | SHA-256 `c4c036fbf181fc55ef329786c8c17e0d427972b053b825944d968a6aafef1ba4` |
| RTK Release executable | SHA-256 `99e0cff729d52297a23eb832f809d9773ba7c32de818dfe76b2cdd900a951535` |

受支持的 Host profile 是 Linux x64 上的 Pi `0.85.0`。上述上游源码提交作为来源参考保留。验收会在真实 Host 上
通过 Pi 的公开 API 覆盖完整 Suite 契约，包括公开的 `registerMarkdownTransformer()`、常规与 fullscreen UI 行为，
以及保留空格的原生设置搜索。仅匹配版本还不够：Host 还必须通过适用的真实 Host 能力验收。Pi Stuff 不重建或
分发 Pi Host。

CI 使用四个 job：`Plan`、`Checks`、`Tests`、`Verify`。它们在 pull request、push 到 `main` 和手动触发时运行；
`Plan` 对 PR 比较 target range，对 push 比较 before/after range，手动触发则选择完整离线清单，并把范围与
`tests_required` 决策写入 artifact。`Checks` 独立于 `Tests` 验证冻结依赖图、仓库格式、anti-slop lint、类型接口、
未使用代码分析、生成组合和公开 Release 安全。当 `Plan` 要求 Tests 时，该 job 获取受支持的 Pi Host、Code Mode
Host 和 RTK runtime，在网络隔离 namespace 中逐个以全新 Bun 或 Node 进程运行选中的离线文件。`Tests` 只等待
`Plan`，不等待 `Checks`；只有成功的 plan 明确选择零测试时才跳过。`Verify` 始终运行，并校验 plan、每个必需
job 的结果、精确的选中文件覆盖和结构化 test report。Plan 与 test report 是分开的 artifacts。同一 pull request
只有过时运行会被取消；不同 main-push range 保留。workflow 配置已实现，但托管执行和最终迁移认证仍待完成。

仓库工具链使用 Bun 1.4.0。Host 自带的 runtime 和 Release 打包属于 Host 细节，不是 Pi Stuff 的兼容性准入标准。

Bun 依赖升级必须由维护者明确执行，因为冻结 Bun lockfile、精确仓库工具链、`@types/bun`、CI 和可执行文档
必须协调移动。Dependabot 仅覆盖固定版本的 GitHub Actions；它不会创建遗漏或绕过仓库 Bun lockfile 的 npm pull request。

受支持的 Host profile 标识 Release 版本、审核过的上游源码提交和 Linux x64 平台。仓库工具链行单独标识仓库
命令和 CI 使用的 Bun。升级 Pi 必须一起审查受支持版本、公开 API 接缝和真实 Host 能力证据；本仓库不声称能复现
上游编译过程。

Pi core import 保持 wildcard peer dependency，因为它们由 Host 提供。开发依赖固定到已发布的 `0.85.0` 类型
接口。已发布的 `pi-coding-agent` SDK 通过主入口导入 `pi-server`，却没有在 manifest 中声明该依赖。仓库以开发
依赖补齐精确的 `@earendil-works/pi-server@0.85.0`；Knip 中的单项声明记录了这条由 SDK 拥有的运行时导入。
SDK 源码和 standalone Host 均不打补丁，已安装的 Suite 也不增加该依赖。后续认证 SDK 正确声明依赖后移除
这一临时处理。

User Message 呈现适配 Pi 0.85.0 的原生消息插入和重放方法，保留原生卡片与 Markdown 组件。
行内 Skill 放置观察卡片实例的原生 Markdown token renderer，不使用第二套解析器。精确的 standalone Host 必须通过 Skill＋prompt、纯 Skill、`Ctrl+O`、resize、重放和 reload 验收。结构预检和运行时异常保护保留
原生消息；正常认证输入发生回退不能算通过。Tool 对齐认证限于 `outputPad=1`；其他值仍可设置。

输入增强编辑器暴露 Pi 0.85.0 的原生内嵌运行状态能力。Host spinner 与运行提示使用顶部边框和原生 thinking
等级配色，不再重复显示独立运行行。真实 Host PTY 覆盖普通／全屏、深色／浅色、窄窗口缩放、弹窗恢复、取消、
reload、完成，以及既有的 500 ms Vibe Line Spinner 活性限制。

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

升级 Pi 必须作为一次专门变更：审查相关 Extension 和 Package 接口，同时更新固定开发依赖和来源参考，并通过真实
Host 能力验收。完成这些工作前，不声明兼容其他 Pi 构建。

changelog、归档验收报告、研究笔记和已捕获 prototype 中的旧版本字符串描述的是产生这些历史证据的 Host。
不得改写它们来暗示旧证据来自当前 Host。当前源码、Package manifest、CI、fixture 与验证脚本遵循上表中适用
的 Host 或仓库工具链行。`CERTIFIED_PI_BUN_VERSION` 仅在明确使用仓库工具链时描述该工具链，不是 Pi 兼容性门槛。

Codex Capability 只为认证 Linux x64 profile 打包保留的原生 helper。在其他目标上，命令和普通 Pi turn 仍然
可用，不可用的 Tool 会返回有界恢复错误。
