# pi-quiet 工具调用对齐审计

审计日期：2026-08-03  
审计对象：[`Wing900/pi-quiet@f5ee381`](https://github.com/Wing900/pi-quiet/tree/f5ee381e46253cdb0e0917c760be0d3e14b7d815)  
验证环境：Pi / `@earendil-works/pi-tui` 0.83.0

## 结论

**pi-quiet 在当前六个 ASCII 工具名和本机 Pi 宽度规则下，终端列确实对齐。** README 截图不是偶然：运行、成功、失败三种状态都使用同一个一格 marker 槽，工具名再补齐到 5 格，因此 marker、工具名和参数的起始列固定。

但这只证明了常规输入下的**结构对齐**，不是完整的宽度安全实现：

- `✓`、`✗`、`⋯` 在 Pi 0.83.0 中都计为 1 列，所以当前机器上不会挤动后文；不同字形的视觉重心仍取决于终端字体。
- 截断使用 JavaScript 的 `.length` / `.slice()`，不是 Pi TUI 的 `visibleWidth()` / `truncateToWidth()`；中文、emoji 等宽字符会被低估。
- 宽度取自全局 `process.stdout.columns`，而不是组件实际获得的 `render(width)`；窄终端或嵌套布局会换行。
- 5 格只适合现有短工具名。加入 `web_search` 等超过 5 格的名字后，参数列不再一致。

因此，**它值得参考固定 gutter 和名称列的思路，但不宜原样采用其宽度算法或状态字形方案。** Pi Stuff 继续采用 Claude Code 的单一 `●` 状态槽更稳定；需要吸收的是列结构，并以 Pi 的可见宽度 API 重写。

## 对齐机制

源码将工具名宽度写死为 5，并在运行行和结果行复用同一前缀结构：

```text
  ⋯ bash  $ npm test
  ✓ bash  $ npm test · exit 0
  ✗ edit  src/a.ts  · no match
```

对应实现：

- [`NAME_WIDTH = 5`](https://github.com/Wing900/pi-quiet/blob/f5ee381e46253cdb0e0917c760be0d3e14b7d815/src/index.ts#L41-L58)
- [运行态：两格缩进 + marker + 一格分隔 + 补齐后的工具名 + 一格分隔](https://github.com/Wing900/pi-quiet/blob/f5ee381e46253cdb0e0917c760be0d3e14b7d815/src/index.ts#L204-L211)
- [完成态复用同样的 marker/name 前缀](https://github.com/Wing900/pi-quiet/blob/f5ee381e46253cdb0e0917c760be0d3e14b7d815/src/index.ts#L213-L228)
- [流式期间只显示 call 行，完成后只显示 result 行](https://github.com/Wing900/pi-quiet/blob/f5ee381e46253cdb0e0917c760be0d3e14b7d815/src/index.ts#L240-L265)，因此状态切换不会同时留下两行。

按 1 起始列计算，当前布局固定为：

| 内容 | 起始列 | 宽度 |
|---|---:|---:|
| 状态 marker | 3 | 1 |
| 工具名 | 5 | 5 |
| 参数/目标 | 11 | 可变 |

当前注册的 `bash`、`edit`、`write`、`find`、`grep`、`ls` 都不超过 5 个 ASCII 字符，因而参数从同一列开始。[工具清单见固定提交](https://github.com/Wing900/pi-quiet/blob/f5ee381e46253cdb0e0917c760be0d3e14b7d815/src/index.ts#L139-L202)。

## 实测

### 字形宽度

在 Pi Stuff 已认证的 `@earendil-works/pi-tui` 0.83.0 上调用 `visibleWidth()`：

| 字符 | JavaScript `length` | Pi `visibleWidth` |
|---|---:|---:|
| `✓` | 1 | 1 |
| `✗` | 1 | 1 |
| `⋯` | 1 | 1 |
| `●` | 1 | 1 |
| `编辑` | 2 | 4 |
| `🙂` | 2 | 2 |

前三个状态字符在 Pi 的布局模型中均为一格，证实了当前 marker 列不会因状态切换而发生列偏移。作者附在[固定版本 README](https://github.com/Wing900/pi-quiet/blob/f5ee381e46253cdb0e0917c760be0d3e14b7d815/README.md#L5-L17) 的终端截图也显示：三条 Bash 记录的 marker、`bash` 和命令起点分别处在同一竖线上。

这里仍需区分：`visibleWidth = 1` 保证的是占用同一终端单元格；勾、叉、省略号在不同字体中的墨迹宽度和视觉中心可能不同。截图证明作者所用字体下观感可接受，不能证明所有字体下光学效果完全相同。

### 真实 Pi PTY

审计还把固定提交作为扩展加载进隔离的 Pi 0.83.0，并用确定性 provider 依次执行内置工具。在 `100 × 32` PTY 中，完成态实际显示为：

```text
  ✓ write written.txt · written
  ✗ edit  written.txt · Validation failed for tool "edit":
  ✓ bash  $ printf 'BASH_CJK_工具\n' · exit ? · 1 lines
  ✓ grep  /新内容/ in . · 1 matches
  ✓ find  *.txt in . · 2 files
  ✓ ls    . · 2 entries
```

这些行的 marker、工具名和参数分别从第 3、5、11 列开始，证实源码推导在真实 Host 中成立。相同流程改为 `24 × 32` 后，`write`、`bash`、`grep` 和 `find` 均出现第二行；例如：

```text
  ✓ write written.txt ·
written

  ✓ find  *.txt in . · 2
files
```

因此可以同时确认两件事：普通宽度下的列对齐是真实的，窄宽下的单行保证则不真实。

### 宽字符与窄终端反例

使用项目自身 renderer，再把返回的 `Text` 组件按指定宽度真实渲染：

- 宽度 40：100 个 ASCII `A` 的运行行被正确截成 1 行；100 个中文 `界` 的同类运行行变成 **2 行**。
- 宽度 20：含中文的 Bash 运行行和完成行都变成 **2 行**。

20 列运行态的实际输出为：

```text
  ⋯ bash  $ echo 中
文…
```

完整 Pi PTY 还暴露了比普通换行更严重的后果：

- 42 列失败结果实际生成 43 列，摘要末尾的 `2…` 被推到下一物理行。
- 32/24 列的中文加 emoji 命令会在第二行出现 `�`，因为 `.slice()` 可以从 emoji 的 surrogate pair 中间切开。
- 24 列下，换行的 running 行切换为 settled 行后，旧 `⋯ bash ...` 首行仍残留在 transcript 上方。renderer 向 Host 声称自己是一行，但实际终端占了两行，使差分重绘无法完整清除旧帧。

原因可直接从源码确认：[`truncate()` 按 UTF-16 code unit 截断](https://github.com/Wing900/pi-quiet/blob/f5ee381e46253cdb0e0917c760be0d3e14b7d815/src/index.ts#L51-L58)，而结果行又使用 `Math.max(20, ...)` 保留最小预算，[即使实际宽度不足也不会继续收缩](https://github.com/Wing900/pi-quiet/blob/f5ee381e46253cdb0e0917c760be0d3e14b7d815/src/index.ts#L218-L225)。Pi 的 `Text` 最终只能把超宽字符串换行。

所以 README 所称“按终端宽度截断，保证不换行”在 ASCII、足够宽的顶层终端中大体成立，但对宽字符、窄终端和组件宽度小于全局终端宽度的布局不成立。

## 成熟度

截至审计日，该项目更接近一个可读的早期原型，而不是成熟依赖：

- 仓库创建于 2026-07-29，最新提交为 2026-07-30；4 stars、0 forks、0 open issues。
- 没有 tag、release 或发布到 npm；`npm view pi-quiet` 返回 404，README 中的 `pi install npm:pi-quiet` 目前不可用。
- 生产代码只有一个 290 行文件；没有测试文件或 `test` script。`npm ci` 与 `npm run typecheck` 可以通过。
- README 仍声称覆盖 `read`，但当前源码明确把 `read` 让给 `pi-hashline-edit-pro`，实际只注册六个工具。这是文档与当前实现漂移的直接证据。[源码说明](https://github.com/Wing900/pi-quiet/blob/f5ee381e46253cdb0e0917c760be0d3e14b7d815/src/index.ts#L1-L18)与[README 声明](https://github.com/Wing900/pi-quiet/blob/f5ee381e46253cdb0e0917c760be0d3e14b7d815/README.md#L5-L14)并不一致。

## 对 Pi Stuff 的取舍

建议吸收：

1. 两格外缩进。
2. 固定一格状态 gutter，再留一格分隔。
3. 工具名称列和参数列有明确边界。
4. 运行态与完成态复用同一行骨架，避免状态变化时横向跳动。

不建议照搬：

1. 不采用 `✓ / ✗ / ⋯` 三套字形；继续按既定 Claude Code 方案使用同一个 `●`，以颜色和闪烁表达状态。
2. 不用 `.length`、`.slice()` 或 `process.stdout.columns` 做 TUI 布局；统一使用组件传入宽度与 Pi TUI 的 `visibleWidth()` / `truncateToWidth()`。
3. 不把名称列永久写死为 5；应为 Pi Stuff 支持的工具体系定义统一列策略，并明确处理超长名称。
4. 不以逐个重注册六个内置工具作为最终架构；Pi Stuff 需要让所有受管工具、恢复后的历史工具调用和扩展工具走同一套展示协议。

最终判断：**pi-quiet 的“看上去对齐”是真实的，但成立范围有限。它验证了固定槽位设计方向，没有提供比 Claude Code 单点状态语法更强、更通用的实现。**
