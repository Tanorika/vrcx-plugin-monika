param([int]$Port = 39123, [string]$DataDir = '')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $taskRoot
try {
    $monikaArgs = @('server/main.mjs', '--port', $Port)
    if ($DataDir) { $monikaArgs += @('--data-dir', $DataDir) }
    & node @monikaArgs
} finally {
    Pop-Location
}
