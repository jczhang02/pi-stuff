<!-- translation-source: packages/pi-stuff/src/ponytail/README.md; translation-source-sha256: ff69957eef0e21f137b9d37960591f3c2b9b63018a57b5a35e61b0ea80f1ed5e -->

# Ponytail

[English](../../../../../../../packages/pi-stuff/src/ponytail/README.md)

帮助当前 Session 选择足够解决问题的最小编码方案。

## 快速开始

```text
/ponytail
/ponytail lite
/ponytail off
/ponytail-review
```

不带参数的 `/ponytail` 打开控制 dialog。`full` 是默认 mode。

## 亮点

- 提供 `off`、`lite`、`full` 与 `ultra` Session mode。
- 在 Session 中保留当前 mode，并把有效 snapshot 传给 child Agent。
- 只在活动时加入紧凑指导和六项 Skill catalog。
- 提供 review、audit、debt、gain 与 help 命令。
- 控制默认 mode、Statusline identity 与启动 notice。
- 先解析环境 override，再读取合并 Pi Stuff 设置。

## 文档

- [Ponytail 指南](../../../../docs/capabilities/ponytail.md)
- [命令参考](../../../../docs/reference/commands.md#ponytail)
- [设置参考](../../../../docs/reference/settings.md#ponytail)
- [上游参考](UPSTREAM.md)

