<!-- translation-source: packages/pi-stuff/src/session-naming/README.md; translation-source-sha256: a1bacd22641ba6664d85909bf307d780813c33c980c27b94552a601398a56ec4 -->

# Session Naming 能力

Session Naming 为稳定的直接用户会话提供简洁语义名称，并在配置的冷却期后刷新该名称。`/autoname` 强制重新生成，`/autoname settings` 打开常规控制。Pi 仍负责会话元数据及其原生呈现；该能力只选择标签，并调用 Pi 的公开 `setSessionName()` API。周期请求会包含当前权威名称；如果它仍符合当前工作与生成英文名称策略，就逐字保留，避免不必要的会话元数据写入。

自动命名监听对话 UI 共享的直接用户稳定边界。Goal 继续、后台结果和其他扩展发起的工作不会触发。子 Agent 会话保留 Agents 分配的名称，但子会话内仍可显式使用 `/autoname`。生成名称与观察到的手动名称记录为分支局部自定义条目，使冷却期和 `respectManualName` 行为可跨恢复与分支保留。没有匹配标记的现有权威名称会被视为手动名称；其原生 `session_info` 时间戳作为冷却期起点，不产生启动写入。恢复兼容会读取现有上游 `pi-autoname-state` 条目。英文策略只约束新生成的名称：手动分配的非英文名称仍然有效，现有名称也不会在原本符合重命名条件之前被扫描或迁移。

命名请求只包含有界用户和 Assistant 文字，移除开头的 Magic Context 控制块，遮盖常见凭据形式，并把全部对话文字标记为不受信数据。不发送 Thinking、工具记录、图像或完整会话文件。无论对话使用什么语言，模型都必须生成自然的两至四词英文标签，保留技术标识符，但不得把非英文正文音译为拉丁字母。每个 AI 或本地回退候选都必须包含一个 ASCII 英文字母、只使用可打印 ASCII，并通过现有安全与质量检查。不合规的模型结果会继续尝试现有模型链；本地回退算法保持不变，只有完整候选合规时才使用。若没有候选合规，权威会话名称保持不变，并在下一次稳定的直接用户运行后重试。请求使用 Pi 公开模型注册表，输出上限 64 tokens，每模型超时 12 秒，总预算 30 秒；命名失败绝不阻塞 Agent 稳定。

设置位于 `<agentDir>/pi-stuff.json` 的 `sessionNaming` 下。启动只读该命名空间；只有在 `/autoname settings` 中直接修改才会持久化：

```json
{
	"sessionNaming": {
		"schemaVersion": 1,
		"enabled": true,
		"cooldownMinutes": 10,
		"respectManualName": false,
		"model": "provider/model-id",
		"fallbackModels": ["provider/backup-model-id"]
	}
}
```

原生设置列表暴露 **自动命名**、**重命名冷却期**（`10 分钟`、`30 分钟`、`1 小时`、`6 小时` 或 `24 小时`）、**保留手动分配名称** 和 **命名模型**。模型行会打开可搜索子菜单：有模型作用域时使用 Pi 作用域内集合，否则使用所有可用且已认证模型。**会话模型** 会清除固定 `model` 设置并跟随活跃会话模型；选择固定模型不会改变活跃会话模型。持久化后，变更应用到活跃会话。关闭自动命名不会禁用显式 `/autoname`。

`fallbackModels` 仍是高级 JSON 专用设置。选择固定模型或跨 Provider 回退，会显式允许把清理后的命名上下文发送到该模型的 Provider。两者都未配置时，Session Naming 使用活跃会话模型，再使用本地回退。跨 Provider 路由为选择加入，因此默认不会把对话文字发送给另一个 Provider。无效命名空间会安全关闭到完整内置默认值，并产生一条有界诊断记录；启动不创建合并文件，也不迁移上游 `pi-autoname.json`；对话框不会覆盖现有无效设置。不能同时加载独立 `pi-autoname` 扩展，因为两者都会负责 `/autoname` 和同一个宿主会话名称。

吸收分叉的来源与许可证见 [`UPSTREAM.md`](UPSTREAM.md) 和[英文许可证](../../../../../../../packages/pi-stuff/src/session-naming/LICENSE)。
