# Animated Storybook Producer / 动态绘本制作人

## 中文

**版本：0.1.0** · 自有贡献 Apache-2.0 · `develop` 迭代 / `main` 正式基线。版本与维护规则见 [维护指南](references/maintenance.md)。

一个可独立使用的动画绘本制作技能：从自己的 IP、故事和分镜到完整 pose 素材、豆包配音、双语字幕、原创配乐与 HyperFrames 成片。核心是编排画面、层次、镜头、声音和节奏，而非拆手脚让插画硬动起来。

技能指令与 references 使用英文，本 README 为中英双语。使用者可用中文创作；不内置任何系列角色、作者账号、私有素材或密钥。

**完整制作必需：** 实际提供图像生成能力的 Codex 环境，以及你自己的豆包语音 TTS API Key。安装技能不等于开通这些能力。ASR 按需单独配置。离线技术样例不代表完整创作环境已就绪。

本地安装（在目标工作区运行；不是发布命令）：

```bash
DISABLE_TELEMETRY=1 npx skills add /path/to/animated-storybook-producer --skill animated-storybook-producer --agent codex -y
```

配置的源仓库为 `git@github.com:achaosxyz/animated-storybook-producer.git`；设置 remote 不代表已经推送。只有远端实际发布后才使用远程安装，目前本地安装路径已验证。标准入口是带 YAML `name` / `description` 的 `SKILL.md`，目录名称与 name 一致。脚本依赖另外安装，不靠安装技能隐式执行。

从 [上手说明](references/getting-started.md) 开始，Agent 使用 [技能入口](SKILL.md)。完整安装、参数、限制见 [CLI](references/cli.md)。自己的 IP/审核放在调用方工作区；Skill 的制作文件与交付包统一输出到工作区 `.build/<task-id>/`，不自动管理剧集或归档版本，后续保存由使用方规则决定。不要编辑技能包来保存你的故事或 key。

自有贡献采用 Apache-2.0，第三方材料保留各自许可；许可不代表 Agent 已获上传/发布授权，见 [LICENSE](LICENSE) 与 [来源归属](references/provenance.md)。不自动上传、发布、提交或付费生成。

## English

**Version: 0.1.0** · Apache-2.0 for original contributions · `develop` for iteration / `main` for the stable baseline. See [Maintenance](references/maintenance.md).

A standalone production skill for original animated storybooks: bring your own IP, approve the story and storyboard, then create complete poses, Doubao speech, bilingual captions, optional original music and a HyperFrames review copy. Animate the composition—not detached anatomy.

Instructions and references are English. This README is bilingual; story language belongs to the user. No series identity, creator account, private media or credentials are bundled.

**Full production requires** a Codex environment with an actually available image-generation tool and your own Doubao Speech TTS API key. Installation grants neither. ASR is separately configured when needed. An offline smoke test is not proof of full production readiness.

Install from a local extracted directory using the command above, from the target workspace. The configured source repository is `git@github.com:achaosxyz/animated-storybook-producer.git`. A configured remote does not establish a pushed release; remote installation remains unverified until an authorized release exists. The directory and YAML name match; SKILL.md contains the required name and description. Runtime dependencies are installed explicitly, not through an install hook.

Read [Getting started](references/getting-started.md), the [Skill entry](SKILL.md) and task-specific references. Keep your IP, approvals and keys in your own workspace. The skill produces task work and its review bundle under that workspace’s `.build/<task-id>/`; episode/version archival is the caller’s responsibility. See [CLI](references/cli.md) for executable contracts and limitations.

Original contributions are licensed under Apache-2.0; third-party materials retain their own terms. A license does not authorize the agent to upload or publish; see [LICENSE](LICENSE) and [Provenance](references/provenance.md). Nothing auto-publishes, commits or incurs paid generation.
