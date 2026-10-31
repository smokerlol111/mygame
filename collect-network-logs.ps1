# Read-only service diagnostics. Writes only a new output folder and ZIP archive.
# Run from an Administrator PowerShell. Does not read .env/state/key/config files.
[CmdletBinding()]
param(
    [DateTimeOffset]$IncidentTime = [DateTimeOffset]::Parse('2026-10-30T22:00:00+02:00'),
    [ValidateRange(1, 180)][int]$WindowMinutes = 30,
    [string]$OutputDirectory
)

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Open PowerShell as Administrator and run this script again.'
}

$ErrorActionPreference = 'Stop'
$caseStart = $IncidentTime.AddMinutes(-$WindowMinutes)
$caseEnd = $IncidentTime.AddMinutes($WindowMinutes)
if (-not $OutputDirectory) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    if (-not $desktop) { $desktop = $env:TEMP }
    $OutputDirectory = Join-Path $desktop ('smokerlol-network-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 6))
}
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Output directory already exists; choose a new directory.' }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$errorsPath = Join-Path $OutputDirectory 'collection-errors.txt'
$inventory = New-Object System.Collections.Generic.List[object]

@(
    'Incident time: ' + $IncidentTime.ToString('o')
    'Window start UTC: ' + $caseStart.UtcDateTime.ToString('o')
    'Window end UTC: ' + $caseEnd.UtcDateTime.ToString('o')
    'Collected UTC: ' + [DateTime]::UtcNow.ToString('o')
    'Windows timezone: ' + [TimeZoneInfo]::Local.Id
    'Log files are copied whole to preserve rotated files spanning the incident.'
    'Current diagnostics do not establish the cause of the historical outage.'
    'No .env, state, keys, auth files, config files or process command lines collected.'
) | Set-Content -LiteralPath (Join-Path $OutputDirectory 'collection-info.txt') -Encoding UTF8

function Copy-DiagnosticLog([System.IO.FileInfo]$File, [string]$Group) {
    $target = Join-Path $OutputDirectory $Group
    if (-not (Test-Path -LiteralPath $target)) { New-Item -ItemType Directory -Path $target | Out-Null }
    try {
        Copy-Item -LiteralPath $File.FullName -Destination (Join-Path $target $File.Name)
        $inventory.Add([pscustomobject]@{ Group=$Group; Name=$File.Name; Bytes=$File.Length; LastWriteUTC=$File.LastWriteTimeUtc.ToString('o') })
    } catch { ($File.FullName + ': ' + $_.Exception.Message) | Add-Content -LiteralPath $errorsPath -Encoding UTF8 }
}

# Only text log files in the service log directory; never copy the ProgramData root.
Write-Host 'Collecting Tailscale and quiz text logs...'
$serviceLogs = Join-Path $env:ProgramData 'Tailscale\Logs'
if (Test-Path -LiteralPath $serviceLogs) {
    Get-ChildItem -LiteralPath $serviceLogs -File |
        Where-Object { ($_.Extension -in @('.txt', '.log')) -and $_.Name -notmatch '(?i)(config|state|secret|\.conf|env)' -and $_.LastWriteTimeUtc -ge $caseStart.UtcDateTime } |
        ForEach-Object { Copy-DiagnosticLog $_ 'tailscale-service' }
}
foreach ($root in @(
    @{ Path=(Join-Path $env:ProgramData 'Tailscale'); Group='tailscale-root' },
    @{ Path='C:\Users\user\AppData\Local\Tailscale'; Group='tailscale-user' }
)) {
    if (-not (Test-Path -LiteralPath $root.Path)) { continue }
    Get-ChildItem -LiteralPath $root.Path -File |
        Where-Object { $_.Name -match '^(tailscaled|tailscale-ipn)\.log[0-9]*\.txt$' -and $_.LastWriteTimeUtc -ge $caseStart.UtcDateTime } |
        ForEach-Object { Copy-DiagnosticLog $_ $root.Group }
}
foreach ($name in @('local-server.log', 'local-server-error.log')) {
    $file = Join-Path $PSScriptRoot $name
    if (Test-Path -LiteralPath $file) { Copy-DiagnosticLog (Get-Item -LiteralPath $file) 'quiz-server' }
}
$inventory | Export-Csv -LiteralPath (Join-Path $OutputDirectory 'file-inventory.csv') -NoTypeInformation -Encoding UTF8

Write-Host 'Exporting Windows events for the incident window...'
foreach ($logName in @('System', 'Application', 'Microsoft-Windows-WLAN-AutoConfig/Operational', 'Microsoft-Windows-NetworkProfile/Operational')) {
    $target = Join-Path $OutputDirectory ('windows-' + ($logName -replace '[^a-zA-Z0-9-]', '_') + '.txt')
    try {
        Get-WinEvent -FilterHashtable @{LogName=$logName; StartTime=$caseStart.LocalDateTime; EndTime=$caseEnd.LocalDateTime} -ErrorAction Stop |
            Sort-Object TimeCreated |
            Select-Object @{Name='TimeUTC';Expression={$_.TimeCreated.ToUniversalTime().ToString('o')}}, Id, LevelDisplayName, ProviderName, Message |
            Format-List | Out-File -LiteralPath $target -Encoding UTF8 -Width 240
    } catch { $_.Exception.Message | Set-Content -LiteralPath $target -Encoding UTF8 }
}

$current = Join-Path $OutputDirectory 'current-state.txt'
Write-Host 'Recording current Tailscale state (not historical evidence)...'
foreach ($arguments in @(@('version'), @('funnel', 'status'), @('netcheck'))) {
    try { & tailscale @arguments 2>&1 | Out-File -LiteralPath $current -Append -Encoding UTF8 -Width 240 }
    catch { $_.Exception.Message | Add-Content -LiteralPath $errorsPath -Encoding UTF8 }
}
Get-Process node, tailscaled -ErrorAction SilentlyContinue |
    Select-Object Name, Id, StartTime, CPU, WorkingSet64 | Format-Table -AutoSize |
    Out-File -LiteralPath $current -Append -Encoding UTF8 -Width 240
Get-Service -Name '*tailscale*' -ErrorAction SilentlyContinue |
    Select-Object Name, Status, StartType | Format-Table -AutoSize |
    Out-File -LiteralPath $current -Append -Encoding UTF8 -Width 240

$zip = $OutputDirectory + '.zip'
Write-Host 'Creating ZIP archive...'
Compress-Archive -LiteralPath $OutputDirectory -DestinationPath $zip -CompressionLevel Optimal
Write-Host ''
Write-Host ('Archive ready: ' + $zip)
Write-Host 'Send this ZIP archive for review. Services and configuration were not changed.'
