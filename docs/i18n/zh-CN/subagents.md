# 子代理

[English](../../subagents.md) · 以英文版为准.

Pi Stuff 用一个 `subagent` 工具管理委派工作, 用 `/agents` 提供人工检查入口. 已接受的产品范围见 [#64](https://github.com/jczhang02/pi-stuff/issues/64), 实现和验收证据见 [#97](https://github.com/jczhang02/pi-stuff/issues/97). 当前为开发源码, 尚未发布包版本.

## 开始委派

通过 Pi 的 `-e /absolute/path/to/pi-stuff` 加载检出目录. 宿主的活动工具中须包含 `subagent`; 使用 `--tools` 时要显式列入. 父代理也须拥有准备授予子代理的每个工具.

让主代理委派工作, 或在其 `subagent` 调用中使用以下参数:

```json
{
  "command": "dispatch",
  "tasks": [
    {
      "key": "lifecycle",
      "name": "lifecycle",
      "prompt": "Trace cancellation and identify writes that can continue after cancellation."
    },
    {
      "key": "packages",
      "name": "packages",
      "prompt": "Compare the existing packages' cancellation behavior."
    },
    {
      "name": "reviewer",
      "prompt": "Compare both reports and identify unresolved risks.",
      "needs": ["lifecycle", "packages"]
    }
  ]
}
```

前两个代理可以并行. 两个前置任务都已结束、显式声明 fulfilled 且证据已保存后, reviewer 才会启动. 无关的慢代理不会形成整批屏障. 返回的 `agentId`、`taskId` 和 `dispatchId` 标识实际记录; 名称和批次内的 `key` 不能代替管理操作的标识.

每个代理保留身份、上下文和工作区. 每次交办形成独立任务记录. 因此, 给已完成的 reviewer 续聊后, 先前报告仍可查看:

```json
{
  "command": "followup",
  "agentId": "<returned agentId>",
  "text": "Recheck the revised cancellation design."
}
```

异常结果会暂停该代理的队列. 活动执行停止后, 才能使用 `recovery: true` 恢复. 健康代理的普通续聊按 FIFO 排队, 不能借恢复插队. 恢复创建新记录, 不改写失败结果, 也不重跑旧消费者. `queue` 配合 `queueAction: "continue"` 或 `"cancel"` 显式处理剩余队列.

## 查看和控制工作

| 命令            | 用途                                                                         |
| --------------- | ---------------------------------------------------------------------------- |
| `inspect`       | 查看当前或历史记录、用量、待处理通知和结果预览.                              |
| `wait`          | 有时限的事件驱动等待. 超时交还控制权, 不取消子任务.                          |
| `read`          | 通过 `offset` 和 `length` 分页读取完整 `report`、`transcript` 或固定 `diff`. |
| `message`       | 向任务保存普通消息, 区分收件和模型消费.                                      |
| `steer`         | 在下一个安全模型边界纠正活动任务. 已结束任务拒绝 steer.                      |
| `ask` / `reply` | 将子代理问题、直接父代理和答复关联起来. 迟到答复仍关联原问题.                |
| `report`        | 子代理发送中间发现, 不声明完成.                                              |
| `finish`        | 子代理声明 `fulfilled` 或 `unable`, 附报告及预期 `files`/`checks`.           |
| `cancel`        | 停止有权控制的任务分支或整个批次, 保留现有文件和记录.                        |
| `restrict`      | 收窄所拥有分支的工具. 受影响的活动工具停止后才能结算.                        |
| `accept`        | 单独记录主代理验收, 不与子代理的履约声明混为一谈.                            |
| `release`       | 在保存检查通过后, 显式释放空闲代理工作区.                                    |
| `roles`         | 发现可用的命名角色.                                                          |
| `acknowledge`   | 确认一条具体的持久通知.                                                      |

精确参数见 [protocol.ts](../../../src/subagent/protocol.ts). 通信和检查应使用返回的任务标识. 主代理管理整棵树; 子代理不能取消或 steer 无关任务. 同一批次内可以跨层级发消息. 主代理负责跨批次转达, 也可以在新交办的 `inputs` 中提供已保存且 fulfilled 的任务标识.

普通最终回答不等于履约声明. 父代理还须等待自己拥有的交办并消费其结果. 执行结束、履约、证据已保存和主代理验收是四件不同的事. 声称 fulfilled 的结果仍可能无法通过审查.

取消沿当前任务归属传播. 旧下级在新交办中归主代理管理后, 旧父代理不再拥有该任务的控制权. 活动工作真正停止前保持 Cancelling, 不撤销已经发生的外部效果. 主代理回答期间或关闭检查页后, 后台任务仍可继续.

## 使用 60 配列键盘检查

FleetView 位于正常 statusline 下方. Main 没有 description. 子代理行对齐名称、描述、状态和指标, 正常执行不重复显示 Running. 选中只改变圆圈图标, 不整行高亮. 最多显示六个子代理行, 并显示屏外活动和待处理事项数量.

`/agents` 打开总览, `/agents fleet` 聚焦 FleetView. 默认检查快捷键为 `Ctrl+Q`. Pi 已将 `Ctrl+R` 用于会话重命名. 自定义快捷键仍须经过宿主和扩展的冲突检查; 如 Pi 报告冲突, 通过 `subagent.inspectShortcut` 重映射. 可用的检查快捷键保留主编辑器草稿、光标和撤销状态, 主代理忙碌时也适用.

| 场景       | 按键                                                     |
| ---------- | -------------------------------------------------------- |
| 浏览       | `j/k`、Enter、`q` 或 Esc, `?` 查看局部帮助.              |
| 内容树或图 | `h/l` 折叠/展开或平移.                                   |
| 长内容     | `u/d` 移动半页, `g/G` 到首尾.                            |
| 可用操作   | `a`, 再选择操作名称.                                     |
| 完整阅读器 | `/` 搜索, `n/N` 下一个/上一个匹配, `f` 显式跟随实时输出. |
| 区域       | Tab.                                                     |

方向键是可选别名. 文本编辑器采用 Pi 原生编辑和提交方式, 浏览字母不会在输入中触发操作. 返回保留定向草稿, 不会发送. 发送失败保留草稿和收件目标. Stop 须确认.

定向输入保留收件人、原生编辑器、当前补全候选和提交提示. 窗口较矮时先省略可选上下文; 原生编辑器本身仍无法放下时, 显示所需高度并保留 Esc 返回. 普通详情页在内容滚动时保持底部导航提示可见.

底部检查区取代主编辑器、statusline 和 FleetView, 上方保留主对话. 它不是 overlay, 也不切换宿主的活动代理. Prompt 位于 Progress 上方. 新续聊到来时, 已打开的详情仍固定在原交办. 内容树可以打开完整报告、日志和 diff.

Tab 在总览的结构区和摘要区之间切换焦点, 两区独立滚动. 选择节点或详情标题时会自动使其可见; 手动平移会保留, 直到另一次选择或窗口尺寸变化. 长 Actions、Help 和 Stop 预览也使用 `u/d` 和 `g/G`. Stop 预览会加入页面打开期间新接收的下级任务.

在 Actions 和 Detail 中, `g/G` 选择首项/末项并使其可见. History 展开时, 这组按键作用于历史交办列表. 在完整阅读器中, 它们移动到内容首尾. `u/d` 只滚动画面, 不改变选中项.

配置详情记录本次交办实际加载的规则、可用技能、接收时的限额以及后续工具限制. 单任务用量和批次汇总分别标注; 汇总对每个下级和续聊计数一次, 并标明尚无测量值的任务. 暂停跟随的阅读器保留当前内容, 显示新增活动, 直到显式恢复跟随.

详情预览优先显示请求、当前工作和结果, 配置与执行元数据可在完整分段中查看. Attention 统计未答问题、待处理通知和当前失败. 恢复成功后不再计入旧失败, 但旧交办上的未处理通知仍可通过 attention 筛选直接打开.

详情中的 `/` 会在完整阅读器打开当前分段并搜索. 无匹配时明确提示, 保留原位置. 阅读器标题显示代理与分段名称.

总览用列表展示独立工作, 用图展示真实结果依赖. 所有权下钻和已保存输入引用与依赖箭头分开, 避免将图上的箭头误认为取消权限.

## 配置和角色

用户设置位于 Pi agent 目录下的 `pi-stuff.json`. 项目默认值和角色从最近一个含 `.pi/pi-stuff.json` 或 `.pi/agents` 的祖先目录发现. 例如:

```json
{
  "subagent": {
    "concurrency": 8,
    "tasksPerDispatch": 64,
    "maxDepth": 3,
    "resultWaitMs": 60000,
    "answerWaitMs": 600000,
    "inspectShortcut": "ctrl+q",
    "defaults": {"thinking": "medium"}
  }
}
```

这些并发、数量和深度值是试用默认值, 并非经过测量的容量建议. 主会话内所有批次共享执行槽位. 保留代理的续聊消耗原批次累计额度. 只有任务的其他执行都已静止, 显式等待才释放槽位. 未配置 `executionTimeoutMs` 时没有累计执行期限. 执行时钟排除排队和显式等待; Fleet 经过时间包含启动后的等待.

新交办在父级当前权限上限内, 按调用、显式角色、项目、用户、父级顺序解析配置. 默认使用新上下文和只读 Git 快照. 首次派发时设置 `copyHistory: true`, 可以在有效分叉边界复制已完成的可见历史和已有压缩摘要. 后续父会话消息不会自动复制.

角色文件是带 frontmatter 的 Markdown:

```markdown
---
name: reviewer
description: Review correctness and failure handling
tools: read, grep, find, ls, subagent
thinking: high
workspace: snapshot
---

Read the changed code and its tests. Report concrete failures with evidence.
```

角色来自 agent 目录的 `agents`、项目的 `.pi/agents` 和配置的 `rolePaths`. 通过 `role` 选择精确名称, 提示词中的普通词语不会选择角色. 续聊使用已保存配置加受支持的 `overrides`. 编辑角色文件不会悄悄改变保留任务, 但当前工具限制始终生效.

模型采用 `provider/model` 语法, 使用宿主已配置的认证. 子代理模型注册独立; 不要把凭据值放入提示词. 支持内置工具和已验证的 `pi-stuff:web` 扩展. 授予 Web 工具时, 设置 `extensions: ["pi-stuff:web"]`, 并在工具列表中包含所需工具和 `subagent`. 初始化创建子代理自己的 Web 缓存和生命周期, 再过滤暴露工具. 不支持的扩展会明确失败; 分离工厂并不能保证任意第三方全局状态隔离.

## 代码、持久化和恢复

| 工作区     | 行为                                                                     |
| ---------- | ------------------------------------------------------------------------ |
| `snapshot` | 默认只读 Git 快照, 包含已跟踪脏修改. 未跟踪输入由 `include` 显式选择.    |
| `write`    | 独立保留的 Git worktree, 可使用写工具. 声明范围内的文件形成固定代码产物. |
| `live`     | 显式只读访问当前源码, 支持非 Git 目录.                                   |
| `direct`   | 显式在所选目录写入, 支持非 Git 项目.                                     |

隔离初始化失败不会退回父目录. 捕获快照不修改源 index 和工作树. 未接受显式基线变更时, 续聊复用原工作区. 消费者收到固定提交, 而不是移动中的分支 tip. 多份代码输入需要显式集成基线; 是否将产物应用到主检出由主代理决定.

保留代理的工作区模式不变. 需要在 snapshot、write、live 或 direct 之间切换时, 派发新代理. 收窄工具时仍保留 `subagent`, 供其报告和管理任务生命周期; 每项操作仍由协调器检查子代理权限.

记录位于 `<Pi agent directory>/pi-stuff/subagents/<parent session ID>/`, 包含子上下文、复制历史和工作区. 本地只有一个执行者拥有写权限, 第二个打开者观察已有记录, 不重复启动工作. 崩溃后未解决的任务需要显式恢复, 不重放已有写操作. 必需上下文、代码或执行者证据缺失/损坏时阻止继续, 不悄悄替换为新状态.

隔离工作区丢失, 但保存的提交和子上下文仍可用时, 显式继续会重建该基线并记录恢复过程. 已删除目录中的未保存文件无法恢复, 这一缺口会明确报告. 保存的提交或子上下文缺失仍会阻止继续.

真正离开会话前, 先停止和保存子任务. 核心保存错误会阻止成功离开并保持可见. 可选事件监听器失败不会把 fulfilled 任务改成 failed. `pi-stuff:subagent` 事件为观察者提供当前 revision 和任务记录.

Release 拒绝仍有未保存的已跟踪、未跟踪或 ignored 内容, 以及仍有活动或排队交办的工作区. 对于已结束的交办, 它先阻止该代理接收新工作, 等通知和会话清理完成后再检查并释放工作区. 删除前检测到保存故障会阻止释放. 若删除后保存最终释放记录失败, 会明确报错; 此时目录可能已删除, 已保存的产物和上下文仍保留. 部分成果保存妥当后再清理. Linux 进程身份和受跟踪 shell 进程组提供取消与恢复证据; 工具白名单和工作树路径不是操作系统沙箱, 刻意脱离的外部 daemon 需要额外核对.

回退扩展代码不会迁移或删除这些记录. 变更实现版本前, 应让所属 Pi 会话成功停止并保留记录目录. 不要手动删除执行者锁来强制第二个写入者接管.

## 实现参考

[实现与验收记录](subagents-implementation.md)列出已接受功能对应的回归来源、实际终端截图和审查边界.

Fork 参考为 [`@arhen/pi-core-subagent` 1.3.54](https://github.com/arhen/pi-extensions/tree/de1c8783c2a39b1cbb0f86b412307193de9774c1/packages/core/pi-core-subagent). 已保留其 [MIT 声明](../../../src/subagent/LICENSE.arhen), 包括更早的 fork 归属. Pi Stuff 在 `src/subagent` 中实现已接受的生命周期、持久化和 UI 合同, 不采用上游 UI.

隔离工作区区分 Git 根目录与子代理实际工作目录. 从 linked checkout 的 `api/` 派发时, 快照捕获该 checkout 的脏状态, 子代理在新 worktree 的 `api/` 中执行. 声明的产物路径从该实际目录解析. 即使子代理已自行提交修改, 仍会相对本次交办的原始基线形成固定产物.
