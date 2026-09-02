<!-- translation-source: docs/capabilities/fast-resume.md; translation-source-sha256: 93297b1c7d735f51dd3b152419d5c0912762bb3bee77ac8401df9dbb2300a323 -->

# Fast Resume

[English](../../../../../docs/capabilities/fast-resume.md)

Fast Resume 用渐进式选择器替代 Pi 默认的 Session 选择器。它只读取有界的 JSONL 区域，不解析完整 conversation
历史；原生 Session 文件保持不变，最终切换仍由 Pi 执行。

## 打开选择器

运行 `/resume`。Fast Resume 只在当前 Host 进程的内存中拦截原生选择器，不修改 Pi 的安装文件。如果经认证
的 Host seam 不可用，Pi 会打开原生选择器，并用一条有界 Diagnostic Record 说明回退原因。

关闭 `fastResume.hijackResume` 后，Pi 保留原生 `/resume`，Pi Stuff 则注册 `/fast-resume`。可选的
`fastResume.shortcut` key ID 会打开同一个 Fast Resume 界面。

## 导航与过滤

Header 显示 scope、视图、排序顺序、可见数量、加载状态，以及可用时的加载进度。

| 按键 | 操作 |
| --- | --- |
| Up / Down | 移动一个 Session |
| Page Up / Page Down | 在可见窗口内翻页 |
| Home / End | 选择第一个或最后一个可见 Session |
| Enter | 切换到选中的 Session |
| Escape | 关闭选择器并恢复编辑器 |
| Tab / Shift+Tab | 在 Current Folder 与 All Sessions 之间切换 |
| Ctrl+S | 循环切换 Threaded、Recent 与 Fuzzy 排序 |
| Ctrl+N | 切换仅显示 Named Session |
| Ctrl+P | 切换 Session 路径显示 |
| Ctrl+L | 刷新活动 scope |
| Ctrl+R | 重命名选中的 Session |
| Ctrl+D | 确认删除选中的 Session |

输入文字会在当前 scope 中搜索。普通输入使用模糊匹配，完整引号包围的查询使用精确子串匹配；
`re:<pattern>`（例如 `re:release.*notes`）使用正则表达式。无效表达式会显示有界错误，在修正前不匹配
任何行。搜索覆盖 Session ID、Session 名称、cwd 与首条用户消息，不搜索完整 transcript。

Threaded 模式按规范化父路径分组，子项位于父项之后，root 和同级项按活动时间排序。Recent 模式在过滤后保留
修改时间顺序。Fuzzy 模式按匹配分数排序，同分时按修改时间打破平局。

## 渐进加载

Fast Resume 通过文件名和修改时间发现候选项，读取首个完整 header 与用户消息，并在有界尾部窗口中查找最新
Session 名称。Current Folder 最新的 30 个候选项最先出现；较旧的 Current Folder 行加载完成后，才开始
All Sessions，并按批次显示进度。关闭或刷新 Dialog 会取消过期工作，避免迟到结果进入当前视图。

该有界契约有明确限制：

- 写在尾部窗口之外的名称可能缺失；
- 部分读取的消息数量使用 `≈` 标记；只有完整读取的数量是精确值；
- 完整历史搜索只能使用 Pi 原生选择器。

Fast Resume 不创建持久 cache 或 sidecar 索引，不发送网络请求，扫描时也不重写 Session 文件。

## 重命名与删除

Ctrl+R 写入 Pi 的普通 Session 名称元数据并刷新活动视图。输入为空时不修改 Session。

Ctrl+D 打开行内确认。不能删除活动 Session。确认后先尝试平台回收站命令；命令不可用或失败时，Fast Resume
会永久 unlink 该 JSONL 文件。unlink 失败时保留该行并报告有界错误。变更成功后刷新活动 scope；如果选中路径
仍然存在，则继续选中该路径。

## 配置

在 `<agentDir>/pi-stuff.json` 的 `fastResume` 命名空间中手动配置 Fast Resume。启动时只读取该命名空间，
不会创建或重写文件。无效值回退到默认值并产生 Diagnostic Record。字段定义见
[设置参考](../reference/settings.md#fastresume)。
