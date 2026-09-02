<!-- translation-source: packages/pi-stuff/src/fast-resume/README.md; translation-source-sha256: a1e2d4e8b1732f22a8c9ca1bc366c6232c27d526ed7970799c903f135d947460 -->

# Fast Resume

[English](../../../../../../../packages/pi-stuff/src/fast-resume/README.md)

一个渐进式 Session 选择器：无需解析完整 Session 历史，也能在 Pi 中完成日常恢复操作。

<p align="center">
  <a href="../../../../../../assets/readme/capabilities/fast-resume.png">
    <img src="../../../../../../assets/readme/capabilities/fast-resume.png" alt="Pi 中的 Fast Resume Session 选择器" width="100%">
  </a>
  <br>
  <em>Fast Resume 先让当前项目最近的 Session 可供选择，同时继续加载较旧的元数据。</em>
</p>

## 快速开始

`/resume` 默认打开 Fast Resume。输入文字进行搜索，按 Enter 切换 Session，或按 Tab 在 Current Folder
与 All Sessions 之间切换。经认证的拦截 seam 不可用时，运行时会回退到 Host 原生选择器。

若要保留 Pi 原生 `/resume`，请在 `pi-stuff.json` 中把 `fastResume.hijackResume` 设为 `false`，
并改用 `/fast-resume` 打开本选择器。

## 主要特性

- 先显示 Current Folder 中最新的 Session，再以有界批次加载其余 Session 和 All Sessions。
- 在线程化目录呈现与平面的 Recent 或 Fuzzy 呈现之间切换，并支持仅显示 Named Session。
- 搜索 Session ID、名称、cwd 和首条用户消息；支持模糊、引号精确与 `re:<pattern>` 正则输入。
- 通过 Pi Session 元数据重命名；确认后删除，平台回收站命令不可用时回退到永久 unlink。
- 在刷新、关闭、reload、Session 替换和 shutdown 时取消过期后台工作。
- 保持 Session JSONL 文件为权威来源；Fast Resume 不创建索引或 cache。

有界读取使选择器保持快速，但也意味着尾部窗口之外的名称可能缺失，消息数量只是近似值。需要完整历史搜索
或精确元数据时，请使用 Pi 原生选择器。

## 文档

- [Fast Resume 指南](../../../../docs/capabilities/fast-resume.md)
- [命令参考](../../../../docs/reference/commands.md#session-与支线问题)
- [设置参考](../../../../docs/reference/settings.md#fastresume)
- [架构决策](../../../../docs/adr/0026-add-fast-resume.md)
- [故障排查](../../../../docs/troubleshooting.md)
