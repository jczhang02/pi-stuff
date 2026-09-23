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

**Skill 引用 (Skill reference)**:
以完整 `/skill:<name>` 形式出现的 skill 文本引用. 单凭引用不能断定该 skill 已安装或已调用.

**高亮关键词 (Highlight keyword)**:
用户选定的纯文本, 在支持的会话显示面上获得与 skill 引用相同的视觉强调. 出现该文本不代表请求执行操作.

**代码块可视化 (Fenced visualization)**:
由完整 Markdown 代码块描述的图表或树的显示形式. 可视化和原始消息文本表达同一份会话内容.
