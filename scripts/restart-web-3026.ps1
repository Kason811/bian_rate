[CmdletBinding()]
param(
    [int]$Port = 3026,
    [string]$HostName = "127.0.0.1",
    [string]$WebDir = "web",
    [int]$WaitSeconds = 20
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$webPath = Join-Path $repoRoot $WebDir

if (-not (Test-Path $webPath)) {
    throw "Web directory not found: $webPath"
}

$connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
$pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique

foreach ($targetPid in $pids) {
    try {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $targetPid"
        Write-Host "Stopping PID $targetPid listening on $HostName`:$Port"
        if ($proc -and $proc.CommandLine) {
            Write-Host "  $($proc.CommandLine)"
        }
        Stop-Process -Id $targetPid -Force -ErrorAction Stop
    }
    catch {
        Write-Warning "Failed to stop PID ${targetPid}: $($_.Exception.Message)"
    }
}

Start-Sleep -Seconds 2

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stdoutLog = Join-Path $webPath "server-$timestamp.out.log"
$stderrLog = Join-Path $webPath "server-$timestamp.err.log"
$npmCmd = "D:\Program Files\nodejs\npm.cmd"

if (-not (Test-Path $npmCmd)) {
    $npmCmd = "npm.cmd"
}

$process = Start-Process `
    -FilePath $npmCmd `
    -ArgumentList @("run", "start", "--", "--hostname", $HostName, "--port", "$Port") `
    -WorkingDirectory $webPath `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

$deadline = (Get-Date).AddSeconds($WaitSeconds)
$listener = $null

while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500

    if ($process.HasExited) {
        Write-Host "Start process exited with code $($process.ExitCode)"
        break
    }

    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        break
    }
}

Write-Host "Launcher PID: $($process.Id)"
Write-Host "stdout log: $stdoutLog"
Write-Host "stderr log: $stderrLog"

if ($listener) {
    $serverPid = $listener.OwningProcess
    $serverProc = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid"
    Write-Host "Ready on http://$HostName`:$Port"
    Write-Host "Server PID: $serverPid"
    if ($serverProc -and $serverProc.CommandLine) {
        Write-Host "  $($serverProc.CommandLine)"
    }
    exit 0
}

Write-Warning "Port $Port did not become ready within $WaitSeconds seconds."
if (Test-Path $stdoutLog) {
    Write-Host "Recent stdout:"
    Get-Content $stdoutLog -Tail 40
}
if (Test-Path $stderrLog) {
    Write-Host "Recent stderr:"
    Get-Content $stderrLog -Tail 40
}
exit 1
