<div align="center">

# Pi Stuff

**更安静、更好用的 Pi 编码工作流。**

面向原生 [Pi 编码代理](https://github.com/earendil-works/pi)的界面、任务、上下文与集成能力。

[English](README.md) · [贡献指南](docs/zh-CN/CONTRIBUTING.md) · [Issues](https://github.com/jczhang02/pi-stuff/issues)

</div>

## 项目状态

仓库仍处于项目搭建阶段，已有贡献模板、代理工作流约定和仓库检查，尚无可安装的 Pi Stuff 软件包。技术栈选用 TypeScript、Bun `1.4.0` 和 Effect v4（`4.0.0-rc.112`）；纯算法保留为普通函数。这不代表已经验证了 Pi 宿主兼容性。

下述能力是产品方向，并非已实现的功能。安装说明、支持版本和截图会在相应代码与检查就绪后补充。

## 项目目标

Pi Stuff 希望让日常工作留在 Pi 内，同时让对话更易读、长任务更易管理。计划中的能力分为四类：

- 安静、易读的界面，用于对话、工具活动和会话名称。
- 目标、后台任务、委派代理和待办跟踪。
- 不打断主线的旁支提问与通知。
- 可选的上下文、网页、MCP、RTK、Codex 和 Code Mode 集成。

这些方向是仓库的起点。每项能力都须先约定范围和验收标准，再开始实现。

## 开始参与

目前可克隆仓库，查看项目约定或参与搭建：

```bash
git clone https://github.com/jczhang02/pi-stuff.git
cd pi-stuff
```

开始工作前请阅读[贡献指南](docs/zh-CN/CONTRIBUTING.md)。编码代理还须阅读 [AGENTS.md](AGENTS.md)。

目前没有可安装的 Pi Stuff 扩展。使用 Bun 安装开发依赖并运行仓库检查，请参照[验证说明](docs/zh-CN/CONTRIBUTING.md#验证变更)。

## 文档

| 文档                                                         | 用途                                           |
| ------------------------------------------------------------ | ---------------------------------------------- |
| [贡献指南](docs/zh-CN/CONTRIBUTING.md)                       | Issue、聚焦的变更、验证与 PR                   |
| [代理指令](AGENTS.md)                                        | 代理写作与 Git 工作流要求，仅英文              |
| [Issue 跟踪流程](docs/agents/issue-tracker.md)               | GitHub 与 Beads 的分工、同步和公开更新，仅英文 |
| [Beads 设置](docs/agents/beads.md)                           | 本地数据库、共享工作树、技能与认证，仅英文     |
| [分流标签](docs/agents/triage-labels.md)                     | 将任务分配到信息收集、代理或人工处理，仅英文   |
| [领域文档规则](docs/agents/domain.md)                        | 领域术语与架构决策的阅读要求，仅英文           |
| [TypeScript/Bun 决策](docs/zh-CN/adr/0001-typescript-bun.md) | 产品与仓库检查共用的工具链                     |
| [Effect 与质量决策](docs/zh-CN/adr/0002-effect-quality.md)   | 框架、严格检查与结构审查                       |
| [工程规则](docs/agents/engineering.md)                       | 类型、边界、格式与审查义务，仅英文             |

以英文版为准。面向人的文档提供互链的中英版本，在同一 PR 中同步更新；代理指令和技能仅保留英文。Issue、PR 和公开评论使用英文，对话使用中文。不批量翻译历史研究资料。

## 贡献

从已有 Issue 开始，或使用 Issue 模板描述问题。保持变更范围明确，如实报告执行过的验证。代理用 Beads 保存执行上下文，并在 GitHub 发布有实质内容的更新；其他贡献者无需安装 Beads。

完整流程见[贡献指南](docs/zh-CN/CONTRIBUTING.md)。

## 安全

扩展代码是可执行软件，运行前应审查源码。不要在 Issue、日志或截图中暴露凭据及个人信息。漏洞请通过[安全政策](.github/SECURITY.md)指定的私密渠道报告，不要发布到公开 Issue。

## 致谢

[Pi](https://github.com/earendil-works/pi) 是本项目面向的宿主。[Best README Template](https://github.com/othneildrew/Best-README-Template) 为 README 的结构提供了参考。

引入第三方代码或资源时，须保留上游声明，并在相邻位置记录来源。

## 许可证

仓库尚未添加项目级许可证。改编自 GitHub CLI 的贡献模板在 [.github/TEMPLATE_LICENSE](.github/TEMPLATE_LICENSE) 中保留了上游 MIT 声明；该声明不适用于项目其余部分。
