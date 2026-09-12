# 优先使用宿主管理的 API Key 存储

[English](../../../adr/0004-host-api-key-storage.md) · 英文为准.

Pi Stuff 优先通过 Pi 管理的 `auth.json` 持久保存 API Key, 不把秘密加入普通 `pi-stuff.json` 设置, 也不另建凭据文件. 这样可以让普通配置与秘密分开备份, 并复用宿主认证生命周期. 维护者已在 [Exa 认证修订](https://github.com/jczhang02/pi-stuff/issues/45#issuecomment-5644351201)中接受这一取舍.

Exa 沿用宿主 helper 的顺序: **已保存凭据优先于 `EXA_API_KEY`**. 仍可仅使用环境变量, 但认证被拒绝时不能静默换另一个 Key 重试. Exa 仅注册认证能力, 不提供聊天模型或流实现; 后续搜索通过宿主解析所需凭据, 无须 `/reload`. OpenAI/Codex 继续使用既有宿主认证, 本决策不为它们另设统一的凭据优先级链.

仅支持环境变量会把持久化交给 shell 或启动器配置; 把 Key 混入普通设置会增加 Git/云备份负担; Pi Stuff 自建存储则重复宿主职责. 复用宿主避免了这些成本, 但也继承其限制: `auth.json` 是明文, 属主专用权限不是加密或同用户隔离, 秘密仍需排除普通同步并单独保护备份. 登录、退出及特定版本的宿主限制见[网页访问](../web-access.md); Pi Stuff 不替换宿主登录界面.
