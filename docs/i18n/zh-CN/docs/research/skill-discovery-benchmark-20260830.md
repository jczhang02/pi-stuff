<!-- translation-source: docs/research/skill-discovery-benchmark-20260830.md; translation-source-sha256: c9331977c9b5746504934c79f82d142148a5f527a709b98c9034b64f59ae6b34 -->

# Skill Discovery 真实模型 benchmark 预注册

日期：2026-08-30

状态：研究设计已冻结；Run Lock 尚未完成；尚未产生任何 benchmark Session、Provider 请求或结果。

本文档在实现或查看结果前，冻结 Bead `ps-1gd` 的研究设计。该 benchmark 要回答 Pi Stuff 是否保留 Raw Pi
的自动 Skill 使用行为，以及启用代码模式是否带来进一步退化。它是手动认证 benchmark，不属于 CI 或
Capability Contract Acceptance。底层机制的发布门槛仍是确定性测试与经认证的真实 Host 验收。

## 问题与范围

一个精确固定的 Provider/model 配置会运行三个配对 arm：

1. **Raw Pi**：认证 Host、benchmark Skills 与只测量 observer；不加载 Pi Stuff。
2. **Pi Stuff off**：同一 Host、Skills、observer 与候选 Package，并把代码模式冻结为 off。
3. **Pi Stuff on**：输入与候选 Package 相同，把代码模式冻结为 on，并保持虚拟 Read active。

主要比较依次为 Pi Stuff off 减 Raw Pi，以及 Pi Stuff on 减 Pi Stuff off。第一个检测 Suite 层退化；第二个
隔离 Code Mode。本研究不声称结论适用于其他 model、Provider、prompt、task set 或 Host 版本。后续任何
跨模型研究都是独立研究，不能替换本研究样本。

## Run Lock

在一次结果产生前的 amendment 用精确值替换以下每一项之前，不得发起任何 live call：

- Provider、model 与 reasoning 配置：与 `ps-1gd` 受控复现完全相同的精确配置。
- 候选 Package commit 与 tree：两个 Pi Stuff arm 共用一个 clean、immutable tree。
- runner 与只测量 observer 的路径和 SHA-256。
- 已生成 task manifest 的路径和 SHA-256。
- 已清理的报告目标。

Candidate commit 标识 Package source，而不是必然更晚、用于记录 Run Lock 的 commit。为避免自引用 commit
hash，preflight 要求该 commit 与 clean execution tree 都解析到完全相同的 locked Package tree，并独立计算
每个可执行 runner input、observer 与 manifest 的 hash。

Host 已固定为认证 Pi 0.84.4 Linux x64 Release executable：SHA-256
`ce91e1f8bff6176c6a23a690bd0bc4c6e1f5bee1b1183cd2a3b1e92d88c9038a`，104,511,616 bytes。第一次 Provider
请求前，preflight 会拒绝不同的 executable、dirty candidate tree、不匹配的 manifest 或未完成的 Run Lock。
失败的 preflight 不产生 sample 或 outcome。

## 任务与 fixture

固定研究包含 30 个 task triad，因此共有 90 个 primary Session。每个 family 包含十个任务：

1. **Metadata**：匹配 Skill 带有唯一 frontmatter verification token。
2. **Instruction**：匹配 Skill 正文定义获得精确答案所必需的 deterministic transformation。
3. **Relative resource**：匹配 Skill 指示 Agent 读取一个包含精确答案的相对 resource。

每项任务拥有不同的目标 Skill、两个看似合理但不匹配的 decoy Skill、prompt、expected token 与 fixture hash。
同一任务的三个 arm 使用相同 fixture；不同 task ID 绝不复用目标 Skill 或 expected token。Prompt 以自然语言
描述工作，绝不写出 Skill 名称、路径、`SKILL.md`、Skill command 或检查 Skill catalog 的指令。研究对象是
自动选择，而不是显式调用。

确定性 manifest generator 使用 seed `20260830`。Run Lock 关闭前，它把全部 30 个 prompt、Skill file、
relative resource、expected token、fixture hash 与 arm order 写入一个 immutable manifest。在其 hash 记录到
上文之前，不得检查任何 outcome。

## 顺序与隔离

六种 arm permutation 各出现五次。Manifest generator 使用 seed `20260830` 打乱 30 个 task ID，然后分配
每种 permutation 的五个副本。运行保持 sequential；没有 arm 永远最先执行。

每个 Session 都有全新的 project、Agent、Session、cache、data、runtime 与 temporary directory。各 arm
不共享 Session、cache、生成 fixture path 或 model history。它们使用相同 prompt、fixture bytes、Tool
authority、model settings、timeout 与 measurement observer。预期中的 arm 差异只有 Package 是否存在与冻结的
Code Mode 状态。普通 discovery Tool 保持可用，使模型绕路可以被观测，而不是被预先禁止。

不允许 retry、replacement、结果产生后的 exclusion 或 early stopping。如果 authentication 或 provenance
在第一个 Session 前失败，研究状态为 incomplete，且没有 sample。开始采样后，instrumentation、process、
timeout、Provider、parsing 或 model failure 都作为原 arm 中的失败 observation。后续 confirmation study 必须
重新预注册，并原样保留本研究。

## 每个 Session 的 measure

主要二元 outcome 是 **automatic Skill-use success**。只有以下条件全部通过时才通过：

1. 第一次 Provider prompt 恰好包含一个目标 Skill entry，且 name、description 与 location 均符合预期。
2. Prompt 未写出目标名称，但模型仍选择目标 Skill。
3. 第一个相关 Tool operation 在精确 location 读取目标 `SKILL.md`。在 Code Mode arm 中，外层 `codemode`
   call 符合预期，而其第一个相关 nested operation 必须是 `tools.read`。
4. 在该 read 之前，不得出现 Bash、Find、Grep、List、`tool_search`、Skill directory scan、Pi
   documentation/settings lookup、historical Session lookup 或读取 decoy Skill。
5. 观察到的 Skill content SHA-256 与 fixture 相同。Relative-resource task 还必须在 Skill 之后读取精确声明的
   resource。
6. 最终答案与 task token 完全一致。
7. Instrumentation、process、Provider、prompt boundary 与 protected-file check 全部通过。

Protected-file check 会比较新建 project tree 与生成的 Agent `skills/` tree 的完整前后快照，包括任何意外新增。
Provider 所有的 authentication 副本不在比较范围内，因为 OAuth 可能轮换它；模型只要访问 authentication、
settings、Session 或 environment 数据，就会由独立的 safety check 判为违规。

如果没有观察到 Skill read，即使答案正确也算失败。没有证据却声称已加载 Skill 也算失败。完成所需 read 后的
额外调用不会使成功失效，除非违反 safety 或 output contract。

Secondary outcome 只用于描述，绝不替换主要 gate：

- 目标 catalog visibility 与 duplicate count；
- 自动目标选择率；
- direct-read rate 与 detour taxonomy；
- task correctness，包括 unconditional 与 conditional on Skill read；
- Provider request count、Tool 与 nested-operation count、elapsed time 和 total tokens；
- Provider Tool names，包括 Code Mode 中 Package-owned exposure 只能是 `codemode` 与 `tool_search` 的 invariant；
- failure class：catalog、selection、detour、read、resource、answer、safety、instrumentation、process、timeout
  或 Provider。

Disabled、unloaded、`disable-model-invocation`、`--no-skills`、显式 `/skill` 与 custom-prompt 行为继续作为
deterministic regression case，不在结果产生后追加为真实模型任务。

## 统计与 verdict

对于 arm outcome `Y_raw`、`Y_off` 与 `Y_on`，分别报告原始成功 fraction 及 Wilson score 95% interval。
报告以下配对差值：

```text
delta_suite = mean(Y_off - Y_raw)
delta_code  = mean(Y_on  - Y_off)
```

使用固定 seed `20260830` 对完整 triad 进行 20,000 次 bootstrap resample，并报告 percentile 95% interval。
同时报告每项比较的四个 paired cell 与 exact two-sided McNemar result。这些结果只描述该固定 task set，
不是 population guarantee。

只有满足以下全部条件时，预注册 verdict 才通过：

- 观察到的主要成功率满足 `Raw Pi <= Pi Stuff off <= Pi Stuff on`；
- 两个配对 95% interval 的下界都高于 `-0.10`；
- 90 个计划 observation 全部保留在原 arm；
- prompt-boundary、protected-file、instrumentation-integrity 或 report-privacy violation 均为零；
- 每项 Host、tree、manifest、arm 与 Provider-Tool hard invariant 均通过。

`-0.10` uncertainty bound 不表示允许观察到十个百分点的退化：独立的 observed ordering 已禁止任何更低的
候选成功率。只有相关 favorable discordant count 高于 unfavorable count，且 exact two-sided McNemar
`p <= 0.05` 时，才可以声称 improvement。否则，允许的最强表述是“在预注册 Host/model/prompt/fixture/
environment 与 paired gate 下 non-inferior”。

## 观测与公开数据政策

Observer 在内存中检查完整 Provider payload 与 Tool lifecycle，但绝不归档它们。报告只可以包含 arm/task ID、
hash、relative path class、count、boolean、bounded failure enum、Tool name、timing、token total、精确
model/Host/source identity、statistical summary 与最终 verdict。报告不得包含 credential、prompt、Assistant
text、Skill body、Provider payload、Session JSON、Session ID、private absolute path 或 machine-specific
temporary directory。写入并验证 sanitized report 后，删除全部 temporary project、Session、fixture 与 observer
log。
