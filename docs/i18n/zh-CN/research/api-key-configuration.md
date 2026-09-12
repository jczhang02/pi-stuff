# Pi Stuff 的 API Key 配置

[English](../../../research/api-key-configuration.md)

为 [#45](https://github.com/jczhang02/pi-stuff/issues/45) 于 2026-09-11 开展最初调查. **本文是历史调研, 不是当前使用契约.** 维护者随后通过[本修订](https://github.com/jczhang02/pi-stuff/issues/45#issuecomment-5644351201)批准复用宿主 auth.json, 开发版扩展已在 `bfc7720` 实现. 当前行为见[网页访问](../web-access.md). 下方最初的仅环境变量实现和字面值字段建议均为历史记录. 本文不包含真实凭据.

## 后续验证: 复用 Pi auth.json

本节记录实施前的可行性实验, 其中待实施的表述描述的是当时阶段.

在实际 Linux Bun 编译 Pi 0.85.1 上进行的有限实验已确认: **不注册聊天模型也能复用宿主凭据**. 对普通配置和秘密分开备份的用户, 现在更推荐这个方向. 下方原来的字面值字段方案保留为调研历史, 不再是当前建议.

临时扩展只使用公开 API:

- `pi.registerProvider(createProvider({id: 'exa', auth: {apiKey: envApiKeyAuth(...)}, models: [], api: {}}))` 注册认证, 模型目录和流实现映射都为空, 不增加虚构模型或协议适配器.
- `/login exa` 使用宿主 API Key 流程, 在隔离的 `auth.json` 中保存形如 `{type: 'api_key', key: '...'}` 的 exa 条目.
- `ctx.modelRegistry.getProviderAuth('exa')` 无须模型即可解析认证. 优先使用它, 而不是会捕获失败并返回 undefined 的 `getApiKeyForProvider`; 后者会丢失凭据缺失与认证失败的区别.
- `/logout` 删除已保存条目, 不删除另外提供的 `EXA_API_KEY` 环境变量.

内置 `envApiKeyAuth` 的顺序是**已保存凭据优先, 环境变量其次**, 与先前建议的 env-first 不同. 沿用宿主顺序可以不再自写一套解析器; 改变顺序需要明确决策. [辅助函数源码](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/ai/src/auth/helpers.ts), [provider API/工厂](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/ai/src/models.ts), [注册表接口](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/model-registry.ts).

Tuistory 实验只使用假 Key, 隔离工作、设置和会话目录. 无选定模型和显式选定已有 OpenAI 模型两个环境各通过 1 测试/7 断言, 没有调用该模型. 均验证了登录保存、文件创建权限 0600、reload 和进程重启后读取、已保存值优先于环境变量、logout 删除、删除后回到环境变量, 以及 Exa 模型数量始终为零. 临时进程/目录已清理, 未访问真实凭据. 这是可行性实验, 不是已交付产品测试或 Exa API 验收.

**实际观察到的宿主限制:** secret 输入框显示了假 Key 明文, 因此最初的遮蔽断言失败. 没有选定模型时, 登录保存成功后还显示“无默认模型”错误, 但不会撤销保存; 已选定模型的环境没有该错误. 不能宣称登录输入已遮蔽. 直接管理分离的凭据文件可以避免 Key 出现在登录画面, 但仍需正确权限和单独保护备份. [宿主登录完成流程](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/modes/interactive/interactive-mode.ts).

建议布局: 后端偏好和工具开关继续放在 `pi-stuff.json`, Exa 凭据放在宿主管理的 `auth.json`. 后者排除普通配置同步, 需要时单独加密备份. 文件权限不是加密或同用户隔离. 生产集成、错误/取消处理和回归测试仍待达成一致后实现; 本次实验未修改个人 auth 文件或运行时实现.

## 初始建议

对这个本地扩展, 建议同时支持在已有全局 Pi Stuff 配置中直接填写 Key 和环境变量覆盖. 仅为使用 Exa 就要求修改启动器或另建凭据文件, 增加了不必要的配置步骤. 只允许当前用户读取的明文文件可以是合理的受支持选项, 前提是明确它的限制. 环境变量不是加密存储, 也不天然更安全.

建议读取顺序: **非空 `EXA_API_KEY` → `web.exaApiKey` → 缺少 Key 时明确报错**. 这是应用的策略, 不是所有 SDK 的统一惯例. 它允许临时任务和 CI 覆盖凭据, 无须修改已保存的配置. 凭据被拒绝后应保留认证错误, 而不是换另一个已保存的 Key 重试.

建议示例, 当前尚不支持:

```json
{
  "web": {
    "provider": "openai",
    "exaApiKey": "YOUR_EXA_API_KEY"
  }
}
```

后端偏好与凭据是否可用是两件事: 默认 OpenAI 时, Exa 仍能处理带域名筛选的搜索及既有允许回退的情况. 是否修改默认后端, 仍由用户决定.

## 其他项目的做法

### OpenAI Python SDK

普通构造函数优先使用显式 `api_key`, 仅在该参数为 `None` 时读取 `OPENAI_API_KEY`. 显式空字符串不会回退. 当前源码还接受返回 Key 的函数, 包括异步形式, 便于应用对接 secret manager. 这些与工作负载/provider 身份模式不同, 本次没有审计那些模式的完整认证链. [构造函数](https://github.com/openai/openai-python/blob/d7c41efee1b0802b79f3f88a678ef2052b06e9ce/src/openai/_client.py#L161-L357), [请求时调用函数](https://github.com/openai/openai-python/blob/d7c41efee1b0802b79f3f88a678ef2052b06e9ce/src/openai/_client.py#L666-L692).

README 建议用 python-dotenv 加载 `.env`. 这是独立加载器, 不是 SDK 自动读取应用配置. **构造函数允许传 Key, 不等于 SDK 会读配置文件.** [官方 README](https://github.com/openai/openai-python/blob/d7c41efee1b0802b79f3f88a678ef2052b06e9ce/README.md).

### Exa JavaScript SDK

构造函数优先使用真值的显式 `apiKey`, 否则读取 `process.env.EXA_API_KEY`, 仍为空则抛错. 空字符串会回退, 但该构造函数不 trim 空白. 结果被设置到 `x-api-key` 请求头. 这条路径没有配置文件、`.env`、钥匙串或凭据命令加载器; 应用须先解析这些来源, 再传入字符串. [构造函数](https://github.com/exa-labs/exa-js/blob/f33c4fffbcdded178b4d19b5ab259147d501b3b9/src/index.ts#L876-L920), [官方用法](https://github.com/exa-labs/exa-js/blob/f33c4fffbcdded178b4d19b5ab259147d501b3b9/README.md).

Pi Stuff 使用直接 HTTP, 不使用该 SDK. 可借鉴的是让宿主/配置边界负责解析凭据, 而不是仅为读一个字符串引入 SDK.

### GitHub CLI

`gh auth login` 通常保存到系统凭据库, 安全存储失败或不可用时退回明文; `--insecure-storage` 可显式选择明文. 也支持环境变量和通过 stdin 提交 token 登录. [官方登录文档](https://cli.github.com/manual/gh_auth_login), [登录源码](https://github.com/cli/cli/blob/8fcd6a643f993ee12b70ad0edeab741ed133c9f1/pkg/cmd/auth/login/login.go).

GitHub.com 当前账号认证优先读取非空 `GH_TOKEN`, 其次 `GITHUB_TOKEN`, 然后检查主机级明文 token, 最后检查当前用户的钥匙串 token. 因此写入优先钥匙串, 不代表读取也优先钥匙串. 企业主机的变量名不同, 单独的按用户查询接口也有不同顺序. 凭据使用 `hosts.yml`, 与普通设置 `config.yml` 分开. [当前 token/存储实现](https://github.com/cli/cli/blob/8fcd6a643f993ee12b70ad0edeab741ed133c9f1/internal/config/config.go#L254-L579), [实际依赖 go-gh v2.16.0 的解析器](https://github.com/cli/go-gh/blob/c9808f266122bea7f5d7500d771c8134a0217af7/pkg/auth/auth.go), [文件加载](https://github.com/cli/go-gh/blob/c9808f266122bea7f5d7500d771c8134a0217af7/pkg/config/config.go).

### OpenAI Codex CLI

Codex 支持 `file`、`keyring`、`auto`、`ephemeral` 凭据存储. 已检查源码的默认值为 **file**, 不是 auto. 文件模式把明文写入 `CODEX_HOME/auth.json`, 在 Unix 创建文件时请求 `0600` 权限. auto 先尝试钥匙串, 可以退回文件; ephemeral 只在进程内存中保存. [官方认证文档](https://developers.openai.com/codex/auth), [存储实现](https://github.com/openai/codex/blob/2fc4bda3ca3e93b764dd3845cb8c1a15a10866e1/codex-rs/login/src/auth/storage.rs), [存储模式定义](https://github.com/openai/codex/blob/2fc4bda3ca3e93b764dd3845cb8c1a15a10866e1/codex-rs/config/src/types.rs#L108-L160).

自定义后端可以用 `env_key` 指定环境变量名, 或用 `experimental_bearer_token` 直接填写 token; 必需的 env_key 不存在时会报错. 当前源码还提供命令式后端认证, 带超时、刷新和互斥配置. 托管的 ChatGPT/API Key 认证是另一条受策略影响的路径, **不能把 Codex 简化成 `OPENAI_API_KEY → auth.json`**. [后端定义](https://github.com/openai/codex/blob/2fc4bda3ca3e93b764dd3845cb8c1a15a10866e1/codex-rs/model-provider-info/src/lib.rs), [后端解析](https://github.com/openai/codex/blob/2fc4bda3ca3e93b764dd3845cb8c1a15a10866e1/codex-rs/model-provider/src/auth.rs#L184-L305), [托管认证解析](https://github.com/openai/codex/blob/2fc4bda3ca3e93b764dd3845cb8c1a15a10866e1/codex-rs/login/src/auth/manager.rs#L1461-L1569), [命令实现](https://github.com/openai/codex/blob/2fc4bda3ca3e93b764dd3845cb8c1a15a10866e1/codex-rs/login/src/auth/external_bearer.rs).

### Pi 0.85.1

Pi 自身支持在 `models.json` 中直接写 Key、插入环境变量和 `!command` 解析. 凭据存储也会把 API Key/OAuth 条目保存到宿主解析出的 `auth.json`. 创建文件时请求 `0600`, 新父目录为 `0700`, 保留已有管理员设置的权限/ACL. 因此文件凭据本来就是宿主有意提供的能力, 并非原则上不允许. [固定版本的模型文档](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/models.md#value-resolution), [固定版本的认证存储](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/auth-storage.ts).

已安装的模型文档与该标签的官方源文件逐字节相同, 也检查了已安装的凭据存储和模型注册表 API. 这**不代表**已经验证了仅用于搜索的 Exa 能直接接入 Pi 登录/provider 注册表. 不应为了保存 Key 注册虚构聊天模型或绕过宿主职责. 上方后续实验补充了独立的有限兼容性验证; 原先的源码检查本身不能证明已经兼容.

## 建议边界

- 只使用项目目录之外的 `<agent-dir>/pi-stuff.json`, 保留不支持项目级覆盖的策略. 增加一个可选字面值字段, 不另建配置层级.
- Unix 上创建含 Key 文件时使用仅属主可读写的 `0600`. 不静默改写现有 ACL 或权限. 明确这是明文, 不是加密.
- 工具结果、异常、诊断、提交的示例和审查证据不包含 Key 或配置全文. 最多报告凭据来源, 不报告内容, 不增加展示 Key 的工具.
- 空白环境变量按缺失处理; 显式文件值须校验. 写清优先级, 没有可用来源时明确报错, 保持既有认证错误和后端回退语义.
- 文件变更通过 `/reload` 生效, 沿用现有配置生命周期. 父 shell 环境变化通常需要带新环境重启 Pi, `/reload` 无法从另一个进程导入变量.
- 属主专用权限不能防御同一用户、root、同用户下任意代理或意外备份. 环境变量可能被子进程继承或泄露到诊断转储. 两者都不是沙箱边界.
- 用户需要静态存储保护或集中轮换时, 钥匙串/外部 secret manager 有价值; 有合适的宿主能力时优先复用. 不应为单个 Exa Key 强制新增原生依赖、把解密密钥放在旁边的自制加密、启动器修改或任意命令执行.

以上建议等待确认. 本次调研没有修改产品运行时行为、个人配置、真实凭据或启动器. 实施前需要明确修订 #45 原来的 env-only 契约.

## 方法与限制

独立调研会话检查了 OpenAI Python、Exa JS、GitHub CLI、Codex 的公共源码; 负责人核对 Pi 已安装及固定版本实现. 检查普通构造函数、相关完整解析函数和存储路径, 不根据搜索片段推断. 仓库链接固定到已检查快照, 官网文档没有版本固定且可能变化. 这不是完整认证/安全审计. 最初的源码调查未进行后端验收或凭据访问测试, 后续假凭据实验见上文. 先前 Exa 验收是 [PR #46](https://github.com/jczhang02/pi-stuff/pull/46) 中单独的证据.
