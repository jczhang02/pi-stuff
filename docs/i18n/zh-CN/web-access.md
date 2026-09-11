# 网页访问设计

[English](../../web-access.md) · 英文为准。

本文记录 [#43](https://github.com/jczhang02/pi-stuff/issues/43) 中的设计访谈。功能范围各节已接受，最后的契约提案仍待确认；维护者确认共同理解后再开始实现。另见[术语表](CONTEXT.md)和[维护决策](adr/0003-web-access-fork.md)。

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
- Exa 无 Key MCP 和 `/answer` 路径、网页访问专用的 OpenAI 凭据、凭据命令和自定义网关。
- 多后端并发搜索、多级路由、独立时间筛选参数、第二套 HTML 解析器、RSC 专用提取和浏览器渲染。

删除 GitHub 专用处理，不等于在普通公开文本读取中封禁 GitHub URL。删除登录态网页读取，不影响两个保留搜索后端所需的认证。

## 搜索后端与结果

OpenAI/Codex 搜索复用 Pi 已有的认证，仅连接官方服务。不增加另一套登录系统、网页访问专用的 OpenAI 凭据配置、凭据命令或自定义网关。对话使用其他厂商模型时，搜索仍可使用已配置的 OpenAI/Codex 模型；具体模型选择规则仍待确定。Exa 必须配置 API Key，只使用 `/search`。没有 Exa Key 时，OpenAI/Codex 仍可使用。

默认后端允许全局配置，初始默认 OpenAI/Codex。两个后端均可用时，仅在网络错误、超时、限流或服务端错误时，最多回退到另一个后端一次。参数错误、认证失败和取消直接结束；正常返回空结果不触发重搜。结果记录实际后端及回退情况。初始可用性检查和具体状态映射仍待确定。

统一结果包含标题、URL、片段和来源，允许附带服务原生答案。保留 OpenAI 原生答案及引用，不额外调用摘要。Exa 返回搜索结果，不单独请求答案。

保留单条或批量查询、返回数量上限，以及域名包含／排除。数量表示最多返回多少条，不保证能够提供足够来源。域名条件不能静默退化成查询提示；无法支持时明确报错。不提供独立时间筛选参数。时间要求可写入查询，但不保证按发布日期过滤。

## 公开文本提取

保留一套 HTML 主正文提取与 Markdown 转换流程，以及原始文本读取。删除第二套解析器、RSC 专用提取和浏览器渲染。正文依赖 JavaScript 或无法被解析器识别的页面可能提取失败；明确返回失败，让模型选择其他来源。具体解析器依赖仍须提交审查。

## 通用工具开关

Pi Stuff 必须支持超出网页访问范围的独立工具开关。开关控制模型对单个工具入口的直接调用。例如，关闭 `fetch_content` 会移除该模型调用入口，本身不禁止所有内部 HTTP 请求或解析器调用。

工具开关采用统一的全局配置，修改后通过 `/reload` 生效。首版不提供临时会话开关命令或项目级覆盖。具体配置 schema 及其与 Pi 自身工具选择的关系仍待确定。

## 内容保留期限

搜索结果和抓取正文只保存在有容量限制的当前会话内存中。不另写磁盘内容缓存，也不在 Pi 重启或 `/reload` 后恢复内容引用。引用不可用时，模型须重新搜索或抓取，才能继续分页或查找该内容。具体容量上限和淘汰规则仍待确定。

此决定针对 Pi Stuff 的内容缓存。已经进入对话的工具输出仍遵循 Pi 自身的会话历史行为。

## 重写与代码量

源码基线为 npm `pi-web-access@0.28.0`，commit `e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5`。Fork 遵循仓库的严格 TypeScript、Bun 和 Effect v4 规则。纯算法保持普通函数；边界解码、类型化错误和必要 I/O 遵循 [ADR 0002](adr/0002-effect-quality.md)。

保留导入代码的源码及许可声明，在实现和 PR 证据中记录版本与 commit，后续选择性移植上游修复。不承诺兼容上游目录、配置或工具接口。依赖和最终接口须在实现前提交具体方案审查。

已检查的基线为 **66 个运行时文件、25,795 行有效代码**。统计取 `cloc` 的 code 列，排除注释、空行、测试、文档、类型声明和独立资源；内联在 TypeScript 中的页面代码计入。第三方依赖内部实现不计入。

以相同口径记录重写后的运行时源码，测试、文档和依赖另列。通过保留与删除的功能解释规模变化。不设总行数硬上限，不要求同等功能下再压缩额外比例，不通过压缩可读代码改善数字，也不为达标而删除必要验证。最终数字须来自实际实现 diff；静态删除估算不等于重写后的实测值。

## 未决契约

上述功能范围、认证路径、回退策略、搜索输出、筛选、提取覆盖范围、内容期限和工具开关范围均已接受。

剩余契约需要明确具体配置及模型选择规则、与 Pi 工具选择的关系、工具 schema、依赖选择，以及读取和存储的容量边界。实现事实应通过现有运行时能力和源码证据解决；产品取舍通过访谈确定。最终共同理解仍待确认。本文尚未批准依赖清单、配置格式或完整工具 schema。

## 最终契约提案——待确认

以下细节是下一轮访谈的推荐方案，尚未接受，也未实现。

### 配置与宿主集成

使用 `getAgentDir()/pi-stuff.json`，遵循 Pi 的 agent 目录设置；已检查的 Pi 0.85.1 SDK 默认路径为 `~/.pi/agent/pi-stuff.json`。这是 Pi Stuff 配置，不是内容缓存。不自动读取或迁移上游 `web-search.json`。

```json
{
  "tools": {
    "web_search": true,
    "fetch_content": true,
    "get_search_content": true
  },
  "web": {
    "provider": "openai",
    "openaiModel": {
      "provider": "openai-codex",
      "id": "<Pi 中已存在的模型 ID>"
    }
  }
}
```

文件和每个字段均可省略。已知工具默认开启，`web.provider` 默认为 `openai`，另一个可选值是 `exa`。填写 `web.openaiModel` 时优先使用该配置，须精确对应 Pi 中已存在的官方 OpenAI/Codex 模型；未填写时复用符合条件的当前对话模型。不按模型名称、价格等级或注册顺序猜测模型。因此，对话使用其他厂商时，需要显式指定 OpenAI 搜索模型，或配置 Exa Key。OpenAI 认证通过 Pi 解析；Exa Key 只从 `EXA_API_KEY` 环境变量读取。

发出搜索前，选择已配置且兼容的后端。默认后端未配置时，使用另一个可用后端并说明实际选择。显式模型或配置无效时直接报错，不静默选择其他配置。请求发出后，只有已接受的临时故障允许回退一次，具体为 HTTP 408、429、5xx、传输错误和超时；不重复请求同一后端。响应格式错误或能力不支持时明确失败。

凡带域名筛选的查询都使用 Exa，不受默认后端影响；未配置 Exa Key 时，明确说明筛选不可用。带筛选的 Exa 搜索不回退到 OpenAI/Codex。官方标准 Responses schema 公开支持域名包含，但本次检查未建立同等的域名排除及 Codex 筛选契约。统一筛选路径可以避免假定两个适配器能力相同。筛选条件传给 Exa，并再次校验返回的来源 URL。域名匹配自身及其子域，排除优先于包含；必要时返回更少结果，不承诺完整覆盖所有子域。

Pi Stuff 全局开关作为 Pi 自身工具选择的额外限制：全局关闭的工具不能通过 Pi 的工具选择重新打开；全局开启也不覆盖 Pi 自身的关闭选择。各开关独立，关闭抓取不关闭搜索或已缓存内容的读取。配置文件缺失时使用默认值；配置无效时给出可操作的错误，Pi Stuff 工具保持不可用，修复后重新加载。不改写配置文件，也不修改其他扩展的工具。

### 工具输入与内容返回

| 工具                 | 输入提案                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web_search`         | `queries: string[]`，可选 `maxResults`、`includeDomains`、`excludeDomains`。单条查询使用只有一个元素的数组；后端选择留在全局配置中。                 |
| `fetch_content`      | `urls: string[]`，可选 `mode: "readable" \| "raw"`，默认 `readable`。原始模式读取纯文本、Markdown、JSON、HTML 等文本响应，不把二进制响应转换为文本。 |
| `get_search_content` | `contentId`，加可选的分页参数 `offset`／`limit`，或单个 `find` 字符串。查找与分页参数混用时报错。                                                    |

搜索和抓取批量调用按输入顺序，为每项分别返回结果或错误。成功项带内容引用、来源信息和有长度限制的预览；搜索另含查询、实际后端、结果列表及可选原生答案。完整保留内容只存内存，不藏入工具结果 details 或会话自定义条目。

分页返回实际下一位置及总长度；位置和长度按 JavaScript UTF-16 代码单元计数。查找采用不区分大小写的字面匹配，返回位置和少量上下文；删除正则、模糊匹配和同时查找多个词。引用失效时，明确提示重新搜索或抓取。

### 首版固定边界

这些值作为实现默认值，不为每一项增加用户配置。它们是拟定上限，不是性能实测结论。

| 边界           | 推荐规则                                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 批量与并发     | 每次最多 5 条查询或 URL，同一次调用最多并发 3 项；单条查询按顺序使用后端。                                                                                     |
| 搜索结果       | 每条默认 5 条，最多 20 条；允许返回更少。                                                                                                                      |
| 输入大小       | 查询最多 2,000 个 UTF-16 代码单元，URL 最多 8,192 个；包含／排除域名列表各最多 20 项。域名为主机名，不接受 URL 或通配表达式。                                  |
| 网络超时       | 每次后端尝试或页面抓取 30 秒；一次回退使单条查询最多尝试两次。取消时终止正在执行和排队的工作，不再回退。                                                       |
| 公开页面读取   | 仅允许 HTTP(S) 公网目标，重定向目标同样受限，最多 5 次重定向。不访问 localhost／私网，不接受调用方传入的凭据、cookie 或 headers。HTTP 错误按错误返回。         |
| 响应与保存内容 | 每次网络响应体最多 5 MiB，每项保留文本按 UTF-8 计最多 1 MiB；超限明确返回该项失败。                                                                            |
| 内存缓存       | 最多 64 项、32 MiB UTF-8 内容，优先淘汰最早保存的条目。这是内容预算，不是进程总堆内存保证。不设 TTL、不写磁盘、不合并重复请求。重启、reload 或切换会话时清空。 |
| 工具输出与分页 | 每个工具结果的模型可见文本最多 32 KiB。默认分页／预览 8,000 个 UTF-16 代码单元，单次请求最多 20,000 个，同时受字节预算限制；返回截断与继续读取信息。           |
| 查找           | 单个非空查找词最多 200 个 UTF-16 代码单元，最多返回 10 处匹配，每处两侧各最多 200 个代码单元上下文；说明是否还有更多匹配。                                     |

使用 Pi 默认工具渲染。此提案不增加独立活动面板、自定义 renderer、进度命令或浏览器界面。验证须覆盖自有筛选、回退、取消、公网访问边界、输出上限、缓存淘汰和 reload 行为。真实宿主和在线后端验收留到实现阶段。

### 依赖提案

保留现有 Effect v4。拟新增运行时依赖并锁定为 `@mozilla/readability@0.6.0`（Apache-2.0）、`linkedom@0.18.13`（ISC）、`turndown@7.2.4`（MIT）和 `typebox@1.3.7`（MIT）。前三项组成单一提取流程，TypeBox 与已检查 Pi 0.85.1 SDK 的依赖一致。保留适用的许可声明。这是依赖候选清单，尚未安装，也不代表运行时兼容性已经验证。

开发依赖增加 `@types/turndown@5.0.6`（MIT），仅用于类型检查。TypeBox 声明宿主工具入参；配置和后端响应仍按现有规则用 Effect 解码，不增加另一套应用通用校验框架。

Pi Coding Agent 及直接导入时的 Pi AI 作为宿主 peer dependencies，以已检查的 0.85.1 作为开发基线；没有证据时不声明支持其他宿主版本。使用默认渲染，不增加 Pi TUI 依赖。不引入 OpenAI／Exa SDK、`p-limit`、`undici`、`defuddle`、`unpdf` 或兼容性 polyfill。

已检查的 Pi 0.85.1 类型声明中，普通模型调用接口未暴露原生托管 `web_search` 工具。复用其模型和认证服务，保留独立的官方 OpenAI Responses／Codex 搜索适配。SDK 检查不代表已验证当前运行的 Bun 编译宿主兼容性；后者须通过实际扩展验收确认。

## 源码证据

- [工具注册和流程编排](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/index.ts)。
- [OpenAI/Codex 搜索](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/openai-search.ts)和 [Exa 搜索](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/exa.ts)。
- [内容提取](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/extract.ts)、[存储](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/storage.ts)和[文本查找](https://github.com/nicobailon/pi-web-access/blob/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5/content-find.ts)。
- [OpenAI Responses API reference](https://platform.openai.com/docs/api-reference/responses-streaming?lang=python) 和 [Exa search API reference](https://exa.ai/docs/reference/search)：2026-09-11 检查筛选能力。
- 已发布的 [Pi Coding Agent 0.85.1](https://registry.npmjs.org/@earendil-works/pi-coding-agent/0.85.1) 和 [Pi AI 0.85.1](https://registry.npmjs.org/@earendil-works/pi-ai/0.85.1)：只读检查缓存包中的类型声明、agent 目录实现和扩展生命周期文档，没有启动 Pi 或读取用户凭据。
- 依赖元数据：[Readability](https://registry.npmjs.org/@mozilla/readability/0.6.0)、[linkedom](https://registry.npmjs.org/linkedom/0.18.13)、[Turndown](https://registry.npmjs.org/turndown/7.2.4)、[TypeBox](https://registry.npmjs.org/typebox/1.3.7) 和 [Turndown 类型](https://registry.npmjs.org/@types/turndown/5.0.6)。
