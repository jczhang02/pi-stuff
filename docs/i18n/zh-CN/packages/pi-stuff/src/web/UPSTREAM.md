<!-- translation-source: packages/pi-stuff/src/web/UPSTREAM.md; translation-source-sha256: ccb0ab14340010d176987493ce38154aaf36c3a04f3d3ae6b7a9fbc37a90b8b8 -->

# 上游来源

Pi Stuff Web 负责围绕改编版 `nicobailon/pi-web-access` 源码快照的产品界面；该快照已吸收到 `packages/pi-stuff/src/web/runtime`。

- 原始发布：`0.18.0`
- 原始源码提交：`d2aab00dcf0547572276d9de4bc4a2a49d640e13`
- 原始 npm SHA-1：`ee2d325b247b0239eab0d20b6b27eea698a42df4`
- 原始 npm 完整性：`sha512-UVLWaNBHrbbe2jnpYq+uVJdPgoExz8HevkI7r3VSboZ6AT/S7oxsxpJY/a72mUt9jAy41512ndVxfxh/CIuYqg==`
- 原分叉仓库：`jczhang02/pi-web-access`
- 已吸收分叉提交：`8e11f1a41547a9415b6d36742a04e3ee2896bcea`
- 原分叉标签：`pi-stuff-v0.18.0-4`
- 原发布资源 SHA-256：`7030811f8c4b0e75a1e5fc60f72916ebec2add2d9d615cf5a01fbde349eaa638`
- 规范 Pi Stuff 源码：`packages/pi-stuff/src/web/runtime`
- 许可证：MIT

保留原分叉身份只为证明精确导入字节。不存在需要维护的第二仓库、软件包或发布生命周期。

## Pi Stuff 差异

- 只暴露搜索、HTTP(S)/PDF 读取和有界继续检索。
- 强制非浏览器搜索，并禁用后台完整页面扇出。
- 使用有界 GitHub API 读取，不克隆仓库，并删除 YouTube/本地视频专用行为。
- 提取前拒绝非 HTTP(S)、含凭据和异常 URL；之后仍以吸收实现的 DNS/IP SSRF 防护为准。
- 只在抓取开始时检测系统 TUN 假 IP DNS，并提供进程局部默认值，不写入设置。
- 删除上游 Curator、来源检查、页面回答、命令、快捷键和私有工具渲染界面；父模块负责三个保留工具及其共享套件呈现。
