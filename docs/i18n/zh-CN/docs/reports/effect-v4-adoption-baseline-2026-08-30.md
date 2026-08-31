<!-- translation-source: docs/reports/effect-v4-adoption-baseline-2026-08-30.md; translation-source-sha256: d6bcaa5449442c1eea33b26321ed6af7e330eb438fd5200634f286f8e92c2dff -->

# Effect v4 采用基线与最终对比

**基线测量日期：** 2026-08-30  
**最终测量日期：** 2026-08-31  
**Beads：** `ps-pby`、`ps-pby.1`、`ps-pby.35`  
**基线提交：** `d45db1a7fa6a60defd822c42d3b103be567ac66a`  
**被测实现提交：** `a6edace46111ed89ce44617955fbf525ece863c9`  
**认证 Host：** Pi `0.84.4+source.b79e4cc83497.binary.ce91e1f8bff6.bun.1.3.14`、Linux x64  
**仓库工具链：** Bun `1.4.0`、TypeScript `5.9.3`  
**暂定建议：** **目前不采用（no-go）**

Effect v4 实验保住了已测试的 Suite 契约，也替换了大量原生生命周期机制，但并未让所有可执行认证闸门保持
绿色。完整生命周期验收矩阵执行了全部要求的覆盖，随后拒绝了重复超出 Pi 0.84.2 时期预算的启动、重载和降级
Provider 数据。迁移前提交在同一 Pi 0.84.4 二进制上的匹配测量复现了相同的超预算类别，因此这属于认证基线陈旧，
而不是 Effect 引入这些失败的证据。即便如此，该闸门仍是红色，不能宣称通过。再考虑到候选版本依赖和测得的体积
增长，目前的建议是 no-go。实现分支保留为证据；ADR 0024 继续保持 proposed。

## 定量摘要

| 度量 | 迁移前基线 | Effect v4 最终值 | 变化 |
| --- | ---: | ---: | ---: |
| Package `src/` TS/JS 文件 | 481 | 495 | +14 (+2.91%) |
| Package `src/` TS/JS 物理行数 | 120,140 | 124,233 | +4,093 (+3.41%) |
| Package `src/` TS/JS 代码行数 | 107,857 | 111,942 | +4,085 (+3.79%) |
| 直接运行时依赖 | 19 | 19 | 不变 |
| 已安装依赖树条目 | 433 | 443 | +10 (+2.31%) |
| 归档文件数 | 564 | 578 | +14 (+2.48%) |
| 归档大小 | 4,521,469 bytes | 4,556,566 bytes | +35,097 (+0.78%) |
| 解包文件字节数 | 11,827,546 bytes | 11,978,928 bytes | +151,382 (+1.28%) |
| 新进程启动 p50 | 5,410.89 ms | 4,926.02 ms | -484.87 (-8.96%) |
| 新进程启动 p95 | 7,394.82 ms | 5,030.57 ms | -2,364.25 (-31.97%) |
| 新进程关闭 p50 | 124.64 ms | 135.65 ms | +11.01 (+8.83%) |
| 新进程关闭 p95 | 138.18 ms | 146.31 ms | +8.13 (+5.88%) |
| 生命周期进程最大 RSS | 206,116 KiB | 220,904 KiB | +14,788 (+7.17%) |
| 暖机后 typecheck 墙钟时间 | 59.60 s | 67.37 s | +7.77 (+13.04%) |

Package 的 trusted dependency 仍为零。最终 manifest 用 `effect@4.0.0-rc.112` 替换了 `p-limit@6.2.0`，
所以直接运行时依赖总数不变。Tokei 在最终源码树中统计到六个 JavaScript 文件和 489 个 TypeScript 文件。
依赖树数字是 `bun pm ls --all` 的输出行数，并非唯一 package identity 的数量。`bun pm pack` 报告的最终
归档 SHA-1 为 `20655f1e562dece5ff3e8fa690a233c79a55fdac`。

采用相同方法得到的启动对比是有用的机器证据，但不能直接用于归因：两批测量日期不同，且没有重置全局 kernel
cache。下面的背靠背对照能更好地隔离迁移成本。

## 生命周期机制与分支普查

迁移显著减少了与手工管理异步生命周期机制相关的语法。原生 adapter 仍保留其外部协议所需的原语；这些计数是
证据，不是语义完整性证明。

| 语法 | 基线 | 最终值 | 变化 |
| --- | ---: | ---: | ---: |
| `let` 声明 | 1,290 | 1,261 | -29 (-2.25%) |
| 非 `readonly` 类属性 | 520 | 505 | -15 (-2.88%) |
| `new Promise` | 73 | 29 | -44 (-60.27%) |
| `new AbortController` | 26 | 11 | -15 (-57.69%) |
| `setTimeout` | 72 | 22 | -50 (-69.44%) |
| `setInterval` | 20 | 3 | -17 (-85.00%) |
| `new Worker` | 1 | 1 | 不变 |
| `fetch` 调用 | 31 | 30 | -1 (-3.23%) |
| `Bun.spawn` 调用 | 2 | 2 | 不变 |
| `spawn` / `execFile` / `fork` 调用 | 21 | 20 | -1 (-4.76%) |

| 分支语法 | 基线 | 最终值 | 变化 |
| --- | ---: | ---: | ---: |
| `if` 语句 | 10,804 | 10,855 | +51 (+0.47%) |
| 条件表达式 | 3,407 | 3,570 | +163 (+4.78%) |
| `switch` 语句 | 47 | 47 | 不变 |
| `case` 子句 | 302 | 302 | 不变 |
| 循环 | 1,129 | 1,118 | -11 (-0.97%) |
| `catch` 子句 | 1,121 | 964 | -157 (-14.01%) |
| `&&`、`||` 和 `??` 表达式 | 8,271 | 8,291 | +20 (+0.24%) |

普查使用 TypeScript 5.9.3 读取每个 Package TS/JS 源文件。可变类属性是没有 `readonly` 修饰符的
`PropertyDeclaration`。循环包括 `for`、`for in`、`for of`、`while` 和 `do`。原语计数沿用基线中
完全相同的源码 token pattern。

## 运行时证据

### 已记录的基线方法

两个主要对比批次都先执行一次保留的 warmup，再测量五个 `suite/fresh/exit/80x24` 样本。每个样本都启动一个
新的认证 Pi 进程，并使用冷的进程内 Suite 模块缓存；可执行文件与文件系统缓存已预热，全局 kernel cache 未被
丢弃。

基线启动样本为 4,475.81、4,785.86、5,410.89、7,394.82 和 6,501.81 ms。最终样本为 4,978.02、
5,030.57、4,926.02、4,589.19 和 4,708.92 ms。基线关闭样本为 105.36、138.18、124.64、135.38 和
121.39 ms；最终样本为 135.65、142.55、128.83、135.26 和 146.31 ms。

RSS 来自 zsh `time` 内建命令测量的独立“一次 warmup、一次 sample”生命周期批次。typecheck 在正式测量五项目
命令之前执行一次 warmup。测得的最终 typecheck 最大 RSS 也达到 1,857,296 KiB。

### Pi 0.84.4 背靠背对照

完整验收报告重复超预算后，精确的基线提交与最终 worktree 在认证 Pi 二进制上背靠背执行了相同的非验收 cell。
每个 cell 在 100x32 下保留一次 warmup 并测量三个样本。这个对照可以证明某类发现是否在迁移前已经存在，但不能
替代仓库的可执行验收契约。

| p95 cell 度量 | 基线 | 最终值 | 变化 |
| --- | ---: | ---: | ---: |
| 新 Session 正常退出的启动时间 | 3,158.71 ms | 3,356.34 ms | +197.63 (+6.26%) |
| 新 Session 的未变更重载 | 515.11 ms | 538.11 ms | +23.00 (+4.47%) |
| 降级场景启动时间 | 2,303.30 ms | 2,548.28 ms | +244.98 (+10.64%) |
| 降级场景首次 Provider 边界 | 957.29 ms | 958.40 ms | +1.11 (+0.12%) |

保留的验收上限分别是：普通启动 2,700 ms、普通未变更重载 200 ms、降级场景首次 Provider 边界 800 ms。
基线和最终值都超过了这三项。实验没有提高、屏蔽或重新解释预算来制造通过结果。

第一次完整矩阵尝试还在 `suite/resume-long/reload/64x28` 等待初始 Editor 时遇到一次孤立的 harness 超时。
对该 cell 执行一次 warmup、三个样本的重跑后通过；随后完整重启矩阵，全部要求的主 cell 和确认 cell 都完成，
没有再次发生 readiness 超时。由于上述重复预算发现仍然存在，重启后的命令依旧以失败退出。这样可以把瞬时
readiness 未命中与确定性的验收结果区分开来。

## 认证矩阵

| 证据 | 结果 |
| --- | --- |
| 被测实现上的 `bun run check:fast` | 通过 |
| 使用认证 Pi 与官方 RTK 的最终 `bun run check` | 通过 |
| 隔离 Package 测试以及 Goal upstream/smoke 套件 | 通过 |
| 生成组合、依赖分析、仓库安全和 Package 验证 | 通过 |
| 使用认证 Pi 0.84.4 的打包 Package | 通过，共 578 个文件 |
| Tool Activity 性能验收 | 通过 |
| 真实 Pi Code Mode 执行与 Session 重载 | 通过 |
| 两种宽度下真实 Pi Code Mode TUI 的 group/failure/media/cancel 矩阵 | 通过 |
| 真实 Provider Magic Context 路径 | 不适用：没有已配置的认证信息，也未取得外部 Provider 调用权限 |
| 匹配的基线/最终生命周期对比 | 通过 |
| 完整生命周期可执行验收 | **失败：在 Pi 0.84.4 上，基线也复现了陈旧 Pi 0.84.2 预算的重复发现** |

Code Mode TUI verifier 最初曾在 Provider 已完成、但外层 Host 尚未稳定时捕获一帧 media 画面。现在它会等待两个
相同且不含工作中状态的屏幕再作比较；此后隔离 media 路径、完整 TUI 矩阵和 `check:fast` 都已通过。Magic Context
真实 Provider 验收没有合成或复制任何 Provider 凭据。

## 架构评估

- **行为一致性：** 完整自动检查、打包 Host 验证、Code Mode 真实执行和 TUI 矩阵均通过。没有刻意改变任何公开
  Tool、命令、Session、设置、Provider、Agent 或可见 UI 契约。
- **执行模型：** Pi-facing adapter 下方的 effectful 生产路径返回 Effect 值。一个共享 foundation 管理 Suite、
  Session、Capability 和 operation Scope，同时不从 Pi、Goal、Agents、Background Work 或 Context Management
  手中夺走生命周期策略。
- **机制删除：** 原生 Promise 构造、AbortController 构造、timer、可变生命周期状态和 catch 子句均显著减少。
  最终结果不是在完整旧机制外面再包一层 Effect。
- **所有权约束：** 仓库安全分析拒绝未声明的原生 effect 原语和低层 Effect runner，同时保留窄小、由 Capability
  所有的 native adapter。生成源码和打包源码检查均通过。
- **技术体积：** 物理源码增长 3.41%，代码行增长 3.79%，归档大小增长 0.78%，最大 RSS 增长 7.17%，暖机后
  typecheck 增长 13.04%，背靠背启动/重载对照增长约 4–11%。
- **发布风险：** 实现精确依赖 prerelease `effect@4.0.0-rc.112`。实验没有追逐更新的 RC；把候选版本作为 Suite
  内部执行基础仍是需要 maintainer 承担的风险。

## 建议

现在不要接受 ADR 0024，也不要合并该实验。架构结果具有实质性，行为证据也很强，但当
`bun run benchmark:lifecycle` 仍为红色时，不能把它称作通过完整认证的 merge-quality candidate。该失败应在独立
的 Pi 0.84.4 基准重新认证决策中解决，并使用干净的迁移前对照，而不是在本实验中提高阈值。后续采用决策还应重新
评估测得的运行时/typecheck 体积与 Effect v4 候选版本状态。本报告不授权合并、发布或改变 ADR 状态。

## 复现

从待比较的 worktree 运行，并通过 `PI_BIN` 选择认证 release binary：

```sh
tokei packages/pi-stuff/src --types TypeScript,JavaScript
bun pm ls --all
(cd packages/pi-stuff && bun pm pack --destination "$PACK_DIR")
tar -tvzf "$PACK_DIR/jczhang02-pi-stuff-0.3.3.tgz"

bun scripts/benchmark-lifecycle.ts \
  --pi "$PI_BIN" \
  --variants suite \
  --scenarios fresh \
  --actions exit \
  --sizes 80x24 \
  --samples 5 \
  --warmups 1 \
  --output "$LIFECYCLE_REPORT"

TIMEFMT='max_rss_kib=%M wall_seconds=%E'
time bun scripts/benchmark-lifecycle.ts \
  --pi "$PI_BIN" \
  --variants suite \
  --scenarios fresh \
  --actions exit \
  --sizes 80x24 \
  --samples 1 \
  --warmups 1 \
  --output "$RSS_REPORT"

bun run typecheck
TIMEFMT='wall_seconds=%E max_rss_kib=%M'
time bun run typecheck
```

最终比较还使用相同的 node 与 token 定义重新执行了已记录的 TypeScript AST 普查。本地测量 artifact 保存在
`.artifacts/` 下；它们属于机器证据，不随 Package 一起发布。
