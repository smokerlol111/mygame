param(
  [Parameter(Mandatory=$true)][ValidateSet('Create','Verify')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$PlanPath,
  [Parameter(Mandatory=$true)][string]$ArchivePath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$plan = Get-Content -LiteralPath $PlanPath -Raw -Encoding UTF8 | ConvertFrom-Json
$archiveAbsolute = [IO.Path]::GetFullPath($ArchivePath)
$rootAbsolute = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\','/')
if (-not $archiveAbsolute.StartsWith($rootAbsolute + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Archive must stay inside the repository.'
}
$zipMode = if ($Mode -eq 'Create') { [IO.Compression.ZipArchiveMode]::Create } else { [IO.Compression.ZipArchiveMode]::Read }
if ($Mode -eq 'Create' -and (Test-Path -LiteralPath $archiveAbsolute)) { throw 'Archive already exists; refusing to overwrite.' }
$zip = [IO.Compression.ZipFile]::Open($archiveAbsolute, $zipMode)
try {
  if ($Mode -eq 'Create') {
    foreach ($file in $plan.files) {
      $source = [IO.Path]::GetFullPath((Join-Path $rootAbsolute $file.source))
      if (-not $source.StartsWith($rootAbsolute + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Source escaped repository.' }
      if ($file.entry.StartsWith('/') -or $file.entry -match '(^|/)\.\.(/|$)' -or $file.entry.Contains('\')) { throw 'Invalid ZIP entry.' }
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $source, $file.entry, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } else {
    if ($zip.Entries.Count -ne $plan.files.Count) { throw 'ZIP entry count mismatch.' }
    $names = @{}
    foreach ($entry in $zip.Entries) {
      if ($names.ContainsKey($entry.FullName)) { throw 'Duplicate ZIP entry.' }
      $names[$entry.FullName] = $entry
    }
    foreach ($file in $plan.files) {
      $entry = $names[$file.entry]
      if (-not $entry -or $entry.Length -ne $file.bytes) { throw ('Missing/truncated entry: ' + $file.entry) }
      $stream = $entry.Open()
      $sha = [Security.Cryptography.SHA256]::Create()
      try { $digest = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
      finally { $sha.Dispose(); $stream.Dispose() }
      if ($digest -ne $file.sha256) { throw ('SHA-256 mismatch: ' + $file.entry) }
    }
  }
} finally { $zip.Dispose() }
Write-Output ($Mode + ': ' + $plan.files.Count + ' ZIP entries')
