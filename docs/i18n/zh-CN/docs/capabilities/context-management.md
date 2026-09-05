<!-- translation-source: docs/capabilities/context-management.md; translation-source-sha256: e71969b2573d99269845ca937126355f3e44660bf9014266417a0289034a1a4b -->

# Context Management

[English](../../../../../docs/capabilities/context-management.md)

Context Management 为 Pi 增加检索、memory、note、compaction 与压力处理，同时保持 Host 的 conversation 和
Session 界面不变。

## 快速开始

打开 Context 状态 dialog：

```text
/ctx
```

已配置的 Context 会在 Session 启动时激活。没有配置时，直接交互输入有权执行首次使用操作，`/ctx` 会显示可用路径。

## 命令界面

| 命令 | 操作 |
| --- | --- |
| `/ctx` 或 `/ctx status` | 打开状态与可用操作 |
| `/ctx flush` | 随下一条 message 应用 queued drop |
| `/ctx wrapup [N]` | 压缩较早历史，默认保留 20 条 message |
| `/ctx recomp [start-end]` | 重建全部或部分历史 compartment |
| `/ctx upgrade` | 升级受支持的旧版 Session history 与 memory |

状态 dialog 报告 Context 用量、活动与 dropped tag、compartment、memory、note、pending 工作、Historian
状态、cache、history token、当前错误，以及 Pi native-compaction fallback 被禁用时的 degraded continuity。

维护会保存为 model 不可见的 Context Activity。`recomp` 与 `upgrade` 在后台继续；切换或 fork Session 会让
可见更新脱离，但不会取消操作。

## Context Tool

已配置 engine 提供时，以下 deferred Tool 会出现：

- `ctx_search` 用于检索；
- `ctx_expand` 用于展开压缩 context；
- `ctx_memory` 用于访问 memory；
- `ctx_note` 用于 note；
- `ctx_reduce` 用于显式 reduction。

Engine 也保留投影使用的 history、memory、note 与 Historian 行为。Pi Stuff 负责 `/ctx` 界面，并隐藏重复的
上游 status、dialog、announcement 与 Todo UI。

## 启动与首次使用

已识别且无需迁移的配置会在编辑器就绪前激活。缺少或旧版配置在启动期间保持 dormant。

第一次直接用户输入、`/ctx` 命令或显式 Context 投影可以授权创建配置或执行受支持迁移。Extension 发起的自动
turn 无权创建或迁移用户配置。

## 投影

Pi Session JSONL 仍是原始 conversation 记录。Context Management 为 model request 构建派生投影，并在输入、
compaction 或 tree navigation 改变活动 branch 时让缓存失效。

第一次 bind 或 branch 不连续时，会把完整 Session snapshot 发给 Context worker。普通投影只发送新 leaf。
派生 store 或 worker 不可用时，当前 request 会退回 Pi 原生 context。

Prompt contribution 保持固定顺序：Host context、Context Management，再到其他已注册 capability contribution。
Direct-mode guidance 上限为 8,000 个字符。

## Compaction

Pi 负责原生 compaction 和配置的 threshold。Context Management 不会为同一个前台生命周期再启动第二次原生
compaction。

对于绕过普通 preflight 的 idle custom turn，如果原生 compaction 已启用并超过 threshold，Context Management
可以调用 Pi 的公开 compaction 方法。极端 overflow 会交给原生 compaction，并暂时把活动 Context 降级为原生投影。
Magic Context 活动但 Pi native auto-compaction 被禁用时，`/ctx` 会保持 Magic 活动，同时报告 degraded
continuity，并引导用户通过 `/settings` 启用 auto-compaction；Pi Stuff 不会自行更改该设置。Magic
降级到 native Context 后仍保留此警告，启用 native auto-compaction 后才清除。

## Worker 与恢复

Context engine 运行在一个内部 Worker 中，因此检索与 compaction 工作不会阻塞终端绘制。Worker 是执行边界，
不是生命周期所有者：Pi 接受 prompt 后，中断其 Agent turn 不会取消 engine 的生命周期事件，也不会重建健康的
Worker。input callback 不等待延迟 activation，Agent 中断也不能让下一条已接受 prompt 等待一次虚假的恢复。
Tool 与 augmentation 的取消仍由各自 invocation 所有。

Worker 发生 fatal failure 时立即切换到原生投影。恢复属于当前 Session，而不是已中断的 Agent turn。Shutdown
会在有界宽限期内等待 pending worker 工作。

## 配置

Context engine 与 worker 选择属于外部配置。Pi Stuff 不在 `pi-stuff.json` 中定义 provider 特定字段。
修改外部配置后，重启 Pi 并检查 `/ctx` 与 `/diagnostics`。

## 相关文档

- [Context Management Module README](../../packages/pi-stuff/src/context-management/README.md)
- [命令参考](../reference/commands.md#context)
- [故障排查](../troubleshooting.md#context)
- [架构](../architecture.md#生命周期所有权)

