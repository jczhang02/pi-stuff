<!-- translation-source: .github/SECURITY.md; translation-source-sha256: abb6efcde0980ef47079f7fd7e005b1336f3c7b9e13580e216187e8cb502b7c4 -->

# 安全策略

## 支持的版本

| Package 版本 | 是否支持 |
| --- | --- |
| `0.3.x` | 是 |
| `< 0.3.0` | 否 |

安全修复只面向当前私有、本地使用的 `0.3.x` Package 系列。Host 兼容性是另一份契约，记录在
[`docs/compatibility.md`](../docs/compatibility.md) 中。

## 报告漏洞

如怀疑存在漏洞，请勿创建公开 issue。请使用本仓库的 GitHub 私密漏洞报告功能：

<https://github.com/jczhang02/pi-stuff/security/advisories/new>

请说明受影响的 Package 或 Runtime Resource、复现步骤、影响及建议的缓解措施。不要包含凭据或无关的
私密数据。

## 信任模型

Pi Extension 以用户的操作系统权限运行。Suite 不增加权限层或命令拦截层。因此，导入与启动纯净性、明确的
Package allowlist、精确开发依赖，以及由用户触发的副作用都属于安全契约。
