<!-- translation-source: docs/research/work-btw-package-reference.md; translation-source-sha256: 49733a0669ff5c2988c37d43be5ceccd992c96e0548bc0229d21b96629560d74 -->
# Work BTW Package 参考

**审计日期：** 2026-08-01
**已认证 Host：** Pi 0.83.0，Linux x64
**决策：** 选择 `@juicesharp/rpiv-btw@2.3.1` 的自有 fork；不 fork `@narumitw/pi-btw`

## 决策

Pi Stuff 应从源提交 [`75823a68024a0a649cc28087976074be791ca554`](https://github.com/juicesharp/rpiv-mono/tree/75823a68024a0a649cc28087976074be791ca554) fork [`@juicesharp/rpiv-btw@2.3.1`](https://registry.npmjs.org/@juicesharp%2Frpiv-btw/2.3.1)。

这取代了此前认为 `@narumitw/pi-btw` 是首选 fork 候选的工作假设。在 BTW 产品形态确定之前，早先的假设是合理的。在维护者选择当前的 Claude Code 生命周期——一次无工具问题、一次回答、无后续输入编辑器——之后，更窄的 rpiv Package 是更好的能力基础。

该选择是源代码基础决策，并不代表批准上游 UI。Pi Stuff 将保留有用的请求、上下文、取消和预算机制，同时替换浮动覆盖层并移除不属于所选产品的行为。

本审计未导入或实现任何 fork。

## 用于比较的产品契约

已接受的 BTW 行为记录在 [Work BTW UI reference](./work-btw-ui-reference.md) 中。具体来说：

1. 主 Agent 仍在工作，用户提交 `/btw <question>`。
2. BTW 可以看到当前父级对话，但不接收工具。
3. 一次独立的模型请求产生一个回答。BTW 没有后续回合的输入编辑器。
4. 问题和回答永远不会进入主 transcript 或主模型上下文。
5. 较早的 session-local 交流可以重新打开、浏览和清除，作为显示历史。
6. 取消 BTW 永远不会取消主 Agent。
7. 需要工具或持续工作的内容会提升到 Agent/session 系统。
8. Pi Stuff 通过共享的全宽、分隔线引导、非浮动 Command Dialog 渲染 BTW，并在之后恢复之前的编辑器和 Suite chrome。

这遵循 Anthropic 当前的 [`/btw` 文档](https://code.claude.com/docs/en/interactive-mode#side-questions-with-btw)：侧边调用可以看到当前对话、没有工具、在主回合期间独立运行、产生一个响应，并且问题和回答不会进入对话历史。同一文档说明，继续该线程需要将其 fork 到一个 session；较早的交流仍可作为覆盖层历史使用。

## 所选源身份

| 事实 | 已验证值 |
| --- | --- |
| Package | `@juicesharp/rpiv-btw` |
| 版本 | `2.3.1`，发布于 2026-07-31 |
| 精确源修订 | `75823a68024a0a649cc28087976074be791ca554` |
| 许可证 | MIT，版权所有 2026 juicesharp |
| npm 下载量，2026-07-02 至 2026-07-31 | 4,700 |
| npm archive | `https://registry.npmjs.org/@juicesharp/rpiv-btw/-/rpiv-btw-2.3.1.tgz` |
| npm integrity | `sha512-6gK0z43D90AVe/+Pu248VCRPFSBpnsXe0b9uGSDVRUmZGAvIsGhWIW+4fVo5aq4cQ+07MO5IdOlVE1ngkzZ82g==` |
| 本地观察到的 archive SHA-256 | `5318bbf4256b83825cb56a314bdbfa605e495e68043d83a169a65dd35ceabf59` |
| 发布大小 | 解包后 71,499 字节 |
| 生产 TypeScript | 六个文件共 1,267 行 |
| 上游测试 | 六个文件共 1,811 行 TypeScript；111 个测试 |
| 运行时依赖 | 无；只有 Pi peer dependencies |
| 上游开发 Pi | 0.80.5 |

来源：精确的 [npm registry 记录](https://registry.npmjs.org/@juicesharp%2Frpiv-btw/2.3.1)、固定时间窗口的 [npm 下载记录](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/%40juicesharp%2Frpiv-btw)、精确的 [manifest](https://github.com/juicesharp/rpiv-mono/blob/75823a68024a0a649cc28087976074be791ca554/packages/rpiv-btw/package.json)，以及精确的 [MIT license](https://github.com/juicesharp/rpiv-mono/blob/75823a68024a0a649cc28087976074be791ca554/packages/rpiv-btw/LICENSE)。

npm archive 中的每个源文件、文档、prompt、manifest 和 license 文件，都与记录的 Git 修订中的对应文件逐字节匹配。相对于 2.3.0，2.3.1 只更改了发布元数据；不过，2.3.1 仍是应记录的正确不可变 npm/source 身份。

## 所选基础中值得保留的内容

所选 Package 已经实现了大多数困难的非 UI 边界：

- 一个 `/btw <question>` 命令，而不是第二个 Agent 或工具表面；
- 通过 Pi 的消息转换生成父分支克隆，而不是手工构造的散文摘要；
- 侧边请求显式使用 `tools: []`；
- 当前主模型及其正常的 Pi 凭据解析；
- 独立的 `AbortController`，因此 BTW 取消不会向主回合发送信号；
- compaction 和树变更时的分支快照失效；
- 有界上下文计量、历史上限、分支裁剪，以及一次上下文溢出重试；
- 没有正式 transcript 条目；Pi Stuff 会添加一个独立的、不可见且不进入上下文的历史记录，使已接受的 session-local 历史能够在恢复后继续存在；
- 针对预算、上下文组装、生命周期、错误、取消、UI 宽度和 Host API 兼容性的聚焦测试套件。

这些机制可以在精确的[请求实现](https://github.com/juicesharp/rpiv-mono/blob/75823a68024a0a649cc28087976074be791ca554/packages/rpiv-btw/btw.ts)、[上下文模型](https://github.com/juicesharp/rpiv-mono/blob/75823a68024a0a649cc28087976074be791ca554/packages/rpiv-btw/docs/context-model.md)和[架构记录](https://github.com/juicesharp/rpiv-mono/blob/75823a68024a0a649cc28087976074be791ca554/packages/rpiv-btw/docs/architecture.md)中看到。

这比之前的候选具有明显更小的所有权边界，也没有额外需要 fork 或 pin 的运行时 Package。

## 所需的自有 fork 变更

上游 Package 是基础，而不是完成后的 Pi Stuff Capability。在进入默认 Suite 前，fork 必须进行以下有意变更：

1. **完全替换覆盖层。** 上游使用底部居中的浮动覆盖层。Pi Stuff 必须通过共享的非覆盖层 Command Dialog coordinator 路由 BTW，在其拥有焦点时隐藏普通 footer/statusline，并恢复精确的编辑器草稿、Todo、Agent roster 和之前的 Command Dialog 状态。
2. **严格保持一个回答。** 完成后不要添加 BTW 输入编辑器。裸 `/btw` 重新打开最近一次交流；历史导航和清除仍然是显示操作。
3. **不要把重复调用变成隐藏的多回合聊天。** 上游会把之前的 BTW 回合输入到后续模型请求中。Pi Stuff 应保留之前的交流以供浏览，但从父对话加当前侧边问题构建新请求。继续交流属于 forked Agent/session。
4. **移除跨 session 的问题提示。** 上游会将其他 session 中最近十个 BTW 问题字符串加入系统 prompt。Pi Stuff 的 BTW 历史是 session-local；无关 session 不应悄悄影响侧边回答。
5. **在原位流式输出回答。** 上游等待 `completeSimple`，然后把 loader 替换为完整回答。Pi 0.83 暴露了 provider-neutral 的 `streamSimple` 路径；fork 应通过 Command Dialog 投影增量文本，同时保留独立的 abort signal 和 `tools: []` 契约。
6. **保留稳健的父上下文路径。** 保留 Pi 消息转换、compaction/tree 失效、上下文预算和溢出重试。增加主回合仍在流式输出时 BTW 快照上下文的覆盖。
7. **默认使用当前主模型。** 不要继承 Package 专属的模型选择器或 thinking 设置界面。只有在形成单独且有理由支持的决策后，未来才能添加 Suite-wide 模型选择。
8. **与共享 surface 优先级集成。** 破坏性安全 prompt 或确实需要人回答的 Agent 问题可以挂起 BTW；解决后恢复精确的 BTW 状态。完成、失败和普通 Agent 状态永远不能抢走 BTW 焦点。
9. **可见地保留来源。** 保留 MIT notice、精确的上游修订和 archive 身份，以及持续维护的本地变更记录。Aggregate Package 必须依赖自有 Capability Package，永远不能依赖上游 npm Package。

后续产品决策选择了不可见的 session-owned 持久化。历史事件记录其 owner session id，因此恢复时可以还原；`/clear`、新 session 和 Pi 普通 session fork 会得到不同的 id，不会继承它。异常 guard 在 8 MiB 内保留最新的 1,000 次交流；这不是短滚动历史的产品限制。

## 为什么不再选择 `@narumitw/pi-btw` 作为基础

当前 Package 是 [`@narumitw/pi-btw@0.43.0`](https://registry.npmjs.org/@narumitw%2Fpi-btw/0.43.0)，源提交为 [`aceaf779b17655d9102d84a5352984408432b8e3`](https://github.com/narumiruna/pi-extensions/tree/aceaf779b17655d9102d84a5352984408432b8e3)，采用 MIT 许可证。它在同一固定时间窗口报告了 7,640 次下载，直接针对 Pi 0.83.0 开发，并且拥有严肃的测试套件。它是一个可信的 Package，并不是因为质量被否定的 Package。

它的产品和所有权形态现在不适合 Pi Stuff：

- 它有意打开一个带有自身 composer 的临时多回合侧边工作区；
- 成功的较早侧边回合会被输入后续回合；
- 它包含详细的 bring-to-main 选择和预览流程；
- 0.43.0 版本加入了自己的 start/settings 菜单以及持久化的 model-thinking 控件；
- 其 2,741 行生产 TypeScript 通过浮动范围 `^0.42.0` 依赖 `@narumitw/pi-tui-kit`；当前解析到的 0.42.1 UI 库另有 3,516 行生产 TypeScript；
- 要获得已经选定的单次交流 Capability，大多数这类表面都需要删除或替换。

精确的 0.43.0 archive 与其 Git 修订匹配。针对 Pi 0.83.0，其 Package typecheck 通过，119 个 Package 测试通过，真实 Host 加载 `/btw` 时没有 Extension error。因此，该决策依据是产品适配性和 fork 大小，而不是兼容性失败。来源：精确的 [manifest](https://github.com/narumiruna/pi-extensions/blob/aceaf779b17655d9102d84a5352984408432b8e3/extensions/pi-btw/package.json)、[README](https://github.com/narumiruna/pi-extensions/blob/aceaf779b17655d9102d84a5352984408432b8e3/extensions/pi-btw/README.md)、[license](https://github.com/narumiruna/pi-extensions/blob/aceaf779b17655d9102d84a5352984408432b8e3/extensions/pi-btw/LICENSE)，以及固定时间窗口的[下载记录](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/%40narumitw%2Fpi-btw)。

## 其他可信的成熟替代方案

[`pi-btw@0.4.1`](https://registry.npmjs.org/pi-btw/0.4.1) 具有最大的固定窗口采用信号，下载量为 8,391，采用 MIT 许可证。其精确源代码是提交 [`4f858102706910ee9d520a9666832f3103631b61`](https://github.com/dbachelder/pi-btw/tree/4f858102706910ee9d520a9666832f3103631b61)。真实 Pi 0.83 Host 加载了其八个命令，且没有 Extension error。

它不是所选 Capability 的可信基础，因为它创建了一个真实的、启用工具的 Pi sub-session，具有 read、shell、edit 和 write 访问权限；维护持续的侧边对话；提供 injection 和 summarization 命令；并使用聚焦的浮动 modal。这些是有用的能力，但它们重复了已经选定的 multi-Agent kernel，并且违背 BTW 的无工具、单响应边界。下载量无法弥补这种产品不匹配。来源：精确的 [README](https://github.com/dbachelder/pi-btw/blob/4f858102706910ee9d520a9666832f3103631b61/README.md)、[manifest](https://github.com/dbachelder/pi-btw/blob/4f858102706910ee9d520a9666832f3103631b61/package.json)，以及固定时间窗口的[下载记录](https://api.npmjs.org/downloads/point/2026-07-02:2026-07-31/pi-btw)。

较低采用率的 Package 已经过筛选，但没有一个能取代这三个。围绕多个 slot、持久化 sidecar Agent、answer injection 或启用工具的 pane 构建的 Package，都不符合已接受的产品边界。较小的一次性实现，其采用率和测试证据弱于所选的 rpiv 基础。

## 已执行的 Pi 0.83 验证

精确的 `@juicesharp/rpiv-btw@2.3.1` 生产源代码与本地检查过的 2.3.0 源代码相同；2.3.1 只更改 Package 发布元数据。在安装精确的 Pi AI、coding-agent 和 TUI 0.83.0 后：

- 所有 **111** 个 rpiv BTW 测试通过；
- 生产文件和测试文件的严格 TypeScript 检查通过；
- 精确发布的 npm Package 通过真实 Pi 0.83.0 RPC Host 加载；
- `/btw` 已注册，Host 没有发出 Extension error。

同一兼容性 lane 还确认当前的 `@narumitw/pi-btw@0.43.0` typechecks，通过 **119** 个 Package 测试，并通过真实 Pi 0.83.0 Host 加载 `/btw`。未限定 scope 的 `pi-btw@0.4.1` archive 也成功加载并注册其命令族。

这些初始检查没有发起模型请求，也没有使用凭据。自有 fork 现在还有一个确定性的 real-Pi provider lane，覆盖流式输出、并发的主任务/BTW 工作、终端焦点仲裁、重写后的 Command Dialog、持久历史恢复，以及 idle-safe promotion。fixture 是本地且无凭据的。

## Fork 验收门槛

在自有 fork 成为默认 Capability 前，必须通过：

- 一个并发主回合和 BTW 调用的真实 Pi 0.83 测试；
- 断言每个 BTW 请求都携带 `tools: []`，并拥有自己的 abort signal；
- 普通 BTW 历史不修改主 formal-message 或模型上下文；
- 跨进程重启和恢复的不可见历史持久化，以及被提升/新 session 不继承；
- 增量回答、错误、取消和空回答状态；
- 分支切换、compaction、上下文溢出和过期晚到结果场景；
- 更高优先级 Suite surface 出现时的精确挂起和恢复；
- 在 `100 × 32` 和 `64 × 28` 终端交互，包括滚动和草稿恢复；
- copy/clear/history 控件、Space/Enter/Esc 关闭，以及主任务 idle 后使用 `f` promotion；
- 无浮动覆盖层、无 statusline 条目、关闭时 BTW 行数为零；
- packed-archive 审计，涵盖文件、精确 Pi peer、保留的 MIT notice、bundled-dependency 规则和本地变更记录。

生产实现满足上述 BTW-specific unit、real-Host 和 real-PTY 门槛。Pi 0.83 provider-lifecycle seam 仍是明确的兼容性限制，而不是 fork Pi 的理由。

## 最终选择声明

Pi Stuff 将使用 **`@juicesharp/rpiv-btw@2.3.1`，位于 `75823a68024a0a649cc28087976074be791ca554`**，作为 BTW capability base。`@narumitw/pi-btw` 仍是有用的比较证据，但不是 fork base。`pi-btw` 被排除，因为它是另一个支持工具的 Agent system，而不是已接受的轻量侧边问题能力。
