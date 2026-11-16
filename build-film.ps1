param([switch]$Test,[string]$OutputName='MikuFilm.exe')
$ErrorActionPreference='Stop'
Push-Location -LiteralPath $PSScriptRoot
try {
    node tools/dsh/build-trial.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Miku 视频桌宠构建失败。' }
    if ($Test) {
        node --test tools/dsh/adapter.test.mjs tools/dsh/recover-enclosed-background.test.mjs tools/dsh/pink-floor-shadow.test.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Miku 视频桌宠检查失败。' }
    }
    $framework=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
    $compiler=Join-Path $framework 'csc.exe'
    $exe=Join-Path $PSScriptRoot $OutputName
    & $compiler /nologo /target:winexe /optimize+ /codepage:65001 "/out:$exe" /reference:System.Windows.Forms.dll /reference:System.Xml.dll '/win32icon:assets\Miku.ico' 'tools\dsh\MikuLauncher.cs'
    if ($LASTEXITCODE -ne 0) { throw 'Miku 启动器编译失败。若桌宠正在运行，请先退出再重试。' }
    Write-Output $exe
} finally {
    Pop-Location
}
