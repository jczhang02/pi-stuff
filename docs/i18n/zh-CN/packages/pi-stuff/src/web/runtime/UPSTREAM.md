<!-- translation-source: packages/pi-stuff/src/web/runtime/UPSTREAM.md; translation-source-sha256: 4697e387f8e6f72d7ac0baebe6bfbd867534e7fa45e090b4a07580aa3f1b4298 -->

# 上游来源

本目录包含已吸收到 Pi Stuff 的 `pi-web-access` `0.18.0` 改编源码快照。

- 上游仓库：<https://github.com/nicobailon/pi-web-access>
- 上游发布：`v0.18.0`
- 上游源码提交：`d2aab00dcf0547572276d9de4bc4a2a49d640e13`
- npm 软件包：`pi-web-access@0.18.0`
- npm SHA-1：`ee2d325b247b0239eab0d20b6b27eea698a42df4`
- npm 完整性：`sha512-UVLWaNBHrbbe2jnpYq+uVJdPgoExz8HevkI7r3VSboZ6AT/S7oxsxpJY/a72mUt9jAy41512ndVxfxh/CIuYqg==`
- 导入分叉提交：`8e11f1a41547a9415b6d36742a04e3ee2896bcea`
- 原分叉标签：`pi-stuff-v0.18.0-4`
- 原发布资源 SHA-256：`7030811f8c4b0e75a1e5fc60f72916ebec2add2d9d615cf5a01fbde349eaa638`
- 规范源码：`jczhang02/pi-stuff`，`packages/pi-stuff/src/web/runtime`
- 许可证：MIT

分叉标识证明吸收的是哪个本地改编快照；它们不定义需要维护的第二仓库或软件包。本实现保留 Provider 搜索、普通 HTTP/图像/PDF 提取、有界 GitHub API 读取、经过校验的进程局部 SSRF 默认值、存储和继续。Curator、来源检查、页面回答、仓库克隆、YouTube/本地视频、命令、快捷键和私有工具渲染代码均已删除。显式用户 SSRF 配置仍是权威。Pi Stuff 还用软件包负责的 Web 设置读取器替换了快照中重复的 Provider 配置解析器，并从一个带类型 Provider 注册表派生分派、可用性、标签和安全自动路由。
