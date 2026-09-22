<div align="center">

# Pi Stuff

**更安静、更好用的 Pi 编码工作流。**

面向原生 [Pi 编码代理](https://github.com/earendil-works/pi)的界面、任务、上下文与集成能力。

[English](../../../README.md) · [贡献指南](CONTRIBUTING.md) · [Issues](https://github.com/jczhang02/pi-stuff/issues)

</div>

## 项目状态

当前检出包含开发版网页扩展: 独立的搜索、抓页和保留内容工具, 共用工具开关, 以及宿主管理的 OpenAI/Codex/Exa 认证. Exa 提供搜索与认证, 不提供聊天模型. 尚未发布版本. 源码加载、设置、凭据和限制见[网页访问](web-access.md).

[RTK 集成](rtk.md)提供受支持的 Bash 改写、独立的最终结果 ANSI 清理, 以及包含设置、原生用量和诊断的内联 `/rtk` 面板. 它能发现 mise 管理的安装, 不修改 PATH, 保留 Pi 内置 Bash 执行.

[会话命名](session-naming.md)只在开场生成一次名称, 支持手动 `/autoname` 替换, 并提供与 RTK 共用组件的 `/autoname panel` 面板, 管理名称、模型、规则和长度.

包内还提供 Catppuccin、Tokyo Night、Gruvbox 和 Rosé Pine 共十款明暗[主题](themes.md). 通过 Pi 主题设置选择, 加载包会保留当前选择.

原始包验收目标是 Linux Bun 编译版 Pi `0.85.1`; 会话命名另在编译版 Pi `0.87.0` 和 Bun `1.4.0` 上验证. 技术栈为 TypeScript、Bun `1.4.0` 和 Effect v4 (`4.0.0-rc.112`), 纯算法保留为普通函数. 其他运行环境尚未验证. 除网页访问、RTK 集成、会话命名和主题外, 下方能力仍是产品方向, 不是已实现功能.

## 项目目标

Pi Stuff 希望让日常工作留在 Pi 内，同时让对话更易读、长任务更易管理。计划中的能力分为四类：

- 安静、易读的界面，用于对话、工具活动和会话名称。
- 目标、后台任务、委派代理和待办跟踪。
- 不打断主线的旁支提问与通知。
- 可选的上下文、网页、MCP、RTK、Codex 和 Code Mode 集成。

这些方向是仓库的起点。每项能力都须先约定范围和验收标准，再开始实现。

## 开始参与

克隆仓库以审查源码或参与贡献:

```bash
git clone https://github.com/jczhang02/pi-stuff.git
cd pi-stuff
```

开始工作前请阅读[贡献指南](CONTRIBUTING.md)。编码代理还须阅读 [AGENTS.md](../../../AGENTS.md)。

试用审查过的源码扩展, 参照[网页访问](web-access.md#加载开发版扩展). 安装开发依赖和运行仓库检查, 参照[验证说明](CONTRIBUTING.md#验证变更).

## 源码组织

[源码布局规则](agents/engineering.md#源码布局)约束入口和模块职责.

- [index.ts](../../../index.ts) 是唯一的 Pi 入口, 直接读取配置并注册各项能力; Pi 的本地扩展列表显示检出目录名.
- [src/pi/](../../../src/pi/) 管理共用的宿主配置、工具开关策略、共用面板布局和主题兼容.
- [src/web/](../../../src/web/) 管理网页访问, 包含工具, 认证, 网络实现和会话生命周期. 其他能力实现时放在同级目录.
- [src/rtk/](../../../src/rtk/) 管理 RTK 发现、命令改写、最终结果清理和内联面板.
- [src/naming/](../../../src/naming/) 管理命名资格、请求限制、结果发布保护和命名面板.
- [themes/](../../../themes/) 保存包声明中的静态 Pi 主题资源.
- [tests/component/](../../../tests/component/) 验证模块行为; [tests/system/](../../../tests/system/) 在真实 Pi 宿主中加载扩展.

Web 宿主注册位于 `src/web/register.ts`, 工具定义位于 `src/web/tools.ts`. 功能专用代码归所属能力管理, 包括使用 Pi API 的适配代码. 改编的 Web 源码在文件内保留上游来源和完整许可声明.

## 文档

| 文档                                              | 用途                                     |
| ------------------------------------------------- | ---------------------------------------- |
| [网页访问](web-access.md)                         | 加载、设置、凭据、工具与限制             |
| [RTK 集成](rtk.md)                                | Rewrite、ANSI 清理、设置、原生统计与恢复 |
| [会话命名](session-naming.md)                     | 开场自动命名、手动生成、限制和持久化     |
| [主题](themes.md)                                 | 主题选择、自动配对、色板来源与限制       |
| [贡献指南](CONTRIBUTING.md)                       | Issue、聚焦的变更、验证与 PR             |
| [代理指令](AGENTS.md)                             | 代理写作与 Git 工作流要求的中文阅读参考  |
| [TUI 设计](design.md)                             | Pi 主题、交互、窄终端和操作反馈          |
| [任务工作流](agents/workflow.md)                  | PR 范围、前置依赖、回退、Git 与工作树    |
| [Issue 跟踪流程](agents/issue-tracker.md)         | GitHub 与 Beads 的分工、同步和公开更新   |
| [Beads 设置](agents/beads.md)                     | 本地数据库、共享工作树、技能与认证       |
| [分流标签](agents/triage-labels.md)               | 将任务分配到信息收集、代理或人工处理     |
| [领域文档规则](agents/domain.md)                  | 领域术语与架构决策的阅读要求             |
| [TypeScript/Bun 决策](adr/0001-typescript-bun.md) | 产品与仓库检查共用的工具链               |
| [Effect 与质量决策](adr/0002-effect-quality.md)   | 框架、严格检查与结构审查                 |
| [工程规则](agents/engineering.md)                 | 类型、边界、格式与审查义务               |
| [质量保证](quality-assurance.md)                  | 四类 QA 活动、五级测试与执行策略         |

以英文版为准。面向人的文档提供互链的中英版本，中文版本放在 `docs/i18n/zh-CN/`，在同一 PR 中同步更新。GitHub 上新增或实质性更新的面向人的内容采用英文在前、中文在后的双语形式；代理指令和技能仅保留英文，对话使用中文。适用范围、例外和 Markdown 指引见[语言与呈现](CONTRIBUTING.md#语言与呈现)。`docs/` 下的历史文档保留中文对照并明确标识其历史性质；不批量改写历史讨论和机器生成元数据。

## 贡献

从已有 Issue 开始，或使用 Issue 模板描述问题。保持变更范围明确，如实报告执行过的验证。代理用 Beads 保存执行上下文，并在 GitHub 发布有实质内容的更新；其他贡献者无需安装 Beads。

完整流程见[贡献指南](CONTRIBUTING.md)。

## 安全

扩展代码是可执行软件，运行前应审查源码。不要在 Issue、日志或截图中暴露凭据及个人信息。漏洞请通过[安全政策](../../../.github/SECURITY.md)指定的私密渠道报告，不要发布到公开 Issue。

## 致谢

[Pi](https://github.com/earendil-works/pi) 是本项目面向的宿主。[Best README Template](https://github.com/othneildrew/Best-README-Template) 为 README 的结构提供了参考。

引入第三方代码或资源时，须保留上游声明，并在相邻位置记录来源。

## 许可证

项目自有代码和文档采用 [MIT 许可证](../../../LICENSE)。第三方材料保留各自的声明，包括 [.github/TEMPLATE_LICENSE](../../../.github/TEMPLATE_LICENSE)、[审查技能许可证](../../../.agents/skills/thermo-nuclear-code-quality-review/LICENSE)及 `tools/` 下的声明。
