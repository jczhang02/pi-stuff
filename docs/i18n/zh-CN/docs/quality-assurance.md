<!-- translation-source: docs/quality-assurance.md; translation-source-sha256: f22c771c1577e84e95b4aebb853f6e7f6a7ee5b07522d6130b2c891839f6a035 -->

# 质量保障

Static Checks 验证源码，不运行产品场景。Tests 通过声明的接缝证明行为；Capability Benchmarks 独立测量性能或效果；Reviews 评估需求、设计、安全、可维护性与证据质量。

## 当前命令

```bash
bun run check
bun run fix
bun run test --list
bun run test --level acceptance --file repository/source-install.test.ts
bun run test --level component-integration --file goal/goal-runtime.test.mjs
bun run benchmark:capability:ponytail --help
```

`check` 执行格式、lint、TypeScript、依赖和未使用源码、生成组合、仓库安全、Capability Contract Catalog 以及 Package/resource/license 静态验证；不会改写源码或运行 Benchmark。`fix` 才会执行格式和安全 lint 修复。

`test` 发现五个层级下的 332 个文件（331 个离线文件、1 个显式在线文件）：Component (`unit`)、Component Integration (`component-integration`)、System (`system`)、System Integration (`system-integration`) 与 Acceptance (`acceptance`)。目录按 `level/capability/scenario` 组织，每个文件独立 OS process。Goal smoke 是原生 Bun test；其余 21 个 `.node.ts` 保留 Node 兼容边界，只编译一次后运行。同一维度的重复 selector 取并集，不同维度取交集。`--name` 使用原生 test runner 的 regex candidate filter，不扫描源码名称。`--help` 和 `--list` 不执行场景。报告默认写入 `.artifacts/tests/`，记录文件状态、process duration 和 setup duration；失败或空选择返回非零。

默认 profile 是 `offline`：使用 deterministic fixture Provider，不需要凭据，也不调用 live model。需要真实边界的场景仍要求 Real Pi、Node、Code Mode、RTK、Expect、tmux 和本地工具；缺失要求会使 preflight 或场景失败。Live Provider/Service 证据必须显式使用 `--profile live`；唯一的 live Magic Context 场景是 `magic-context-live`。`--list` 只报告工具要求，不执行 setup。

## 源码安装与保留证据

`test/acceptance/repository/source-install.test.ts` 在隔离 Settings 和 XDG 目录中运行认证 Pi 的 `install`，再从 checkout 外启动 Pi，观察已安装 Package 加载的命令，并清理临时环境。Distribution archive 不是交付要求。原 package-verification aggregate 重复的 Host/PTY 场景已移除；源码安装、Suite inspection、Host seam 和依赖互操作各自在相应层级与 Capability 下拥有主归属。

## Benchmarks

现有实验使用 `benchmark:capability:<name>` 命名。它们是 Capability 范围问题，不建立 complete-Suite public-task 结果。执行前使用 `--help` 或 `--list`；需要 live 的实验必须显式选择 `--profile live`。历史报告仍是 dated evidence，新报告默认写入本地 artifacts。

完成的实验即使结果较差也可成功；setup failure 或 incomplete experiment 仍失败。Tool Activity 过去的 250 ms 和 relative 25 ms benchmark 值仅保留为诊断报告值。显式 PTY 要求仍为首个 Tool UI/input/selection 反馈 150 ms，以及不变 Vibe Line Spinner 帧不超过 200 ms；ADR 0025 的 500 ms severe-stall 是独立 backstop，稳定的 focused certification 仍待完成。`benchmark:suite` 尚未注册。

## 迁移状态

第二批完成测试分类与精简、五层 Capability 目录迁移、稳定层级 aliases、过时 acceptance aliases 清理，以及 `--level`、`--capability`、`--file`、`--name`、offline/live profile、严格空/未知选择失败、环境报告和 timing。Code Mode RPC/TUI 已有使用真实 Host 与 fixture Provider 的 offline Acceptance 归属；live Magic Context wrapper 仍单独存在且未运行。受影响测试选择、CI Plan/Checks/Tests/Verify 编排与最终验证属于第三批工作，见 [ADR 0032](../../../../docs/adr/0032-organize-quality-assurance-by-verification-purpose.md)。
