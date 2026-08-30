<!-- translation-source: packages/pi-stuff/src/context-management/UPSTREAM.md; translation-source-sha256: 2b562a10265b3c88d755c990e6755d03060593c89c5ac2ba428cea72700a2ebd -->

# 捆绑上下文引擎来源

Pi Stuff 通过本适配器集成官方 Magic Context 软件包，不内嵌 Magic Context Core。上游分词器路径尚不满足独立 Pi 的模块解析和首轮延迟约定，因此仓库为固定软件包应用一个临时且经过审查的依赖补丁。

精确发布的软件包在 Pi Stuff 上下文引擎 Worker 中执行。适配器只在激活时生成一个内存包，使官方模块图可从已验证的独立 Pi 二进制文件解析；它不修改上游源码，也不持久化派生产物。

- 上游：`https://github.com/cortexkit/magic-context`
- 上游发布：`v0.40.0`
- 已发布源码提交（`gitHead`）：`002c2c292eef51573ebe950237d586f9310bbece`
- 软件包：`@cortexkit/pi-magic-context@0.40.0`
- npm 完整性：`sha512-nlrC4QKcUWsdWnmoXhWRhRinOrZwrkrkIz3SmEdu2Fe78DS4BFNmyv4vIRR58yqv+iSBvkUzko5fOb4F9z6oxA==`
- npm tarball SHA-1：`8697ea2bc658f325faefd1308b39b82594910b38`
- 已审查 tarball SHA-256：`968c34cc384252302ef77eec1c0235ecf1cd5ca96d6abccdd4ef4630fdf48f1b`
- 许可证：MIT，与官方软件包清单及上游仓库声明一致。

## 临时分词器兼容补丁

- 补丁：[`patches/@cortexkit%2Fpi-magic-context@0.40.0.patch`](../../../../../../../patches/@cortexkit%252Fpi-magic-context@0.40.0.patch)
- 补丁 SHA-256：`809e9705edad15cc8f5cfc6122b4c50c62ed6c6d49a2fa00f36353b433a88388`
- 范围：
  - 把已发布模块的 `import.meta.url` 祖先路径和 Bun 隔离链接器的 `node_modules` 根目录，加入现有 `ai-tokenizer` 回退搜索；
  - 在引擎初始化期间预加载分词器，而不是等到第一个提交轮次；
  - 哈希图像草稿时复用现有图像 token 估算，避免对不属于哈希结果的 base64 执行精确 BPE 工作。
- 保留的行为：真正不可用的分词器仍使用 Magic Context 现有启发式回退。补丁不会抑制或拦截诊断。
- 证据：在已验证独立 Pi 宿主下直接调用 `preloadTokenizer()`，当宿主从无关用户项目运行时会从 `false` 变为 `true`；长异常图像 PTY 用例保持响应；真实上下文 PTY 门槛拒绝原始 `[magic-context]` 输出。
- 删除触发条件：只有某个精确官方 Magic Context 产物通过相同的全新安装、首次输入、异常图像和真实宿主检查后，才替换该补丁。

### 2026-08-30 上游审计

本次审计时最新的官方软件包版本是
[`v0.40.1`](https://github.com/cortexkit/magic-context/releases/tag/v0.40.1)，发布自
[`a239835e161efc730f0da8472786fe372626e66b`](https://github.com/cortexkit/magic-context/commit/a239835e161efc730f0da8472786fe372626e66b)。
该发布提交只修改三个软件包的版本号；release notes 涉及数据库打开、musl 本地 embedding、Task 可见性和
reminder rendering，不包括 tokenizer 加载或图像哈希修复。

精确的官方 [`@cortexkit/pi-magic-context@0.40.1` npm
产物](https://www.npmjs.com/package/@cortexkit/pi-magic-context/v/0.40.1) SHA-1 为
`86c182b8fe0785f38ec3ff35c2a2196b356cab82`，仍缺少本地补丁的全部行为：

- `tokenizerPackageRoots()` 会搜索工作目录、OpenCode cache 与 `process.argv[1]` 的祖先路径，但不会搜索已发布
  模块的 `import.meta.url` 祖先路径或 Bun isolated-linker 的 `node_modules` 根目录；
- `preloadTokenizer()` 仍从 `before_agent_start` 运行，而不是在引擎初始化时运行；
- `memoizedContent(kind, content)` 仍会执行 `estimateTokens(content)`，不能接收图像草稿已有的 token 估算。

因此删除触发条件尚未满足。Pi Stuff 保留精确的 `0.40.0` 依赖及其已审查补丁；后续升级必须保留等价补丁，
直到新的官方产物通过全新安装、首次输入、异常图像和真实宿主门槛。

软件包声明 Pi Peer 为 `^0.80.2`，不包括套件已验证的 Pi 0.84.4 宿主。因此 Pi Stuff 不从 Peer 范围推断兼容性：其真实宿主 PTY 门槛会针对固定 Pi 0.84.4 源码配置单独验证该精确产物。

## Pi Stuff 适配器政策

- 由直接输入延迟激活；只有存在可识别 CortexKit 配置，且没有旧位置或扁平用户执行设置等待官方工厂迁移时，自动轮次才会激活；
- 开放回退到 Pi 原生行为；
- 为 BTW 和 Agents 提供一个有界状态/投影接缝；
- 在可替换能力接缝后使用精确官方基础软件包及临时、经过审查的分词器兼容补丁；
- 通过不可变宿主快照和有界副作用，把精确官方引擎与 Pi UI 线程隔离；
- 不提供相互竞争的 Todo、状态栏、公告、Dreamer 或 Sidekick UI；
- 只暴露五个上下文工具，以及聚焦的状态、清理、重组、收尾和会话升级命令；
- 只有一个显式压缩权威：Magic 接管前允许原生回退，活跃 Magic 尝试后绝不叠加；
- 为 BTW 和 Agents 提供有界、仅引用的投影；
- 首次使用配置引导遵循上游绝对 XDG 与 JSON/JSONC 路径规则，忽略上游不读取的自定义 Pi Agent 目录，并且只有不存在可识别用户或项目配置时才创建用户配置；
- 首次使用采用纯词法搜索配置，使初始激活不依赖可选本地嵌入运行时。显式用户嵌入配置会保留。
