param([string]$Manifest)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-VrcAbsolutePath([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value -match '[\x00-\x1f]' -or $Value -notmatch '^[A-Za-z]:[\\/][^:]*$') { throw 'Update path must be an absolute local drive path.' }
    $resolved = [IO.Path]::GetFullPath($Value)
    if ($resolved -match '(^|[\\/])[^\\/]*[. ]([\\/]|$)') { throw 'Ambiguous update path.' }
    return $resolved
}
function Test-VrcWithin([string]$Value, [string]$Root) {
    $prefix = $Root.TrimEnd('\', '/')
    return $Value.Equals($prefix, [StringComparison]::OrdinalIgnoreCase) -or $Value.StartsWith($prefix + '\', [StringComparison]::OrdinalIgnoreCase)
}
function Assert-VrcNoLinks([string]$Value) {
    $current = Get-VrcAbsolutePath $Value
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $entry = Get-Item -LiteralPath $current -Force
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Update paths cannot contain links or junctions.' }
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if ($parent -eq $current) { break }
        $current = $parent
    }
}
function Assert-VrcWritePath([string]$Value, $Plan) {
    $resolved = Get-VrcAbsolutePath $Value
    Assert-VrcNoLinks $resolved
    foreach ($root in $Plan.protectedRoots) {
        $protected = Get-VrcAbsolutePath ([string]$root)
        Assert-VrcNoLinks $protected
        if (Test-VrcWithin $resolved $protected) { throw 'Material directories are protected from updates.' }
    }
    return $resolved
}
function Get-VrcSha256([string]$File) {
    $stream = [IO.File]::Open($File, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}
function Assert-VrcFile([string]$File, [long]$Size, [string]$Sha256) {
    Assert-VrcNoLinks $File
    $entry = Get-Item -LiteralPath $File -Force
    if ($entry.PSIsContainer -or $entry.Length -ne $Size -or (Get-VrcSha256 $File) -ne $Sha256) { throw 'Update file size or SHA-256 verification failed.' }
}
function Assert-VrcExecutable([string]$File) {
    $stream = [IO.File]::Open($File, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        $header = New-Object byte[] 64
        if ($stream.Read($header, 0, 64) -ne 64 -or $header[0] -ne 77 -or $header[1] -ne 90) { throw 'Invalid Windows executable.' }
        $offset = [BitConverter]::ToUInt32($header, 60)
        if ($offset -lt 64 -or $offset -gt 16777216 -or $offset + 4 -gt $stream.Length) { throw 'Invalid Windows executable header.' }
        $stream.Position = $offset
        $signature = New-Object byte[] 4
        if ($stream.Read($signature, 0, 4) -ne 4 -or $signature[0] -ne 80 -or $signature[1] -ne 69 -or $signature[2] -ne 0 -or $signature[3] -ne 0) { throw 'Invalid Windows executable signature.' }
    } finally { $stream.Dispose() }
}
function Read-VrcUpdatePlan([string]$ManifestPath) {
    $manifestFile = Get-VrcAbsolutePath $ManifestPath
    Assert-VrcNoLinks $manifestFile
    $manifestInfo = Get-Item -LiteralPath $manifestFile -Force
    if ($manifestInfo.PSIsContainer -or $manifestInfo.Length -gt 131072) { throw 'Invalid update manifest.' }
    $plan = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($plan.schema -ne 1 -or $plan.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$' -or $plan.token -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' -or $plan.sha256 -notmatch '^[a-f0-9]{64}$' -or $plan.expectedTargetSha256 -notmatch '^[a-f0-9]{64}$' -or $plan.size -lt 512 -or $plan.size -gt 1073741824 -or $plan.expectedTargetSize -lt 512 -or $plan.expectedTargetSize -gt 1073741824 -or $plan.parentPid -lt 1 -or $plan.parentPid -gt 2147483647 -or $plan.parentPid -eq $PID -or $plan.protectedRoots -isnot [Array]) { throw 'Invalid update manifest fields.' }
    $data = Assert-VrcWritePath ([string]$plan.dataDir) $plan
    $stage = Assert-VrcWritePath ([string]$plan.stageDir) $plan
    $target = Assert-VrcWritePath ([string]$plan.target) $plan
    $staged = Assert-VrcWritePath ([string]$plan.staged) $plan
    $expectedStage = [IO.Path]::Combine($data, 'updates', [string]$plan.token)
    if ($stage -ne $expectedStage -or $manifestFile -ne [IO.Path]::Combine($stage, 'install.json') -or $staged -ne [IO.Path]::Combine($stage, 'update.exe') -or [IO.Path]::GetExtension($target) -ne '.exe' -or [string]::IsNullOrWhiteSpace($env:PORTABLE_EXECUTABLE_FILE) -or $target -ne (Get-VrcAbsolutePath $env:PORTABLE_EXECUTABLE_FILE) -or (Test-VrcWithin $target $stage)) { throw 'Update target is not the current portable launcher.' }
    Assert-VrcFile $staged $plan.size $plan.sha256
    Assert-VrcExecutable $staged
    Assert-VrcFile $target $plan.expectedTargetSize $plan.expectedTargetSha256
    $plan.target = $target
    $plan.staged = $staged
    $plan.stageDir = $stage
    $plan.dataDir = $data
    return $plan
}
function Write-VrcUpdateResult($Plan, [string]$Status, [string]$Message) {
    $result = Assert-VrcWritePath ([IO.Path]::Combine([string]$Plan.stageDir, 'result.json')) $Plan
    @{status = $Status; message = $Message; at = [DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $result -Encoding UTF8
}
function Get-VrcLiveProcess($Identity) {
    $process = Get-Process -Id $Identity.id -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    try {
        # Open a process handle before checking its creation time. Kill will use this handle,
        # so a subsequently reused PID can never select an unrelated process.
        $null = $process.Handle
        if ($process.HasExited -or $process.StartTime.ToUniversalTime().Ticks -ne $Identity.startedAt -or $process.Path -ne $Identity.path) { $process.Dispose(); return $null }
        return $process
    } catch { $process.Dispose(); return $null }
}
function New-VrcProcessTracker($Launcher, $Plan) {
    $null = $Launcher.Handle
    if ($Launcher.HasExited -or $Launcher.Path -ne $Plan.target) { throw 'The updated launcher exited before startup was confirmed.' }
    $root = @{id = [int]$Launcher.Id; startedAt = $Launcher.StartTime.ToUniversalTime().Ticks; path = [string]$Launcher.Path; parentId = 0; depth = 0; taskOwned = $true}
    $members = @{}
    $members[[string]$root.id] = $root
    return @{root = $root; members = $members; launchedAt = [DateTime]::UtcNow; token = [string]$Plan.token}
}
function Update-VrcProcessTracker($Tracker) {
    $rootProcess = Get-VrcLiveProcess $Tracker.root
    if (-not $rootProcess) { throw 'The updated launcher exited before startup was confirmed.' }
    $rootProcess.Dispose()
    $snapshot = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    # Discover descendants only while their parent still has the exact recorded identity.
    # Different executables opened by the application are observed but never terminated.
    for ($pass = 0; $pass -lt 64; $pass++) {
        $added = $false
        foreach ($entry in $snapshot) {
            $key = [string]$entry.ProcessId
            if ($Tracker.members.ContainsKey($key)) { continue }
            $parent = $Tracker.members[[string]$entry.ParentProcessId]
            if (-not $parent) { continue }
            $parentProcess = Get-VrcLiveProcess $parent
            if (-not $parentProcess) { continue }
            $parentProcess.Dispose()
            $candidate = Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
            if (-not $candidate) { continue }
            try {
                $null = $candidate.Handle
                $started = $candidate.StartTime.ToUniversalTime().Ticks
                if ($candidate.HasExited -or [Math]::Abs($started - $entry.CreationDate.ToUniversalTime().Ticks) -gt 10 -or $started -lt $parent.startedAt) { continue }
                $taskOwned = $candidate.Path -eq $Tracker.root.path -or ($parent.taskOwned -and $candidate.Path -eq $parent.path) -or ([string]$entry.CommandLine -match ('(?:^|\s)--vrc-update-token=' + [regex]::Escape($Tracker.token) + '(?:\s|$)'))
                $Tracker.members[$key] = @{id = [int]$entry.ProcessId; startedAt = $started; path = [string]$candidate.Path; parentId = [int]$entry.ParentProcessId; depth = $parent.depth + 1; taskOwned = $taskOwned}
                $added = $true
            } catch { <# A process that exited or cannot be identified is never adopted. #> }
            finally { $candidate.Dispose() }
        }
        if (-not $added) { break }
    }
}
function Stop-VrcUpdateProcesses($Tracker) {
    if (-not $Tracker) { return }
    try { Update-VrcProcessTracker $Tracker } catch { <# Still stop already identified task processes after an early launcher exit. #> }
    foreach ($identity in @($Tracker.members.Values | Sort-Object -Property { $_.depth } -Descending)) {
        if (-not $identity.taskOwned) { continue }
        $process = Get-VrcLiveProcess $identity
        if (-not $process) { continue }
        try { $process.Kill(); $null = $process.WaitForExit(5000) }
        catch { <# If a verified task process cannot exit, retain the rollback copy for recovery. #> }
        finally { $process.Dispose() }
    }
}
function Wait-VrcUpdateStartup($Plan, $Tracker, [int]$TimeoutMilliseconds = 60000) {
    # Timeout injection is internal to dot-sourced tests; it is never accepted from CLI/manifest.
    if ($TimeoutMilliseconds -lt 1 -or $TimeoutMilliseconds -gt 60000) { throw 'Invalid startup confirmation timeout.' }
    $receipt = Assert-VrcWritePath ([IO.Path]::Combine([string]$Plan.stageDir, 'startup-ready.json')) $Plan
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    while ($true) {
        Update-VrcProcessTracker $Tracker
        if (Test-Path -LiteralPath $receipt) {
            $null = Assert-VrcWritePath $receipt $Plan
            $entry = Get-Item -LiteralPath $receipt -Force
            if ($entry.PSIsContainer -or $entry.Length -gt 4096) { throw 'Invalid update startup receipt.' }
            $ready = Get-Content -LiteralPath $receipt -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($ready.schema -ne 1 -or $ready.token -cne $Plan.token -or $ready.target -ne $Plan.target -or $ready.sha256 -cne $Plan.sha256 -or $ready.size -ne $Plan.size -or $ready.version -cne $Plan.version -or $ready.startupReady -isnot [bool] -or -not $ready.startupReady -or $ready.pid -lt 1 -or $ready.pid -gt 2147483647) { throw 'Invalid update startup receipt.' }
            $identity = $Tracker.members[[string]$ready.pid]
            if (-not $identity -or -not $identity.taskOwned -or $ready.pid -eq $Tracker.root.id -or $ready.parentPid -ne $identity.parentId) { throw 'Update startup receipt is not from the newly launched application.' }
            $application = Get-VrcLiveProcess $identity
            if (-not $application) { throw 'The updated application exited before startup was confirmed.' }
            $application.Dispose()
            $at = [DateTime]::Parse([string]$ready.at).ToUniversalTime()
            if ($at -lt $Tracker.launchedAt.AddSeconds(-2) -or $at -gt [DateTime]::UtcNow.AddSeconds(2)) { throw 'The update startup receipt is stale.' }
            Assert-VrcFile ([string]$Plan.target) $Plan.size $Plan.sha256
            return
        }
        if ([DateTime]::UtcNow -ge $deadline) { throw 'The updated application did not confirm successful startup before the deadline.' }
        Start-Sleep -Milliseconds 100
    }
}
function Invoke-VrcUpdate([string]$ManifestPath, [int]$StartupTimeoutMilliseconds = 60000) {
    $plan = Read-VrcUpdatePlan $ManifestPath
    $target = [string]$plan.target
    $directory = [IO.Path]::GetDirectoryName($target)
    $incoming = Assert-VrcWritePath ([IO.Path]::Combine($directory, '.vrc-update-' + $plan.token + '.new.exe')) $plan
    $backup = Assert-VrcWritePath ([IO.Path]::Combine($directory, '.vrc-update-' + $plan.token + '.rollback.exe')) $plan
    if ((Test-Path -LiteralPath $incoming) -or (Test-Path -LiteralPath $backup)) { throw 'Reserved update paths already exist.' }
    $backupMade = $false
    $swapped = $false
    $newProcesses = $null
    try {
        $startupReceipt = Assert-VrcWritePath ([IO.Path]::Combine([string]$plan.stageDir, 'startup-ready.json')) $plan
        if (Test-Path -LiteralPath $startupReceipt) { throw 'The application startup receipt already exists.' }
        $ready = Assert-VrcWritePath ([IO.Path]::Combine([string]$plan.stageDir, 'helper-ready.json')) $plan
        $pendingReady = Assert-VrcWritePath ($ready + '.tmp') $plan
        if ((Test-Path -LiteralPath $ready) -or (Test-Path -LiteralPath $pendingReady)) { throw 'The helper acknowledgement already exists.' }
        $acknowledgement = @{token = $plan.token; parentPid = $plan.parentPid; helperPid = $PID} | ConvertTo-Json
        [IO.File]::WriteAllText($pendingReady, $acknowledgement)
        [IO.File]::Move($pendingReady, $ready)
        $deadline = [DateTime]::UtcNow.AddSeconds(120)
        while (Get-Process -Id $plan.parentPid -ErrorAction SilentlyContinue) {
            if ([DateTime]::UtcNow -gt $deadline) { throw 'The application did not exit before the update deadline.' }
            Start-Sleep -Milliseconds 250
        }
        # Read approval only after parent exit, so a failed launch/quit can revoke it.
        # A helper that escaped the old app's process job must never apply by itself.
        $approval = Assert-VrcWritePath ([IO.Path]::Combine([string]$plan.stageDir, 'install-approved.json')) $plan
        $approvalInfo = Get-Item -LiteralPath $approval -Force
        if ($approvalInfo.PSIsContainer -or $approvalInfo.Length -gt 4096) { throw 'Invalid update install approval.' }
        $approved = Get-Content -LiteralPath $approval -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($approved.schema -ne 1 -or $approved.token -cne $plan.token -or $approved.parentPid -ne $plan.parentPid -or $approved.helperPid -ne $PID -or $approved.approved -isnot [bool] -or -not $approved.approved) { throw 'Invalid update install approval.' }
        $null = Assert-VrcWritePath $approval $plan
        [IO.File]::Delete($approval)
        while ($true) {
            try {
                $lock = [IO.File]::Open($target, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
                $lock.Dispose()
                break
            } catch {
                if ([DateTime]::UtcNow -gt $deadline) { throw 'The portable launcher is still locked.' }
                Start-Sleep -Milliseconds 250
            }
        }
        $null = Assert-VrcWritePath $target $plan
        Assert-VrcFile $target $plan.expectedTargetSize $plan.expectedTargetSha256
        Assert-VrcFile ([string]$plan.staged) $plan.size $plan.sha256
        [IO.File]::Copy([string]$plan.staged, $incoming, $false)
        Assert-VrcFile $incoming $plan.size $plan.sha256
        $null = Assert-VrcWritePath $target $plan
        $null = Assert-VrcWritePath $backup $plan
        Assert-VrcFile $target $plan.expectedTargetSize $plan.expectedTargetSha256
        [IO.File]::Move($target, $backup)
        $backupMade = $true
        $null = Assert-VrcWritePath $incoming $plan
        [IO.File]::Move($incoming, $target)
        $swapped = $true
        $launcher = Start-Process -FilePath $target -WorkingDirectory $directory -ArgumentList ('--vrc-update-token=' + $plan.token) -PassThru -WindowStyle Hidden -ErrorAction Stop
        $newProcesses = New-VrcProcessTracker $launcher $plan
        Wait-VrcUpdateStartup $plan $newProcesses $StartupTimeoutMilliseconds
        Write-VrcUpdateResult $plan 'completed' 'Update applied and application startup confirmed.'
        try { $null = Assert-VrcWritePath $backup $plan; Remove-Item -LiteralPath $backup -Force } catch { <# Keep the rollback copy if cleanup is unavailable. #> }
    } catch {
        $failure = $_.Exception.Message
        if ($backupMade) {
            try {
                Stop-VrcUpdateProcesses $newProcesses
                $null = Assert-VrcWritePath $target $plan
                $null = Assert-VrcWritePath $backup $plan
                Assert-VrcFile $backup $plan.expectedTargetSize $plan.expectedTargetSha256
                if ($swapped -and (Test-Path -LiteralPath $target)) {
                    Assert-VrcFile $target $plan.size $plan.sha256
                    $null = Assert-VrcWritePath $incoming $plan
                    [IO.File]::Move($target, $incoming)
                }
                if (Test-Path -LiteralPath $target) { throw 'Cannot overwrite a changed launcher during rollback.' }
                [IO.File]::Move($backup, $target)
                try { $null = Start-Process -FilePath $target -WorkingDirectory $directory -PassThru -WindowStyle Hidden -ErrorAction Stop } catch { <# The restored original remains available for manual launch. #> }
            } catch { $failure += ' Rollback requires attention: ' + $_.Exception.Message }
        }
        try { Write-VrcUpdateResult $plan 'error' $failure } catch { <# Never write a result outside the validated stage directory. #> }
        throw $failure
    } finally {
        if (Test-Path -LiteralPath $incoming) {
            try { $null = Assert-VrcWritePath $incoming $plan; Remove-Item -LiteralPath $incoming -Force } catch { <# Do not follow a replaced path during cleanup. #> }
        }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    if ([string]::IsNullOrWhiteSpace($Manifest)) { throw 'An update manifest is required.' }
    Invoke-VrcUpdate $Manifest
}
