# 自动 Session 命名调研

[English](../../session-naming-research.md). 调研日期: 2026-09-22. 本文建议尚不是已批准的实现契约.

自动命名值得恢复, 它帮助用户辨认并恢复并行会话. 目标是得到稳定、可辨认的任务名称. 长会话发生实际主题变化时可以更新名称, 但时间过去本身不构成改名理由. 这是产品建议, 不是经过用户实验测得的结论.

## 证据与当前状态

当前基线为 `cd0f174f65bdbacdca265646b4e191943063d0ac`. [入口](../../../index.ts) 注册 Web 和 RTK, [配置](../../../src/pi/configuration.ts) 只接受 `tools`、`web` 和 `rtk`, 尚无命名功能或设置. 未知配置字段会被拒绝, 因此直接复制旧版的 `sessionNaming` 配置不是当前版本支持的接入方式.

本次检查的旧版本地快照为 `21b636eaccc487a08362165ec69ffe364e8730fb`, 具体文件包括 `packages/pi-stuff/src/session-naming/{index,controller,state,prompt,model,settings}.ts`、`conversation-ui/{index,agent-run-origin}.ts` 和 `docs/adr/0020-add-automatic-session-naming.md`. 这些文件在该工作树中没有修改. 当前 GitHub 仓库无法解析这个提交, 因此这些属于本地源码观察, 不是可公开访问的证据. 旧 ADR 记录历史决策, 不属于重建后仓库的现行 ADR.

旧版实现来自 [pi-autoname 的 73d25ca](https://github.com/ssdiwu/pi-autoname/tree/73d25caa9ff33dadfaa8187ad3f7d1495a01cec9), 检查时它仍是该上游的 main. 上游 README 记录首轮对话命名、冷却后重新判断、显式 `/autoname` 以及可配置的手动名称策略. 上游跟随用户语言, 旧版分支则明确要求英文.

| 源码中观察到的旧版行为                                                              | 对新版的判断                                                                                          |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 默认开启, 用户一轮工作结束且距上次命名满十分钟后重新判断                            | 保留按事件判断. 十分钟可作为初始值, 不是测量得到的最优值. 不需要空闲定时器.                           |
| `respectManualName: false`                                                          | 建议更改默认值: 手动名称保留到用户显式重新生成. 这是对旧行为的修改建议.                               |
| 最近六条用户/助手消息, 每条在转义前最多取 700 字符, 排除工具结果消息、图片和思考块  | 保留输入限额. 同时保留初始任务信息, 避免局部追问覆盖整体任务名称. 助手文字仍可能转述工具里的敏感数据. |
| 提示词要求英文 2-4 词; 校验实际接受含英文字母的 3-30 个 ASCII 字符                  | 不能声称严格校验词数. 语言和显示宽度政策需要重新决定, 支持中文也必须修改校验.                         |
| 指定模型、指定后备模型、当前会话模型依次尝试; 单次 12 秒、总计 30 秒、输出 64 token | 复用宿主模型注册表. 默认跟随当前模型或使用一个显式指定的模型, 这种辅助功能不需要隐式跨提供商回退.     |
| 自动生成、强制生成和观察到的手动命名写入自定义记录                                  | 恢复会话后仍需识别名称归属, 但记录的作用范围要与 Pi 的全会话名称语义一致.                             |
| 关闭自动命名后仍可执行 `/autoname`                                                  | 保留. 自动失败保持安静, 显式调用需要有用的失败提示.                                                   |

旧代码已经会拒绝被手动改名或关闭操作取代的旧结果, 按子进程约定排除子会话, 并取消受管理的请求. 这些要求值得保留, 但不说明可以照搬它的完整生命周期框架.

Pi 0.85.1 对应上游提交 `d981de1229ef899957bbe968bc8dcda02a21f477`. 下文安装包代码观察对应的公开来源是 [扩展类型](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/extensions/types.ts)、[Agent 生命周期](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/agent-session.ts)、[Session 元数据](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/session-manager.ts) 和 [会话选择器](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/modes/interactive/components/session-selector.ts). 没有名称时, 选择器显示首条消息.

## 两个接入陷阱

已安装的 `@earendil-works/pi-coding-agent@0.85.1` 提供 `getSessionName`、`setSessionName`、`appendEntry`、`modelRegistry.complete`、`session_info_changed`、`session_start`、`session_shutdown` 和 `session_tree`. 自动命名不需要新增提供商客户端或直接编辑 JSONL.

`AgentSettledEvent` 只有事件类型. `dist/core/agent-session.js` 中的 `_runAgentPrompt` 在 `finally` 中发出该事件, 因此结束不代表成功, 也不代表来自用户. `InputEvent.source` 可区分 `interactive`、`rpc` 和 `extension`, 但仍需确认输入实际进入了执行流程. 旧版共享来源跟踪器处理了这一区别, 然而检查到的结束事件发布路径没有核对助手停止原因. 因此该路径不能证明旧 ADR 承诺的失败/取消排除. 新版必须显式验证成功、中断、失败、被拦截输入、排队的 steer/follow-up 以及自动续跑.

Pi 的 `SessionManager.getSessionName()` 扫描全部记录, 旧版却从 `getBranch()` 恢复命名标记. 本次用真实 Pi 0.85.1 的内存 Session 写入名称和标记, 然后回到两者之前的分支, 得到:

```json
{
  "name": "RTK Review",
  "branchTypes": ["message"],
  "allTypes": ["message", "session_info", "custom"]
}
```

名称仍存在, 标记却已离开当前分支. 旧版 `restore()` 会把缺少匹配标记的名称当成手动名称, 命名模块也没有监听 `session_tree`. 这证明状态范围不一致并缺少导航处理, 不是一次端到端误覆盖复现. 建议按整个 Session 跟踪名称归属, 并单独在切换分支时使未完成请求失效. fork 到新 Session 时也需要明确名称继承规则.

在安装了固定依赖的工作树中复现:

```sh
bun -e 'import {SessionManager} from "@earendil-works/pi-coding-agent"; const s=SessionManager.inMemory(); const root=s.appendMessage({role:"user",content:"Investigate RTK",timestamp:0}); s.appendSessionInfo("RTK Review"); s.appendCustomEntry("research-marker",{name:"RTK Review"}); s.branch(root); console.log(JSON.stringify({name:s.getSessionName(),branchTypes:s.getBranch().map(e=>e.type),allTypes:s.getEntries().map(e=>e.type)}));'
```

## OpenCode 对照

OpenCode v2.0.9 (`6608799`) 在未命名根会话的输入变得可见时就启动自动命名, 不等待主回复完成. 它的 [runner](https://github.com/anomalyco/opencode/blob/6608799d35d96c2821a48ac1d4b26a3b84b4e433/packages/core/src/session/runner/llm.ts#L156-L173) 按 Session 去重并发命名任务. 这种方式更早提供名称; 等第一轮完成则能利用助手提供的任务上下文. 两种时机都不是唯一正确答案. 对本仓库, 我倾向后者, 与旧版设计意图一致.

它的 [标题服务](https://github.com/anomalyco/opencode/blob/6608799d35d96c2821a48ac1d4b26a3b84b4e433/packages/core/src/session/title.ts#L93-L141) 在重新生成时组合初始请求与有长度限制的近期文字, 写入前重新读取名称, 跳过已被修改或完全相同的名称, 并用事件序号检查保护发布. 这些做法可用于保持名称稳定并保护手动改名. 这是源码证据, 不是 OpenCode 实机测试. 首条输入命名是周期性主题更新的另一种选择, 不能据此声称 OpenCode 使用旧版十分钟策略.

## 建议的首版行为

未命名的父会话在第一轮用户对话成功结束后命名. 启动有时间上限的后台请求, 不在结束事件处理器中等待它. 后续用户对话成功结束且经过冷却期时, 只重新判断自动命名拥有的名称. 当前名称仍适用就要求模型原样返回. 单次工具完成、空闲时间流逝、自动续跑或子任务完成不单独触发命名.

保留 `/name` 作为手动覆盖, `/autoname` 作为显式重新生成. 生成结果写入前, 必须确认仍是同一个 Session、分支、输入版本和名称归属. 新输入、树导航、会话替换、手动改名、关闭功能和扩展重载应使旧请求失效或被取消. 取消与写入前检查都需要, 因为提供商可能恰好在取消过程中返回.

输入只保留辨认任务所需的文字, 排除工具和思考内容. 拒绝空值、多行/控制字符及过长输出. 凭据模式脱敏可以减少明显泄露, 不能保证移除所有私密信息. 用户应知道命名请求发往哪个模型, 使用其他提供商必须明确. 更新失败就保留原名. 未命名会话可以继续使用 Pi 列表已有的回退显示, 等待下一次合格尝试; 本地截词回退是可选项, 不应导致每轮重复请求.

复用当前宿主配置的所有者, 从根入口注册独立命名能力. 不要只为获取生命周期信号而搬回旧版整个 conversation UI 框架. 按实际调用者确定最小的来源跟踪逻辑, 并与正在进行的 subagent 工作协调子会话约定. 新命令、配置命名空间和持久化归属标记涉及公开接口与持久化, 实现前需要维护者同意. 本报告没有修改这些内容.

我的语言建议是跟随用户任务语言, 保留技术标识符. 如果维护者希望会话列表统一英文, 旧版英文策略仍是合理偏好. 仓库要求 Issue/PR 标题用英文, 不能据此推导 Session 名称也必须英文.

## 验收场景与限制

- 第一轮成功用户对话只生成一次简短可辨认的名称; 重试、压缩和排队续跑不产生重复请求.
- 同主题追问保留原名; 冷却后发生实质任务变化, 可替换自动拥有的名称.
- 手动名称在恢复和后续对话中保持. 显式重新生成可以替换它; 关闭自动命名不影响显式命令.
- 延迟结果不能改到其他 Session、新选择的树分支、更新后的任务或已被手动命名的会话.
- 无凭据、超时、提供商失败和非法输出不影响主任务, 不破坏已有名称. 连续失败的重试频率有边界.
- 中文、英文、混合标识符、超长内容和合成的凭据样式文本符合选定的语言及显示约束.
- 在固定版本的 Bun 编译 Pi 宿主中验证实际提供商流量、元数据持久化及 resume/tree/fork 行为. 单元测试不能证明这一接入成立.

本次阅读了源码, 执行了内存元数据探针. 没有调用真实模型、评测名称质量、测量 token 费用、认证旧扩展或修改运行时行为. 费用取决于输入限额、实际请求频率和选定提供商; 即使返回相同名称, 仍然消耗一次生成调用. 生产实现及其并发/持久化独立审查属于后续工作.
