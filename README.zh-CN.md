# 动态绘本制作人

[English](README.md) | 简体中文

**版本：0.1.0** · Apache-2.0 · `develop` 迭代 / `main` 正式基线。版本与维护规则见 [维护指南](references/maintenance.md)。

一个在 Codex 中使用的动画绘本制作技能：从自己的 IP、故事和分镜到完整 pose 素材、豆包配音、双语字幕、原创配乐与 HyperFrames 成片。核心是编排画面、层次、镜头、声音和节奏，而非拆手脚让插画硬动起来。

技能指令与 references 使用英文，README 分为独立的中文与英文版本。使用者可用中文创作；不内置任何系列角色、作者账号、私有素材或密钥。

## 在 Codex 中使用

在具备图像生成能力的 Codex 中使用本技能。配音需提供自己的豆包语音 TTS API Key，ASR 凭据按需配置。Codex 检查运行依赖，并在权限和网络允许时安装。环境配置详见 [上手说明](references/getting-started.md)。

源仓库：`git@github.com:achaosxyz/animated-storybook-producer.git`。

从 [上手说明](references/getting-started.md) 开始，Agent 使用 [技能入口](SKILL.md)。完整安装、参数、限制见 [CLI](references/cli.md)。自己的 IP/审核放在调用方工作区；Skill 的制作文件与交付包统一输出到工作区 `.build/<task-id>/`，不自动管理剧集或归档版本，后续保存由使用方规则决定。不要编辑技能包来保存你的故事或 key。

采用 [Apache-2.0](LICENSE) 许可。
