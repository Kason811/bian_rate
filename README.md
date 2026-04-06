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

当前网页有 8 个页面：

- `/` 费率总览
- `/monthly` 月费率明细表
- `/audit` 数据审计
- `/volume` 成交量观察
- `/combined` 联合筛选
- `/heatmap` 热力图
- `/research` BTC 周线研究页
- `/research-2` BTC 周线研究页2

当前网页直接读取本地 SQLite，不再依赖样例数据。

当前页面口径补充：

- `/monthly` 默认看“上12个月”，即排除当月未完成月份
- `/audit` 只保留审计信息，不复用费率总览顶部 5 张维度卡
- `/combined` 使用“费率优先表”的综合分作为点大小，当前为 `X=成交量`、`Y=费率`
- `/combined` 的成交量轴使用对数压缩并对极端值封顶，费率轴也会对称封顶，避免少数异常值拉坏整体分布
- `/heatmap` 当前包含 5 个维度：当前、上月、上3个月、上6个月、上12个月
- `/heatmap` 面积看费率绝对值，颜色看费率方向和强弱，并对极端值做封顶处理
- `/research` 当前固定做 `BTC + 周线`，在同一时间轴内展示价格、周费率、周成交量和市场区间带
- `/research` 当前价格序列来自本地缓存文件 `web/lib/btc-weekly-klines.json`，避免页面打开时依赖外网请求
- `/research` 目前支持统一 hover 信息框，显示时间、区间、价格、周费率、周日均成交量、周涨跌、当前区间周数和区间总涨跌
- `/research` 现在支持手动区间编辑器：BTC 可直接在周线图上点起点、点终点，先看周数、涨跌、波动、最大上冲、最大回撤，再选择 `牛 / 小牛 / 震荡牛 / 震荡 / 震荡熊 / 小熊 / 熊`
- `/research` 的手动区间编辑器支持把已保存区间直接显示成图表底色热力带：`牛=深绿`、`小牛=绿`、`震荡牛=浅绿`、`震荡=灰`、`震荡熊=浅红`、`小熊=红`、`熊=深红`
- `/research` 的手动区间编辑器也支持录入其他币种，例如 `SOL`；切到目标币种后可直接手填开始/结束日期并保存到同一个本地手工区间文件
- `/research` 现在会在保存前提示新区间和哪些已有区间重叠，并支持“用当前新区间覆盖全部重叠区间，以最新这段为准”
- `/research` 当前手工区间文件即使混入重叠或无效区间，页面也会跳过坏行继续打开，不再整页报 Server Components 渲染错误
- `/research-2` 当前固定做 `BTC + 周线 + 七态自动分区`，状态顺序为 `大牛 / 小牛 / 震荡牛 / 震荡灰 / 震荡熊 / 小熊 / 大熊`
- `/research-2` 当前采用“连续特征分段 -> 段级命名 -> 相邻同标签合并”的结构，页面展示价格、EMA21、SMA200、周费率、ADX14、BBW 分位、Return Z52、日均成交量
- `/research-2` 当前保留 `5` 周最小区间长度，不再强行按价格最高/最低点切边界
- `/research-2` 当前极端多头标签已统一改名为 `大牛`
- `/research-2` 顶部卡片当前会区分“当前状态”和“最新数据日期”，避免把 `weekStart` 误读成最新数据截止日
- `/research-2` 当前已清理早期残留的说明字段和调试字段，hover 信息块、区间统计、七态均值画像都已按当前展示需求收紧

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

研究页地址：

```text
http://127.0.0.1:3026/research
```

研究页2地址：

```text
http://127.0.0.1:3026/research-2
```

工作约定：

- 下次继续工作时，不要先让用户手动启动程序
- 应先执行 `npm run build` 与 `npm run start -- --hostname 127.0.0.1 --port 3026`
- 确认 `3026` 可访问后，再开始继续改页面或数据逻辑
- 每次改动完成后，都要重新启动并确认页面返回正常

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

## 当前进度快照

截至 `2026-04-06`，当前已落地的重点变更如下：

- 数据侧
  - `import_outputs_to_sqlite.py` 已禁止把 Excel 的 `30天日平均成交量` 伪造成 `daily_volume_metrics`
  - `binance_coin_funding_rate_collector.py` 已修正“上12个月”逻辑，排除当月未完成月份
  - `web/lib/sqlite-workbench-data.ts` 已加入按 SQLite 文件修改时间的缓存，减少页面重复全表扫描

- 前端页结构
  - `/audit` 已独立成纯审计页，不再复用费率总览顶部 5 张维度卡
  - `/monthly` 默认范围为“上12个月”，并改成标题栏模式
  - `/combined` 已改成 5 张维度散点卡，点大小来自费率优先表综合分，坐标为 `X=成交量`、`Y=费率`
  - `/combined` 的成交量轴使用对数压缩并做极值封顶，费率轴也做对称封顶，hover 显示币种名、成交量、费率、分数
  - `/heatmap` 已改成 5 个维度卡片，面积看费率绝对值，颜色按方向和强弱分层，并对极值封顶
  - `/research` 已上线 BTC 周线研究页，用来测试价格、周费率、周成交量在不同市场区间中的联动关系
  - `/research-2` 已上线 BTC 周线七态自动分区页，用来测试段级市场体制识别
  - `/research` 已增加手动区间编辑器，支持本地保存 `BTC` 以及后续其他币种的手工区间
  - `/research` 的 `BTC` 手动区间交互已改成图上点起点、点终点，并实时预览周数、区间涨跌、波动、最大上冲、最大回撤
  - `/research` 的重叠区间提示已上线，支持直接点冲突区间载入编辑，也支持“最新区间覆盖全部重叠”
  - `/research` 的自动区间热力图已加入长周期低净涨跌 / 低振幅优先判定为震荡的收敛逻辑，并支持手动覆盖文件修正自动结果
  - `/research-2` 当前状态名已整理为 `大牛 / 小牛 / 震荡牛 / 震荡灰 / 震荡熊 / 小熊 / 大熊`，并补了各图指标图例，便于直接读图
  - `/research-2` 已去掉旧的纠偏说明 / 分类说明 / 周级初判等残留展示，只保留当前实际使用的段级输出和图表信息

- 工具链
  - `web/eslint.config.mjs` 已补齐
  - `npm run lint` 当前可直接执行
  - 本地查看统一使用 `3026` 端口
  - `web/next.config.ts` 已把构建输出目录切到 `.next-runtime`，避开 Windows/Nutstore 下旧 `.next-build` 的构建问题
  - 仓库已补 `scripts/restart-web-3026.ps1`，用于只清理 `3026` 监听进程并安全重启网页

当前建议直接从 `docs/2026-04-03-next-phase-plan.md` 接着看，因为那里记录会更详细。

## Git 同步

仓库里保留了一个 PowerShell 辅助脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\git-sync.ps1
```

它会按仓库约定通过代理执行 `pull / add / commit / push`。

## 安全重启 3026

如果只想清掉网页端口并干净重启，不要执行“杀所有 node”。

直接在仓库根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\restart-web-3026.ps1
```

这个脚本会：

- 只停止当前监听 `3026` 的进程
- 在 `web/` 下后台启动 `npm run start -- --hostname 127.0.0.1 --port 3026`
- 输出新的日志文件路径和实际监听 PID

这样不会把本机其他 `node` 进程一并杀掉。

## 自动区间手动覆盖

研究页里的“自动区间热力图”支持手动参与修正。

配置文件：

```text
web/lib/btc-weekly-auto-regime-overrides.json
```

当前文件默认是空数组。后面如果你要手动指定某段区间，可按下面格式追加：

```json
[
  {
    "start": "2025-07-07",
    "end": "2025-10-06",
    "stateLabel": "震荡",
    "heatScore": 0,
    "note": "长周期小波动，手动压回震荡"
  }
]
```

说明：

- `start` / `end` 使用周起始日期范围，规则是 `start <= weekStart < end`
- `stateLabel` 支持写 `上行`、`震荡`、`下行`
- `heatScore` 可选；不写时会按状态给默认热度
- `note` 可选；会显示在研究页 tooltip 里

## 注意事项

- `coin_funding_rate_outputs/` 和 `data/` 默认不进 Git
- `web/.next-build/` 是前端构建产物，不进 Git
- 如果网页已经在运行，不要直接删构建目录；先停服务再重建
- 这个仓库当前应以 `README` 为入口，不再依赖旧原型交接文档
