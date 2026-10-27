# Tray 汉化版（非官方）

Obsidian 社区插件 [Tray](https://github.com/dragonwocky/obsidian-tray) 的简体中文汉化 fork。

- 上游版本：`v0.3.5`（`dragonwocky/obsidian-tray`）
- 许可证：MIT（与上游一致）
- 改动范围：**仅界面文本汉化，未改动任何功能逻辑**

## 汉化范围

| 位置 | 内容 |
| --- | --- |
| 托盘右键菜单 | 快速笔记 / 显示仓库 / 隐藏仓库 / 重启 Obsidian / 关闭仓库 |
| 设置页分组 | 窗口管理、快速笔记 |
| 设置项名称 | 11 项全部汉化 |
| 设置项描述 | 全部汉化，含快捷键与日期格式说明 |
| 输入框占位符 | 示例文本汉化 |
| 命令面板 | 「重启 Obsidian」「关闭仓库」 |

保留英文的部分：控制台日志（`loading`、`cleaning up` 等）。这些不影响使用，且保留原文便于对照上游 issue 排查。

## 安装

1. 先在 Obsidian 里安装官方 Tray 插件：设置 → 第三方插件 → 浏览 → 搜索 `Tray` → 安装并启用
2. 完全退出 Obsidian
3. 把本仓库的 `main.js` 和 `manifest.json` 覆盖到：

   ```
   <你的仓库>/.obsidian/plugins/tray/
   ```

4. 重新打开 Obsidian，托盘菜单与设置页即为中文

## 注意事项

- **不要在社区插件市场对 Tray 点击「更新」**，否则会被覆盖回英文原版。需要升级上游新版本时，得重新套用汉化。
- 插件 `id` 保持为 `tray`，才能覆盖官方安装而不产生两个托盘图标。

## 技术说明

汉化只动了三处结构：

1. 顶部 `ACTION_*` 常量（托盘菜单与命令面板的文案来源）
2. `OPTIONS` 数组，为每个设置项新增 `name` 字段并翻译 `desc`
3. `keyToLabel()` 增加 `name` 参数，优先取中文名，缺省时仍回退到原 camelCase 拆词逻辑

设置项 `desc` 中用于实时预览的 HTML 钩子（`img[data-preview]`、`[data-preview]`）全部原样保留，托盘图标预览、提示文字预览、日期格式预览功能不受影响。

## 许可证

上游为 MIT 许可，本 fork 沿用。原作者版权声明保留在 `main.js` 头部。
