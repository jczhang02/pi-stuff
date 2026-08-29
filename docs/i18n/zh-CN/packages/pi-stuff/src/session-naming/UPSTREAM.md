<!-- translation-source: packages/pi-stuff/src/session-naming/UPSTREAM.md; translation-source-sha256: e453f50ed9e1df67b7d4b6a81370d8dac2e0400836970c88dd204b096fbd035d -->

# 上游来源

- 项目：[`ssdiwu/pi-autoname`](https://github.com/ssdiwu/pi-autoname)
- 已吸收源码提交：`73d25caa9ff33dadfaa8187ad3f7d1495a01cec9`（`main`，获取于 2026-08-24）
- 吸收时最新发布软件包：`pi-autoname@0.6.8`
- 已发布软件包 Git 提交：`6cb20af3fd5a0b766347ba53ab2b015f70ff345b`
- 已发布软件包完整性：`sha512-+fEjRKxBGAqhT4WboA7ZjV2KTxDilZPAG4kAJQV2YxgWRCVpq6MwImGYUitO6mZbtUWl5mjz0BfgePJ2pzG1ow==`
- 版权：Copyright (c) 2025 ssdiwu
- 许可证：MIT；上游许可证保留在[英文 `LICENSE`](../../../../../../../packages/pi-stuff/src/session-naming/LICENSE)。

Pi Stuff 把该分叉作为内部 `session-naming` 能力负责。源码经过改编，并非逐字复制：配置移到合并 Pi Stuff 设置文件；模型调用使用 Pi 当前公开模型注册表；自动运行使用共享直接用户稳定生命周期，并排除子 Agent 会话；状态条目区分强制重新生成和观察到的手动名称；模型回退为选择加入；扩展了有界本地回退与凭据遮盖；上游控制台/文件诊断则替换为 Pi Stuff 诊断和测试。
