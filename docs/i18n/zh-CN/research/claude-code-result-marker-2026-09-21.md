# Claude Code 结果枝线实测

[English](../../../research/claude-code-result-marker-2026-09-21.md) · [真实截图画廊](../../../../prototypes/ui-session/claude-reference/index.html)

## 结论

此前 "每个工具结果一个标记" 的描述过窄. 在本轮 Claude Code 2.1.261 实测路径中, `⎿` 标记可见从属内容的开头: 已完成输出、运行中的 stdout、当前命令预览, 或中断提示. 它不是每一行都有, 也不是每次调用必有; 收起后的摘要可以没有.

一个已显示的多行结果, 首行有一个标记, 后续源文本行及终端折行使用空格对齐. 两个独立显示的 Bash 结果有两个标记. 展开聚合的两个 Read 后, 各有一个结果标记. Edit 的改动摘要有一个, diff 正文各行不重复.

## 方法与来源

2026-09-21 直接执行本机官方 Linux 发布版 Claude Code `2.1.261`, SHA256 为 `4ae40dd1784e85753e742e09f267d29ecbb82890361ad3817d27560866d364a6`. Terminal Control 1.2.1 在新 PTY 中启动该二进制, HOME、配置和工作目录均隔离. 没有复制用户的 Claude 凭据、设置、hooks 或项目文件. 使用 `--bare`、明确工具允许列表、`--permission-mode dontAsk` 和空的严格 MCP 配置限定探针. 实测工具为 Bash、Read、Edit, 未绕过权限检查.

本地 Anthropic 兼容 SSE 夹具提供合法的工具调用块, 最后返回 `PROBE_COMPLETE` 文本. 无工具的辅助请求单独返回文本, 不推进场景. Claude Code 自己执行 shell 命令、读取文件、修改临时文件, 随后的客户端请求携带实际 `tool_result`; 完成场景的交换记录随证据保留. 夹具没有提供终端行、截图或预制工具结果. 这验证客户端执行与渲染, 不验证真实模型的工具选择或推理. 界面中的模型及计费标签来自客户端的假 API 配置, 不代表付费模型调用.

classic 使用 `CLAUDE_CODE_NO_FLICKER=0`, fullscreen 使用 `1`. 两者均为 Claude 浅色主题; 白底黑字的 OSC 默认色只发往隔离截图 PTY. 视口为 100 x 40, 长行另测 60 x 40. PNG 由捕获的 ANSI 用仓库 Nerd Font 字体栈直接导出. 未涉及原生桌面 compositor 或 Ghostty 配置. 参见[官方模式切换文档](https://code.claude.com/docs/en/fullscreen#enable-fullscreen-rendering).

共执行 20 个场景/模式/宽度组合, 保留 43 个画面状态. 每次实际发送键盘输入, 完成场景在 Ctrl+O 前后捕获. classic 运行态等待独立 stdout 行 `RUN_SECOND`, 不匹配命令标题中的同名文本. 本轮 fullscreen 运行视图没有显示该 stdout, 因此捕获命令子项, 再进入详细记录、返回并按 Escape. 运行态是瞬时画面, 不声称动画已静止. 所有自建会话、driver 和夹具服务器均已停止.

## 观察结果

| 场景                         | classic 默认                                 | fullscreen 默认                      | 详细记录                                             |
| ---------------------------- | -------------------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| `python3 output.py` 输出八行 | 一个 `⎿`, 前三行及 `… +5 lines`              | `Ran 1 shell command`, 零个          | 八行输出共用一个标记                                 |
| 两个独立 `printf` 调用       | 两个 Bash 块, 两个标记                       | `Ran 2 shell commands`, 零个         | 两个结果各有一个                                     |
| `true`                       | `(No output)` 前一个                         | `Ran 1 shell command`, 零个          | `(No output)` 前一个                                 |
| 两行 stderr, exit 3          | `Error: Exit code 3` 前一个, stderr 续行缩进 | `Ran 1 shell command`, 零个          | 同样一个错误块标记                                   |
| 同次响应包含两个 Read        | `Read 2 files`, 零个                         | `Read 2 files`, 零个                 | 两个 Read 各有一个                                   |
| `Bash(cat multiline.txt)`    | `Read 1 file`, 零个                          | `Read 1 file`, 零个                  | 恢复实际 Bash 调用和八行输出, 一个标记               |
| Read 后成功 Edit             | Read 收起; Update 摘要和 diff 保留, 一个标记 | 标记结构相同                         | Read、Update 各一个, diff 正文没有                   |
| 100/60 列长 Bash 输出        | 一个标记; 窄屏预览可能折叠渲染后的行         | `Ran 1 shell command`, 零个          | 换行增加物理行, 不增加标记                           |
| Bash 运行中                  | stdout 和耗时等内容前一个                    | 活动描述下, `$ command` 前一个       | fullscreen 样本仅显示调用标题, 没有子项标记或 stdout |
| 该 Bash 运行中按 Escape      | 中断提示前一个                               | `Ran 1 shell command` 加一个中断标记 | 中断提示仍附于该工具活动                             |

数字仅描述捕获到的画面, 不是全部工具或配置的 API 保证. fullscreen 的 Edit 是明确例外, 不能说它隐藏所有工具结果. 失败结果的折叠是夹具最终响应后的实际观察, 不作为 Pi 的推荐行为.

[截图索引](../../../../prototypes/ui-session/claude-reference/manifest.json)记录版本、每次执行和标记数量. 每次执行保留默认/展开的 TXT、ANSI、PNG, 完整终端流, 夹具发出的调用及实际返回结果. 运行场景改为保留运行/取消状态, fullscreen 另有运行中详细记录. ANSI 流以 gzip 保存, 保留原始 CR/LF 和控制字节, 避免 Git 文本规范化. 证据中的临时绝对路径仅指生成的测试文件.

## 复现输入

创建 `a.txt`, 内容为 `alpha`、`beta`、`gamma`; `b.txt` 为 `delta`、`epsilon`, 均以换行结尾. 多行 Python 脚本打印 `RESULT_LINE_1: actual shell output` 至 `RESULT_LINE_8: actual shell output`. 长行脚本打印 `LONG_START `, 十二次 `pagination_cursor_`, ` LONG_END`, 下一行打印 `SECOND_LOGICAL_LINE`. 其他 Bash 精确命令和 Edit 输入见各自 `exchanges.json`.

以以上模式变量、隔离配置和本地 Messages endpoint 启动新的交互式发布版. 通过 endpoint 返回保留的工具调用块, 让客户端执行, 收到结果后返回最终文本. 发送 Ctrl+O 查看详情. 运行态 Python 先打印两行, 等二十秒再打印最后一行; 最后一行前发送 Escape. 无需永久安装测试框架或依赖.

## 对 Pi 原型的影响

保留原型已声明的 classic/旧 Pi 风格: 可见子结果摘要开头一个标记, 正文保持缩进, 展开子工具各有自己的标记. 原型 `Explored` 父摘要仍有枝线, 与 Claude 实测的收起检索摘要不同; 这是已有设计选择, 不再称为精确复刻. assistant 失败/中断仍遵守用户要求的普通文字策略. 观察到 Claude 的工具中断提示带枝线, 不等于授权改变该策略.

本轮确定的是这些 Bash/Read/Edit 路径, 未覆盖 Web、MCP、agents、hooks、权限弹窗、纯 assistant 提供方失败或所有主题配置. 布局仍用描述性名称 "工具调用/结果块", 或旧项目的 Operation Block. 对字形作用, "从属内容连接符" 比 "已完成结果标记" 更准确; 这是我们的描述, 不是 Claude 官方组件名.
