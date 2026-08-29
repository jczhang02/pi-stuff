<!-- translation-source: packages/pi-stuff/src/mcp/UPSTREAM.md; translation-source-sha256: 2468a177e080e245808864dc1174e3362a0a8adad209b5797c1dce8a409ec415 -->

# 上游来源

Pi Stuff MCP 负责围绕改编版 `nicobailon/pi-mcp-adapter` 源码快照的产品界面；该快照已吸收到 `packages/pi-stuff/src/mcp/runtime`。

- 原始发布：`2.19.0`
- 原始源码提交：`cde58793327b15d65f86e59ec9025d649cb8c300`
- 原始 npm SHA-1：`44fe4388436b507b3abfc073e34f82d5d7b8ff37`
- 原始 npm 完整性：`sha512-2FwyuQKFWJP9kO8nl83fAEl+d10MxENqw7TvMcINlJn0yLVCHb5WevN06jpKo19GBi7BBkD6Ri7Sq2rJyiYZiQ==`
- 原分叉仓库：`jczhang02/pi-mcp-adapter`
- 已吸收分叉提交：`2333b79429ea28f6a7d24ca7ad7a169e07b7cf7d`
- 原分叉标签：`pi-stuff-v2.19.0-7`
- 原发布资源 SHA-256：`b0fbbcdcca56c28c49884b69002f1519504ab538afd1abf86e00247aeb441478`
- 规范 Pi Stuff 源码：`packages/pi-stuff/src/mcp/runtime`
- 许可证：MIT

保留原分叉身份只为证明精确导入字节。不存在需要维护的第二仓库、软件包或发布生命周期。

## Pi Stuff 差异

- 只暴露一个有界工具，使用字面量排名发现；在物理上省略正则、直接调用、脚本、Prompt、Sampling、Elicitation 和 MCP Apps 界面。
- 用共享命令对话框和显式 `.mcp.json` 指引替换浮动状态/设置/认证面板。
- 让 `/mcp` 成为唯一持久 MCP 状态权威，并抑制吸收实现的页脚。
- 把已确认的逐服务器自动/按需连接策略持久化为范围狭窄的项目局部 MCP 覆盖。
- 先关闭 Streamable HTTP 探针和实时会话，再关闭其 SDK 客户端。
- 只保留 SDK、传输、OAuth、生命周期、元数据缓存、资源、批准、追踪和输出防护通道。
