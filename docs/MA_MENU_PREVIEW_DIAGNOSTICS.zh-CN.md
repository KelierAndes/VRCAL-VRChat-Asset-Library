# MA 菜单预览报错：先核对调用链，再处理引用

适用版本：1.4.0-preview.16，2026-10-28。本页说明本应用的日志识别和人工排查顺序，不提供自动修改工程或第三方插件的修补程序。

## 这条报错说明了什么

如果 `MissingReferenceException` 提到已销毁的 `ModularAvatarMenuInstaller`，并且同一异常堆栈同时出现 `MenuPreviewGUI…PushMenuInstaller` 和 `ModularAvatarMenuInstallTarget.Visit`，本应用会将其识别为 MA Inspector 菜单预览中的失效引用调用链。

这段调用链说明菜单预览访问了已销毁的 Menu Installer；它不能单独确定引用为什么失效，也不能证明角色构建或上传失败。只有相近的组件名称、普通 `NullReferenceException` 或另一次日志中的调用链，不会套用这个专门结论。

截至 2026-10-28 核对的 MA 官方主分支中，Menu Install Target 的 `Visit` 将其 `installer` 引用交给菜单访问上下文，Inspector 预览随后读取 Installer 的组件与菜单。这与该调用链吻合，是定位预览访问阶段的依据，不是用户实际安装版本或根因的证明。见 [Menu Install Target 源码](https://github.com/bdunderscore/modular-avatar/blob/main/Runtime/ModularAvatarMenuInstallTarget.cs) 与 [MenuPreviewGUI 源码](https://github.com/bdunderscore/modular-avatar/blob/main/Editor/Inspector/Menu/MenuPreviewGUI.cs)。

## 在应用里查看原始线索

1. 在 **改模工作台** 选择对应 Unity 工程，点击 **查看 Unity 报错**。
2. 确认页面的 **当前工程** 和状态为 **已核对工程归属**。未核对、属于其他工程或已过期的日志不作为本工程的新问题展示。
3. 点击 **立即检查**，或等待页面的定时读取。展开 **查看已脱敏的原始报错**，核对异常首行及后续堆栈。
4. 记录在 Unity 中执行的具体操作、对应对象、时间和插件版本。应用显示的是已观察到的日志；旧记录仍在或短时间没有新日志，都不能替代重现检查。

这些中文基础建议在本地生成，不要求开启 AI。若另行开启日志 AI 分析，发送范围及同意开关仍按 [隐私说明](PRIVACY.zh-CN.md) 执行。日志已过滤常见凭据、链接和个人路径，但转发前仍需检查插件输出。

## 建议的人工排查顺序

1. 先保留完整堆栈和触发步骤。解除 Inspector 锁定，选中无关对象，再重新选择菜单对象，观察相同步骤是否产生新报错。这用于排查预览状态，不代表引用已经修复。
2. 若仍能重现，先备份场景与相关 Prefab，保留未保存的改动，再重开工程复测，以区分暂存的预览状态与持久引用问题。不要为此直接丢弃改动或执行 Prefab 的 Apply All。
3. 检查相关 Menu Install Target 的 Installer 是否显示 Missing 或 None。确认对象归属后，通过 MA 的 Select Menu 重新指定有效菜单；只有确认目标已废弃，才考虑移除这个失效目标。不要批量删除 MA 组件或直接修改插件源码。
4. 记录 Unity、MA、NDMF、VRChat SDK 的实际版本，以及发生阶段：选择对象、撤销、删除、构建或上传。按实际版本核对兼容性与发行说明，必要时先在工程副本中通过 VCC 等官方支持的方式更新；升级不是保证修复。
5. 若构建或上传也失败，另外保留该阶段的独立错误与堆栈，不把菜单预览错误直接当作根因。

MA 官方说明将 Menu Install Target 与 Menu Installer 的 Select Menu 功能联系起来，通常无需手动新建目标组件；应核对实际菜单归属再调整。操作参考：[Menu Install Target](https://modular-avatar.nadena.dev/docs/reference/menu-install-target)、[Menu Installer](https://modular-avatar.nadena.dev/docs/reference/menu-installer)。安装与版本操作参考：[官方安装说明](https://modular-avatar.nadena.dev/docs/intro)、[官方升级说明](https://modular-avatar.nadena.dev/docs/upgrading)。这些页面会随上游更新，不能据主分支行号假定你安装的版本。

## 本版改动与验收范围

本应用现在会保留 Unity 已销毁对象提示后的堆栈，堆栈分批到达时继续补充原问题记录，并据完整调用链更新中文建议；重复记录继续合并计数。

已静态核对自有桥 `assets/unity/VRCALMASetup.cs`：它不创建 Menu Install Target，也不写入已有目标的 `installer` 字段；装配会实例化 Prefab、按条件调用 MA 的公开 Setup Outfit 接口，并可能在新建节点添加 Menu Installer。这个核对不能排除作者预设、对象删除／撤销、版本差异或装配步骤之间的交互，不能据此排除与本应用操作相关。

验证使用合成日志，不修改 Unity 工程、场景、Prefab 或第三方 MA 包。**第三方异常尚未在真实工程复现，本版不宣称修复了 MA 的菜单预览异常。** 实际引用修改与效果仍由用户在可恢复副本中确认。

[本版说明](RELEASE_1.4.0-preview.16.zh-CN.md) · [改模工作台](AVATAR_WORKBENCH.zh-CN.md) · [用户协议](USER_AGREEMENT.zh-CN.md)
