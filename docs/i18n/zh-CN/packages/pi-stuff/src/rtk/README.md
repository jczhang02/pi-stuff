<!-- translation-source: packages/pi-stuff/src/rtk/README.md; translation-source-sha256: 3481b1564130c9b02638c48ee85516477e1e4ad8f597a4c9a83055d594429b73 -->

# RTK

[English](../../../../../../../packages/pi-stuff/src/rtk/README.md)

为 Bash 与 Grep 提供可选命令改写和只面向 model 的输出投影。

<p align="center">
  <a href="../../../../../../assets/readme/capabilities/rtk.png">
    <img src="../../../../../../assets/readme/capabilities/rtk.png" alt="Pi 中的 RTK 验证与改写控制" width="100%">
  </a>
  <br>
  <em>RTK 对话框分别展示 runtime 验证、改写策略和 Session 节省量。</em>
</p>

## 快速开始

把已认证 RTK `0.45.0` Linux x64 binary 安装到 `PATH`，然后打开：

```text
/rtk
```

Dialog 验证 runtime、切换 Command rewriting 与 Model projection，并显示当前 Session savings。

## 亮点

- 第一次使用时验证官方版本与 executable SHA-256。
- 每次 rewrite 前重新检查 runtime identity，并检测 binary drift。
- RTK 不可用时保留原 Bash 命令。
- 投影紧凑的成功 Bash 与 Grep 文字，不改变 Session JSONL。
- 分别配置 rewriting 与 projection。
- 对 runtime probe、rewrite、投影输出和 savings statistic 设定上限。

## 文档

- [RTK 指南](../../../../docs/capabilities/rtk.md)
- [设置参考](../../../../docs/reference/settings.md#rtk)
- [故障排查](../../../../docs/troubleshooting.md#rtk)
- [上游参考](UPSTREAM.md)
