# 使用 TypeScript 和 Bun

[English](../../../adr/0001-typescript-bun.md) · 以英文版为准。

维护者为 Pi Stuff 选择了 TypeScript 和 Bun。仓库自动化也使用同一套工具链，不再维护单独的 Python 环境：Bun 运行脚本和测试，按 `bun.lock` 安装依赖，并调用 TypeScript 进行静态检查。它替换了初始化阶段的 Python 检查器，但不改变 PR 证据或安全要求。

Bun 能执行 TypeScript，不代表可以省略类型检查。CI 运行编译器, 并在有适用测试时运行测试. 在 [#21](https://github.com/jczhang02/pi-stuff/issues/21) 中, 维护者取消了自研治理检查器和相应测试, 不保留占位测试. PR 证据仍是人工审查责任, 工具链和安全要求保留.这项决策不证明与任何特定 Pi 宿主版本兼容；引入可执行扩展时须另行验证。

[ADR 0002](0002-effect-quality.md) 增加 Effect v4 和质量基线，保留 TypeScript/Bun 工具链。
