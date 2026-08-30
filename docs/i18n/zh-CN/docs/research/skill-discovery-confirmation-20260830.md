<!-- translation-source: docs/research/skill-discovery-confirmation-20260830.md; translation-source-sha256: b4356f9d40f8c54dc71c17235a695ae41ef3a8d85920bb93eb6bc69049191811 -->

# Skill Discovery 真实模型 confirmation 预注册

日期：2026-08-30

状态：已完成并保留；预注册 verdict 为失败。

这是 Bead `ps-1gd` 的新 confirmation study。它不会替换保留的 instrumentation failure
[首次研究](../../../../../docs/research/skill-discovery-benchmark-20260830.md)，也不复用其中任何样本。问题仍是
Pi Stuff 是否保留 Raw Pi 的自动 Skill 使用，以及启用 Code Mode 是否带来进一步退化。

## Confirmation 原因

首次研究向每个 arm 传入 `--tools bash,find,grep,ls,read`。Pi 0.84.4 把 `--tools` 作为覆盖 built-in、
extension 与 custom Tool 的严格 allowlist，因此排除了 on arm 的 `codemode` 与 `tool_search`。每个 on arm 的
首次 Provider 请求因而既没有 Tool，也没有 Skill catalog。本 confirmation 只修正让预期 authority 可达所必需的
Tool-selection 设计，并使用新 seed、task、fixture、manifest、Run Lock 与报告。

## Arms 与 Tool authority

一个精确固定的 Provider/model 配置运行三个配对 arm：

1. **Raw Pi**：认证 Host、confirmation Skills 与只测量 observer；不加载 Pi Stuff。
2. **Pi Stuff off**：输入相同，加载候选 Package，把 Code Mode 冻结为 off。
3. **Pi Stuff on**：输入与候选 Package 相同，把 Code Mode 冻结为 on，并保持虚拟 Read active。

每个 arm 都使用完全相同的严格 allowlist：`bash,find,grep,ls,read,codemode,tool_search`。Raw Pi 不注册最后两个
名称；Pi Stuff off 移除 disabled envelope；Pi Stuff on 把相同的五个 active ordinary Tool 投影到
`codemode` 与 `tool_search` 后。因此首次请求必须精确呈现以下 Provider surface：

- Raw Pi 与 Pi Stuff off：`bash`、`find`、`grep`、`ls`、`read`；
- Pi Stuff on：`codemode`、`tool_search`。

任何额外 surface、缺失 Tool 或缺失 catalog 都是 instrumentation failure，并使 confirmation verdict 失败。
主要比较仍依次为 Pi Stuff off 减 Raw Pi，以及 Pi Stuff on 减 Pi Stuff off。

## Run Lock

结果产生前的 Run Lock 已完成：

- Provider `openai-codex`、model `gpt-5.6-sol`、reasoning `xhigh`。
- Candidate commit `361915932c3a50ffc3d8b2d06108bf289c4f2f3a`；Package tree
  `261e1fb3719913a8ca7ed6f62281de3e122cd34c`。
- Runner source：
  - `scripts/benchmark-skill-discovery.ts`：`53f810d62a600acf59e09e4e5b9ce9a44331521fa1ede67b1f7ba17af603dcbb`；
  - `scripts/pi-rpc-client.ts`：`bad75a34475d04209580df6fc68acda606eab87606cd711ac8b449065509eb1e`；
  - `scripts/skill-discovery-benchmark-core.ts`：`fc9ad5f4875a48d46899ada9cdabe1beb6171609b42cdfd43cd36e25b2d0239d`；
  - `scripts/skill-discovery-benchmark-evidence.ts`：`b92fc647053c2a5ef047f3e35649ff96f12978f68254497fb093f99b2a25df0a`；
  - `scripts/skill-discovery-benchmark-report.ts`：`72b2c606b2dd8ac7741da24eb22f313604f67d8c316e9522a24791600b0e31c9`；
  - `scripts/skill-discovery-benchmark-session.ts`：`2d5a7ea8180c357c89f798f57e1f8d62937c8fbcd9ed0fef785045269e5e16b9`。
- 只测量 observer `test/fixtures/skill-discovery-benchmark-observer.ts`：
  `c7ad035b166ff99950c3138c033e991f6d5ea97b6a3f84d158b3ae34fc7fa705`。
- Immutable manifest `test/fixtures/skill-discovery-confirmation-manifest.jsonl`：
  `6fa006d7df5273ed38a9c0176eb02f19f73a9ade768d4ebf0bf8b5bb5d51ae59`。
- Run Lock `test/fixtures/skill-discovery-confirmation-run-lock.json`。
- Sanitized report 目标 `docs/reports/skill-discovery-confirmation-20260830.json`。

Candidate commit 标识 Package source；更晚的 Run Lock commit 无法自我标识。Preflight 改为要求 candidate 与
clean execution tree 解析到相同 locked Package tree，并独立计算每个可执行 runner input、observer 与 manifest
的 hash。

Host 仍是认证 Pi 0.84.4 Linux x64 Release executable：SHA-256
`ce91e1f8bff6176c6a23a690bd0bc4c6e1f5bee1b1183cd2a3b1e92d88c9038a`，104,511,616 bytes。第一次 Provider
请求前，preflight 会拒绝不同 Host、dirty tree、已存在的报告目标、mismatched source、malformed lock 或不可用
authentication。失败的 preflight 不产生 sample。

## 新 task 与顺序

Confirmation 包含 30 个全新 task triad，共 90 个 primary Session：metadata、deterministic instruction 与
relative-resource 各十个。Task ID 以 `confirm-` 开头；target Skill 名称、自然语言 subject 与 expected token
都不同于首次研究。Prompt 不会写出 Skill、路径、`SKILL.md`、command 或检查 catalog 的指令。

确定性 generator 使用 seed `20260831`。它在 Run Lock 前把每个 prompt、target 与 decoy Skill、relative
resource、expected token、fixture hash 与 arm order 写入一个 immutable JSON Lines manifest。Seeded task
shuffle 后，六种 arm permutation 各出现五次。运行保持 sequential；没有 arm 永远最先执行。

每个 Session 都有全新的 project、Agent、Session、cache、config、data、runtime、state 与 temporary directory。
各 arm 不共享 Session、cache、fixture path、model history 或 mutable authentication copy。它们共享完全相同的
prompt 与 fixture bytes、底层 ordinary Tool authority、model settings、timeout 与 observer。

不存在 retry、replacement、结果产生后的 exclusion 或 early stopping。采样开始后，每个 instrumentation、
process、timeout、Provider、parsing 或 model failure 都作为原 arm 的 failed observation 保留。任何后续运行都
需要另一份预注册，并原样保留本 confirmation。

## 每个 Session 的 measure

Automatic Skill-use success 要求以下条件全部通过：

1. 第一次 Provider prompt 恰好包含一个目标 Skill entry，name、description 与 location 均符合预期。
2. Prompt 未写出目标名称，但模型仍选择目标 Skill。
3. 第一个相关 Tool operation 读取精确 target `SKILL.md`；on 使用外层 `codemode`，其第一个相关 nested
   operation 为 `tools.read`。
4. Target read 前不得出现 Bash、Find、Grep、List、`tool_search`、Skill directory scan、Pi
   documentation/settings lookup、historical Session lookup 或 decoy read。
5. 观察到的 Skill content SHA-256 与 fixture 相同；relative-resource task 随后读取精确声明的 resource。
6. 最终答案与 task token 完全一致。
7. Provider-Tool、instrumentation、process、Provider、prompt-boundary、protected-file 与 privacy check 全部通过。

Protected-file check 比较新建 project 与生成的 Agent `skills/` tree 的完整前后快照，包括意外新增。Provider
所有的 authentication 可能轮换，因此不在比较范围内；模型访问 authentication、settings、Session 或
environment 数据会由独立 safety check 判为违规。

Secondary field 保留 catalog、selection、read、detour、content hash、resource、answer、Provider request、
Tool call、nested operation、timing、token、failure class、safety 与 integrity evidence。正确答案文字不能替代
观察到的精确 Skill read。

## 统计与 verdict

每个 arm 报告 success fraction 与 Wilson 95% interval。两个 paired difference 使用 seed `20260831` 做
20,000 次 whole-triad bootstrap resample，并报告 percentile 95% interval。Exact two-sided McNemar 报告全部
四个 paired cell。

Confirmation 只有在以下条件全部满足时才通过：

- observed rate 满足 `Raw Pi <= Pi Stuff off <= Pi Stuff on`；
- 两个 paired interval 下界都高于 `-0.10`；
- 90 个 observation 全部保留在原 arm；
- prompt-boundary、protected-file、instrumentation-integrity、safety 与 report-privacy violation 均为零；
- 每项 Host、tree、source、manifest、schedule、arm、model 与 Provider-Tool hard invariant 均通过。

Improvement 还要求 favorable discordant pair 多于 unfavorable，且 exact two-sided McNemar `p <= 0.05`。
否则，通过后允许的最强表述是在本次精确冻结研究下 non-inferior。

## 公开数据政策

Observer 只在内存中检查 Provider payload 与 Tool lifecycle。Sanitized report 可以包含 ID、hash、relative path
class、count、boolean、bounded failure enum、Tool name、timing、token total、精确 locked identity、statistics
与 verdict。它不得包含 credential、prompt、Assistant text、Skill body、Provider payload、Session JSON 或 ID、
private absolute path 或 temporary directory。Runner 在写入前后验证报告，然后删除全部 temporary project、
Session、fixture、authentication copy 与 observer log。

## 保留的结果

唯一一次冻结运行完成全部 90 个 Session，没有 retry 或 replacement。Raw Pi 在 30/30 个 task 上成功；Pi Stuff
off 为 29/30，另一个在任何 Provider 请求前 timeout；Pi Stuff on 的 primary success 为 0/30。预注册 verdict
为**失败**。Sanitized report 为
[`skill-discovery-confirmation-20260830.json`](../../../../../docs/reports/skill-discovery-confirmation-20260830.json)，
SHA-256 `fed9cb200d6b2387a627584659aa17fc20762f0616cadf0c544dff670b7c51a9`。

Suite comparison 为 `-0.0333`，bootstrap interval 为 `[-0.10, 0]`。Code Mode comparison 为 `-0.9667`，
interval 为 `[-1, -0.90]`；其 exact McNemar cell 是 0 favorable、29 unfavorable，`p = 3.7253e-9`。同一个
relative-resource task 在 off 与 on 均 timeout，两个 Session 都没有 Provider 请求，因此产生两项
instrumentation 与 prompt-boundary violation，并使 Provider-Tool hard invariant 为 false。Protected-file、
safety 与 report-privacy violation 均为零。

On arm 的 primary rate 需要比 verdict 本身更精确的解释。29 个完成的 on Session 全部看见精确 catalog，自动
选择目标，执行精确的 nested `tools.read`，匹配 Skill 与可选 resource hash，并返回精确答案。但 29 个 Session
都先调用了 `tool_search`，所以全部违反冻结的 no-detour 条件。报告中的 failure class 是 23 个 detour、6 个
process 与 1 个 timeout。6 个 process-class observation 同样保留了完整且正确的 measurement；结果产生后的代码
检查发现，冻结的 RPC close path 在发送 signal 后只检查 `exitCode`，但 Node 对 signal-terminated child 保持
`exitCode` 为 null，并设置 `signalCode`。这些 observation 仍按原报告保留为失败。

因此，本研究证明候选实现恢复了 catalog visibility 与 nested Read path，却没有达到 issue 要求的直接、无 detour
行为门禁。投影后的 Host catalog 使用 ordinary Read Tool 名称，而压缩后的 provider surface 指示通过
`tool_search` 发现 Tool；候选实现没有给出从已选 Skill location 到直接 `codemode` `tools.read` 调用的显式桥接。
修复并测量这个缺口需要新 candidate 与单独预注册的研究。本 confirmation 与报告保持不变。
