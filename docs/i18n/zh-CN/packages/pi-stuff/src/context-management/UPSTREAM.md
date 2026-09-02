<!-- translation-source: packages/pi-stuff/src/context-management/UPSTREAM.md; translation-source-sha256: 554872f76b902a0290c7d8fb2a62fbd791d73b4d992e1dd45c66ccdfba17be9a -->

# 捆绑上下文引擎来源

Pi Stuff 通过本适配器集成官方 Magic Context Package，不内嵌 Magic Context Core。上游 tokenizer 路径尚
不满足独立 Pi 的模块解析和首轮延迟约定，因此仓库为固定 Package 应用一个临时且经过审查的依赖补丁。

精确发布的 Package 在 Pi Stuff Context Engine Worker 中执行。适配器只在激活时生成一个内存 bundle，使
官方模块图可从已认证的独立 Pi 二进制文件解析；它不修改上游源码，也不持久化派生产物。

- 上游：`https://github.com/cortexkit/magic-context`
- 上游发布：`v0.41.1`
- 已发布源码提交（`gitHead`）：`cbfac49fa88b3eb86074b9499c38e993cc447f34`
- Package：`@cortexkit/pi-magic-context@0.41.1`
- npm integrity：`sha512-FYl1IH4KOCXkt4UOI6ZswwI/p3YO9+eP2hrfOtgjlsYjp8UHI+OM7fRY6Z6PGOcaf5+kn0PM1CeHY9j3mjL9TQ==`
- npm tarball SHA-1：`877ae8c6d055bc8af7e7fa5f1d180724c18d2dfb`
- 已审查 tarball SHA-256：`5a227889dd91ed952a7403390b463e3e1ac705f837b8f055ffba62eb659229de`
- 许可证：MIT，与官方 Package manifest 和上游仓库声明一致。

## 临时 tokenizer 兼容补丁

- 补丁：[`patches/@cortexkit%2Fpi-magic-context@0.41.1.patch`](../../../../../../../patches/@cortexkit%252Fpi-magic-context@0.41.1.patch)
- 补丁 SHA-256：`b9793412071a0f6797d2afad4a91a90b8f51313daba4df4170898004ce739c56`
- 范围：
  - 把已发布模块的 `import.meta.url` 祖先路径和 Bun isolated-linker 的 `node_modules` 根目录加入现有
    `ai-tokenizer` 回退搜索；
  - 在引擎初始化期间预加载 tokenizer，而不是等到第一个提交轮次；
  - 哈希图像草稿时复用已有图像 token 估算，避免对不属于哈希结果的 base64 执行精确 BPE 工作。
- 保留的行为：真正不可用的 tokenizer 仍使用 Magic Context 现有启发式回退。补丁不会抑制或拦截诊断。
- 证据：强制 frozen-lockfile 安装能够应用补丁；已认证 Pi Host 从无关用户项目运行时可直接解析
  `preloadTokenizer()`；4 MiB 异常图像 PTY 用例保持响应；真实 Context PTY 门槛拒绝原始
  `[magic-context]` 输出。
- 删除触发条件：只有某个精确官方 Magic Context 产物通过相同的全新安装、首次输入、异常图像、schema
  和真实 Host 检查后，才替换该补丁。

### 2026-09-02 上游审计与升级

本次审计时 npm 最新版本是
[`v0.41.1`](https://github.com/cortexkit/magic-context/releases/tag/v0.41.1)。此前的
[`v0.41.0`](https://github.com/cortexkit/magic-context/releases/tag/v0.41.0) 增加 cache 稳定性修复、Pi RPC
与多 Session 支持、可适配不同布局的 Pi 模块解析，以及存储迁移 v82。补丁版本修复了首日发现的 Historian、
捆绑 Pi subagent、可选 ONNX、Todo 渲染和诊断回归。

官方 0.41.1 产物仍缺少三项本地 tokenizer 与图像哈希行为：tokenizer 回退路径只从 `process.argv[1]`
开始遍历，tokenizer preload 仍不在 factory 初始化内，part hash 也不能接收已经计算好的 token 估算。因此
删除触发条件尚未满足，等价的已审查补丁继续保留。

Schema v82 新增 `memory_verifications.mapping_origin`。认证会创建真实 v82 数据库，将它精确回退成 v81
形状，验证 v81 到 v82 自动迁移，再让只支持 v81 的 Worker 面对 v82 存储启动。旧 Worker 不暴露命令或
Tools，只保留 `session_shutdown`，因此不能写入更新版本的存储。

上游 0.41.1 还会读取 `pi.events` 以接收 child-subagent 生命周期通知。Pi 不会在 Context Engine Worker
里初始化 child Extensions，因此隔离适配器提供无操作 EventBus：Worker 内根本没有需要转发的 publisher，
前台 Pi 与 Agents 仍保留原有生命周期所有权。

Package 声明的 Pi peer 是 `^0.80.2`，不包括 Suite 已认证的 Pi 0.84.4 Host。Pi Stuff 不从这个范围推断
兼容性。真实 Pi 0.84.4 PTY 与 Provider 门槛会单独认证激活、取消恢复、在线 Session 替换与恢复、冷恢复、
仅 Magic compaction、项目隔离和 fail-open。详情见[优化报告](../../../../docs/reports/magic-context-effect-optimization-2026-09-02.md)。

## Pi Stuff 适配器政策

- 直接输入先由 Host 确认，再启动惰性激活；第一个 Agent 边界仍保留直接用户的配置写入权限。只有存在可识别
  CortexKit 配置，且没有旧位置或扁平用户执行设置等待官方 factory 迁移时，自动轮次才会激活；
- 开放回退到 Pi 原生行为；
- 为 BTW 和 Agents 提供一个有界状态/投影接缝；
- 在可替换 Capability 接缝后使用精确官方基础 Package 及临时、经过审查的 tokenizer 兼容补丁；
- 通过不可变 Host 快照和有界副作用，把精确官方引擎与 Pi UI 线程隔离；
- 不提供相互竞争的 Todo、状态栏、公告、Dreamer 或 Sidekick UI；
- 只暴露五个 Context Tools，以及聚焦的状态、清理、重组、收尾和 Session 升级命令；
- 只有一个显式 compaction 权威：Magic 接管前允许原生回退，活跃 Magic 尝试后绝不叠加；
- 为 BTW 和 Agents 提供有界、仅引用的投影；
- 首次使用配置引导遵循上游绝对 XDG 与 JSON/JSONC 路径规则，忽略上游不读取的自定义 Pi Agent 目录，
  并且只有不存在可识别用户或项目配置时才创建用户配置；
- 首次使用采用纯词法搜索配置，使初始激活不依赖可选本地 embedding runtime。显式用户 embedding 配置会保留。
