# UI 集成实验

[English](../../../docs/ui-integration.md) · 以英文版为准.

这些实验检查 Pi 扩展 API 与已确认 UI 之间的差距. 维护者已[批准 assistant/Thoughts 展示适配](https://github.com/jczhang02/pi-stuff/issues/106#issuecomment-5786103200). 目前已添加 assistant 前导栏和 Thoughts 标签, 已观察到的思考区间在内存中独立计时. 工具历史接入按[另行决定](https://github.com/jczhang02/pi-stuff/issues/106#issuecomment-5785970338), 先比较公共 API 提前注册与 lookup patch.

## Assistant 和 Thoughts: 公共 API 的限制

assistant 实验使用当前 Pi 0.87.0 / Bun 1.4.0 编译宿主、隔离的确定性 provider 和100列×45行 Terminal Control 会话. 生产代码基线为 `5accad3`.

实验注册 Markdown transformer, 为 assistant 正文添加 `• `, 为 thinking 添加 `• Thoughts: `. 临时命令调用 Pi 的 `setHiddenThinkingLabel`.

| 操作                                                                           | 实际结果                                                     | 影响                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------- |
| 给以两个 Markdown 列表项开头的回答添加前缀                                     | 首行变成 `• - FIRST_LIST_ITEM`, 第二项的列表标记在其左侧两列 | 在源码前加文字不能得到已确认的消息前导栏 |
| 给展开的 thinking 添加前缀                                                     | 整行 Thoughts 仍为斜体, 截图对应的终端帧包含35个斜体单元格   | 前缀不能改变 Pi 默认的 thinking 字体样式 |
| 先将隐藏标签设为 `• Thoughts · 1s`, 再产生一个回答, 随后设为 `• Thoughts · 2s` | 两个历史 thinking 块都显示 `2s`                              | 全局标签不能表示各块独立耗时             |

`1s` 和 `2s` 是故意设置的标签, 不是实测耗时. provider 收到的上一条 assistant 正文保持原样, 没有展示前缀.

![公开 transformer 实验: 列表错列与斜体 Thoughts](../../assets/ui/public-api-prefix-dark-100.png)

![全局标签实验: 两个历史块一起采用最新标签](../../assets/ui/public-api-labels-dark-100.png)

Pi 的[扩展类型](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/extensions/types.ts)提供 Markdown 渲染前的 transformer 和字符串形式的隐藏标签. [assistant 组件](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/modes/interactive/components/assistant-message.ts)负责 thinking 斜体和局部显示状态. 此扩展 API 没有注册 assistant 组件工厂的入口. 已安装的0.85.1类型声明具有相同的相关边界.

### 必须保留的行为

真实宿主消息测试检查 Ctrl+T 改变默认值并清除局部覆盖, 点击只展开一个 thinking 块, Ctrl+O 保持 thinking 收起. 同时检查下一次模型请求包含原始 assistant 正文. 这些原生行为检查已通过, 不代表新字体样式或计时已完成.

```sh
bun test tests/system/ui-messages.test.ts
PI_TEST_HOST=/opt/bin/pi bun test tests/system/ui-messages.test.ts
```

确定性 provider 先发送 reasoning, 再发送最终正文. 只有 provider 流使用脚本控制, 测试驱动真实 Pi TUI 和 renderer. 同一文件中的欢迎页测试保留.

### 已批准的兼容补丁范围

已批准在 `AssistantMessageComponent` 的内容组装处增加仅负责展示的适配层. 批准的是接入方向, 不代表功能或性能验收完成.

- 在 Markdown 解析之后添加 assistant 前导栏, 复用 Pi Markdown、语法高亮和折行, 保留原生失败/Esc 展示.
- 按 Thoughts 块调整展示并记录内存中的实测耗时, 保留 Hide thinking、Ctrl+T 和局部鼠标展开. 不修改 canonical message、provider 上下文或会话记录, 缺少历史计时则省略.
- 每次 UI 扩展加载只安装一次, shutdown/reload 时恢复. 检查宿主结构、保留其他扩展, 无法安全适配时回退原生展示. 不修改 Pi 安装文件.
- 验收前检查重复 reload、切换会话、主题/宽度变化、流式输出、列表/代码开头的回答以及长历史性能.

把全局隐藏标签接口当成计时器还会反复更新历史组件. [所检查 pi-tool-display 版本](https://github.com/MasuRii/pi-tool-display/blob/91cef7580078371f8dc49a8607222807ad6a424d/src/thinking-label.ts)通过修改持久化 thinking 添加标签, 与已确认的记录保留要求冲突. 两种做法均不采用.

### Assistant 前导栏实现

首段实现包装原生内容组装, 通过注册的原样返回 Markdown transformer 身份识别所属实例, 为原生 Markdown 子组件添加两列前导区域. Thoughts 鼠标区域和原生错误 Text 组件不参与修改. 不给消息拼接文本或替换 Markdown 解析. quit/reload 时先停用 wrapper, 仍持有方法时再恢复; 切换会话则保留安装.

包装层复用原生返回的行数组, 只保存一个宽度的前缀输出. 独立审查发现初版重复扫描 ANSI, 现仅在原生行数组或宽度变化时重算. 完整流式与长历史性能仍待验收.

真实宿主测试覆盖列表开头、reload、亮暗主题、60/80/120列、反复启用/关闭 UI 和新会话, 并保留既有 thinking 展开检查. 同时检查下一次 provider 请求收到原列表文本. 这些测试不证明 Thoughts 样式、计时、并发 SDK 隔离或任意外部补丁共存.

下图使用编译 Pi 0.87.0 / Bun 1.4.0、隔离确定性 provider、80×24终端及 Pi 默认暗色主题. Terminal Control 将虚拟终端导出 SVG, 再由 rsvg-convert 转为 PNG, 不是 Ghostty 窗口截图.

![Assistant 前导栏与原生列表、代码渲染](../../assets/ui/assistant-gutter-dark-80.png)

### Thoughts 标签

后续实现修饰 Pi 原有 Thoughts 鼠标区域中的子组件. 展开时以 `• Thoughts: ` 开头, 收起时显示 `• Thoughts`. 按维护者允许的方案保留原生斜体 Markdown. 标签预留宽度但不改写 Markdown 源文, 列表结构不变. 续行与 assistant 正文一样保留两列前导区域. 运行中的展开与收起态均显示 `Thinking · Ns`. 完成后收起态显示 `Thoughts · Ns`, 展开态在正文末尾添加时长. 这些截图展示实测两秒的 reasoning 区间.

Ctrl+T 和局部点击仍使用 Pi 的可见性状态. 审查复现了含 Thoughts 会话 reload 后再新建会话的崩溃: 初版样式回调保留了失效的扩展 context. 修正后仅保留 Pi 动态主题代理. 回归测试覆盖这次切换及下一次回答.

以下截图与 assistant 图使用相同编译宿主、隔离 provider、80×24虚拟终端和 SVG 转 PNG 方式. 使用 Terminal Control 默认导出字体, 不是维护者的 Ghostty 字体配置.

![展开的 Thoughts 与原生 Markdown](../../assets/ui/thoughts-visible-dark-80.png)

![收起的 Thoughts 与实测时长](../../assets/ui/thoughts-hidden-dark-80.png)

### 计时边界

计时使用 Pi 公开消息事件和单调时钟. thinking start/delta 开始或恢复一个区间; text/tool 输出立即结束该区间, 即使 provider 要等整条回答结束才发送 `thinking_end`. Pi 合并展示的连续 thinking 块累加各自实测区间. 取消时冻结当前区间. 不添加定时器、持久化字段或消息改写. 运行标签随 Pi 原有重绘按整秒更新, 已完成内容保留布局缓存.

WeakMap 将各个已观察消息对象及最终消息关联到计时. reload 和切换会话会清除观测数据, 恢复的历史块只保留 Thoughts 标签. 测试检查两轮不同时长、provider 暂停时继续计数、排除正文暂停时间、取消后恢复、reload/resume 及保存记录字节不变. 暂停 fixture 控制网络传输, 不指定界面显示的时长.

下方工具实验仍是与公共 API 提前注册并列的候选.

## 在重建历史之前获取工具定义

2026-09-22 的隔离探针拦截了公开导出的 `AgentSession.getToolDefinition()` 方法, 分别运行于 Pi 0.85.1 和当前 Pi 0.87.0 编译宿主, Bun 均为1.4.0. 扩展原样返回每个定义. 两个宿主在 reload 和 resume 时, 都先查询历史工具定义, **再触发 `session_start`**. 返回值包含真实 `execute`、参数 schema 和 renderer. 当前产品在 `session_start` 中注册内置工具的新展示, 此时历史组件已经组装完成.

已检查的 [AgentSession 源码](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session.ts)公开了此查询方法. [interactive mode](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/modes/interactive/interactive-mode.ts)在构造工具组件时使用它. 拦截该方法仍属于兼容补丁, 并非受支持的 renderer 注册 API.

后续两个临时实验使用既有隔离 Pi-host fixture 和 Terminal Control 1.2.1. 实验关闭产品 UI, 由临时扩展负责候选展示适配. 生产基线为 `12b0969`. [保留的观察记录](../../assets/ui/tool-lookup-experiment.json)包含两个宿主的生命周期记录和终端文本.

| 实验                                                    | 两个宿主的实际结果                                                                                                                         | 边界                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 复制原生 Read 定义, 只替换 renderer 字段                | 当前展示、连续三次 reload 和 resume 均使用候选 renderer; 后续修改文件不会改变历史内容                                                      | 不代表所有内置工具已验证                                                   |
| 注册自定义 Grep/Find fixture, 保留 Grep 并显式接管 Find | Grep 保留自定义展示, Find 使用候选展示; provider 收到的仍是 fixture 原结果                                                                 | 这是模拟第三方工具的 fixture, 不是已安装第三方包的验收                     |
| 比较定义和会话数据                                      | 返回定义保留原 `execute`、schema 和 prompt 字段引用; 观察的既有会话文件在 reload/new/resume 后字节不变; reload/resume 不重新执行自定义工具 | 不代表完整 UI 开关等价验证; 取消和 SDK 执行覆盖仍需生产测试                |
| 复用未修改的产品 Read renderer 和检索索引               | 两个成功 Read 聚合, 后续失败保持可见, 再后的成功另起一组; 连续三次 reload 和 resume 保留这些边界                                           | 仅测试未指定 offset/limit 的 Read; 本实验未覆盖 Web 聚合及其他生命周期操作 |
| 打开恢复后的组并使用 Ctrl+O                             | 成员与普通工具对齐, 紧凑成员隐藏正文, 展开显示记录中的内容, 修改文件后仍如此                                                               | 属于功能证据, 不是长历史性能结果                                           |

恢复历史聚合还需要一步. 临时适配器保存 `session_start` 前已组装结果的原生 `context.invalidate()` 回调. 既有检索索引恢复分支后, 逐个调用一次并清空回调表. Pi 随后依据恢复后的索引重新调用结果 renderer. 此过程无需修改 `ToolExecutionComponent` 或产品检索实现. 给 `setToolsExpanded()` 传入当前值无法替代此步骤: 已检查的宿主会直接返回, 不刷新组件.

### 作用范围和导出检查

通过生命周期回调函数相等判断所属扩展, 在0.85.1通过、在编译0.87.0失败: 后者把事件处理函数包装成了 `registeredHandler`. 后续改为仅检查已加载扩展的 `resolvedPath`, 虽然两个宿主均通过, 独立审查仍指出它不足以确定归属: 多个 SDK 实例可以加载同一路径.

两个宿主的命令处理函数均保留原身份. 最终聚合实验用这一身份匹配所属的已加载扩展. 另一项探针在每个宿主中创建两个真实 SDK 会话, 使用相同的 inline 扩展名; 每个查询只命中自己的适配器. 生产代码可以使用已注册的 `/ui` 处理函数, 无需增加标记命令. 这些探针验证了运行实例归属, 不代表完整并发 SDK UI 或配置验收.

审查还发现一个卸载问题: 仅在补丁链顶恢复方法, 无法阻止其他扩展后来重新装回旧 wrapper. 修订后的实验先停用 wrapper、使其透明透传, 再在仍持有方法时恢复原函数. SDK 探针检查了两种退出顺序, 以及中间插入外部 wrapper 的情况. 外部 wrapper 恢复旧适配器后, 旧适配器仍然停用, 另一活跃适配器也继续正常工作. 反复装卸外部 wrapper、内存保留和实际第三方补丁包仍待测试.

HTML 导出也使用定义查询. 0.85.1 的导出保留原会话结果并使用简单的自定义 Grep/Find renderer, 已解码检查其内嵌会话数据. Read 使用 Pi 自己的 HTML 模板, 因而此实验不验证自定义 Read HTML 或产品检索组导出. 首次断言直接搜索 HTML 源码, 因 Pi 将数据编码为 base64 而失败; 这是实验断言错误, 不是产品缺陷. 编译0.87.0因安装目录缺少 `export-html/template.css` 而无法导出, 不加拦截时也有同样错误. 该安装环境的导出兼容性仍未验证, 未修改任何安装文件.

### 工具接入方案比较

比较 pi-tool-display 的公共 API 提前注册方式与下述工具定义适配器, 暂不选定方案. 两者保持相同的执行、归属、Web 配置、生命周期和性能要求; 公共 API 满足要求时优先采用更简单方案. lookup 候选的做法如下: 通过 `/ui` 命令处理函数识别所属运行实例, 在原生历史组件构造前装饰实际定义, 保留执行与 schema; 分组索引就绪后, 仅刷新启动事件前生成的结果组件. 第三方 renderer 默认保留, 显式接管也使用同一入口. 退出时先停用适配器、再尝试恢复, 不覆盖其他扩展后装的替换.

Pi Stuff 的 Web 定义目前同样在 `session_start` 才注册, 此查询无法装饰尚不存在的定义. 通过 Pi 公共 API 提前注册时, 必须保留认证、模型选择和非法配置处理行为. 生产验收前, 接入全部工具及 Bash 结果观测, 重跑既有历史失败测试和配置、取消、媒体、生命周期及补丁共存检查. 对完整长历史负载测量适配器开关前后的表现. `12b0969` 的两个产品 reload/resume 测试仍未修复, 临时实验通过不等于生产测试通过. 比较应先确定是否需要这个 patch, 再选择生产接入方式.
