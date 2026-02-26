---
name: github-https-proxy-sync
description: Enforce GitHub pull/push via v2rayN SOCKS5 proxy (127.0.0.1:10808) for this project. Use when syncing code to GitHub to avoid Recv failure: Connection was reset.
---

# GitHub HTTPS Proxy Sync

For this project, GitHub operations must use proxy:
- `socks5h://127.0.0.1:10808`

## One-command sync (recommended)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\git-sync.ps1
```

The script defaults to `-ProxyUrl "socks5h://127.0.0.1:10808"`.

## Manual commands (must include proxy)

```powershell
git -c http.proxy=socks5h://127.0.0.1:10808 -c https.proxy=socks5h://127.0.0.1:10808 pull --rebase
git -c http.proxy=socks5h://127.0.0.1:10808 -c https.proxy=socks5h://127.0.0.1:10808 push -u origin main
```

## Optional repo-level persistent proxy

```powershell
git config http.proxy socks5h://127.0.0.1:10808
git config https.proxy socks5h://127.0.0.1:10808
```
