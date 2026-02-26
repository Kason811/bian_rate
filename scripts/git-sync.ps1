param(
    [string]$Message = "",
    [switch]$SkipPull
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Run-Git {
    param([string[]]$Args)
    & git @Args
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Args -join ' ') failed with exit code $LASTEXITCODE"
    }
}

Run-Git @("rev-parse", "--is-inside-work-tree")

if (-not $SkipPull) {
    Run-Git @("pull", "--rebase")
}

$status = git status --porcelain
if (-not $status) {
    Write-Host "No local changes. Pushing current branch..."
    Run-Git @("push")
    exit 0
}

Run-Git @("add", "-A")

$oversize = @()
git diff --cached --name-only | ForEach-Object {
    if (Test-Path $_) {
        $size = (Get-Item $_).Length
        if ($size -gt 50MB) {
            $oversize += "{0} -> {1} MB" -f $_, [math]::Round($size / 1MB, 2)
        }
    }
}
if ($oversize.Count -gt 0) {
    Write-Host "Large staged files detected (>50MB):" -ForegroundColor Yellow
    $oversize | ForEach-Object { Write-Host "  $_" }
    throw "Review large files before commit."
}

if ([string]::IsNullOrWhiteSpace($Message)) {
    $Message = "chore: sync " + (Get-Date -Format "yyyy-MM-dd HH:mm")
} elseif ($Message -notmatch "^[a-z]+: ") {
    $Message = "chore: $Message"
}

Run-Git @("commit", "-m", $Message)
Run-Git @("push")

Write-Host "Done. Commit + push completed."
