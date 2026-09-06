<!-- translation-source: docs/reports/quality-assurance-migration-20260906.md; translation-source-sha256: 419c6950bdf68880213817c413c6a87d4e205b01c095e1f634175c3495b06d72 -->

# 质量保障迁移——2026-09-06

## 第一批：命令和执行边界

基线：`cac0e79a866c3973a1515a5044441e136f30652e`。这是检查点证据，不是整个
[迁移设计](../adr/0032-organize-quality-assurance-by-verification-purpose.md)的最终验收。

| 证据 | 之前 | 第一批 |
| --- | --- | --- |
| `check` 范围 | 静态检查、全部测试、Tool Activity benchmark、归档／Host 聚合 | 只读静态检查，包括源码 Package 验证 |
| 普通测试 runner | Bun runner 加单独调用的 Goal runner；忽略参数 | 一个可选择的文件清单；Bun 与编译后的 Node 文件仍使用独立 OS 进程 |
| 重复 Host 验证器族 | Package 聚合再次调用十个已有测试的验证器族 | 删除十次调用；七个原先独有的调用有了主测试入口 |
| Package 聚合中的 Suite surface | 打包前后各一次 | 一个 inspector 场景；安装后的源码发现提供独立证据 |
| Package 交付证据 | 创建／提取归档 | 真实 `pi install`、隔离设置、checkout 外加载 |
| 变更涉及的实现／测试源码 | 4,525 物理行 | 4,856 物理行（+331） |

新增源码用于参数校验、报告、live profile 边界、真实安装证据和适量命令测试，没有新增依赖或第二套产品 runtime。
最大的变更文件仍低于 800 行门槛；独立审查评估了超过 500 行的文件，认为职责内聚。

本地 Linux x64、Bun 1.4.0 和 Pi 0.85.0 的聚焦执行结果：

- 命令预览、无效选择器、benchmark 发现、源码约束和选中的 Goal Node 测试通过。Node 执行前只编译一次；
  Node 测试报告三个用例共 6.64 ms。
- 源码安装耗时 3.29 秒。Suite inspector、Web fixture、Goal lifecycle、Notification PTY 和 Host seams 合计
  52.02 秒。MCP PTY 为 17.78 秒；RTK PTY 为 7.48 秒，均通过。
- Benchmark 命令测试 6.80 秒，源码 Package 测试 0.11 秒，Effect 比较工具测试 7.52 秒，均通过。
  Tool Activity 完成并写入本地 JSON 报告，比较耗时值不作为门禁。
- 集成后的 `bun run check` 通过。没有运行真实模型 benchmark。针对最终检查点源码，两轮连续独立
  Thermo-Nuclear 审查均无发现。

这些耗时的范围不同，不能相加当作完整测试耗时，也不代表迁移前后加速。基线与最终完整 CI 比较仍属于最终迁移证据。
本地 JSON 报告在忽略的 `.artifacts/tests/` 下，benchmark 报告独立存放。

## 第二批：测试分类与精简

基线为第一批检查点 `f506b4f1`；这是经过审查的第二批检查点。当前测试清单共 332 个文件（331 个离线文件、1 个显式在线文件）：Component 130、Component Integration 159、System 2、System Integration 10、Acceptance 31。目录采用 `level/capability/scenario`；helpers 保留在中性的 `test/<legacy-capability>` 位置。Goal smoke 已改名为 `test/component-integration/goal/goal-runtime.test.mjs` 并使用原生 Bun scenarios；其余 21 个 `.node.ts` 保留 Node 兼容边界，执行前只编译一次。

runner 支持 `--level`、`--capability`、`--file`、`--name`。同一维度的重复 selector 取并集，不同维度取交集；`--name` 是原生 regex candidate filter，不扫描源码名称。未知参数和空的显式选择失败。默认 profile 为 offline；live 必须显式使用 `--profile live`，唯一的 live Magic Context wrapper 是 `magic-context-live`。`--list` 只预览要求，不执行 setup。`.artifacts/tests/` 报告记录实际文件/process duration 与 setup duration；实际 tests 为零（包括 Node）时返回非零。

Code Mode RPC/TUI offline Acceptance wrapper 使用真实 Host 与 fixture Provider。Agent 执行结果：RPC 8.33 秒；TUI group/failure/media/cancel 113.48 秒，resume 宽度 100 和 64；Goal native name selection 0.52 秒；Unit selector 三个测试 1.2 秒；Node no-match 正确以零测试失败。Code Mode executable SHA-256 为 `60bf16414be5333f09ff082540082304c7352931ef64bdeb170d4c35a82e6ef8`，已加入 compatibility。

真实 RTK 场景要求经过认证的可执行文件，显式缺失会失败。共享 test-environment helper 已实现前置检查。150 ms 首个 UI/input/selection 目标与 200 ms 不变 spinner 目标仍是显式 PTY 要求，ADR 0025 的 500 ms severe-stall 是独立 backstop，稳定 focused certification 尚未完成。本批未运行 full test suite、final CI/affected selection 或 live Magic Context；Batch 3 负责 affected selection 与 CI orchestration。


生成器测试删除了固定三个 wrapper 语句和 Goal 精确多行格式的断言。Capability 成员语义、Suite loader 行为与真实源码安装验收继续提供证据。

同机单次聚焦对比（含 Bun 启动）：生成器迁移前 `0.185 s`、迁移后 `0.168 s`；Suite loader 迁移前 `0.573 s`、迁移后 `0.504 s`。干净基线与当前 worktree 均通过；微小差异不能证明整体加速。本批涉及 JavaScript/TypeScript 源码的物理行数为迁移前 79,366、迁移后 79,824（+458），大部分源码随文件移动而保留。

Web 直接 Provider API 的重定向声明检查已归入 Static Checks，一个小型 Component 测试保护基于 AST 的声明计数；它保留旧有数量对应约束，不宣称证明请求数据流。Codex 原生工具检查不再因不支持或缺少可执行文件而跳过，真实本地二进制的三个场景已通过。缺少 Pi 的前置检查已验证：场景不执行，报告明确记录环境失败。静态检查、聚焦命令、原生工具、Node 兼容性和真实 Code Mode 验收检查已通过。针对完整 diff，两轮连续独立 Thermo-Nuclear 审查均无发现。

## 可复用诊断

**RTK 环境身份：**维护者默认可执行文件未通过认证 SHA-256 检查。这是环境失败，不是耗时回退或偶发测试问题。
下载官方 0.45.0 Release 到本地 artifacts 并验证归档及可执行文件哈希后，通过显式 `RTK_BIN`，原场景无需修改即通过。
不要弱化身份检查，也不要把无关本地 RTK 版本当作认证证据。

**删除调用审计：**文件名相似不足以证明覆盖重复。MCP 和 RTK PTY 调用原本没有测试调用方，已在检查点之前恢复。
随后逐项将原聚合的全部 17 个调用对应到真实调用点及其终端尺寸／默认值；删除的十个验证器族已包含原场景。
