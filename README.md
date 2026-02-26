# bian_rate

币安币本位永续资金费率抓取与整理工具。脚本会抓取近 3 年数据，输出日频明细、月度统计（近 12 / 24 / 37 个月）以及可点击的币种月度趋势图。

## 功能

- 自动获取币本位永续交易对列表（TRADING + PERPETUAL）
- 抓取资金费率并按上海时区聚合日频/月频
- 输出每个交易对 `daily` Excel（含近 30 天图表、7 日均线、0 轴基准线）
- 输出月度统计 Excel：
  - `近12月`（实际保留 13 个月用于“上12个月”窗口计算）
  - `近24个月`
  - `近37个月`
- `MonthlySummary` 支持点击币种表头跳转到 `Trend_币种` sheet 查看月度走势
- `Overview` 包含本月/上月正负零费率币种数及 Top3
- `30天日平均成交量` sheet 自动标记低成交量币种

## 目录结构

- `binance_coin_funding_rate_collector.py`：主脚本
- `coin_funding_rate_outputs/`：输出目录
  - `daily/`：单币日频文件
  - `费率统计表_近xx_时间戳.xlsx`：月度汇总文件

## 依赖

推荐 Python 3.10+

```bash
pip install pandas openpyxl python-binance requests
```

## 使用方式

在项目根目录执行：

```bash
python binance_coin_funding_rate_collector.py
```

脚本会自动清理并重建 `coin_funding_rate_outputs/daily`，然后重新生成全部输出。

## 一键同步到 GitHub

提供了一个 PowerShell 脚本用于一键执行：

- `git pull --rebase`
- `git add -A`
- `git commit`
- `git push`

本项目约定：**GitHub 拉取/推送默认必须走 v2rayN 代理 `socks5h://127.0.0.1:10808`**。

默认命令（已内置 10808 代理）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\git-sync.ps1
```

自定义提交信息：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\git-sync.ps1 -Message "feat: update funding report layout"
```

如果只想跳过 `pull`（例如你已经手动同步过）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\git-sync.ps1 -SkipPull
```

显式指定代理（与默认一致）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\git-sync.ps1 -ProxyUrl "socks5h://127.0.0.1:10808"
```

## GitHub 连接异常排查（HTTPS）

当出现 `Recv failure: Connection was reset`，先确认代理链路：

```powershell
git -c http.proxy=socks5h://127.0.0.1:10808 -c https.proxy=socks5h://127.0.0.1:10808 ls-remote https://github.com/Kason811/bian_rate.git
```

推荐：配置仓库级持久代理（仅当前仓库）：

```powershell
git config http.proxy socks5h://127.0.0.1:10808
git config https.proxy socks5h://127.0.0.1:10808
```

取消：

```powershell
git config --unset http.proxy
git config --unset https.proxy
```

## 主要输出说明

- `Trend_XXX` 图表：
  - X 轴：月份（YYYY-MM）
  - Y 轴：费率(%)，固定范围 -3 到 3，步长 0.5
  - 包含 `ZeroLine` 基准线
- `TopRanking`：本月 / 上个月 / 上三个月 / 上6个月 / 上12个月 排名
- `MonthlySummary`：热力色阶 + 正负费率字体颜色 + Top5 加粗

## 注意

- 依赖币安接口连通性；如遇网络/代理异常会自动重试。
- 输出包含实时抓取结果，重复执行会生成新的时间戳文件。
