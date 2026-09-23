# Pi Stuff

[English](../../../CONTEXT.md) · 英文为准。

Pi Stuff 为维护者的开发流程扩展 Pi。

## 术语

**网页访问（Web access）**：
Pi Stuff 在 Pi 内搜索网页、读取公开页面文本并查阅已获取内容的能力。

**工具开关（Tool switch）**：
独立决定模型能否直接调用某个 Pi Stuff 工具的设置。它控制调用入口，不禁止所有对底层能力的内部使用。

**Pi 适配目标 (Pi compatibility target)**:
Pi Stuff 打算适配的 Pi 宿主版本. 列为目标不代表已通过宿主验收.

**Pi 支持范围 (Pi support range)**:
Pi Stuff 承诺在声明的运行环境中维护的 Pi 宿主版本区间. 区间内的中间版本也属于维护对象, 即使没有被选为直接验收样本.

**已验收 Pi 版本 (Verified Pi version)**:
针对特定 Pi Stuff 修订和运行环境, 已有验收记录的 Pi 宿主版本. 这类证据比支持范围更具体.

**状态字段 (Statusline segment)**:
Pi Stuff 会话底栏中一项独立的状态信息, 例如上下文用量或 Git 状态.

**第三方状态字段 (Third-party status segment)**:
由其他扩展提供信息的状态字段, 区别于 Pi Stuff 核心 statusline 自身提供的字段.

**缓存命中率 (Cache-hit ratio)**:
当前会话分支最近一次有效模型响应中, 由缓存提供的输入 token 比例. 它不是会话累计比例.
