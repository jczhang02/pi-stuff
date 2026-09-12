# 运行时兼容性

[English](../../compatibility.md)

## Subagent UI 原型

一次性原型的 [run.ts](../../../tools/subagent-ui-prototype/run.ts) 使用 `Bun.spawn` 启动隔离的 Bun 进程，继承终端输入输出并显式设置环境变量。Bun 已是仓库固定的运行时；独立进程让 SDK 宿主使用自己的临时工作与设置目录，没有新增运行时依赖。

当前原型在 Linux、Bun 1.4.0 下运行 Pi SDK 0.85.1 的 `InteractiveMode`，使用 Tuistory 0.11.0 操作终端。会话与设置保存在内存中。[原型 README](../../../tools/subagent-ui-prototype/README.md) 记录原生与模拟 UI 的边界及复现命令。

本轮没有通过单独编译的 Pi 可执行文件加载扩展。验证范围限于上述 SDK 原型环境；正式扩展加载、Node 与其他操作系统仍未验证。
