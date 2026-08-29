<!-- translation-source: packages/pi-stuff/src/goal/UPSTREAM.md; translation-source-sha256: 5cfd9d8de1fae014a1b3a24aa0674f76bd932c2ab9df0d291f7903c70f80e093 -->

# 上游来源

| 字段 | 值 |
| --- | --- |
| 上游仓库 | `https://github.com/narumiruna/pi-extensions` |
| 上游软件包 | `extensions/pi-goal` / `@narumitw/pi-goal` |
| 上游发布 | `v0.48.0` |
| 上游提交 | `f0963e4c343124a6f1419163b0425f571282c9b0` |
| 自有分叉 | `https://github.com/jczhang02/pi-extensions` |
| 自有基线分支 | `pi-stuff-goal-v0.48.0` |
| 许可证 | MIT |
| 许可证 SHA-256 | `5293e92f073f47012e723990a8605431b438757e9c6eb00c89868b1203e157da` |
| npm 版本 | `@narumitw/pi-goal@0.48.0` |
| npm `gitHead` | `f0963e4c343124a6f1419163b0425f571282c9b0` |
| npm SHA-1 | `2b8a6ec48afb4f1f5d7139b7ae42adc58c338bcf` |
| npm SRI | `sha512-IOvGEPvqCwuHCNN+hAAGG1B4IzlC8QUj/clPq3E3G5iRHdNip6nsqWnTFCBnLHEiNrMFJkJw0L14n4ugjSft1Q==` |

上游标签精确解析到所记录提交。接纳时，`extensions/pi-goal` 在该提交与上游 `main` 之间没有差异。npm 注册表元数据也指向同一个 `gitHead`。

Pi Stuff 在运行时不使用上游软件包。固定源码快照已吸收到本模块，并按原 MIT 许可证维护，没有独立软件包生命周期。

## Pi Stuff 差异

- 用套件共享全宽命令对话框和 Pi 原生 SettingsList，替换 `@narumitw/pi-tui-kit`、软件包自有状态框架和浮动呈现。
- 通过内部对话 UI 约定发布仅供观察的 Goal 状态；Goal 不负责状态栏。
- 普通使用默认把自动继续和无进展检测设为无限/关闭，同时保留可选的用户限制、token 预算和不可禁用的高位紧急轮次后备限制。
- 只有同一稳定阻塞条件在连续三个 Goal 轮次中都具有不同且实质性的失败尝试证据后，`goal_blocked` 才能停止工作；恢复和编辑会开始新的审计。
- `goal_complete` 停止工作前，要求按需求逐项提供结构化、具体证据。
- 普通 Provider 重试耗尽、压缩、阶段变化和不完整响应都留在活跃 Goal 生命周期内。
- 保留完整上游状态机、队列/RPC 支持、会话持久化和测试语料。
