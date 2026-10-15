$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:PORT = '3100'
# Configure the public address before starting Node so local host/OBS pages share it.
& tailscale funnel --bg 3100
if ($LASTEXITCODE -ne 0) { throw 'Tailscale Funnel failed to start.' }
$funnelJson = & tailscale funnel status --json
if ($LASTEXITCODE -ne 0) { throw 'Cannot read Tailscale Funnel configuration.' }
$funnel = $funnelJson | ConvertFrom-Json
$publicUrl = $null
foreach ($entry in $funnel.Web.PSObject.Properties) {
    $target = $entry.Value.Handlers.'/'.Proxy
    $allowed = $funnel.AllowFunnel.PSObject.Properties[$entry.Name]
    if ($allowed -and $allowed.Value -and $target -match '^http://(127\.0\.0\.1|localhost):3100/?$') {
        $publicUrl = 'https://' + ($entry.Name -replace ':443$', '')
        break
    }
}
if (-not $publicUrl) { throw 'No public Tailscale Funnel address routes to port 3100.' }
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot '.funnel-url'), $publicUrl, (New-Object System.Text.UTF8Encoding $false))
# Host key: created once in .env; only someone with it can host, manage seasons or read answers.
$envFile = Join-Path $PSScriptRoot '.env'
$hostKey = $env:HOST_KEY
if (-not $hostKey -and (Test-Path -LiteralPath $envFile)) {
    $hostKeyLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^\s*HOST_KEY\s*=\s*\S' } | Select-Object -First 1
    if ($hostKeyLine) { $hostKey = ($hostKeyLine -split '=', 2)[1].Trim().Trim('"', "'") }
}
if (-not $hostKey) {
    $bytes = New-Object byte[] 16
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $hostKey = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    [System.IO.File]::AppendAllText($envFile, "`r`nHOST_KEY=$hostKey`r`n", (New-Object System.Text.UTF8Encoding $false))
}
$listener = $false
try {
    Invoke-WebRequest -Uri 'http://127.0.0.1:3100/health' -UseBasicParsing -TimeoutSec 2 | Out-Null
    $listener = $true
} catch {}
if (-not $listener) {
    Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'server.js' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput "$PSScriptRoot/local-server.log" -RedirectStandardError "$PSScriptRoot/local-server-error.log"
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        try {
            Invoke-WebRequest -Uri 'http://127.0.0.1:3100' -UseBasicParsing -TimeoutSec 2 | Out-Null
            $ready = $true
            break
        } catch {}
    }
    if (-not $ready) { throw 'Game failed to start; check local-server-error.log.' }
}
Write-Host 'Game: http://localhost:3100'
Write-Host "Host (open once in this browser): http://localhost:3100/host?key=$hostKey"
Write-Host "Public game (players and audience): $publicUrl"
