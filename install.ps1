param(
    [switch]$Insiders
)

$ErrorActionPreference = "Stop"

$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$packagePath = Join-Path $source "package.json"
$package = Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json
$extensionRoot = if ($Insiders) {
    Join-Path $env:USERPROFILE ".vscode-insiders\extensions"
} else {
    Join-Path $env:USERPROFILE ".vscode\extensions"
}
$targetName = "$($package.publisher).$($package.name)-$($package.version)"
$target = Join-Path $extensionRoot $targetName

New-Item -ItemType Directory -Force -Path $extensionRoot | Out-Null
if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $target | Out-Null
Get-ChildItem -LiteralPath $source -Force |
    Where-Object { $_.Name -ne ".git" -and $_.Name -ne "node_modules" -and $_.Name -notlike "*.vsix" } |
    Copy-Item -Destination $target -Recurse -Force

Write-Host "Installed $targetName to $target"
Write-Host "Reload VS Code window to activate the extension."
