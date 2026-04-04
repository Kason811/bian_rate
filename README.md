# bian_rate

币安币本位永续资金费率采集与分析仓库。

当前仓库已经不是早期原型结构，主线是：

1. Python 采集币安 COIN-M 永续资金费率与成交量
2. 同时输出 Excel 和本地 SQLite
3. Next.js 网页直接读取 SQLite 做分析看板

## 当前目录

```text
bian_rate/
├─ binance_coin_funding_rate_collector.py   # 主采集脚本：抓 funding + volume，写 Excel 和 SQLite
├─ sqlite_store.py                          # SQLite schema 与持久化逻辑
├─ import_outputs_to_sqlite.py              # 从已有 Excel 输出回灌 SQLite
├─ backfill_volume_history.py               # 给 SQLite 回填日成交量历史
├─ web/                                     # Next.js 分析前端
├─ scripts/
│  └─ git-sync.ps1                          # 走代理的 Git 同步脚本
├─ coin_funding_rate_outputs/               # Excel 输出目录（gitignore）
└─ data/
   └─ bian_rate.sqlite3                     # SQLite 数据库（gitignore）
```

## 当前功能

### 数据侧

- 自动获取 Binance COIN-M `TRADING + PERPETUAL` 交易对
- 抓取近 3 年资金费率历史
- 按可配置时区聚合日频、周频、月频，默认 `Asia/Shanghai`
- 抓取并写入成交量数据
- 输出单币日频 Excel 和月度汇总 Excel
- 将 funding / volume / snapshot 同步写入 `data/bian_rate.sqlite3`

### Web 侧

当前网页有 6 个页面：

- `/` 费率总览
- `/monthly` 月费率明细表
- `/audit` 数据审计
- `/volume` 成交量观察
- `/combined` 联合筛选
- `/heatmap` 热力图

当前网页直接读取本地 SQLite，不再依赖样例数据。

当前页面口径补充：

- `/monthly` 默认看“上12个月”，即排除当月未完成月份
- `/audit` 只保留审计信息，不复用费率总览顶部 5 张维度卡
- `/combined` 使用“费率优先表”的综合分作为点大小，当前为 `X=成交量`、`Y=费率`
- `/combined` 的成交量轴使用对数压缩并对极端值封顶，费率轴也会对称封顶，避免少数异常值拉坏整体分布
- `/heatmap` 当前包含 5 个维度：当前、上月、上3个月、上6个月、上12个月
- `/heatmap` 面积看费率绝对值，颜色看费率方向和强弱，并对极端值做封顶处理

## 环境要求

### Python

推荐 Python `3.10+`

安装依赖：

```bash
pip install pandas openpyxl python-binance requests
```

### Node.js

推荐 Node.js `20+`

安装前端依赖：

```bash
cd web
npm install
```

## 常用命令

### 1. 运行主采集

在仓库根目录执行：

```bash
python binance_coin_funding_rate_collector.py
```

如果后面要按 UTC 或别的时区重算聚合，可直接传参：

```bash
python binance_coin_funding_rate_collector.py --timezone UTC
```

执行后会：

- 更新 `coin_funding_rate_outputs/`
- 更新 `data/bian_rate.sqlite3`

### 2. 从已有 Excel 回灌 SQLite

如果已经有历史输出，但 SQLite 还没准备好：

```bash
python import_outputs_to_sqlite.py
```

这个脚本会读取最新的 `费率统计表_近37个月_*.xlsx` 和 `daily/` 明细，再写入 SQLite。

注意：

- 当前回灌脚本不会再把 Excel 里的 `30天日平均成交量` 伪造成 `daily_volume_metrics` 日线历史
- 如果要补真实成交量历史，应使用下面的回填脚本

### 3. 回填日成交量历史

如果 funding 已经在 SQLite 中，但还需要补齐日成交量历史：

```bash
python backfill_volume_history.py
```

### 4. 从 raw funding 重建日 / 周 / 月聚合

如果已经有 `funding_rates_raw`，但想补 `weekly_funding_metrics`、`funding_quality_audits`，或切换聚合时区：

```bash
python rebuild_funding_from_raw.py
```

切换到 UTC 示例：

```bash
python rebuild_funding_from_raw.py --timezone UTC
```

### 5. 启动网页

开发模式：

```bash
cd web
npm run dev
```

更稳的本地查看方式是生产模式：

```bash
cd web
npm run build
npm run start -- --hostname 127.0.0.1 --port 3026
```

然后打开：

```text
http://127.0.0.1:3026/
```

## 数据说明

### SQLite

默认数据库路径：

```text
data/bian_rate.sqlite3
```

当前核心表：

- `symbols`
- `funding_rates_raw`
- `daily_funding_metrics`
- `weekly_funding_metrics`
- `monthly_funding_metrics`
- `daily_volume_metrics`
- `funding_quality_audits`
- `volume_quality_audits`
- `market_snapshots`
- `collector_runs`

### Excel 输出

输出目录：

```text
coin_funding_rate_outputs/
```

主要包含：

- `daily/`：单币日频明细
- `费率统计表_近12月_*.xlsx`
- `费率统计表_近24个月_*.xlsx`
- `费率统计表_近37个月_*.xlsx`

其中“近12月”当前实际按“上12个月完整月”使用，即默认不包含本月未完成数据。

## 当前分析原则

网页当前默认遵循这套思路：

- 费率优先
- 正费持续性次之
- 成交量用于过滤和确认
- 超低成交量直接排除
- 高成交量但长期负费率不会自然进入优先池

## 下一阶段

下一阶段重点是两件事并行：

- 继续完善主页 `/` 的使用体验
- 继续增强数据层的可校验和可重建能力

当前已知结果：

- volume 历史分页逻辑已经修正为按 200 天窗口抓取
- funding 已可通过 `rebuild_funding_from_raw.py` 从 raw 一键重建
- 最新 funding 审计结果中，22 个币种当前均为 `ok`
- 最新 volume 回填中，22 个币种都已有数据
- `SUI / WIF / WLD` 属于新上市、短历史，不再误报为抓取失败
- 定时任务和服务器部署暂时后置，当前仍以手动运行脚本为主

详细计划见：

- `docs/2026-04-03-next-phase-plan.md`

## Git 同步

仓库里保留了一个 PowerShell 辅助脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\git-sync.ps1
```

它会按仓库约定通过代理执行 `pull / add / commit / push`。

## 注意事项

- `coin_funding_rate_outputs/` 和 `data/` 默认不进 Git
- `web/.next-build/` 是前端构建产物，不进 Git
- 如果网页已经在运行，不要直接删构建目录；先停服务再重建
- 这个仓库当前应以 `README` 为入口，不再依赖旧原型交接文档
