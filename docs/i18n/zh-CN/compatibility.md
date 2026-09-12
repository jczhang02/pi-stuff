# 运行时兼容性

[English](../../compatibility.md)

## Subagent UI 原型

一次性原型的 [run.ts](../../../tools/subagent-ui-prototype/run.ts) 使用 `Bun.spawn` 启动隔离的 Bun 进程，继承终端输入输出并显式设置环境变量。Bun 已是仓库固定的运行时；子进程在临时目录运行并隔离 agent 数据，SDK 则使用调用者项目目录作为原生显示上下文。没有新增运行时依赖。

当前原型在 Linux、Bun 1.4.0 下运行 Pi SDK 0.85.1 的 `InteractiveMode`，使用 Tuistory 0.11.0 操作终端。会话与设置保存在内存中。[原型 README](../../../tools/subagent-ui-prototype/README.md) 记录原生与模拟 UI 的边界及复现命令。

以上说明针对纯 UI 产物。下面的独立运行时实验增加了开发依赖，并验证编译版宿主。

## Arhen 运行时 E2E

[运行时实验](../../../tools/subagent-runtime-e2e/README.md) 将 `@arhen/pi-core-subagent` 1.3.54 固定为开发依赖，通过 Bun patch 保存可选会话 hook 和类型声明。在全新目录中禁用安装生命周期脚本，按冻结锁安装后，使用 Linux/Bun 1.4.0、Pi SDK 0.85.1 和维护者独立编译的 `/opt/bin/pi` 0.85.1 重跑了五个终端探针。两个环境均使用 Tuistory 0.11.0 操作。Arhen 声明的 Pi peer 范围是 `^0.84.2`；这里的有限兼容结论来自实际执行结果。

`Bun.serve` 提供 loopback 模型边界，真实 Pi 会话在临时项目执行真实工具和工作进程，不使用在线模型或凭证。`Bun.spawn` 隔离 SDK 交互宿主，临时会话文件用于验证同进程继续会话和清理。README 记录了 fork 来源、具体命令、行为及截图。

SDK 宿主将原生 footer 放在 Fleet 之前。编译版扩展探针保留 Pi 原生 footer，但公开的 `setWidget({placement: 'belowEditor'})` 会把 Fleet 放到它上方。Pi 0.85.1 没有公开的 footer 追加或读取接口，无法据此与任意已有 footer 扩展组合。因此，本轮没有证明即装即用的正式包能达到指定位置。继续已完成任务仍要求原 Arhen 批次全部结束。受控扩展的 editor 按键在 reload 后仍有效，自定义 footer 只在编译版探针保留。在线模型、任意扩展组合、写入 worktree 的任务、崩溃或跨进程恢复、Node 及其他系统仍未验证。
