# 运行时兼容性

[English](../../compatibility.md)

## 无浮层观测原型

当前探索增加了[五个参考现有产品的候选方案](../../../tools/subagent-observation-lab/README.md)：资源检查器、监控台、通知收件箱、时间瀑布和堆叠式证据工作台。下面的前三个方案被认为不够发散，继续保留为可复现的历史对照。新方案复用它们的原生组件适配和离线场景，使用相同的固定运行时，没有新增依赖或修改已安装的包。启动器、输入路由和视图组合都是隔离的原型代码，尚未采纳生产子代理 UI。

[三个观测候选](../../../tools/subagent-observation-prototype/README.md) 的隔离启动器使用 `Bun.spawn`，验证环境仍为 Linux、Bun 1.4.0、Pi 0.85.1、Tuistory 0.11.0。它们组合原生布局、滚动、编辑器、底栏和消息组件，不导入此前的浮层查看器，也不调用浮层接口。执行使用内存样例；原生 SDK 会话只提供 footer 元数据。

这些候选不是完整 `InteractiveMode` 或正式扩展。具体 keybindings/theme 值未从公开根入口导出，所以原型直接导入固定版本的实现。并排模式通过自有子类调整当前实现可写的 `ScrollView.primary` 字段，让键盘滚动跟随输入焦点。搜索占据正常布局空间，Pi 的浮动搜索按键已禁用。正式采用前，这些实现依赖仍需要受支持的宿主接口。本轮没有新增依赖或修改已安装包的文件。

## 历史浮层 UI 原型

此前的浮层界面已被否决，由上方无浮层候选取代。源码和验证记录保留供比较，不再作为当前 UI 提案。

一次性原型的 [run.ts](../../../tools/subagent-ui-prototype/run.ts) 使用 `Bun.spawn` 启动隔离的 Bun 进程，继承终端输入输出并显式设置环境变量。Bun 已是仓库固定的运行时；子进程在临时目录运行并隔离 agent 数据，SDK 则使用调用者项目目录作为原生显示上下文。没有新增运行时依赖。

这一历史原型在 Linux、Bun 1.4.0 下运行 Pi SDK 0.85.1 的 `InteractiveMode`，使用 Tuistory 0.11.0 操作终端。会话与设置保存在内存中。[原型 README](../../../tools/subagent-ui-prototype/README.md) 记录原生与模拟 UI 的边界及复现命令。

以上说明针对纯 UI 产物。下面的独立运行时实验增加了开发依赖，并验证编译版宿主。

## 历史 Arhen 运行时 E2E

这一实验验证了此前浮层查看器的运行路径。执行证据在下述边界内保留效力，不能据此认定旧 UI 已被接受，或新候选已完成正式接入。

[运行时实验](../../../tools/subagent-runtime-e2e/README.md) 将 `@arhen/pi-core-subagent` 1.3.54 固定为开发依赖，通过 Bun patch 保存可选会话 hook 和类型声明。在全新目录中禁用安装生命周期脚本，按冻结锁安装后，使用 Linux/Bun 1.4.0、Pi SDK 0.85.1 和维护者独立编译的 `/opt/bin/pi` 0.85.1 重跑了五个终端探针。两个环境均使用 Tuistory 0.11.0 操作。Arhen 声明的 Pi peer 范围是 `^0.84.2`；这里的有限兼容结论来自实际执行结果。

`Bun.serve` 提供 loopback 模型边界，真实 Pi 会话在临时项目执行真实工具和工作进程，不使用在线模型或凭证。`Bun.spawn` 隔离 SDK 交互宿主，临时会话文件用于验证同进程继续会话和清理。README 记录了 fork 来源、具体命令、行为及截图。

SDK 宿主将原生 footer 放在 Fleet 之前。编译版扩展探针保留 Pi 原生 footer，但公开的 `setWidget({placement: 'belowEditor'})` 会把 Fleet 放到它上方。Pi 0.85.1 没有公开的 footer 追加或读取接口，无法据此与任意已有 footer 扩展组合。因此，本轮没有证明即装即用的正式包能达到指定位置。继续已完成任务仍要求原 Arhen 批次全部结束。受控扩展的 editor 按键在 reload 后仍有效，自定义 footer 只在编译版探针保留。在线模型、任意扩展组合、写入 worktree 的任务、崩溃或跨进程恢复、Node 及其他系统仍未验证。
