<!-- translation-source: docs/research/skill-discovery-isolated-confirmation-20260830.md; translation-source-sha256: dabe2ee0720bdb9c92cef734e42a72c0d3d635acd1b050c1a86ce5df0a47fad3 -->

# Skill Discovery 隔离真实模型确认预注册

日期：2026-08-30

状态：设计与 Run Lock 已冻结；尚未产生 isolated-confirmation Session、Provider 请求或结果。

这是 Bead `ps-1gd` 的全新独立研究。它不会替换或复用已保留的
[首次 benchmark](../../../../../docs/research/skill-discovery-benchmark-20260830.md)、
[confirmation](../../../../../docs/research/skill-discovery-confirmation-20260830.md)或
[direct-read 研究](../../../../../docs/research/skill-discovery-direct-read-20260830.md)中的样本。本研究在所有 arm
中移除一个已测得、与 Skill Discovery 无关的 Context Worker 混杂因素，然后检验最终候选实现能否自动、
直接地选择并加载 Skill。

## 本研究的原因

Direct-read 研究完成了计划中的全部 90 个 Session。Raw Pi 通过 30/30；Pi Stuff off 与 on 各通过 29/30。
所有完成的 on-arm Session 都通过严格 endpoint，包括直接嵌套调用 `tools.read`，且没有 `tool_search` 或其他
discovery 绕路。一个匹配的 off/on pair 在发出任何 Provider 请求前约 65 秒超时，同一任务的 raw peer 则通过。
更早的 confirmation 也出现了相同的 off/on-only、零 Provider 请求超时形态。

结果产生后的代码路径检查发现，Pi 的 RPC prompt acknowledgement 位于 prompt preflight 之后，而 preflight
包含 Pi Stuff 的 `before_agent_start` handler。Direct RPC input 会在两个 Suite arm 中启动可选 Magic Context
Worker；该初始化没有内部 deadline，raw Pi 中则不存在。保留报告没有标明发生超时的精确 await，因此它们
继续判定失败，不能被重新分类。

本研究不放宽 60 秒 RPC command 边界，不重试失败任务，也不修改候选 Package。相反，每个 arm 都使用
Pi Stuff 已有的 `MAGIC_CONTEXT_PI_SUBAGENT=1` native-Context guard。Runner 先移除继承的
`MAGIC_CONTEXT_*` 变量，再精确设置该 guard。这样，可选 Context Worker startup 不会进入 Code Mode Skill
Discovery 测量，raw、off 与 on 也具有相同的 native Context authority。

## Arms 与 Tool authority

一个精确 Provider/model 配置运行三个 matched arm：

1. **Raw Pi**：认证 Host、研究 Skill 与只测量 observer；不加载 Pi Stuff。
2. **Pi Stuff off**：输入相同，加载候选 Package，把 Code Mode 冻结为 off。
3. **Pi Stuff on**：输入与候选 Package 相同，把 Code Mode 冻结为 on，并保持 virtual Read active。

每个 arm 使用相同的严格 allowlist：`bash,find,grep,ls,read,codemode,tool_search`。要求的 Provider surface
精确为：

- Raw Pi 与 Pi Stuff off：`bash`、`find`、`grep`、`ls`、`read`；
- Pi Stuff on：`codemode`、`tool_search`。

Raw Pi 忽略两个未注册的 Code Mode 名称；Pi Stuff off 移除 disabled envelope；Pi Stuff on 把相同的五个
ordinary Tool 投影到双 Tool envelope 后。Tool 缺失或多出、catalog 缺失或 Provider boundary 无效都属于
instrumentation failure。

Native Context 隔离是评估控制，不是产品改动，也不对 Magic Context 作出结论。它只为这些 synthetic
one-turn Session 禁用可选 derived Context engine；三个 arm 仍全部使用 Pi 原生 prompt、Session 与 compaction
行为。

## Run Lock

完整的结果产生前 Run Lock 冻结：

- Provider `openai-codex`、model `gpt-5.6-sol`、reasoning `xhigh` 与 Context mode `native`；
- candidate commit `518af59db690bd7751ae6e08db9a6750fa411894` 与 Package tree
  `8d9d7220f39f49fb25d7b7ccb9282b75aedf1c15`；
- 认证 Pi 0.84.4 Linux x64 release executable SHA-256
  `ce91e1f8bff6176c6a23a690bd0bc4c6e1f5bee1b1183cd2a3b1e92d88c9038a`，大小 104,511,616 bytes；
- 每个 runner source、只测量 observer、immutable manifest、精确 schedule 与 sanitized report path。

锁定输入精确为：

- `scripts/benchmark-skill-discovery.ts`：`028cc81e87a6a98cd8e55b1bffe358a683ee07ba99f54876e367ecb08d4521f1`；
- `scripts/pi-rpc-client.ts`：`75182f6d2a3cbf3a4369921e94063ef6153eacb95dc683397d95b1d943e09eff`；
- `scripts/skill-discovery-benchmark-core.ts`：`b340cb21f27bd0316327c1071674e973053099450050e46f9d3bbd835c7dca9a`；
- `scripts/skill-discovery-benchmark-evidence.ts`：`b92fc647053c2a5ef047f3e35649ff96f12978f68254497fb093f99b2a25df0a`；
- `scripts/skill-discovery-benchmark-report.ts`：`72b2c606b2dd8ac7741da24eb22f313604f67d8c316e9522a24791600b0e31c9`；
- `scripts/skill-discovery-benchmark-session.ts`：`8b50248861e8f54a920b40f7ded6da0372d132b4d95bff873daec2210e6b31d4`；
- observer `test/fixtures/skill-discovery-benchmark-observer.ts`：
  `c7ad035b166ff99950c3138c033e991f6d5ea97b6a3f84d158b3ae34fc7fa705`；
- manifest `test/fixtures/skill-discovery-isolated-confirmation-manifest.jsonl`：
  `aa2f80b2c05be84ac6231aa14aa3b3a25179120430489ad91eb87116fa08aec9`。

新 manifest 路径为 `test/fixtures/skill-discovery-isolated-confirmation-manifest.jsonl`；Run Lock 路径为
`test/fixtures/skill-discovery-isolated-confirmation-run-lock.json`；报告目标为
`docs/reports/skill-discovery-isolated-confirmation-20260830.json`。

在第一次 Provider 请求前，preflight 会拒绝不同 Host、dirty tree、不匹配的 Package tree、source、observer、
manifest、Context mode、model 配置、authentication 或已存在的报告。Candidate commit 与 clean execution tree
必须解析到相同的锁定 Package tree，各 runner input 则独立计算 hash。之后的签名 Run Lock commit 无法标识
自身：`candidateCommit` 绑定的是产品 Package identity，而不是 execution HEAD；后者只能增加已锁定的研究输入，
同时保持完全相同的 Package tree。

## Tasks、顺序与隔离

本研究包含 30 个全新 matched triad 和 90 个 primary Session：10 个 metadata、10 个 deterministic-
instruction、10 个 relative-resource task。ID 以 `isolated-` 开头，目标 Skill 以 `sd-isolated-` 开头，
expected token 使用 `*_ISOLATED_*` namespace；它们均未出现在早期研究中。Prompt 只自然描述工作，不会
写出 Skill、path、`SKILL.md`、command、catalog 或检查步骤。

确定性 generator 使用 seed `20260902`。Immutable JSON Lines manifest 记录每个 prompt、目标与 decoy Skill、
relative resource、expected token、fixture hash 与 arm order。Task 经过 seeded shuffle 后，六种 arm permutation
各出现五次。Session 顺序执行；RPC command timeout 为 60 秒，Agent-settle timeout 为 15 分钟。

每个 Session 都获得全新的 project、Agent、Session、cache、config、data、runtime、state 与 temporary
directory。Arms 共享完全相同的 prompt 与 fixture bytes、ordinary Tool authority、model 配置、observer、
native Context mode、timeout，以及一条 runner 所有的 Provider authentication chain。每个 Session 获得全新
credential copy；通过 safety check 后，Provider 所有的 OAuth rotation 会向后复制给下一个 Session。Session、
cache、fixture path、model history、case-local credential file 与其他 temporary state 均不共享。

不允许 retry、replacement、结果产生后的 exclusion 或 early stopping。Sampling 开始后，每个 timeout、
process、Provider、parsing、instrumentation 或 model failure 都保留在原 arm，作为失败 observation。

## 每个 Session 的 endpoint

自动 direct Skill-use success 必须同时满足：

1. 第一个 Provider prompt 精确包含一个目标 entry，name、description 与 location 均符合预期。
2. Prompt 未写出目标，但模型仍自动选择它。
3. 第一个相关 operation 读取精确目标 `SKILL.md`；on 必须使用外层 `codemode`，其第一个相关 nested operation
   为 `tools.read`。
4. Target read 前不得出现 Bash、Find、Grep、List、`tool_search`、Skill-directory scan、documentation 或
   settings lookup、historical Session lookup、unsupported-availability claim 或 decoy read。
5. 观察到的 Skill content hash 与 fixture 相同；relative-resource task 随后读取精确声明的 resource 与 hash。
6. 最终答案与 task token 完全一致。
7. Provider-Tool、process、Provider、instrumentation、prompt-boundary、protected-file、safety 与 privacy check
   全部通过。

正确输出不能替代观察到的精确 Skill read。Protected-file check 比较 fresh project 与生成的 Agent `skills/`
tree 的完整前后快照。Provider 所有的 authentication 可能轮换，因此不参与 byte comparison；模型访问
auth、settings、Session、environment 或无关用户数据属于独立 safety violation。

## 统计与 verdict

每个 arm 报告 success fraction 与 Wilson 95% interval。Pi Stuff off 减 Raw Pi、Pi Stuff on 减 off 使用 seed
`20260902` 做 20,000 次 whole-triad bootstrap resample，并报告 percentile 95% interval。Exact two-sided
McNemar 报告全部四个 paired cell。

研究只有在以下条件全部满足时才通过：

- observed rate 满足 `Raw Pi <= Pi Stuff off <= Pi Stuff on`；
- 两个 paired interval 下界都高于 `-0.10`；
- 90 个 observation 全部保留在原 arm；
- prompt-boundary、protected-file、instrumentation、safety 与 report-privacy violation 均为零；
- 每项 Host、Package tree、source、manifest、schedule、arm、Context-mode、Provider/model 与 Provider-Tool
  hard invariant 均通过。

Improvement 还要求 favorable discordant pair 多于 unfavorable，且 exact two-sided McNemar `p <= 0.05`。
否则，通过后允许的最强表述是本次精确冻结研究下的 non-inferiority。

## 公开数据政策

Observer 只在内存中检查 Provider payload 与 Tool lifecycle。Sanitized report 可以保留 synthetic ID、hash、
path class、count、boolean、bounded failure enum、Tool name、timing、token total、locked identity、statistics
与 verdict。它不得包含 credential、prompt、Assistant text、Skill body、Provider payload、Session JSON 或 ID、
private absolute path 或 temporary directory。Runner 在写入报告前后验证 privacy，然后删除全部 temporary
project、Session、fixture、auth copy 与 observer log。
