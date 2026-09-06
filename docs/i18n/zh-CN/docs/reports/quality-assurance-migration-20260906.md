<!-- translation-source: docs/reports/quality-assurance-migration-20260906.md; translation-source-sha256: 8aa9955a9434706c7c78399d8b693ef9de8f9c9ad7547db299771bd472ab4fcc -->

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

## 可复用诊断

**RTK 环境身份：**维护者默认可执行文件未通过认证 SHA-256 检查。这是环境失败，不是耗时回退或偶发测试问题。
下载官方 0.45.0 Release 到本地 artifacts 并验证归档及可执行文件哈希后，通过显式 `RTK_BIN`，原场景无需修改即通过。
不要弱化身份检查，也不要把无关本地 RTK 版本当作认证证据。

**删除调用审计：**文件名相似不足以证明覆盖重复。MCP 和 RTK PTY 调用原本没有测试调用方，已在检查点之前恢复。
随后逐项将原聚合的全部 17 个调用对应到真实调用点及其终端尺寸／默认值；删除的十个验证器族已包含原场景。
