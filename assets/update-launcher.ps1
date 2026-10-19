param([string]$Helper, [string]$Manifest)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Start-Process uses the Windows shell to give the helper an independent lifetime.
# Direct non-detached Node children belong to a job that closes with the old app.
$powershell = [IO.Path]::Combine($env:SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
$plan = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Helper.Contains('"') -or $Manifest.Contains('"') -or $Helper -match '[\x00-\x1f]' -or $Manifest -match '[\x00-\x1f]') { throw 'Invalid helper arguments.' }
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $Helper + '" -Manifest "' + $Manifest + '"'
$helperProcess = Start-Process -FilePath $powershell -ArgumentList $arguments -PassThru -WindowStyle Hidden -ErrorAction Stop
try {
    [Console]::Out.WriteLine((@{token = $plan.token; parentPid = $plan.parentPid; helperPid = $helperProcess.Id} | ConvertTo-Json -Compress))
} finally { $helperProcess.Dispose() }
