<!-- translation-source: packages/pi-stuff/src/conversation-ui/UPSTREAM.md; translation-source-sha256: 1a1f33f4685cfa65ece602d785d62461426e2ef2951bb66494b531baddc57e8d -->

# 上游来源

`unicode-chart.ts` 中的图表解析器和 Unicode 渲染算法改编自固定的 `@howaboua/pi-unicode-charts` 0.1.0 源码快照。

| 字段 | 值 |
| --- | --- |
| 仓库 | `https://github.com/IgorWarzocha/howaboua-pi-stuff` |
| 软件包目录 | `packages/pi-unicode-charts` |
| npm 版本 | `0.1.0` |
| 源码提交（`gitHead`） | `8d63d300597488e6fa4c30ccd6a3eb0fed2d4304` |
| 许可证 | MIT |
| npm 归档 SHA-1 | `bac72747a97073534c42a6212e77795c58a56fd0` |
| npm 归档 SHA-256 | `98e490817cf62f14a5e3a88a5b7e7afc521210b34def32ed65ddce7716d70885` |
| npm 完整性 | `sha512-mu0/WoWSQohE3Zf2+gWpVYZSvhVxXf6ijlYH+Fk0E6dJtDkbp0Y1AE1cnoq/BoZUxAKqepY02sY94PFGJjDSvQ==` |

## Pi Stuff 差异

- 把图表解析器及柱状图、折线图、散点图、火花线、热力图和 Braille 渲染算法吸收到现有对话 UI 能力，而不是加载独立安装的扩展。
- 删除上游 Markdown 转换器注册，保留 Pi Stuff 唯一宿主转换器权威。
- 使用静态 `chart`/`tree` 围栏分派器；不增加插件注册表、配置或依赖。
- 拒绝部分、不受支持、超限、不安全、不完整或过窄的输入，而不是截断源码数据或静默丢弃无效行。
- 图表源码上限为 12,000 个字符，普通序列为 64 个点，热力图为 32×64 单元。
- 使用 Pi TUI 的终端列宽测量和字素感知截断，覆盖中文、日文、韩文与 emoji。
- 保持会话消息和 Provider 上下文为规范内容；只改变对话 Markdown 投影。

上游 MIT 声明保留在 `LICENSES/Howaboua-MIT.txt`。源码已吸收到 Pi Stuff，没有独立软件包或发布生命周期。
