<!-- translation-source: docs/quality-assurance.md; translation-source-sha256: 30eef1463838fef6f86f51774017be2b209fb48ffe128bac32bd00cc67d79dad -->

# 质量保障

Static Checks 不运行产品场景，而是验证源码。Tests 通过声明的接缝证明行为。Capability Benchmarks 独立于验证门禁，
测量性能或效果。Reviews 评估需求、设计、安全、可维护性以及这些证据的价值。

## 当前命令

```bash
bun run check
bun run fix
bun run test --list
bun run test --file source-install
bun run test --file goal-upstream/command.node.ts
bun run benchmark:capability:ponytail --help
```

`check` 运行格式、lint、全部 TypeScript 配置、依赖与未使用源码分析、生成组合、仓库安全、Capability Contract Catalog，
以及静态 Package／资源／许可证验证。它不改写源码，也不运行 Benchmarks。`fix` 显式应用格式和安全 lint 修复；
生成组合和快照仍有各自的显式更新操作。

`test` 发现 Bun 测试以及 Goal Node 兼容性测试集，包括 Goal runtime smoke。每个文件使用独立 OS 进程。
重复的 `--file` 参数和位置路径片段取并集，每个显式选择器都必须匹配。`--help` 和 `--list` 不执行场景。
报告默认写到 `.artifacts/tests/` 下带时间戳的 JSON；`--output <path>` 修改目的地。报告记录实际执行的文件、退出状态
和逐文件耗时。文件失败会让命令失败，但后续选中文件仍然运行。

普通 Tests 使用确定性 fixture，不使用模型凭据。场景使用真实边界时，需要本地 Pi、Node、Code Mode、RTK、Expect、tmux
和系统工具；缺少工具会让对应场景失败。配置后的真实 Provider 和 Service 证据独立于这些离线结果。

## 源码安装和保留证据

静态 Package 验证检查源码／资源、声明的外部依赖、原生 Tool 可执行权限及许可证／来源记录。分发归档不是交付要求。

`test/source-install.test.ts` 在隔离 Settings 和 XDG 目录下调用认证 Pi 的 `install` 命令，再从 checkout 之外启动 Pi，
观察通过已安装 Package 设置加载的命令。它不改变维护者的安装；安装后的进程和临时环境均会清理。

旧 Package 验证聚合重复运行了测试文件已拥有的 Agents、BTW、Context、Goal、Tools、UI 和 Background Work
Host／PTY 场景。这些重复调用已移除。独有的 Suite Tool inspector、Web fixture 集成、Goal lifecycle、MCP／RTK／Notification PTY
和公开 Host 接缝场景迁入 `test/package-host.test.ts`。现有 RPC 和 PTY 测试观察不同契约，因此继续保留。

## Benchmarks

现有实验命名为 `benchmark:capability:<name>`。图像传递、Ponytail 行为效果、Skill Discovery、Markdown、Effect/mainline、
lifecycle、Magic Context 和 Tool Activity 都是 Capability 范围的问题。使用完整 Host 不等于证明完整 Suite 的公开任务结果。

执行前使用各命令的 `--help` 或 `--list`。Ponytail、Code Mode image 和认证 Skill Discovery 实验要求 `--profile live`；
帮助和预览不使用凭据。历史报告继续作为带日期的证据；除非显式选择输出位置，新报告写到本地 artifacts。

完成的实验可以报告较差分数或性能回退而不让命令失败。准备失败和不完整实验仍失败。Tool Activity 原来的 250 ms 和
相对 25 ms 限制保留为报告诊断值，不再作为验证门禁。它们测量比较结果，并非独立定义的性能要求。
另一个 200 ms spinner 要求的审计尚待完成。

Suite Outcome Evaluation 分支保留给完整 Suite 的公开任务评估。历史 Terminal-Bench manifest 和报告不是可运行评估；
仓库没有注册 `benchmark:suite`。

## 迁移状态

第一批分离命令执行边界，移除重复的归档／Host 调用。当前 CI 仍使用 Fast／Acceptance 编排，但调用新的静态和测试命令，
没有 benchmark 门禁。五层目录分类、Capability 和测试名称筛选、保守 `verify` 选择、显式 live 验收路由，以及
Plan／Checks／Tests／Verify CI 属于 [ADR 0032](adr/0032-organize-quality-assurance-by-verification-purpose.md)
后续迁移批次，尚未作为已完成命令暴露。
