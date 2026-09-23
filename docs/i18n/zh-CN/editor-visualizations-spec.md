# Editor 高亮、代码块可视化与 skill 消息展示

[English](../../editor-visualizations-spec.md) · 英文为准.

状态: 四项访谈均已确定: editor 高亮、chart/tree、原生 skill 触发、skill 消息合并展示. [Issue #119](https://github.com/jczhang02/pi-stuff/issues/119) 跟踪交付. 维护者已通过 implement 技能授权在新 worktree 中实现.

## 已确认行为

### Retro 高亮

采用配色对比中的 B: pi-stuff-old 提交 `e61ed27e` 的 `packages/pi-stuff/src/conversation-ui/retro-text.ts` 静态加粗渐变. 九个 RGB 色标经过蓝、紫、粉和暖黄, 最后回到蓝色. 保留该算法, 包括短字符串首尾可能同色的效果; 不替换成旧主分支 ANSI 彩虹, 不加动画.

Retro 高亮仅用于输入框草稿. 发送后的用户消息保留正常颜色, 包括技能标签和指令. Assistant 回复、工具输出及 Thinking 也不在高亮范围. 此决定取代此前所有用户消息高亮决定, 历史消息重新着色问题随之取消.

完整 skill 引用或配置关键词匹配后就上色, 不区分正文、行内代码或围栏代码. 保留光标与选区行为、周边样式、终端控制序列、源文本和提交语义. 不增加 Markdown 区域例外.

识别完整 `/skill:<name>` 文本和配置关键词. 文本形式的 skill 引用不要求已安装对应 skill, 高亮也不执行它. 保留编辑草稿、提交文本、存储消息和模型上下文.

每条关键词配置都按正则解释, 默认不区分大小写, 允许单条规则显式区分大小写. 默认列表为空. 匹配边界完全由表达式决定, 不额外增加中英文完整词或路径例外. 例如 `review` 也匹配 `Review` 和 `preview` 中的相应部分, 需要完整词时在表达式中写明边界. 纯文本中的正则特殊字符需要转义. 完整 skill 引用优先于关键词. 关键词从左向右匹配, 同起点取最长, 每个匹配只上色一次. 每个匹配从渐变起点开始, 折行保持颜色相位.

使用现有全局 `pi-stuff.json`, 不增加项目覆盖. 设置面板提供开关; 在文件中编辑关键词列表, `/reload` 后应用文件修改. 尚未要求在面板内编辑列表. 开关默认开启, 同时控制 skill 和关键词高亮; 面板切换立即应用并保存. 关闭高亮不关闭 chart/tree. 沿用现有文件/结构配置错误处理约定. 跳过无效正则, 每次加载配置时提示一次, 其余有效规则与 editor 继续正常工作.

### Chart 和 tree 显示

保留 pi-stuff-old 的可观察语法、类型与限制. 在用户消息和 assistant 正文（含恢复历史）中转换完整有效的 `chart` 与 `tree` Markdown 代码块. 输入框显示 Markdown 源码. Thinking 与工具输出不转换.

- 图表支持 bar（包含 histogram 别名）、line、scatter、sparkline、heatmap.
- 树只有一个根, 每层两个空格, 拒绝 Tab、奇数缩进、空节点、层级跳跃和额外根节点. 保留完整标签, 不截断.
- 单块源文本最多12,000字符, 每条消息最多转换16块. 普通图表最多64个点, 热力图最多32行乘64列, 树最多256个节点、深度32.
- 图表至少需要24个内容列, 最多使用80列. 宿主缩进和外层标记另行预留. 树中任何一行放不下时保留源代码块.
- 未闭合、格式错误、不安全、嵌套、超限或过窄时继续显示普通代码块. 流式输出中有效代码块闭合后可以转换.
- 仅改变显示, 保留原始消息、会话记录、复制/导出源文本和模型上下文. 不向模型请求追加 chart/tree 格式指令.

参考行为位于 pi-stuff-old 主分支修订 `21b636ea` 的 ADR 0017、`fenced-visualization.ts`、`unicode-chart.ts` 和 `indentation-tree.ts`. 这里接受的是行为, 不代表直接复用其加载器或宿主补丁.

## 原生 skill 触发

Pi 0.87.1 仅在输入以 `/skill:` 开头时展开技能. `_expandSkillCommand` 加载匹配的技能, 在内部 `<skill>` 块后附加用户参数. 未知技能原样传递. [官方技能文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md) 将显式调用描述为确保加载技能指令的方式, 同时保留模型按需加载技能的能力.

已核对的文档没有说明为何仅在首部触发. 区分命令与普通提及、避免多技能解析是根据实现作出的合理推断, 不能作为维护者明确表达的动机. 维护者已确认保留原生技能触发、展开和模型按需加载行为. 不增加任意位置调用或多技能展开. 输入框高亮与技能调用保持独立.

## Skill 消息合并展示

维护者要求 `/skill:name prompt` 像 pi-stuff-old 一样只展示一个 user prompt message, 使用正常的用户消息颜色.

Pi 0.87.1 已将技能块和 prompt 存在同一条 user message 中. 交互渲染器将其拆成 `SkillInvocationMessageComponent`, 有参数时再显示一个 `UserMessageComponent`. 本次需求针对可见的拆分, 不需要合并两条存储记录.

完整 `/skill:<name>` 标签与普通 prompt 合在一张用户消息卡片内显示, 保留正常颜色、背景、间距和 Markdown 渲染. Prompt 以列表、引用或代码块开头时, 放在标签下一行以保留结构.

技能指令默认折叠. 沿用原生展开操作, 在同一卡片内的 prompt 后显示指令, 不重复 prompt. 纯 skill 调用只显示标签, 仍支持展开指令. 恢复历史使用相同展示规则. 保留原始会话记录与模型输入.

维护者已确认上述展示规则. 旧实现是行为参考, 不代表批准引入其用户消息彩虹色或宿主私有补丁.

## 访谈顺序

1. 仅 editor 高亮已确认: 上色表示文本匹配而非调用, 全部条目为正则且自行定义边界, 默认忽略大小写并允许按条覆盖, 无效条目单独跳过. 执行用户表达式时须保持输入响应; 实现细节需验证, 不再增加产品例外.
2. Chart/tree 已按上方完整兼容约定确认, 包括用户消息中的可视化转换, 不添加 retro 配色.
3. 原生 skill 触发已确认保持不变.
4. Skill/prompt 合并展示已确认: 正常配色的单张卡片, 原生操作在卡片内展开指令, 纯 skill 只显示标签, 恢复历史采用相同展示.

四项讨论及实现均已获授权. 已确认测试边界为 editor 渲染/配置、Markdown 可视化转换、skill 消息合并/展开, 另做实际宿主验收. 独立审查基线为 main `1369773`.

## 接入与验收

实现基线为 main `1369773`, 已包含合并的 statusline #117. 本任务合并前, 会话 UI #106 / PR #107 已作为 `ef6b0d5` 合入主线, 现已接入本分支. Pi 每个扩展只有一个 Markdown transformer: 可视化注册提供共享 owner, skill 适配及 UI assistant/tool 适配共用该入口. 关闭 UI 仍保留 editor 配色、chart/tree 和统一 skill 卡片. 组合分支重新执行产品及宿主套件, 补充 UI 开启/关闭时的可视化和 skill 卡片回归. 未修改其他负责人的工作区.

优先使用已有宿主 editor 和 Markdown API, Markdown 转换由单一模块负责. 本次 editor retro 文本是常规语义主题色的局部例外, 例外边界确认后同步更新双语设计规范. 本规格不授权新增依赖.

图表算法来自 MIT 许可的 `@howaboua/pi-unicode-charts` 0.1.0, 提交 `8d63d300597488e6fa4c30ccd6a3eb0fed2d4304`. 保留源代码/许可声明, 在实现证据中记录来源. Retro 源码引用 pi-footer `1b83749f` 的 `src/ui/title-bar.ts`, 导入前核实并保留适用声明. 不新增 `UPSTREAM.md`.

交付前验证已接受的匹配示例、输入/光标/补全、原始数据保留、流式与恢复消息、可视化回退、Unicode 列宽、深浅主题和其他 UI 功能共存. 记录支持宿主的真实终端证据及普通路径性能; 配色预览不代表产品验收. 必需的独立审查、检查与合并授权遵循仓库流程.

## 配置与操作

`/editor` 打开原生设置列表. 唯一开关保存成功后立即生效. 全局配置中的关键词填写正则源码字符串, 仍需遵循 JSON 转义:

```json
{
  "editor": {
    "enabled": true,
    "keywords": [
      {"pattern": "review"},
      {"pattern": "\\bFIXME\\b", "caseSensitive": true}
    ]
  }
}
```

修改文件后 reload. 无效正则按从1开始的条目序号报告并跳过. 正则在独立 worker 中匹配, 避免复杂表达式阻塞输入. Worker 启动后单次请求超过200ms时, 当前草稿仅保留 skill 高亮; 后续编辑只保留最新草稿. 等旧 worker 退出后, 后续编辑留下的最新草稿在1秒冷却后执行, 连续失败翻倍至最多30秒. 不编辑就不会重复执行失败草稿, 成功匹配后恢复正常调度. Reload 或退出会取消待执行的恢复. 这是输入响应保护, 不改变匹配语法.

Chart/tree 和 skill 消息合并独立于 editor 开关保持启用. 原生 skill 展开语义不变. 点击 skill 卡片首个内容行, 或使用 Pi 已配置的展开键查看指令.

实现使用原生 editor factory 和 Markdown transformer, 对 editor 布局、可视化围栏显示和 skill 插入采用局部显示适配. 适配器保留原生存储和执行, reload/退出时仅在仍持有方法所有权的情况下恢复包装. Worker 不导入运行时包, 因为编译宿主不会继承扩展加载器的包解析环境.

配色来源: [pi-footer 1b83749f](https://github.com/wobondar/pi-footer/tree/1b83749f), MIT, copyright 2026 wobondar; 声明保留在 `src/editor/LICENSE-pi-footer.txt`. 图表声明保留在 `src/visualizations/LICENSE-Howaboua.txt`. 解析器与树行为改编自 pi-stuff-old `21b636ea`, MIT, copyright 2026 JC Zhang.

## 实现证据

生产代码 `15f3b62` 已通过以 `1369773` 为基线的独立只读标准和需求审查. 审查上下文为负责人 `codex:01a0cc15-4b69-7610-8c2f-351db6a5f4e6` 的子上下文 `implementation_standards` 与 `implementation_spec`, 均使用强制 thermo-nuclear 审查技能. 图表折行/根节点丢失、原生 editor 工作指示及 Markdown skill 标签位置问题均已修复并独立复核, 无遗留结构问题.

Terminal Control 在编译 Pi 0.85.1、0.86.1、0.87.1 上各执行七项真实宿主场景, 均为7通过、0失败. 覆盖设置保存/reload、无效及病态正则、光标编辑、原生 skill 展开与历史、正常消息配色、用户/assistant 可视化、窄布局、流式 chart 从未闭合源码到完成图形的转换及会话源码不变. 保存测试最初在异步写入完成前读取文件, 现已改为等待实际保存值. 命令为 `PI_TEST_HOST=<compiled-pi> bun test tests/system/editor-visualizations.test.ts`.

以下截图来自实际编译 0.87.1 宿主, 由 Terminal Control 按设计字体栈回放导出. Editor 截图为100列乘30行, 分别显式使用黑/白终端默认背景以匹配深/浅主题; 图表截图为60列乘30行. 它们是无头终端捕获, 不是桌面终端照片.

- [深色 editor 与已发送 skill 卡片](../../assets/editor-visualizations/editor-dark.png)
- [浅色 editor 与已发送 skill 卡片](../../assets/editor-visualizations/editor-light.png)
- [60列 assistant tree 与 sparkline](../../assets/editor-visualizations/visualizations.png)

本地 Bun 1.4.0 基准使用真实 CustomEditor 和无操作终端 I/O, 草稿261字符、渲染宽度100列, 预热100次, 七组各1,000次渲染. 每次渲染中位数为原生0.026ms、使用已缓存正则高亮0.056ms, 增加约0.030ms. 这里只衡量普通渲染路径, 不代表端到端按键延迟或最坏正则开销; 病态正则宿主测试单独验证输入响应.

未增加依赖. 撤销实现可恢复原生显示. 加载旧版严格配置版本前, 应删除新增 `editor` 配置段; 原始会话无需迁移.

补充的[真实宿主性能报告](editor-performance.md)包含输入、着色完成、消息显示、内存快照与病态正则CPU数据. 实测确认长草稿退化和病态正则编辑期间的CPU成本, 不能据早期微基准声称没有性能问题.

相对 `7c35b91` 的性能修复通过47个文件共269项离线测试、1,701断言; 编译 Pi 0.85.1、0.86.1、0.87.1 的七项定向E2E也分别通过, 各28断言. 新增覆盖可见 Unicode 配色范围、原生 editor 滚动、超时后关键词恢复和冷却期间关闭. 静态与差异检查通过. 同一对独立标准/需求审查者复核完整修复差异, 生命周期验证及文档问题已解决, 包括一处中位数舍入更正, 无遗留审查发现. 更新后的性能报告保留修复前后原始数据及观测局限.
