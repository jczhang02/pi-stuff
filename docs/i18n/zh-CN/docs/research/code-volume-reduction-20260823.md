<!-- translation-source: docs/research/code-volume-reduction-20260823.md; translation-source-sha256: 9ea93e3e90203fb02d261c18e5028c122439766b0d9d08d01a40809d80b8c2de -->
# Pi Stuff 代码量削减结果

**测量日期：** 2026-08-23
**Beads：** `ps-4xm`、`ps-hxl`
**基线：** `06e627a`
**测量实现：** `bd48b24`
**认证 Host：** Pi `0.84.2+source.914cf1472e71.binary.9a2d20fab3ca.bun.1.3.14`、Bun `1.3.14`、Linux x64

## 决策

保留原生实现和缩减后的 Web/MCP 产品表面。不要将 Effect v4 添加到生产依赖图中。

这次削减移除了休眠接口，而不是将它们移动到另一个包中。最终实现删除的 Git 行数比新增的多 16,942 行，已发布 Package 源代码减少 14,669 行（12.19%），移除五个直接运行时依赖，并使打包归档缩小 23.19%。保留的公共 Tools、transport 和 security boundary 继续通过 focused、Package 以及 real-Host 检查。

## 前后对比

| 度量 | `06e627a` | `bd48b24` | 变化 |
| --- | ---: | ---: | ---: |
| Package `src/` TS/JS 物理行数 | 133,957 | 117,920 | -16,037 (-11.97%) |
| Package `src/` TS/JS 代码行数 | 120,348 | 105,679 | -14,669 (-12.19%) |
| Git diff | — | 323 additions、17,265 deletions | 净减少 16,942 行 |
| 直接运行时依赖 | 24 | 19 | -5 (-20.83%) |
| 已安装依赖树条目 | 507 | 436 | -71 (-14.00%) |
| 打包文件数 | 442 | 415 | -27 (-6.11%) |
| 打包归档 | 5,845,130 bytes | 4,489,622 bytes | -1,355,508 (-23.19%) |
| 解包文件字节数 | 13,801,985 | 11,776,000 | -2,025,985 (-14.68%) |
| 全新进程启动 p50 | 2,830.32 ms | 2,726.20 ms | -104.12 ms (-3.68%) |
| 全新进程启动 p95 | 2,892.19 ms | 2,809.60 ms | -82.59 ms (-2.86%) |
| 全新进程关闭 p50 | 86.62 ms | 85.49 ms | -1.13 ms (-1.30%) |
| 最大 RSS，三次运行中位数 | 247,932 KiB | 248,056 KiB | +124 KiB (+0.05%)；无可测变化 |
| `check:fast` 墙钟时间 | 39.36 s | 39.17 s | -0.19 s (-0.48%)；无实质变化 |

`tokei` 统计 `packages/pi-stuff/src` 下的 TypeScript 和 JavaScript，包括保留的适配 Web 和 MCP runtime。`bun pm ls --all | wc -l` 统计打印出的依赖树条目，而不是唯一的 package identity。归档字节数是 tarball 大小，文件大小之和是 GNU tar 报告的总和。

生命周期样本使用全新的 Pi 进程和冷的进程内 Suite 模块缓存。一个保留的 warmup 位于 80×24 下的五个样本之前，因此 executable 和 filesystem cache 是 warm；全局 kernel cache 未被丢弃。RSS 是三个独立的“一次 warmup/一次 sample”基准批次中由 zsh 报告的最大 resident set。124 KiB 的差异远低于每次运行的变化，因此不能作为内存回归的证据。

配对的 `check:fast` 计时取自删除检查点 `ce19759`。后续的 cache-invalidation 和 stale-asset review 修复也通过了 `check:fast`；它们分别 warm 后的计时未混入这次配对比较。

## 删除和保留的行为

Web 现在只暴露 `web_search`、`fetch_content` 和 `get_search_content`。它保留 provider search、HTTP(S)、image 和 PDF extraction、cancellation、SSRF 和 redirect protection、fake-IP compatibility，以及有界的 GitHub API extraction。删除的代码覆盖了不可达的 curator 和隐藏的 command/shortcut handler、source-check/research workflow、local video 和 YouTube extraction、page-answering，以及 Git clone fallback。

MCP 现在暴露一个 `mcp` gateway 加 `/mcp` control。它保留 discovery、describe/instructions、connect 和 single call action、resource read、stdio/HTTP transport、OAuth、lifecycle policy、output guard、approval、tracing、metadata cache 以及共享的 Command Dialog。删除的代码覆盖 direct per-server Tools、JavaScript batching、prompt、MCP Apps/browser window、floating panel、bundled Skill、sampling、elicitation 及其支持 runtime asset。

依赖清理用 `node:child_process` 替换 `cross-spawn`，并由原生 Bun Promise 行为替换 `promise.try`。删除的 MCP Apps surface 移除了直接的 `@modelcontextprotocol/ext-apps` 和 `zod` 要求；`@types/json-schema` 仅用于开发。两个未使用的 Todo store accessor 也被删除。

Version 1 MCP metadata cache 被有意使其失效。它们可能包含过去仅 app 可见的 visibility metadata；MCP Apps 移除后，不能将这些 metadata 重建为普通的模型可见 Tool metadata。

## Effect v4 结果

一次性 prototype 仍被拒绝用于生产。在提交
`ad2d770b4accf3068fa5ce05edc9cd69982fe862` 时，Effect 达到了 lifecycle parity，但使用了多 10.2% 的 lifecycle code，使真实 Pi readiness 增加 23–25 ms，使 median RSS 增加 15–22 MiB，并使 aggregate archive 增加 8,225,937 bytes（38.58%）。没有任何 Effect dependency 或 prototype code 被合并。

详细的 Effect v4 采用评估和行为保持架构评估仍可从 Git 历史中获取。只有在 v4 稳定后、针对一个 lazy-loaded in-process slice，并且它在没有造成实质启动、内存、package 或维护回归的情况下，以至少 15% 的净代码优势超过优化后的原生实现时，才重新考虑。

## 验证

- Focused Web 测试：14 个通过。
- Focused MCP 测试：76 个通过；旧版 app-cache invalidation regression test 也通过。
- `bun scripts/verify-web-integration.ts`：针对保留的三 Tool surface 通过。
- `bun scripts/verify-mcp-pty.ts`：在真实 Pi 上通过 wide、narrow、low-height、reload、persistence、OAuth、lifecycle、Tool call/resume 和 Command Dialog 场景。
- `bun run check:fast`：独立 review 修复后通过。
- `PI_BIN="$PI_BIN" bun run pack:verify`：在 Pi 0.84.2 上认证一个包含 415 个文件的本地 Package。
- `PI_BIN="$PI_BIN" bun run check`：在本报告快照上通过。
- 四次独立 deletion review 在修复 cache 和 Package finding 后，没有发现遗留的 Web 或 MCP correctness issue。

## 复现

创建 detached baseline worktree，并在两个 worktree 中安装准确的 lockfile：

```sh
git worktree add .worktrees/ps-4xm-baseline 06e627a
bun install --frozen-lockfile --ignore-scripts
```

从对应的 worktree 运行每项测量：

```sh
tokei packages/pi-stuff/src --types TypeScript,JavaScript
node -e 'const p = require("./packages/pi-stuff/package.json"); console.log(Object.keys(p.dependencies ?? {}).length)'
bun pm ls --all | wc -l

mkdir -p /tmp/pi-stuff-pack-measurement
(cd packages/pi-stuff && bun pm pack --destination /tmp/pi-stuff-pack-measurement)
stat -c %s /tmp/pi-stuff-pack-measurement/jczhang02-pi-stuff-0.3.3.tgz
tar -tvzf /tmp/pi-stuff-pack-measurement/jczhang02-pi-stuff-0.3.3.tgz \
  | awk '{ bytes += $3; files += 1 } END { print files, bytes }'

bun scripts/benchmark-lifecycle.ts \
  --pi "$PI_BIN" \
  --variants suite \
  --scenarios fresh \
  --actions exit \
  --sizes 80x24 \
  --samples 5 \
  --warmups 1 \
  --output /tmp/pi-stuff-lifecycle.json

TIMEFMT='%M'
time bun scripts/benchmark-lifecycle.ts \
  --pi "$PI_BIN" \
  --variants suite \
  --scenarios fresh \
  --actions exit \
  --sizes 80x24 \
  --samples 1 \
  --warmups 1 \
  --output /tmp/pi-stuff-rss.json >/dev/null

time bun run check:fast
PI_BIN="$PI_BIN" bun run check
```

`PI_BIN` 必须指向经过 `scripts/verify-pi-host-provenance.ts` 验证的认证 Pi release binary。
