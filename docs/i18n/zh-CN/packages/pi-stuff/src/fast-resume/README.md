<!-- translation-source: packages/pi-stuff/src/fast-resume/README.md; translation-source-sha256: 4fc895b1468c5980e8e3627787a95a636cc97ff411ceeca59bca634b2d9f19f4 -->

# Fast Resume

[English](../../../../../../../packages/pi-stuff/src/fast-resume/README.md)

Pi 的原生 Session 选择器，以精确名称查找与有界 transcript 解析替代完整历史 JSON 解析。

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
加载方式，并通过 `/fast-resume` 打开使用轻量 loader 的原生选择器。

## Contract

- 可见界面就是 Pi 导出的原生组件。Pi Stuff 不维护并行的 resume UI、搜索引擎、列表 controller 或变更流程。
- Current Folder 和 All Sessions 对每个文件最多解析头部 1 MiB 的 transcript 元数据。文件能放入
  前向窗口时会完整解析。过大文件还会接受一次完整字节扫描，以取得最后一条有效 `session_info`；因此已有
  Session 名称无论位于文件何处都保持权威。加载进度交给原生 Header；只有用户请求 All Sessions 时才加载
  该 scope。
- 选择结果交给 Pi 的 `switchSession`；重命名和确认删除继续使用原生选择器行为。
- 每次打开选择器都拥有自己的 loader operation。关闭界面时关闭该 owner；刷新和迟到结果继续由原生组件处理。
- Session JSONL 文件仍是权威来源。Fast Resume 不创建索引、cache、数据库，也不访问网络。

有界 transcript 解析以完整性换取延迟。文件能放入 1 MiB 前向窗口时，会保留完整的可搜索文字、消息
数量与最后消息活动时间。过大文件会保留最新 Session 名称，但可能缺少后续消息文字、报告较低的消息数量，
并回退到文件系统修改时间进行排序。需要完整历史搜索或精确消息数量与活动时间时，请关闭拦截。

## 文档

- [Fast Resume 指南](../../../../docs/capabilities/fast-resume.md)
- [命令参考](../../../../docs/reference/commands.md#sessions-and-side-questions)
- [设置参考](../../../../docs/reference/settings.md#fastresume)
- [架构决策](../../../../docs/adr/0026-add-fast-resume.md)
- [故障排查](../../../../docs/troubleshooting.md)
