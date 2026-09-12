# 网页访问

[English](../../web-access.md)

Pi Stuff 提供三个独立工具: `web_search`、`fetch_content` 和 `get_search_content`. 搜索返回来源链接, 由模型选择要抓取的页面. 不包含自动抓页代理、浏览器 Cookie 集成或 Exa 聊天模型.

## 加载开发版扩展

尚未发布版本. 审查源码后, 在检出目录使用固定的 Bun `1.4.0` 安装依赖, 再加载入口:

```bash
bun install --frozen-lockfile --ignore-scripts
pi -e /absolute/path/to/pi-stuff/src/pi/index.ts
```

将绝对路径替换为你的检出目录. 这些工具名只由一个扩展注册, 避免冲突. 扩展代码使用你的账号权限运行. 已测试目标为 Linux Bun 编译版 Pi `0.85.1`, 其他版本/平台尚未验证. 开发检查还会通过 Bun 启动已安装的 Pi CLI. 两种环境的区别见[质量保证](quality-assurance.md#终端-e2e).

## 设置与凭据分开

决策理由见 [ADR 0004: 宿主管理的 API Key 存储](adr/0004-host-api-key-storage.md).

`pi-stuff.json` 和 `auth.json` 位于宿主解析的 **Pi agent 目录**, `PI_CODING_AGENT_DIR` 可覆盖宿主默认值. Pi Stuff 不读取项目级配置, 也不新建第二套凭据存储.

可选的 `pi-stuff.json`:

```json
{
  "tools": {
    "web_search": true,
    "fetch_content": true,
    "get_search_content": true
  },
  "web": {
    "provider": "openai"
  }
}
```

- 缺省时允许全部三个工具, 优先 OpenAI.
- `web.provider` 接受 `openai` 或 `exa`, 选择搜索后端, 不选择聊天模型.
- 每个 `tools` 条目独立允许注册, `false` 则不注册该工具. Pi 自身的活动工具选择仍决定模型收到哪些工具, 全局开启不会覆盖它. 认证注册本身不增加工具或模型.
- 修改设置后使用 `/reload`. 无效 JSON、错误类型或未知顶层/web 字段会阻止 Pi Stuff 加载; 修正后 reload. 不要在这里填写 `exaApiKey`.

### Exa

实际编译宿主验收覆盖了仅从 auth.json 读取凭据、EXA_API_KEY 不存在时的普通和域名过滤搜索, 以及随后由模型选择的抓页和 find.

加载扩展后, 使用 `/login exa` 通过 Pi 保存 Exa API Key. Exa 是认证 provider, **不是 Pi Stuff 聊天模型**. 可以继续使用任意受支持的聊天模型.

宿主在 `auth.json` 管理如下条目. 下方值是占位符, 编辑时保留其他 provider 条目:

```json
{
  "exa": {
    "type": "api_key",
    "key": "YOUR_EXA_API_KEY"
  }
}
```

Pi 内置 helper 优先使用已保存凭据, 其次为 `EXA_API_KEY`. 已保存 Key 被拒绝时, 不会换用环境变量 Key 重试. 使用 `/logout` 并选择 Exa 可删除保存的条目, 但已有环境变量 Key 仍可使用.

后续搜索通过宿主解析所需凭据, 所以登录、退出或修改凭据文件不需要 `/reload`. 已发出的请求保留解析好的 Key, 不会因后续 logout 而被追溯取消. 修改父 shell 环境变量需要重启 Pi, 无法改变已运行进程的环境.

**Pi 0.85.1 的限制:** 登录输入框会显示 Key. 不要在录屏或共享终端时输入秘密, 也可以直接管理凭据文件. 未选聊天模型时, 登录可能保存成功后又提示 Exa 没有默认模型. 应选择真正的聊天模型, 而不是 Exa. Pi Stuff 不修补这部分宿主 UI.

实际隔离 Pi 0.85.1 登录画面, 使用未提交的假值, 同时保持选中独立聊天模型:

![Pi Exa 登录显示假 Key, 聊天模型仍为 gpt-4.1](../../assets/exa-login-pi-0.85.1.png)

将 `auth.json` 排除普通配置的 Git/云同步, 需要时单独加密备份. Pi 创建新凭据文件时使用 `0600`, 但保留已有权限. 明文文件和环境变量都不是加密存储, `0600` 也不能隔离同用户进程.

### OpenAI 与 Codex

使用 Pi 已有的 OpenAI/Codex 认证. 默认仅在当前模型是官方 OpenAI/Codex Responses 模型时用它搜索. 若想保留其他聊天模型, 同时指定搜索模型, 在 `web` 中加入宿主已知的精确模型引用:

```json
{
  "web": {
    "provider": "openai",
    "openaiModel": {
      "provider": "openai",
      "id": "gpt-4.1"
    }
  }
}
```

这是模型引用示例, 不保证你的账号有访问权限. 不支持自定义 OpenAI 网关. 无效的显式模型导致配置失败, 不会猜测其他模型. Codex OAuth 搜索已有真实验收证据; 独立 OpenAI API Key 计费路径尚未真实验证.

## 工具调用

请 Pi 使用这些工具, 或通过工具接口提供等价参数. 它们不是斜杠命令.

| 工具                  | 参数示例                                                                                                            | 结果                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `web_search`          | `{"queries":["Bun fetch documentation"],"maxResults":2}`                                                            | 按输入顺序返回, 标明实际后端、选择原因和 fallback 状态 |
| 带过滤的 `web_search` | `{"queries":["Python JSON documentation"],"includeDomains":["python.org"],"excludeDomains":["discuss.python.org"]}` | 仅用 Exa, 本地核验来源域名                             |
| `fetch_content`       | `{"urls":["https://example.com"],"mode":"readable"}`                                                                | 提取后的正文与 `contentId`; `raw` 返回未提取文本       |
| `get_search_content`  | `{"contentId":"ID_FROM_RESULT","offset":8000,"limit":8000}`                                                         | 下一页正文, 包含 `nextOffset` 和 `truncated`           |
| `get_search_content`  | `{"contentId":"ID_FROM_RESULT","find":"needle"}`                                                                    | 不区分大小写的匹配及附近文本                           |

搜索接受 1–5 个查询, `maxResults` 为 1–20, 默认 5; 每种过滤列表最多 20 个域名. 域名是主机名, 不是 URL 或通配符; 同时匹配其子域名, 排除优先. 过滤搜索要求 Exa 认证, 不会回退到无过滤后端.

普通搜索优先 `web.provider`. 该后端未配置时可以选择已配置的另一后端, 不算 fallback. 临时传输错误、超时、HTTP 408/429 或 5xx 最多允许一次备用后端尝试. 认证错误、其他 HTTP 错误、畸形响应及合法空结果不触发 fallback. OpenAI 返回原生答案/引用/来源, Exa 返回标题、URL 和摘要亮点.

## 限制与生命周期

- 每批最多五项、三个活动检索. 保持输入顺序, 单项失败不丢弃其他成功结果.
- 页面抓取和后端尝试各有 30 秒时限; 宿主认证等待另限 30 秒. 取消会停止 Pi Stuff 等待, 阻止后续后端尝试; 宿主内部认证工作仍归宿主管理.
- 响应限 5 MiB, 每项保留文本限 1 MiB, 工具输出限 32 KiB. 使用 `nextOffset` 继续读取. 偏移和长度是 **UTF-16 代码单元**, 不是字节; `find` 不与 `offset`/`limit` 混用.
- 保留内容仅属于当前会话, 使用 32 MiB/64 项 FIFO 预算. 淘汰、`/new`、`/reload` 和退出会使内容 ID 失效. 隐藏正文不写入工具 `details`, 也不持久化用于恢复; Pi 仍可能将已显示的工具输出保存到会话历史.
- 抓取使用标准运行时网络, 最多跟随五次重定向. 允许可达的 HTTP(S) 本地/私网目标, 拒绝 URL 内嵌凭据. **不提供 SSRF 隔离边界**, 不做 DNS/IP 预检或地址绑定. 请求使用 `credentials: 'omit'`, 不复用浏览器 Cookie 或网页认证.

URL 和返回材料属于外部数据, 不是指令, 也不构成访问其他资源的授权.
