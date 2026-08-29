<!-- translation-source: packages/pi-stuff/src/code-mode/UPSTREAM.md; translation-source-sha256: dfb60b40b267f17c82336b07172b23b4f3b8abf039e46920acaab9105859f864 -->

# 上游来源

Pi Stuff Code Mode 是 monorepo 内自有分叉，派生自 `@howaboua/pi-codex-conversion` 中的代码模式实现。

- 上游仓库：`https://github.com/IgorWarzocha/howaboua-pi-stuff`
- 上游软件包目录：`packages/pi-codex-conversion/src/tools/code-mode`
- 已审查上游提交：`b3591d996efbf6df293e426dea2bb2dd17fcbfe6`
- 上游许可证：MIT；其版权声明保留在 `LICENSE`。
- 接口参考：Cloudflare Code Mode，`https://blog.cloudflare.com/code-mode/`
- V8 宿主：OpenAI Codex 发布版 `rust-v0.145.0`，`https://github.com/openai/codex`
- V8 宿主许可证：Apache-2.0；许可证正文位于 `LICENSES/Apache-2.0.txt`。
- Cloudflare 兼容源码：`@cloudflare/codemode` `0.5.1`，标签提交 `f089c5b6a13f98ad728f9c9cb9d729469b945233`，npm SHA-1 `9f9386ce676f77e7e651731103e8bd090a04c8f8`，npm 完整性 `sha512-PcX5+qAvupi8p1bMLKhqvPHziZpDubbrxDIvVH+iuuNUaFyOxxWNS9HplfFqIULqUzDPdFf1w7IiSCKHp7GDgg==`。
- Cloudflare 许可证：MIT；其声明保留在 `LICENSES/Cloudflare-MIT.txt`。

## Pi Stuff 差异

- 让代码模式适用于整个套件且与模型/Provider 无关，而不是替换 OpenAI 传输。
- 呈现一个普通 Pi 函数工具 `codemode({ code })`；不重写 Provider 载荷，也不维护模型名称兼容表。
- 把每个活跃且由 Pi Stuff 软件包负责的工具投影到本地 V8 Connector。另行安装的第三方工具保持直接调用，因为软件包不负责其私有调用路径。
- 让程序化工具 Schema、搜索和描述留在 V8 本地。Provider 接收小型执行/搜索工具对以及任何非自有第三方工具；不存在逐工具调用方路由策略。
- 在工具内自动等待已经让出的 cell，因此不需要面向 Provider 的 `wait` Schema，也不会遗留继续状态。
- 对嵌套调用重新进入原始工具准备、校验、软件包负责的生命周期/结果钩子、动态工具激活、终止、取消和用量核算，不绑定 Pi 私有分派 API。
- 直接渲染原始 Pi Stuff 工具组件，并让代码模式封装在视觉上保持静默。把嵌套追踪持久化到普通会话详情，使实时执行和重载共享一个投影。
- 延迟安装固定的官方宿主，支持代理、取消、校验和、进程间锁与原子暂存。不把原生二进制文件复制到本仓库。
- 排除上游 Provider 替换、Responses Lite 传输、模型门控、自定义 PATH/TOML 工具、原生压缩、提示词替换、语音、后台 Shell UI 和代码模式专用视觉框架。
- 在本地复用 Cloudflare 与运行时无关的源码规范化、Connector 搜索/描述、名称清理、Schema 到 TypeScript 转换、代码片段、二进制/BigInt 编解码器和确定性重放序列化。内嵌文件只在 ESM 导入后缀、格式和 Pi Stuff 更严格 TypeScript 检查所需防护上存在差异；不导入仅适用于 Workers 的执行器和 Durable Object 存储。
- 把批准、重放、拒绝、过期、回滚和生命周期状态存入 Pi 会话条目，同时继续使用 OpenAI Codex V8 Runtime，而不是 Cloudflare 仅适用于 Workers 的执行器。
