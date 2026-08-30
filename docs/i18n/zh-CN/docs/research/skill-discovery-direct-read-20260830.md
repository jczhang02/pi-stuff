<!-- translation-source: docs/research/skill-discovery-direct-read-20260830.md; translation-source-sha256: 873bd26a7baf9def4c990c2b6d8c5b04d3dfb302e9c640fce25b50e27fdcf896 -->

# Skill Discovery 直接读取真实模型预注册

日期：2026-08-30

状态：研究设计与 Run Lock 已冻结；尚未产生 direct-read Session、Provider 请求或结果。

这是 Bead `ps-1gd` 的全新独立研究。它不会替换或复用已保留的
[首次 benchmark](../../../../../docs/research/skill-discovery-benchmark-20260830.md)与
[confirmation](../../../../../docs/research/skill-discovery-confirmation-20260830.md)中的样本。它检验 Code Mode
虚拟化 Read 后，最终候选实现是否仍保留自动、直接的 Skill 选择与加载。

## 本研究的原因

首次 benchmark 通过 Pi 的严格 `--tools` allowlist 意外排除了 `codemode` 与 `tool_search`。Confirmation 修正
了该 surface 并完成 90 个 Session。在其中 29 个完成的 on-arm Session 里，模型全部看见精确 Skill catalog，
选择并读取精确目标，匹配其内容与可选 resource hash，并返回精确答案。但每个 Session 都先调用了
`tool_search`，所以全部违反已冻结的 direct-read gate。另外 6 个 Session 因 RPC close helper 把 signal-
terminated child 当作仍在运行，而收到结果产生后的 process flag。

新候选实现只做上述保留证据支持的两个修复：

1. Code Mode Skill 投影把 Pi 的 ordinary Read 表述桥接到直接的 `codemode` `tools.read` 调用，并明确已知 Read
   method 无需 `tool_search` 或扫描。
2. 共享 RPC helper 把 exit code 或 signal code 任一存在都视为 terminal。

严格行为 endpoint 不变。全新的 task identity、prompt、Skill name、token、fixture、seed、manifest、Run Lock
与报告避免复用结果或按结果调参。

## Arms 与 Tool authority

一个精确 Provider/model 配置运行三个 matched arm：

1. **Raw Pi**：认证 Host、研究 Skill 与只测量 observer；不加载 Pi Stuff。
2. **Pi Stuff off**：输入相同，加载候选 Package，把 Code Mode 冻结为 off。
3. **Pi Stuff on**：输入与候选 Package 相同，把 Code Mode 冻结为 on，并保持 virtual Read active。

每个 arm 使用相同的严格 allowlist：`bash,find,grep,ls,read,codemode,tool_search`。要求的 Provider surface
仍精确为：

- Raw Pi 与 Pi Stuff off：`bash`、`find`、`grep`、`ls`、`read`；
- Pi Stuff on：`codemode`、`tool_search`。

Raw Pi 忽略两个未注册的 Code Mode 名称；Pi Stuff off 移除 disabled envelope；Pi Stuff on 把相同的五个
ordinary Tool 投影到双 Tool envelope 后。Tool 缺失或多出、catalog 缺失或 Provider boundary 无效都属于
instrumentation failure。

## Run Lock

结果产生前的 Run Lock 已完成：

- Provider `openai-codex`、model `gpt-5.6-sol`、reasoning `xhigh`。
- Candidate commit `518af59db690bd7751ae6e08db9a6750fa411894`；Package tree
  `8d9d7220f39f49fb25d7b7ccb9282b75aedf1c15`。
- Runner source：
  - `scripts/benchmark-skill-discovery.ts`：`263670606ce48c8f1ac63575a5a7efeb529f0c43b1c530282eb242399859a101`；
  - `scripts/pi-rpc-client.ts`：`75182f6d2a3cbf3a4369921e94063ef6153eacb95dc683397d95b1d943e09eff`；
  - `scripts/skill-discovery-benchmark-core.ts`：`44ecc6df41d951a5f73401509169688147085cdbd4b9e7e45dc6ebe47346a8b9`；
  - `scripts/skill-discovery-benchmark-evidence.ts`：`b92fc647053c2a5ef047f3e35649ff96f12978f68254497fb093f99b2a25df0a`；
  - `scripts/skill-discovery-benchmark-report.ts`：`72b2c606b2dd8ac7741da24eb22f313604f67d8c316e9522a24791600b0e31c9`；
  - `scripts/skill-discovery-benchmark-session.ts`：`2d5a7ea8180c357c89f798f57e1f8d62937c8fbcd9ed0fef785045269e5e16b9`。
- 只测量 observer `test/fixtures/skill-discovery-benchmark-observer.ts`：
  `c7ad035b166ff99950c3138c033e991f6d5ea97b6a3f84d158b3ae34fc7fa705`。
- Immutable manifest `test/fixtures/skill-discovery-direct-read-manifest.jsonl`：
  `d4a6d02e3c0b9cbb5501bd8e0ac9b6d508de2ab947a6472d101acee28c5b93c1`。
- Run Lock `test/fixtures/skill-discovery-direct-read-run-lock.json`。
- Sanitized report 目标 `docs/reports/skill-discovery-direct-read-20260830.json`。

Host 仍是认证 Pi 0.84.4 Linux x64 Release executable：SHA-256
`ce91e1f8bff6176c6a23a690bd0bc4c6e1f5bee1b1183cd2a3b1e92d88c9038a`，104,511,616 bytes。第一次 Provider
请求前，preflight 会拒绝不同 Host、dirty tree、mismatched Package tree、source、observer、manifest、model
configuration、authentication 或已存在报告。更晚的 Run Lock commit 无法自我标识，因此 candidate commit 与
clean execution tree 必须解析为相同 locked Package tree，同时独立 hash 每个 runner input。

当前 HEAD 的 runner 与确定性 generator 只负责本研究。每个已保留的早期研究都绑定到各自的 signed Run Lock
commit 与精确 runner-source hash，并从该 commit 重建，而不是把当前 study generator 当作 backward-compatible
multi-study API。

## Task、顺序与隔离

本研究包含 30 个全新 matched triad，共 90 个 primary Session：metadata、deterministic-instruction 与
relative-resource 各十个。ID 以 `direct-` 开头，target Skill 以 `sd-direct-` 开头，expected token 使用
`*_DIRECT_*` namespace；此前研究均未使用。Prompt 只自然描述任务，不写出 Skill、路径、`SKILL.md`、command、
catalog 或检查步骤。

确定性 generator 使用 seed `20260901`。Immutable JSON Lines manifest 记录全部 prompt、target 与 decoy Skill、
relative resource、expected token、fixture hash 与 arm order。Seeded task shuffle 后六种 arm permutation 各出现
五次。Session 串行运行，command timeout 为 60 秒，Agent-settle timeout 为 15 分钟。

每个 Session 都有全新的 project、Agent、Session、cache、config、data、runtime、state 与 temporary directory。
各 arm 共享精确 prompt 与 fixture bytes、ordinary Tool authority、model configuration、observer 与 timeout，
但不共享 Session、cache、fixture path、model history、mutable authentication copy 或 temporary state。

不存在 retry、replacement、结果产生后的 exclusion 或 early stopping。采样开始后，每个 timeout、process、
Provider、parsing、instrumentation 或 model failure 都作为原 arm 的失败 observation 保留。

## 每个 Session 的 endpoint

Automatic direct Skill-use success 要求以下条件全部成立：

1. 第一次 Provider prompt 恰好包含一个目标 entry，其 name、description 与 location 均符合预期。
2. Prompt 未写出目标，但模型仍自动选择它。
3. 第一个相关 operation 读取精确目标 `SKILL.md`；on 必须使用外层 `codemode`，其第一个相关 nested operation
   为 `tools.read`。
4. Target read 前不得出现 Bash、Find、Grep、List、`tool_search`、Skill-directory scan、documentation 或
   settings lookup、historical Session lookup、unsupported-availability claim 或 decoy read。
5. 观察到的 Skill content hash 与 fixture 相同；relative-resource task 随后读取精确声明的 resource 与 hash。
6. 最终答案与 task token 完全一致。
7. Provider-Tool、process、Provider、instrumentation、prompt-boundary、protected-file、safety 与 privacy check
   全部通过。

Protected-file check 比较全新 project 与生成的 Agent `skills/` tree 的完整前后快照。Provider 所有的
authentication 可能轮换，因此不参与 byte comparison；模型访问 auth、settings、Session、environment 或
无关用户数据属于独立 safety violation。正确输出不能替代观察到的精确 Skill read。

## 统计与 verdict

每个 arm 报告 success fraction 与 Wilson 95% interval。Pi Stuff off 减 Raw Pi、Pi Stuff on 减 off 使用 seed
`20260901` 做 20,000 次 whole-triad bootstrap resample，并报告 percentile 95% interval。Exact two-sided
McNemar 报告全部四个 paired cell。

研究只有在以下条件全部满足时才通过：

- observed rate 满足 `Raw Pi <= Pi Stuff off <= Pi Stuff on`；
- 两个 paired interval 下界都高于 `-0.10`；
- 90 个 observation 全部保留在原 arm；
- prompt-boundary、protected-file、instrumentation、safety 与 report-privacy violation 均为零；
- 每项 Host、Package tree、source、manifest、schedule、arm、Provider/model 与 Provider-Tool hard invariant 均通过。

Improvement 还要求 favorable discordant pair 多于 unfavorable，且 exact two-sided McNemar `p <= 0.05`。
否则，通过后允许的最强表述是本次精确冻结研究下的 non-inferiority。

## 公开数据政策

Observer 只在内存中检查 Provider payload 与 Tool lifecycle。Sanitized report 可以保留 synthetic ID、hash、path
class、count、boolean、bounded failure enum、Tool name、timing、token total、locked identity、statistics 与
verdict。它不得包含 credential、prompt、Assistant text、Skill body、Provider payload、Session JSON 或 ID、
private absolute path 或 temporary directory。Runner 在写入报告前后验证 privacy，然后删除全部 temporary
project、Session、fixture、auth copy 与 observer log。
