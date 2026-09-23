# AutoName 原生 UI 原型

[English](../../autoname-native-prototype.md)

这个临时分支从当前 AutoName 实现 `2e9aa1e` 创建, 用来评估一种方案: 保留首页的信息顺序, 由 Pi 组件负责交互. 这不是产品迁移, 也没有修改 `design.md`.

## 启动与体验

在此 worktree 中运行, 需要 Bun 1.4.0 和位于 `/opt/bin/pi` 的编译版 Pi 0.87.1:

```sh
bun run tui run autoname-native-review -- bun tools/autoname-native.prototype.ts
```

输入 `Research OAuth provider compatibility.`, 再输入 `/autoname panel`. 可以打开 Settings, 搜索设置项, 编辑规则或最大长度, 选择模型, 取消重置, 使用 Ctrl-C 或 Esc 返回. Generate name 使用固定样例 `research: Compare OAuth provider compatibility`. `/quit` 退出宿主并清理临时目录. `PI_NATIVE_HOST` 可指定其他宿主路径, `PI_NATIVE_THEME=light` 可选择浅色主题.

启动器将设置、会话和认证隔离在临时目录中, 由本地服务返回固定对话. 设置修改只在当前扩展实例中有效. 模型选择和命名规则不会影响固定生成的名称. Automatic naming 仅作为设置展示, 原型不包含自动命名生命周期. 根入口只加载此原型, 不加载其他产品扩展.

## 原生组件边界

首页使用 `SelectList`, 设置和模型搜索使用 `SettingsList`. 一个小型 `Container` 组合边框和文字, 将输入转发给列表. 规则编辑、数值输入和重置确认分别使用 `ctx.ui.editor`、`ctx.ui.input` 和 `ctx.ui.confirm`. 没有自定义取消按键处理.

取消操作跟随 Pi 的 `tui.select.cancel` 绑定. 这与当前产品设计的固定 Esc 规则不同, 是本次原型要评估的差异, 尚未采纳为产品规则. 模型页采用原生可搜索设置列表; Pi 完整模型选择器需要扩展上下文不提供的运行时依赖, 此处没有使用它.

## 实际观察

通过 Terminal Control 操作真实编译宿主, 已验证首页、设置页、编辑器的 Ctrl-C 取消, Esc 返回, 设置搜索与开关, 模型筛选与选择, 规则提交, 最大长度编辑, 重置取消与确认, 静默生成样例名称, 以及返回主编辑器后的焦点. 深色截图为 100 × 32 字符, 浅色截图为 60 × 28 字符. 60 列时原生首页列表会截短说明. 尚未操作验证自定义按键重映射、鼠标和外部编辑器启动.

以下为真实终端单元格截图, 使用 JetBrainsMono Nerd Font Mono、Symbols Nerd Font Mono 和 LXGW WenKai Mono 渲染. 栅格化前按主题设置了默认前景色和背景色. 截图不证明桌面合成器或宿主字体行为.

![首页](../../assets/autoname-native-prototype/home.png)

![设置](../../assets/autoname-native-prototype/settings.png)

![原生规则编辑器](../../assets/autoname-native-prototype/rules.png)

![60 列浅色主题](../../assets/autoname-native-prototype/light-narrow.png)

独立只读代码审查未发现阻断问题. `bun run check` 和 `git diff --check` 通过. 审查者的隔离检查还验证了启动器保留子进程成功或失败的退出码, 并清理临时目录. 产品命名质量、持久化和自动触发时机不在此次 UI 原型范围内.
