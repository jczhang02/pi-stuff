# 状态栏

[English](../../statusline.md) · 英文版为准.

Pi Stuff 默认用双行状态栏替换 TUI footer. 按[开发版扩展说明](web-access.md#加载开发版扩展)加载包. RPC、JSON 和 print 模式保留原生输出.

第一行左侧显示目录及 `ctx 31%/272k ━━━━━━━━━━ · hit 83.8%`, 右侧显示 Git. 第二行左侧为模型和思考强度, 右侧为现有第三方 `setStatus` 消息. 字段以 `·` 分隔, 原始值保留大小写. 不包含 goal 或账号额度 provider. 会话名仍可通过原生 `/name` 和 `/autoname panel` 查看, 不占用 footer 字段.

## Git 与窄屏

Git 显示分支或 `detached` 加提交号、进行中的操作、`!` 冲突文件数、`+` 暂存文件数、`~` 修改文件数、`?` 未跟踪文件数, 以及 `↑`/`↓` 本地领先/落后提交数. 同一文件同时有暂存和未暂存修改时分别计数, 冲突单独计数. 干净工作树显示 `clean`.

颜色使用当前 Pi 主题: 分支和领先使用强调色, 暂存使用成功色, 修改/未跟踪/落后使用警示色, 冲突使用错误色. 符号和计数保留含义, 不只依赖颜色.

窄屏时第一行先隐藏整块 ctx/hit. Git 可移到第二行, 可选的模型、思考强度和扩展字段让位. 第三方字段按 key 排序, 从末尾整项隐藏. 在所在行允许的空间内尽量保留目录和分支名. 不增加第三行, 不删除正常词间空格.

Git 查询在本地异步执行, 总期限五秒, 子进程期限两秒. 不 fetch、不固定轮询、不递归监听. 原生分支通知、工具完成、agent 完成和会话生命周期触发刷新. 闲置时外部普通文件修改可能到下次触发才反映. 仓库外隐藏 Git; 查询失败清除旧计数, 显示 `git ?` 及可用的原生分支身份.

测试的官方 Linux 编译版内嵌 Bun 1.3.14, 在一次外部 checkout 序列中未触发原生分支回调. 最小原生 footer 探针只收到 `HEAD.lock` 事件, 分支回调为零; Bun 1.4.0 下的 Pi 能自动刷新. 受影响宿主在下一次 Pi 工具/agent 完成或 reload 后刷新快照. 实现沿用原生闲置监听限制. 编译版的无头缩放有时也需下一次编辑器输入才完整重绘, 未加入私有宿主补丁.

## 用量与警示

ctx 使用 Pi 当前上下文估算, 容量跟随当前模型. compact 后用量未知时显示带实际容量的 `ctx ?/128k`, 不显示进度条, 等待 Pi 提供新估算. 容量缺失显示 `?`, 不编造限制.

缓存命中率来自当前分支最近一次有效 assistant 响应, 计算为 `cacheRead / (input + cacheRead + cacheWrite)`. 忽略错误和中止响应. 已知输入但没有缓存命中时显示 `hit 0%`, 无统计时隐藏. 它不是会话累计值.

自动 compact 开启时, 压力边界为模型窗口减去生效的 `reserveTokens`: 低于该边界的 90% 使用强调色, 从 90% 起警示, 达到边界使用错误色. 关闭自动 compact 时, 按窗口容量的 80% 和 90% 分别警示和报错. 显示百分比仍为已用/窗口, 百分比与已填进度条同色.

持久化设置通过当前 Pi 宿主的原生读取器取得, 沿用项目信任及该版本的模型覆盖行为. reload 和切换模型时重读. 配置无法可靠读取时, 已知用量以中性色显示. 不承诺 SDK 临时覆盖一致性.

## 原生回退与其他扩展

在 Pi 的 `settings.json` 同目录下, 修改全局 `pi-stuff.json`:

```json
{
  "statusline": {"enabled": false}
}
```

运行 `/reload` 恢复原生 footer. 删除该字段或设为 `true` 可重新启用. 不增加项目级覆盖或设置命令.

现有扩展状态保留文本、大小写和 SGR 颜色, 换行及控制序列会清理. Pi 只有一个自定义 footer 插槽, 应选择一套完整实现. Pi Stuff 不在普通刷新时抢回插槽. 新建会话和 reload 会重建原生扩展状态.

验收依据及运行时限制见[已确认规格](statusline-spec.md)和 [PR #118](https://github.com/jczhang02/pi-stuff/pull/118).

## 终端截图

以下是编译版 Pi 0.87.1 加载未替换包的完整视口 Terminal Control 截图, 使用临时真实 Git 仓库和确定性的外部模型用量. 它们是无头终端证据, 不是原生 Ghostty 窗口截图. 明色为 Catppuccin Latte (`#eff1f5` 背景), 暗色为 Catppuccin Mocha (`#1e1e2e`), 终端色板通过 OSC 10/11 设置. 导出字体为 `JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono`. 两套色板均检查 150/100/80/50 列; 按上述编译版重绘限制, 缩放后输入编辑器再采集.

![明色, 80 列](../../assets/statusline/light-80.png)
![暗色, 50 列](../../assets/statusline/dark-50.png)

![50 列保留长目录和 Git](../../assets/statusline/long-light-50.png)
