# 网页访问设计

[English](../../web-access.md) · 英文为准。

本文记录 [#43](https://github.com/jczhang02/pi-stuff/issues/43) 中的设计访谈。下列决定已接受，完整契约仍在讨论中；维护者确认共同理解后再开始实现。另见[术语表](CONTEXT.md)和[维护决策](adr/0003-web-access-fork.md)。

## 已接受的首版范围

目的是让 Pi 在开发过程中查找最新信息、读取来源材料，全程留在 Pi 对话中。

| 工具                 | 保留能力                                                                    |
| -------------------- | --------------------------------------------------------------------------- |
| `web_search`         | 单条或批量搜索，包含标题、URL、片段和来源。后端仅保留 OpenAI/Codex 和 Exa。 |
| `fetch_content`      | 读取公开网页正文或原始文本。                                                |
| `get_search_content` | 读取已保存的搜索或抓取内容，支持分页和文本查找。                            |

搜索与抓取分开调用。`web_search` 不抓取结果页面正文；删除上游的 `includeContent` 及其后台抓取状态和通知。模型在 Pi 对话中选择有用链接后调用 `fetch_content`，无须人工筛选结果。

首版删除以下上游功能：

- Curator 及其浏览器页面、本地服务和结果筛选流程。
- OpenAI/Codex 和 Exa 之外的搜索后端。
- GitHub 专用的仓库、tree/blob、issue 和 PR 读取。
- PDF、图片、视频和 YouTube 处理。
- 登录态网页和浏览器 cookie 读取。
- `source_check`、单独的自动摘要和页面问答。
- 托管内容提取回退。

删除 GitHub 专用处理，不等于在普通公开文本读取中封禁 GitHub URL。删除登录态网页读取，不影响两个保留搜索后端所需的认证。搜索服务原生返回的答案与额外摘要调用是两件事；原生答案的输出契约仍待确定。

## 通用工具开关

Pi Stuff 必须支持超出网页访问范围的独立工具开关。开关控制模型对单个工具入口的直接调用。例如，关闭 `fetch_content` 会移除该模型调用入口，本身不禁止所有内部 HTTP 请求或解析器调用。配置作用域、生效时机及其与 Pi 自身工具选择的关系仍待确定。

## 重写与代码量

源码基线为 npm `pi-web-access@0.28.0`，commit `e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5`。Fork 遵循仓库的严格 TypeScript、Bun 和 Effect v4 规则。纯算法保持普通函数；边界解码、类型化错误和必要 I/O 遵循 [ADR 0002](adr/0002-effect-quality.md)。

保留导入代码的源码及许可声明，在实现和 PR 证据中记录版本与 commit，后续选择性移植上游修复。不承诺兼容上游目录、配置或工具接口。依赖和最终接口须在实现前提交具体方案审查。

已检查的基线为 **66 个运行时文件、25,795 行有效代码**。统计取 `cloc` 的 code 列，排除注释、空行、测试、文档、类型声明和独立资源；内联在 TypeScript 中的页面代码计入。第三方依赖内部实现不计入。

以相同口径记录重写后的运行时源码，测试、文档和依赖另列。通过保留与删除的功能解释规模变化。不设总行数硬上限，不要求同等功能下再压缩额外比例，不通过压缩可读代码改善数字，也不为达标而删除必要验证。最终数字须来自实际实现 diff；静态删除估算不等于重写后的实测值。

## 未决契约

搜索与抓取分工已经接受。本轮访谈仍在确认：已存内容是否只保留在当前会话，以及工具开关是否采用全局配置并通过 `/reload` 生效。这两个推荐方案尚未接受。

后续还需明确搜索后端认证与回退、原生搜索答案、公开网页提取覆盖范围，以及读取和存储的容量边界。实现事实应通过现有运行时能力和源码证据解决；产品取舍通过访谈确定。本文尚未批准依赖清单、磁盘格式或完整工具 schema。

## 源码证据

- [工具注册和流程编排](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/index.ts)。
- [OpenAI/Codex 搜索](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/openai-search.ts)和 [Exa 搜索](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/exa.ts)。
- [内容提取](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/extract.ts)、[存储](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/storage.ts)和[文本查找](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/content-find.ts)。
