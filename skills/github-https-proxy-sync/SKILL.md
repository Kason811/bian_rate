---
name: github-https-proxy-sync
description: 在 Windows/PowerShell 项目里使用 v2rayN SOCKS5 代理（127.0.0.1:10808）进行 GitHub HTTPS 的拉取、提交和推送。适用于出现 Recv failure: Connection was reset 的场景。
---

# GitHub HTTPS Proxy Sync

当 GitHub 直连失败（例如 `Recv failure: Connection was reset`）时，使用此流程。

## 快速验证代理可用

```powershell
git -c http.proxy=socks5h://127.0.0.1:10808 -c https.proxy=socks5h://127.0.0.1:10808 ls-remote https://github.com/Kason811/bian_rate.git
```

如果返回远端 hash，说明代理链路正常。

## 一键同步（推荐）

使用仓库内脚本并传入代理：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\git-sync.ps1 -ProxyUrl "socks5h://127.0.0.1:10808"
```

该命令会自动执行：
1. `git pull --rebase`
2. `git add -A`
3. `git commit`
4. `git push`

## 手动单次推送

```powershell
git -c http.proxy=socks5h://127.0.0.1:10808 -c https.proxy=socks5h://127.0.0.1:10808 push -u origin main
```

## 可选：仓库级持久代理

```powershell
git config http.proxy socks5h://127.0.0.1:10808
git config https.proxy socks5h://127.0.0.1:10808
```

取消：

```powershell
git config --unset http.proxy
git config --unset https.proxy
```
