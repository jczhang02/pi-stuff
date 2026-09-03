<!-- translation-source: packages/pi-stuff/src/fast-resume/README.md; translation-source-sha256: f6ca876519d68569a4c213cb6227b2bc7a7bfdb4b0f957b8096d7626e79e7640 -->

# Fast Resume

[English](../../../../../../../packages/pi-stuff/src/fast-resume/README.md)

Pi 的原生 Session 选择器，只是用有界 Session 读取替代完整历史解析。

<p align="center">
  <a href="../../../../../../assets/readme/capabilities/fast-resume.png">
    <img src="../../../../../../assets/readme/capabilities/fast-resume.png" alt="由 Fast Resume 提供数据的 Pi 原生 Session 选择器" width="100%">
  </a>
  <br>
  <em>Fast Resume 只改变 Session 行的加载方式，不改变 Pi 选择器的外观和行为。</em>
</p>

## 快速开始

`/resume` 默认打开 Pi 原生的 `SessionSelectorComponent`，但使用 Fast Resume loader。搜索、scope、排序、
重命名、删除和键盘行为仍由 Host 负责。如果经认证的拦截 seam 不可用，Pi Stuff 会调用原始的原生选择器。

在 `pi-stuff.json` 中把 `fastResume.hijackResume` 设为 `false`，即可让 `/resume` 保留 Pi 的完整历史
加载方式，并通过 `/fast-resume` 打开使用有界 loader 的原生选择器。

## Contract

- 可见界面就是 Pi 导出的原生组件。Pi Stuff 不维护并行的 resume UI、搜索引擎、列表 controller 或变更流程。
- Current Folder 和 All Sessions 对每个文件最多读取头部 1 MiB，并对过大文件读取尾部 32 KiB。文件能
  放入前向窗口时会完整解析。加载进度交给原生 Header；只有用户请求 All Sessions 时才加载该 scope。
- 选择结果交给 Pi 的 `switchSession`；重命名和确认删除继续使用原生选择器行为。
- 每次打开选择器都拥有自己的 loader operation。关闭界面时关闭该 owner；刷新和迟到结果继续由原生组件处理。
- Session JSONL 文件仍是权威来源。Fast Resume 不创建索引、cache、数据库，也不访问网络。

有界读取以完整性换取延迟。文件能放入 1 MiB 前向窗口时，会保留完整的可搜索文字、消息数量与最后消息
活动时间。过大文件可能缺少后续消息和尾部窗口以外的名称、报告较低的消息数量，并回退到文件系统修改时间进行
排序。需要完整历史搜索或精确列表元数据时，请关闭拦截。

## 文档

- [Fast Resume 指南](../../../../docs/capabilities/fast-resume.md)
- [命令参考](../../../../docs/reference/commands.md#sessions-and-side-questions)
- [设置参考](../../../../docs/reference/settings.md#fastresume)
- [架构决策](../../../../docs/adr/0026-add-fast-resume.md)
- [故障排查](../../../../docs/troubleshooting.md)
