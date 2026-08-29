<!-- translation-source: packages/pi-stuff/src/codex/UPSTREAM.md; translation-source-sha256: d3fc92f78404d579cc8aafe5e5ae3be06aaea1e353af275308eab33c1678cd41 -->

# 上游来源

Pi Stuff Codex 包含派生自固定 `@howaboua/pi-codex-conversion` `3.0.7` 快照的源码。

- 历史软件包 URL：`https://github.com/howaboua/pi-codex-conversion`
- 当前上游仓库：`https://github.com/IgorWarzocha/howaboua-pi-stuff`
- 上游软件包目录：`packages/pi-codex-conversion`
- 上游标签：`@howaboua/pi-codex-conversion@3.0.7`
- 已审查上游提交：`b3591d996efbf6df293e426dea2bb2dd17fcbfe6`
- 自有分叉：`https://github.com/jczhang02/pi-codex-conversion`
- 自有分叉分支：`pi-stuff-suite`
- 上游许可证：MIT；保留的声明位于 `LICENSE`。
- 原生辅助程序源码来源：`openai/codex@b545c94041017d000e2c8b2f6272705d21b85dfb`。

## Pi Stuff 差异

- 只保留 `/codex`、Fast 模式、订阅用量、`apply_patch`、`view_image` 和已确认的 `gpt-image-2` 生成。
- 删除上游 Provider 替换、提示词替换、`exec_command`、`write_stdin`、Web 搜索、原生压缩、代码模式、语音、后台 Shell 组件、状态条目和上游设置 UI。
- 每个保留工具都通过内部工具显示约定，每个聚焦界面都通过共享非浮动命令对话框。
- 导入和启动期间不进行网络调用、文件写入、子进程或设置修改。
- 只有显式 `/codex` 操作后才持久化 Fast；只从该操作，或用户驱动的交互式 Codex Agent 运行达到空闲稳定后获取用量。导入或启动期间绝不轮询或获取。
- 不经 Shell 包装直接执行原生辅助程序，包括含 Shell `case`/`esac` 文字的补丁。
- 只捆绑已验证的 Linux x64 辅助二进制文件；不受支持平台作为工具错误失败，不禁用 Pi。

源码与已验证辅助程序已吸收到 Pi Stuff，没有独立软件包或发布生命周期。
