# 独立维护精简的网页访问 fork

[English](../../../adr/0003-web-access-fork.md) · 英文为准。

Pi Stuff 需要在开发项目时直接在 Pi 内开展网页研究；维护者不会切换到浏览器筛选搜索结果。在 [#43](https://github.com/jczhang02/pi-stuff/issues/43) 中，维护者选择以 [pi-web-access 0.28.0](https://github.com/nicobailon/pi-web-access/tree/e55f78a6cf28e2ba5013e14c3dd7bb5eef2ac7c5) 为来源独立重写，删除 Curator，首版收敛到搜索、公开文本读取和已存内容查询，并遵循现有 TypeScript/Bun/Effect 规则。保留导入源码及其许可声明并记录来源，但不承诺兼容上游目录、配置或工具接口；后续选择性移植上游修复，不常规合并整个包。这一选择接受移植成本，以缩小功能和维护范围；代码减量来自[已约定的功能裁剪](../web-access.md)，不设行数硬上限或同功能压缩比例。
