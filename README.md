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
- 按上海时区聚合日频和月频
- 抓取并写入成交量数据
- 输出单币日频 Excel 和月度汇总 Excel
- 将 funding / volume / snapshot 同步写入 `data/bian_rate.sqlite3`

### Web 侧

当前网页有 4 个页面：

- `/` 费率总览
- `/volume` 成交量观察
- `/combined` 联合筛选
- `/heatmap` 热力图

当前网页直接读取本地 SQLite，不再依赖样例数据。

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

执行后会：

- 更新 `coin_funding_rate_outputs/`
- 更新 `data/bian_rate.sqlite3`

### 2. 从已有 Excel 回灌 SQLite

如果已经有历史输出，但 SQLite 还没准备好：

```bash
python import_outputs_to_sqlite.py
```

这个脚本会读取最新的 `费率统计表_近37个月_*.xlsx` 和 `daily/` 明细，再写入 SQLite。

### 3. 回填日成交量历史

如果 funding 已经在 SQLite 中，但还需要补齐日成交量历史：

```bash
python backfill_volume_history.py
```

### 4. 启动网页

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
- `monthly_funding_metrics`
- `daily_volume_metrics`
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

## 当前分析原则

网页当前默认遵循这套思路：

- 费率优先
- 正费持续性次之
- 成交量用于过滤和确认
- 超低成交量直接排除
- 高成交量但长期负费率不会自然进入优先池

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
