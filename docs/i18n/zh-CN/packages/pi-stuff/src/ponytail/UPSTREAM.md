<!-- translation-source: packages/pi-stuff/src/ponytail/UPSTREAM.md; translation-source-sha256: f0a45d331f302ed1f8dbc095054c2a9863469068e53ef408ea3d333bfd9f28ca -->

# Ponytail 上游基线

Pi Stuff 包含一个功能完整、适配宿主的 Ponytail 分叉。

- 上游软件包：`@dietrichgebert/ponytail@4.9.0`
- 仓库：<https://github.com/DietrichGebert/ponytail>
- 标签：`v4.9.0`
- 提交：`0a4dd63ad4541f4f655c4108a295916f3c1d8fda`
- npm 完整性：`sha512-OSdybtBZ3uDd5m/+zyz4h8/+BVBR9nGFhqTDmQkQb1v7k4Vfc1qql78naY64UjocdBPqR94htZEkKu2wpKTJaw==`
- 许可证：MIT；上游声明保留在 `LICENSE.upstream`，并在 `THIRD_PARTY_NOTICES.md` 汇总。
- 复制资源清单：`UPSTREAM.sha256`。

`skills/` 下六个 Skill 资源保留该基线，只增加一个 Pi 特定 Frontmatter 字段：`disable-model-invocation: true`。从每个改编 Skill 删除这一行，即可复现 `UPSTREAM.sha256` 中的哈希；Skill 正文和全部上游字段保持不变。运行时行为以 TypeScript 重新实现，使 Ponytail 使用 Pi Stuff 的合并设置、共享提示词组合、子 Agent 启动路径、命令对话框和状态栏。

上游更新需要人工审查。针对当前 npm 候选运行 `bun run ponytail:upstream:review`，针对指定发布运行 `bun run ponytail:upstream:review --version <version>`。命令会验证注册表完整性、针对固定 tarball 复查本地改编 Skill 与保留许可证、安全解包候选，并打印经过路径清理的完整软件包差异。变化的候选会有意以非零状态退出；更新复制资源、适配测试、哈希和本记录前，应审查运行时、Skill、许可证和元数据变化，并在同一提交完成更新。
