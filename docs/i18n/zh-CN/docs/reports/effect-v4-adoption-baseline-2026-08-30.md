<!-- translation-source: docs/reports/effect-v4-adoption-baseline-2026-08-30.md; translation-source-sha256: 0f296afe7ef64ebbbc6f02bde9252a3ce7d327f7d0485ea3dc3d6c8ac1cb5a74 -->

# Effect v4 采用基线

**测量日期：** 2026-08-30  
**Beads：** `ps-pby`、`ps-pby.1`  
**基线提交：** `d45db1a7fa6a60defd822c42d3b103be567ac66a`  
**认证 Host：** Pi `0.84.4+source.b79e4cc83497.binary.ce91e1f8bff6.bun.1.3.14`、Linux x64  
**仓库工具链：** Bun `1.4.0`、TypeScript `5.9.3`

本报告固定迁移前证据，以便将完成后的 Effect 实现与相同的 Pi Stuff 源码和 Host 配置进行比较。所有测量均在
`effect` 进入任一 manifest 或 lockfile 之前采集。报告不决定该实验是否应合并。

## 基线摘要

| 度量 | 迁移前基线 |
| --- | ---: |
| Package `src/` TS/JS 文件 | 481 |
| Package `src/` TS/JS 物理行数 | 120,140 |
| Package `src/` TS/JS 代码行数 | 107,857 |
| 直接运行时依赖 | 19 |
| 已安装依赖树条目 | 433 |
| 归档文件数 | 564 |
| 归档大小 | 4,521,469 bytes |
| 解包文件字节数 | 11,827,546 bytes |
| 新进程启动 p50 | 5,410.89 ms |
| 新进程启动 p95 | 7,394.82 ms |
| 新进程关闭 p50 | 124.64 ms |
| 新进程关闭 p95 | 138.18 ms |
| Host 基准最大 RSS | 206,116 KiB |
| 暖机后 typecheck 墙钟时间 | 59.60 s |

Package manifest 的 trusted dependency 数为零。Tokei 在 `packages/pi-stuff/src` 下统计到五个 JavaScript
文件和 476 个 TypeScript 文件。依赖树数字是 `bun pm ls --all` 的输出行数，并非唯一 package identity
数量。

## 生命周期与分支普查

生命周期普查记录本次迁移准备收缩的语法。这是证据而不是完整性规则：native adapter 会保留控制外部资源所需的
原语。

| 语法 | 数量 |
| --- | ---: |
| `let` 声明 | 1,290 |
| 非 `readonly` 类属性 | 520 |
| `new Promise` | 73 |
| `new AbortController` | 26 |
| `setTimeout` | 72 |
| `setInterval` | 20 |
| `new Worker` | 1 |
| `fetch` 调用 | 31 |
| `Bun.spawn` 调用 | 2 |
| `spawn` / `execFile` / `fork` 调用 | 21 |

| 分支语法 | 数量 |
| --- | ---: |
| `if` 语句 | 10,804 |
| 条件表达式 | 3,407 |
| `switch` 语句 | 47 |
| `case` 子句 | 302 |
| 循环 | 1,129 |
| `catch` 子句 | 1,121 |
| `&&`、`||` 和 `??` 表达式 | 8,271 |

AST 普查使用 TypeScript 5.9.3 读取每个 TS/JS 源文件。可变类属性是没有 `readonly` 修饰符的
`PropertyDeclaration`。循环包括 `for`、`for in`、`for of`、`while` 和 `do`。原语计数采用精确源码
token pattern，因此只作为审查辅助，不能替代语义调用图证明。

## 运行时测量方法

生命周期基准先执行一次保留的 warmup，再测量五个 `suite/fresh/exit/80x24` 样本。每个样本都启动一个新的
认证 Pi 进程，并使用冷的进程内 Suite 模块缓存；可执行文件与文件系统缓存已预热，全局 kernel cache 未被丢弃。
五个启动样本分别为 4,475.81、4,785.86、5,410.89、7,394.82 和 6,501.81 ms。关闭样本分别为
105.36、138.18、124.64、135.38 和 121.39 ms。

RSS 来自 zsh `time` 内建命令测量的独立“一次 warmup、一次 sample”生命周期批次。typecheck 在正式测量五项目
命令之前执行一次 warmup。这些计时反映测量日期当天这台机器的状态；最终比较必须重复相同命令与采样模型，不能与
预热方式不同的结果比较。

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

最终比较还必须使用上述相同 node 定义，重新执行已记录的 TypeScript AST node 普查。
