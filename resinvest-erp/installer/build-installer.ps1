# Buduje demonstrator i instalator Windows.  Uruchom z katalogu resinvest-erp:
#   powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

node tools/build-demo.mjs
node tools/export-sample-data.mjs

$iscc = @(
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw "Nie znaleziono Inno Setup 6 (ISCC.exe). Pobierz: https://jrsoftware.org/isdl.php" }

& $iscc "installer\ResInvestERP_Demo.iss"
Write-Host "Gotowe: installer\Output\ResInvestERP_Demo_Setup_2.0.0.exe"
