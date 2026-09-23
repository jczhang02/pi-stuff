# RTK 集成

[English](../../rtk.md) · 英文为规范版本.

Pi Stuff 使用 RTK 改写支持的模型 Bash 命令并过滤输出, 另行清理最终工具结果文本中的 ANSI 控制码. 两个设置相互独立. 命令执行、取消、错误结果、流式输出和长输出截断仍由 Pi 管理.

## 配置

按[网页访问](web-access.md#加载开发版扩展)加载源码扩展, 然后打开 `/rtk`. Settings 包含 Command rewrite、ANSI cleanup 和 Executable. 两个开关默认开启. 自动发现先检查 Pi 进程 PATH, 再在当前工作目录通过 mise 查询 RTK, 不修改 PATH 或加载 shell profile.

设置与网页访问配置一起保存在 Pi agent 目录下的 `pi-stuff.json`. RTK 部分可省略:

```json
{
  "rtk": {
    "rewrite": true,
    "ansi": true,
    "executable": "/absolute/path/to/rtk"
  }
}
```

省略 `executable` 表示自动发现. 自定义路径必须是绝对路径, 空格和 shell 特殊字符按路径字面值处理. Pi Stuff 会探测可执行文件, 不只看文件名. 自定义路径无效时不会静默换用其他安装.

面板保存成功后立即影响后续操作, 并跨重启保留. Pi Stuff 写好临时文件后, 会在替换前再次核对加载时的内容和符号链接目标. 检测到外部修改时报告冲突, 使用 `/reload` 后重试. 锁会串行化 Pi Stuff 的保存, 但无法阻止其他编辑器在最后一次检查与替换之间写入; 避免同时从两个入口保存. 原子替换保留无关设置和现有符号链接, 不暴露半写文件. 保存被中断可能在解析后的配置文件旁留下 `.lock` 文件. 手动删除陈旧锁前, 先确认没有 Pi Stuff 保存操作在运行, 然后 reload. 不要删除其他会话正在使用的锁.

发现结果会缓存. 更新 RTK 安装后, 修改可执行设置或使用 `/reload`. RTK 缺失时, 普通 Bash 和独立 ANSI 清理仍可用.

## 面板

`/rtk` 打开 Settings、Usage 和 Diagnostics 的内联列表, 使用 Pi 主题、列表和选择键. 首页、设置和尺寸提示遵循 Pi 原生取消绑定: 默认 Esc/Ctrl-C, 或配置后的替代键. 设置支持原生文本搜索. Usage、Diagnostics 和可执行路径编辑器保留既有 Esc 操作. RTK 扩展不增加底部状态栏. 版本旁的对勾表示可执行探测成功, 运行详情保留文字状态.

直接命令及补全:

- `/rtk integration`: Settings.
- `/rtk gain`: Usage.
- `/rtk diagnostics`: 可执行发现与故障详情.
- `/rtk refresh`: 打开 Usage 并读取当前统计.
- `/rtk help`: 命令帮助.

Usage 提供 Overview、Daily、Weekly、Monthly、History 和 Failures. `r` 刷新或重试, `[` 上一页, `]` 下一页. Usage 和 Diagnostics 在加载与分页时保持 22 行, 长内容在内部换行和分页. 根菜单、Settings 和路径编辑器使用紧凑高度, 不再填充到 22 行; 未完成摘要保持控制区位置, 原生设置说明和可见错误按实际内容定高. 单行错误预览的完整内容仍在 Pi 原有通知中显示. PageUp/PageDown 不是 RTK 快捷键. 离开页面会取消临时查询, 包括从根页摘要进入 Settings; 查询失败不关闭 rewrite. 窄布局支持 56 列 26 行; 更小终端显示尺寸提示, 使用原生取消操作退出.

Diagnostics 只读显示已解析的可执行文件、探测信息、本次扩展生命周期最近一次集成 rewrite 故障和 RTK 原生配置. Pi Stuff 不编辑 RTK 配置、信任设置、遥测、hook 或统计数据库.

Daily、Weekly、Monthly 和 History 每页保留表头. Failures 按最近记录和命令频次分区, 翻页时保留所属分区的标题及列名. 主题强调色区分表头、节省量和回退结果, 每种状态仍有文字标识.

Scope 和 View 放在报告上方, 保留当前设置项说明. 分页在数据下方, 快捷键提示固定在底部. 对 Pi 0.85.1 内置 light 主题, RTK 在原有报告/编辑视图内加深原有强调色、成功色、警告色和弱化文字, 改善浅色背景对比度. 修正不修改全局设置或进入模型的输出. 深色主题及带来源元数据的自定义主题保持不变; 256 色终端使用对应的较深色阶. Pi 无法区分缺少来源元数据且名为 `light` 的内存主题与内置主题, 这种主题中匹配原前景色序列的部分也会被修正.

下方历史 [100x30 截图](../../assets/rtk/usage.png)和 [56x26 截图](../../assets/rtk/usage-narrow.png)来自编译 Pi 0.85.1 与原生 RTK 0.45.0, 展示隔离 fixture 仓库执行十次 `git status` 后的结果. 它们早于顶部选择区布局, 新版见[修改前后证据](rtk-review-evidence.md#顶部选择区与浅色对比度). 数值只属于本次样本, 不是通用压缩率基准. 这些是渲染后的 Terminal Control 抓取, 不是原生桌面截图.

导出使用 Pi 当前深色配色, 字体栈为 `JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono`.

![100 列 30 行的 RTK Usage](../../assets/rtk/usage.png)

## 统计含义

Usage 显示 RTK 对原始和过滤后命令输出 token 的估算, 不表示供应商账单、精确模型上下文、Pi 会话专属用量或 Pi Stuff ANSI 清理收益. Global 可以包含其他应用使用同一 RTK 数据库产生的记录. Project 沿用 RTK 当前工作目录范围, 不单独聚合 Git 根目录.

RTK 0.45.0 支持摘要和日/周/月 JSON. History 的 JSON 模式没有历史列表, 因此 Pi Stuff 读取原生文本历史; 该接口只提供最近记录, 命令名也可能已被截断, 本地分页无法恢复 RTK 没有提供的文本.

Failures 始终为全局文本报告, 即使指定 `--format json` 也一样. Pi Stuff 解析总次数、回退恢复率、最多十条高频命令和十条最近记录. `Recovered` 表示 RTK 回退成功, 不代表解析成功; `Failed` 表示回退失败. RTK 不输出错误原因, 命令也可能先被缩短, 面板无法恢复这些信息. 多行命令仍归属其原记录. 集成只读取命令输出, 不读取 RTK 数据库. 无法识别或字段无效时显示 unsupported, 不伪装成零统计. [RTK 0.45.0 报告实现](https://github.com/rtk-ai/rtk/blob/b34be37caf3796b69a50952a28e60e32b5daad43/src/analytics/gain.rs#L695-L739).

## 执行与恢复边界

不支持的命令原样执行. 非取消的发现或 rewrite 准备错误也保留原命令并记录诊断. 已取消请求不执行 raw fallback.

命令开始执行后, Pi Stuff 不因非零退出、超时或过滤失败而重跑. RTK 可能有自己的内部 fallback, 仍归 RTK 管理. 无法安全绑定绝对路径的 shell 形式会绕过改写.

ANSI 清理修改最终文本块, 包括错误文本, 保留其他内容和结果元数据. 它不重写流式更新或 Pi 保留的完整输出文件. Pi 截断提示和完整输出路径仍可用. RTK 之后不再运行摘要、去重或自定义行筛选算法.

手工 `!` 和 `!!` 不属于自动改写范围. 安装升级 RTK、原生 hook 设置、统计重置/导出和其他 RTK 面板不在本集成范围内.

## 兼容性与回退

验收目标为 Linux、Bun 1.4.0、Pi 0.85.1 和 mise 管理的 RTK 0.45.0. 其他版本和平台需另行验证, RTK 输出格式也可能独立变化.

停用优化可关闭两个开关. 回退到此功能之前的 Pi Stuff 版本前, 删除 `pi-stuff.json` 的 `rtk` 部分, 保留其他字段; 旧版严格配置解码器会拒绝未知部分. 回退代码不会撤销已保存设置或 RTK 原生统计.
