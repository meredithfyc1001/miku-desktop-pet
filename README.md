# Miku 桌宠

「未来有你 2021」Q 版 Miku 的 Windows 透明桌宠。此版本包含 64 段动作、动作图鉴与收藏、桌宠设置、本地待办与碎碎念，以及可选的 Codex 状态联动和额度查询。

## 下载和使用

从 [v0.1.0 Releases](https://github.com/meredithfyc1001/miku-desktop-pet/releases/tag/v0.1.0) 下载 Windows x64 ZIP，完整解压到可写目录，再双击该目录内的 `MikuFilm.exe`。播放组件随包提供。右键 Miku 可以打开动作图鉴、桌宠设置和待办，双击播放已收藏的动作。

Codex 状态联动默认关闭，可从「桌宠设置 → 动作与手感」启用。查看 Codex 额度需要本机已登录的 Codex CLI。碎碎念可以离线使用，也可以在模型设置里填写自己的 OpenAI 兼容接口或 DeepSeek API 配置。

## 代码和素材

此仓库保存启动器、适配源码、测试和动画清单。可运行程序与审核后的 64 段透明动画在 Release ZIP 中。开发版原片、审核记录和上游构建依赖保存在制作工作区，重跑完整素材流水线需要这些输入。

播放适配基于 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，其 MIT 许可见 [LICENSE.dsh-pet](integrations/dsh/runtime/LICENSE.dsh-pet)。Windows 包包含 [Electron v43.3.0](https://github.com/electron/electron/releases/tag/v43.3.0) 及其许可证。角色与造型相关权利归各自权利人所有。

## 开源许可

本项目的原创程序代码采用 [MIT 许可证](LICENSE)。角色形象、图标和动画素材由各自权利人保留权利，MIT 许可仅适用于代码。第三方代码与组件遵循各自随附的许可证。
