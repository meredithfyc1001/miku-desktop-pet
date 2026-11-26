# Miku 桌宠

一款 Windows x64 透明桌宠。「未来有你 2021」有 64 个动作，「交响乐 2020」有 62 个动作。右键选择「切换形象」，下次打开会记住上次的选择。

## 下载与使用

1. 在 [最新 Release](https://github.com/meredithfyc1001/miku-desktop-pet/releases/latest) 下载名称以 `win-x64.zip` 结尾的文件，完整解压到一个可写目录。
2. 双击解压目录中的 `MikuFilm.exe`。Windows 版已包含 Electron 播放组件。
3. 单击 Miku 看互动，拖动可以挪动位置。在右键菜单中选择「动作」分类点播，或在「动作图鉴」中预览和收藏。双击可播放收藏的动作。

交响乐形象默认以提脚站姿待机。在「动作 → 舞台」中可以找到八音盒旋转、两步小华尔兹和画一圈缎带。「画一圈缎带」在身侧画一个金色大圈，5 秒后收回待机。

桌宠还支持本地待办、碎碎念、可选的 Codex 状态联动与额度查询。在「桌宠设置」中可以调整外观、位置和互动偏好。碎碎念支持离线台词，也可填写自己的 DeepSeek 或 OpenAI 兼容模型服务。查看 Codex 额度需要本机已有登录状态。Codex 状态联动默认关闭。

## 从旧版升级

退出旧版，把新版完整解压到新目录。要保留自己的设置、动作收藏、待办及模型配置，可把旧目录中已有的下列文件复制到新版的同一相对位置，再启动新版。模型配置可能包含自己填写的密钥，请只在本机迁移。

- `data-dsh/miku-preferences.json`
- `data-dsh/dsh-pet/main-config.jsonc`、`data-dsh/dsh-pet/pet/miku-config.json`
- `data-dsh/dsh-pet/todos.json`、`data-dsh/dsh-pet/standalone-ai.json`
- `datafilm/settings.xml`（如有，包含启动置顶偏好）

新版的两个形象共用随包提供的 `data-dsh/dsh-pet/pet/miku-animation`。保留新版目录中的这套动画与运行时，即可使用新增动作。

## 源码与开发

本仓库提供启动器、桌宠适配源码、测试、动画制作工具，以及[两个形象的正式动作清单](integrations/dsh/pack/release-animations.json)。清单记录动作名、分类、帧数与 SHA-256。已审核的透明 WebM 和可运行的桌宠随同版本的 [Windows Release](https://github.com/meredithfyc1001/miku-desktop-pet/releases) 分发。角色的原始生成视频与逐次制作记录保存在制作工作区。

下载时可用 `Get-FileHash .\Miku-v0.2.0-win-x64.zip -Algorithm SHA256` 对照同版 Release 中的 `SHA256SUMS.txt`。若要检查动作文件，在与 ZIP 同版本的源码目录中运行以下命令，将路径改为自己解压后包含 `MikuFilm.exe` 的目录。

```powershell
node tools/dsh/verify-release.mjs "D:\Miku"
```

要单独修改启动器，可在 Windows 源码目录执行下面的命令，然后将生成的 `MikuFilm.exe` 放入同版本 Windows 包的副本进行测试。

```powershell
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:winexe /optimize+ /codepage:65001 /out:MikuFilm.exe /reference:System.Windows.Forms.dll /reference:System.Xml.dll /win32icon:assets\Miku.ico tools\dsh\MikuLauncher.cs
```

完整素材生产构建使用 `./build-film.ps1 -Test`。它还需要制作原片、审核记录、已构建的[固定版本 dsh-pet](integrations/dsh/upstream.json)、Node.js 和 `tools/media` 下声明的 FFmpeg 依赖。发布包中的透明成片可用于播放、校验与集成测试。

## 开源许可

本项目的原创程序代码采用 [MIT 许可证](LICENSE)。角色形象、图标和动画素材由各自权利人保留权利，MIT 许可仅适用于代码。播放适配基于 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，其许可见 [LICENSE.dsh-pet](integrations/dsh/runtime/LICENSE.dsh-pet)。Windows 包随附 [Electron v43.3.0](https://github.com/electron/electron/releases/tag/v43.3.0) 及其许可证。
