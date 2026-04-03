param(
    [string]$Message = "",
    [switch]$SkipPull,
    [string]$ProxyUrl = "socks5h://127.0.0.1:10808"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Run-Git {
    param([string[]]$CommandArgs)
    if ([string]::IsNullOrWhiteSpace($ProxyUrl)) {
        & git @CommandArgs
    } else {
        & git -c "http.proxy=$ProxyUrl" -c "https.proxy=$ProxyUrl" @CommandArgs
    }
    if ($LASTEXITCODE -ne 0) {
        throw "git $($CommandArgs -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Get-CurrentBranch {
    $branch = git branch --show-current
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
        throw "Unable to determine current branch."
    }
    return $branch.Trim()
}

function Test-HasUpstream {
    if ([string]::IsNullOrWhiteSpace($ProxyUrl)) {
        & git rev-parse --abbrev-ref --symbolic-full-name '@{u}' *> $null
    } else {
        & git -c "http.proxy=$ProxyUrl" -c "https.proxy=$ProxyUrl" rev-parse --abbrev-ref --symbolic-full-name '@{u}' *> $null
    }
    return $LASTEXITCODE -eq 0
}

Run-Git -CommandArgs @("rev-parse", "--is-inside-work-tree")

if (-not $SkipPull) {
    Run-Git -CommandArgs @("pull", "--rebase")
}

$status = if ([string]::IsNullOrWhiteSpace($ProxyUrl)) {
    git status --porcelain
} else {
    git -c "http.proxy=$ProxyUrl" -c "https.proxy=$ProxyUrl" status --porcelain
}
if (-not $status) {
    Write-Host "No local changes. Pushing current branch..."
    if (Test-HasUpstream) {
        Run-Git -CommandArgs @("push")
    } else {
        $branch = Get-CurrentBranch
        Run-Git -CommandArgs @("push", "-u", "origin", $branch)
    }
    exit 0
}

Run-Git -CommandArgs @("add", "-A")

$oversize = @()
$stagedFiles = if ([string]::IsNullOrWhiteSpace($ProxyUrl)) {
    git diff --cached --name-only
} else {
    git -c "http.proxy=$ProxyUrl" -c "https.proxy=$ProxyUrl" diff --cached --name-only
}
$stagedFiles | ForEach-Object {
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

Run-Git -CommandArgs @("commit", "-m", $Message)
if (Test-HasUpstream) {
    Run-Git -CommandArgs @("push")
} else {
    $branch = Get-CurrentBranch
    Run-Git -CommandArgs @("push", "-u", "origin", $branch)
}

Write-Host "Done. Commit + push completed."
