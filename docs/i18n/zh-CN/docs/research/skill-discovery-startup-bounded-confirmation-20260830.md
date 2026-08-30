<!-- translation-source: docs/research/skill-discovery-startup-bounded-confirmation-20260830.md; translation-source-sha256: 1290afe41fcd2b4347f4692fe9653d3d40d21d3a62d0b24b1fa4b8ff75b922ec -->

# Skill Discovery 启动边界真实模型确认预注册

日期：2026-08-30

状态：已预注册；尚不存在任何 V5 Provider 请求或结果。

这是 Bead `ps-1gd` 的全新独立研究。它不会重试、替换、排除或复用已保留的
[首次 benchmark](../../../../../docs/research/skill-discovery-benchmark-20260830.md)、
[confirmation](../../../../../docs/research/skill-discovery-confirmation-20260830.md)、
[direct-read 研究](../../../../../docs/research/skill-discovery-direct-read-20260830.md)或
[隔离确认](../../../../../docs/research/skill-discovery-isolated-confirmation-20260830.md)中的样本。它在把
Pi/Suite cold startup 与普通 RPC command 计时分开后，测量自动 direct Skill use。

## 为什么需要第五项研究

产品候选实现已经通过 Code Mode 现有 virtual Read surface 提供被发现的 Skill，并引导模型直接读取选中
catalog location，不经过 `tool_search` 绕路。在最近两项保留研究中，每个完成的 Code Mode Session 都通过了
该严格 endpoint：两项研究均为 29/29。两项研究都没有通过 hard gate，因为 Suite Session 在发出任何
Provider 请求前超时。

隔离确认保留的结果是 Raw 30/30、Pi Stuff off 27/30、Pi Stuff on 29/30。它的 4 个 Suite failure 全部在
61–65 秒结束，Provider request、Tool call 与 token 均为零。Native Context 隔离没有消除这些 failure，因此
该研究继续被正确地判定失败。

结果产生后的诊断使用认证 Pi executable 运行 offline、无 prompt 的 Session。Raw Pi 的第一次 `get_state`
response 耗时 1,088 ms，两个 Suite arm 分别耗时 24,967–25,464 ms；之后的 configuration command 只耗时
2–24 ms。在仓库检查并发运行时，Suite cold startup 耗时 34,307 ms，之后的 command 合计耗时 26 ms。因此，
旧的 60 秒 general command timeout 包含 `spawn` 返回后、process 与 Extension 完成 cold startup 的等待，
在外部 CPU 竞争下可能在 prompt preflight 前耗尽。

共享 runner 现在显式表达该 protocol boundary。同步 `spawn` 返回后，`getInitialState` 会在写入第一次请求前
安装 5 分钟 startup-readiness timer；它限制从 cold startup 到第一次 response 的等待，而不包围同步操作系统
调用本身。普通 command 保留 60 秒，Agent settlement 保留 15 分钟。结构化 timeout observation 只保留有界
phase。真实 Host regression 在普通 command 仍限制为 1 秒时通过了 34,307 ms 的 Suite startup。该 runner
修复不能改变失败的历史研究，因此必须使用新的锁定样本。

## Arms 与 Tool authority

一个精确 Provider/model 配置运行三个 matched arm：

1. **Raw Pi**：认证 Host、研究 Skill 与只测量 observer；不加载 Pi Stuff。
2. **Pi Stuff off**：输入完全相同，加载候选 Package，把 Code Mode 冻结为 off。
3. **Pi Stuff on**：输入和候选 Package 完全相同，把 Code Mode 冻结为 on，并保持 virtual Read active。

每个 arm 接收严格 allowlist `bash,find,grep,ls,read,codemode,tool_search`。Raw/off 要求的 Provider surface
精确为 `bash`、`find`、`grep`、`ls`、`read`，on 则精确为 `codemode`、`tool_search`。Tool 缺失或多出、
catalog 缺失或 Provider boundary 无效都属于 instrumentation failure。

每个 arm 都使用 Pi Stuff 已有的 `MAGIC_CONTEXT_PI_SUBAGENT=1` guard，使这些 synthetic one-turn Session
保持 native Context。Runner 在设置锁定环境前删除所有继承的 `MAGIC_CONTEXT_*`、`PI_STUFF_*`、
`PONYTAIL_*` 与 `PI_SUBAGENT_PARENT_*` 变量。这是评估控制，不是产品改动，也不对 Magic Context 作出结论。

## 锁定 identity

签名 Run Lock 将冻结：

- Provider `openai-codex`、model `gpt-5.6-sol`、reasoning `xhigh` 与 Context mode `native`；
- 产品候选 commit `518af59db690bd7751ae6e08db9a6750fa411894` 与 Package tree
  `8d9d7220f39f49fb25d7b7ccb9282b75aedf1c15`；
- 认证 Pi 0.84.4 Linux x64 release executable SHA-256
  `ce91e1f8bff6176c6a23a690bd0bc4c6e1f5bee1b1183cd2a3b1e92d88c9038a`，大小 104,511,616 bytes；
- 300,000 ms startup、60,000 ms ordinary-command 与 900,000 ms settlement budget；
- 每个 executable runner source、只测量 observer、immutable manifest、精确 schedule 与新报告目标。

精确预注册输入为：

- `scripts/benchmark-skill-discovery.ts`：`8f3e5cb79a3a9d1a6bda7970a599bf80049411f0ba979dd483e62dd9fc7a19f5`；
- `scripts/pi-rpc-client.ts`：`689e4f87c8beae6a2978f8acf722fbf3b32af1bd2894c2c023f7c7f3f960c1b4`；
- `scripts/skill-discovery-benchmark-core.ts`：`a36c324ba95711acbe49893c3d23dbd3063989c94c3309d01f0c6e8d6b38cbf4`；
- `scripts/skill-discovery-benchmark-evidence.ts`：
  `b92fc647053c2a5ef047f3e35649ff96f12978f68254497fb093f99b2a25df0a`；
- `scripts/skill-discovery-benchmark-report.ts`：
  `72b2c606b2dd8ac7741da24eb22f313604f67d8c316e9522a24791600b0e31c9`；
- `scripts/skill-discovery-benchmark-session.ts`：
  `52c1703f8d66a95cf017debf147637d73686edd570674af99574e01f6f9d2f22`；
- observer `test/fixtures/skill-discovery-benchmark-observer.ts`：
  `c7ad035b166ff99950c3138c033e991f6d5ea97b6a3f84d158b3ae34fc7fa705`；
- manifest `test/fixtures/skill-discovery-startup-bounded-confirmation-manifest.jsonl`：
  `c864808d44bb2e66fda91d5041d4b10c2484f1f38b585409d51f7231595b4441`。

Run Lock 路径为 `test/fixtures/skill-discovery-startup-bounded-confirmation-run-lock.json`；报告目标为
`docs/reports/skill-discovery-startup-bounded-confirmation-20260830.json`。Candidate commit 绑定产品 Package
identity。之后的签名 lock commit 只能增加已锁定的研究输入，其 `packages/pi-stuff` tree 必须 byte-identical。
Runner 与 observer identity 由各自 hash 独立绑定。

在第一次 Provider 请求前，preflight 必须拒绝不同 Host、dirty tree、不匹配的 Package tree、runner、observer、
manifest、timeout policy、Context mode、Provider/model 配置、authentication state 或已存在的报告。

## 新任务、顺序与隔离

V5 包含 30 个全新 matched triad 和 90 个 primary Session：10 个 metadata、10 个 deterministic-
instruction、10 个 relative-resource task。ID 以 `bounded-` 开头，目标 Skill 以 `sd-bounded-` 开头，
expected token 使用 `*_BOUNDED_*` namespace。可执行测试会把每个 V5 ID、prompt、expected token 与目标 Skill
名称同四个保留 manifest 比较，并要求零复用。

确定性 generator 使用 seed `20260903`。Immutable JSON Lines manifest 记录每个 prompt、目标与 decoy Skill、
relative resource、expected token、fixture hash 与 arm order。Task 经过 seeded shuffle 后，六种 arm permutation
各出现五次。Session 顺序执行。

每个 Session 都获得全新的 project、Agent、Session、cache、config、data、runtime、state 与 temporary
directory。Arms 共享完全相同的 prompt 与 fixture bytes、ordinary Tool authority、model 配置、observer、
native Context mode、timeout policy，以及一条 runner 所有的 Provider authentication rotation chain。每个
Session 获得全新 case-local credential copy；通过 safety check 后，Provider 所有的 OAuth rotation 会向后
复制。Session、cache、fixture path、model history 与 case-local credential file 均不共享。

不允许 retry、replacement、结果产生后的 exclusion 或 early stopping。每个 timeout、process、Provider、
parsing、instrumentation 或 model failure 都保留在原 arm，作为失败 observation。Timeout observation 只保留
`setup`、`prompt-preflight`、`settlement`、`evidence` 或 `unknown` 之一；成功 Session 保留 `none`。

## 每个 Session 的 endpoint

自动 direct Skill-use success 必须同时满足：

1. 第一个 Provider prompt 精确包含一个目标 catalog entry，name、description 与 location 均符合预期。
2. Natural-language prompt 不写出目标，但模型仍自动选择它。
3. 第一个相关 operation 读取精确目标 `SKILL.md`；on 必须使用外层 `codemode`，其第一个相关 nested
   operation 为 `tools.read`。
4. Target read 前不得出现 Bash、Find、Grep、List、`tool_search`、Skill-directory scan、documentation/settings
   或 historical-Session lookup、unsupported-availability claim 或 decoy read。
5. 观察到的 target content hash 与 fixture 相同；relative-resource task 随后读取精确声明的 resource 与 hash。
6. 最终答案与 task token 完全一致。
7. Provider-Tool、process、Provider、instrumentation、prompt-boundary、protected-file、safety 与 privacy check
   全部通过。

正确输出不能替代观察到的精确 Skill read。完整 before/after snapshot 保护 fresh project 与生成的 Agent
`skills/` tree。Provider 所有的 authentication 可能轮换，因此不参与 byte comparison；模型访问
authentication、settings、Session、environment 或无关用户数据属于独立 safety violation。

## 统计与 verdict

每个 arm 报告 success fraction 与 Wilson 95% interval。Pi Stuff off 减 Raw Pi、Pi Stuff on 减 off 使用 seed
`20260903` 做 20,000 次 whole-triad bootstrap resample，并报告 percentile 95% interval。Exact two-sided
McNemar 报告全部四个 paired cell。

研究只有在以下条件全部满足时才通过：

- observed rate 满足 `Raw Pi <= Pi Stuff off <= Pi Stuff on`；
- 两个 paired interval 下界都高于 `-0.10`；
- 90 个 observation 全部保留在原 arm；
- prompt-boundary、protected-file、instrumentation、safety 与 report-privacy violation 均为零；
- 每项 Host、Package tree、source、manifest、schedule、arm、Context-mode、timeout-policy、Provider/model 与
  Provider-Tool hard invariant 均通过。

Improvement 还要求 favorable discordant pair 多于 unfavorable，且 exact two-sided McNemar `p <= 0.05`。
否则，通过后允许的最强表述是本次精确冻结研究下的 non-inferiority。

## 执行 protocol

在 manifest、runner、observer、timeout policy 与 report path 已提交、经过独立审查、写入签名 Run Lock，并
对 clean worktree 完成审计前，不得启动任何 V5 Session 或 Provider 请求。Lock 完成后，runner 严格执行一次
90 个 Session。失败 observation 必须保留，不能重试或替换。无论通过还是失败，都提交 sanitized report。

## 公开数据政策

Observer 只在内存中检查 Provider payload 与 Tool lifecycle。Sanitized report 可以保留 synthetic ID、hash、
path class、count、boolean、有界 failure/timeout enum、Tool name、timing、token total、locked identity、statistics
与 verdict。它不得包含 credential、prompt、Assistant text、Skill body、Provider payload、Session JSON 或 ID、
private absolute path 或 temporary directory。Runner 在写入报告前后验证 privacy，然后删除全部 temporary
project、Session、fixture、auth copy 与 observer log。
