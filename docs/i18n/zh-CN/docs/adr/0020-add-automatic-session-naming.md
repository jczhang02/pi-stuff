<!-- translation-source: docs/adr/0020-add-automatic-session-naming.md; translation-source-sha256: d5b68512a19b7ebafb8baf49baa01deed10202186bee65a493918b39441bb756 -->

---
status: accepted
beads:
  - ps-35b
  - ps-496
---

# 在用户工作稳定边界自动命名会话

## 背景

Pi 负责会话元数据，并公开读取与更改会话名称的 API。上游 [`pi-autoname`](https://github.com/ssdiwu/pi-autoname) 扩展展示了有用的语义命名，但其独立配置文件、直接 `agent_settled` 监听器、兼容辅助函数和独立软件包生命周期，不符合 Pi Stuff 的所有权边界。

命名请求也是一次 Provider 调用。若为 Goal 继续、子 Agent 完成或后台结果触发命名，会错误地把套件发起的工作当成新用户主题。启动时创建上游 `pi-autoname.json` 文件，也会违反套件的纯导入和只读启动约定。

## 决策

在 Pi Stuff 软件包中加入内部 `session-naming` 能力模块，顺序位于 `conversation-ui` 之后。它与 `conversation-ui` 分开：对话 UI 负责呈现和共享的直接用户工作信号；会话命名负责模型选择、语义命名策略、会话元数据和持久命名状态。

自动命名监听对话 UI 已验证的“用户 Agent 运行稳定”事件。第一次稳定的直接用户交互，使用第一轮用户/Assistant 对话命名。默认十分钟冷却期后，可以使用最新六条用户和 Assistant 消息重新考虑模型生成的名称。当前权威名称会作为经过遮盖的不受信数据包含；如果仍然合适，则逐字保留。本地回退会在下一次稳定的直接用户运行时重试。`/autoname` 显式强制重新生成。子 Agent 会话中禁用自动命名；Agents 仍负责其分配的会话名称。

使用 Pi 公开的 `modelRegistry.complete()`、`getSessionName()`、`setSessionName()` 和 `appendEntry()` API。配置的 `provider/model` 引用先于活跃会话模型尝试，并进行去重、配置认证检查、每次尝试 12 秒限制、总计 30 秒预算和 64-token 输出限制。对话内容有界，形似凭据的文字会被遮盖，提示词会标明它不受信。命名始终尽力执行，绝不阻塞稳定生命周期。

持久化分支局部的 `pi-stuff-session-naming-state` 自定义条目，包含生成名称、AI/回退/用户来源、触发模式和时间戳。读取上游 `pi-autoname-state` 条目，使恢复的会话保留既有所有权和手动名称策略。Pi 的 `session_info` 条目仍是实际会话名称的权威。

配置属于 `<agentDir>/pi-stuff.json` 的 `sessionNaming` 命名空间。启动只读取该命名空间；无效时整体回退到内置默认值，并报告一条共享诊断记录。直接执行 `/autoname settings` 时，可以通过 Pi 原生设置列表更新自动命名、冷却期、手动名称策略和可选主要模型，变更立即生效。模型行打开可搜索子菜单：存在模型作用域时使用 Pi 作用域内模型，否则使用可用且已认证的模型。选择 **会话模型** 会删除固定主要路由；有序回退路由仍属于高级 JSON 配置。该能力不创建或迁移 `pi-autoname.json`，对话框也绝不会覆盖现有无效设置。

实现分叉自上游提交 `73d25caa9ff33dadfaa8187ad3f7d1495a01cec9`；旁边的 `LICENSE` 和 `UPSTREAM.md` 仍是源码与许可证权威。

## 被拒绝的替代方案

### 把 `pi-autoname` 安装为另一个软件包

拒绝。它会建立第二套安装和配置生命周期，绕过套件组合，并保留启动写入和范围更广的稳定事件触发。

### 把命名合入 `conversation-ui`

拒绝。会话命名不是显示投影：它调用 Provider、应用命名策略并持久化会话状态。对话 UI 只提供共享生命周期信号。

### 直接由 Pi 的 `agent_settled` 触发

拒绝。该事件不能区分直接用户 Agent 运行与 Goal 继续等套件发起工作。现有共享信号已经负责这项归属判断。

### 在用户输入时立即命名

拒绝。Assistant 结果会提供有用任务上下文，而取消或失败的运行不应触发自动命名请求。

## 后果

- 父会话无需另一个软件包或设置文件即可获得语义名称。
- Goal 继续、后台恢复和子 Agent 会话不会造成自动重命名。
- 一个直接用户轮次在主运行稳定后，可能额外产生一次有界 Provider 请求。
- 把 `enabled` 设为 `false` 会停止自动命名，但显式 `/autoname` 仍可使用。
- 把 `respectManualName` 设为 `true` 会使用户设置或其他未标记的权威名称保持不变；默认 `false` 则在原生重命名时间戳冷却后继续由自动机制周期性负责。
- 选择固定主要模型，会在不改变活跃会话模型的情况下，把清理后的命名上下文显式发送给该模型的 Provider；选择 **会话模型** 恢复活跃会话默认路由。
- 可以读取现有上游状态，但有意不导入上游独立设置。
- 代表性验收必须使用已验证的真实 Pi 宿主，并在恢复前后验证 Provider 流量和持久 JSONL 条目；仅用 Mock 无法验证公开接缝。
