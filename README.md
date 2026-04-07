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
├─ requirements.txt                         # Python 依赖
├─ web/                                     # Next.js 分析前端
├─ scripts/
│  ├─ bootstrap-ubuntu.sh                   # Ubuntu 初始化：venv + pip + npm ci
│  ├─ git-sync.sh                           # Ubuntu Git 同步脚本
│  └─ restart-web.sh                        # Ubuntu 启动/重启脚本
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
- `/combined` 联合筛选
- `/heatmap` 热力图
- `/research-2` 七态研究

当前网页直接读取本地 SQLite，不再依赖样例数据。

当前页面口径补充：

- `/monthly` 默认看“上12个月”，即排除当月未完成月份
- `/audit` 只保留审计信息，不复用费率总览顶部 5 张维度卡
- `/combined` 使用“费率优先表”的综合分作为点大小，当前为 `X=成交量`、`Y=费率`
- `/combined` 的成交量轴使用对数压缩并对极端值封顶，费率轴也会对称封顶，避免少数异常值拉坏整体分布
- `/heatmap` 当前包含 5 个维度：当前、上月、上3个月、上6个月、上12个月
- `/heatmap` 面积看费率绝对值，颜色看费率方向和强弱，并对极端值做封顶处理
- `/research-2` 当前为“七态研究”，已支持 `COIN-M / USDT-M + 周线 + 同名单多币种`，状态顺序为 `大牛 / 小牛 / 震荡牛 / 震荡灰 / 震荡熊 / 小熊 / 大熊`
- `/research-2` 当前采用“连续特征分段 -> 段级命名 -> 相邻同标签合并”的结构，页面展示价格、布林线、EMA、SMA、RSI、周费率、ADX、BBW 分位、Return Z、日均成交量
- `/research-2` 当前会按市场与币种读取本地完整历史，SQLite funding / volume 与本地周线 OHLC 按可用交集自动取样；USDT-M 当前只覆盖与 COIN-M 同名单的币种
- `/research-2` 当前分段参数与指标参数支持服务端默认值持久化，所有浏览器共享同一套默认配置
- `/research-2` 当前极端多头标签已统一改名为 `大牛`
- `/research-2` 顶部卡片当前会区分“当前状态”和“最新数据日期”，避免把 `weekStart` 误读成最新数据截止日
- `/research-2` 当前已清理早期残留的说明字段和调试字段，hover 信息块、区间统计、七态均值画像都已按当前展示需求收紧
- `/research-2` 上下各有一套同步的时间截断控制，默认直接展示全时间段；时间窗支持拖拽和 `- / +` 步进
- `/research-2` 当前支持 `实时重构图表` 开关；点击开启后会立刻按当前可见 K 线重跑七态分段、统计、均值画像和边界参数
- `/research-2` 当前支持点击 `RSI / 布林线 / EMA / SMA / ADX / BBW / Return` 图例，直接隐藏或显示对应叠加线
- `/research-2` 当前已将 `RSI` 从 `ADX / BBW / Return` 混合指标图中拆出，单独展示并支持 `RSI 周期 / 上边界 / 下边界`
- `/research-2` 当前支持在页面内调整分段参数与指标参数；点击应用后会自动重算图表、区间统计和七态画像
- `/research-2` 分段参数当前已支持 `最新区块最短区间`，可单独调尾段灵敏度，而不改前面历史段的最短长度
- `/research-2` 指标参数当前不再只限于周期，已支持 `ADX 趋势阈值`、`RSI 上下边界`、`布林线标准差倍数`、`BBW 高低波动线`、`Return Z 上下边界`
- `/research-2` 区间涨跌、最大上冲、最大回撤当前统一按“首周开盘价 -> 末周收盘价”统计，避免分段边界出现价格真空
- `/research-2` 区间统计当前会同时显示“时间范围 + 起始价/终止价”，低价币自动提高价格小数位

## 环境要求

### Python

推荐 Python `3.10+`

安装依赖：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Node.js

推荐 Node.js `22.13+`

说明：

- Web 端当前直接使用 `node:sqlite` 读取 `data/bian_rate.sqlite3`
- 这意味着前端运行环境不能再按旧的 `Node 20+` 准备，建议直接用当前 LTS 的 `Node 22`

安装前端依赖：

```bash
cd web
npm ci
```

如果是刚从 Windows 迁移到 Ubuntu，建议直接执行一次完整初始化：

```bash
./scripts/bootstrap-ubuntu.sh
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

### 5. 回补 BTC COIN-M 全历史

如果要把 `BTCUSD_PERP` 的 funding / volume / 周线 OHLC 一次性补到币安当前可下载的完整范围：

```bash
python scripts/backfill_btc_coinm_full_history.py
```

### 6. 启动网页

开发模式：

```bash
cd web
npm run dev
```

更稳的本地查看方式是生产模式：

```bash
cd web
npm run build
npm run start
```

当前生产启动参数：

- 默认监听 `0.0.0.0:43126`
- `43126` 是我这次排查时本机未占用的冷门端口
- 启动时会读取 `/home/ben/server/vibecode/ip_allowlist.json`
- 只有白名单 IP 和本机 `127.0.0.1 / ::1` 能访问
- 白名单文件变更后无需重建，重启网页即可生效

然后打开：

```text
http://127.0.0.1:43126/
```

七态研究地址：

```text
http://127.0.0.1:43126/research-2
```

七态研究当前补充说明：

- 市场切换：`币本位 COIN-M / U本位 USDT-M`
- 周期切换位已预留 `周线 / 3日线 / 日线`，当前正式开放的是 `周线`
- `实时重构图表` 使用当前页面实际生效参数，不再和服务端默认参数分叉
- 白名单文件热更新对网页访问控制生效；研究页参数默认值修改后，对所有浏览器生效

工作约定：

- 下次继续工作时，不要先让用户手动启动程序
- 应先执行 `./scripts/restart-web.sh`
- 确认 `43126` 可访问后，再开始继续改页面或数据逻辑
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
  - `/research-2` 当前是唯一保留的七态研究页，导航名为“七态研究”
  - `/research-2` 当前状态名已整理为 `大牛 / 小牛 / 震荡牛 / 震荡灰 / 震荡熊 / 小熊 / 大熊`
  - `/research-2` 已补齐 BTC COIN-M 可下载的 funding / volume / 周线 OHLC 历史，当前覆盖从 `2020-08` 起的完整区间
  - `/research-2` 已补各图指标图例、时间窗拖拽控件、更紧凑的 hover / 统计布局，以及 `牛总 / 熊总` 汇总胶囊，便于直接读图
  - `/research-2` 已补时间窗 `- / +` 步进按钮和 `实时重构图表` 模式，便于观察每多一根周 K 后七态区间如何演化
  - `/research-2` 已加入 `RSI` 与 `布林线`，并支持点击图例切换叠加线显示；其中 `RSI` 现已独立成单独图层
  - `/research-2` 已支持分段参数和指标参数面板，可直接在页内调 `最短区间 / 最新区块最短区间 / 分段惩罚 / 最长区间 / EMA / SMA / ADX 周期与趋势阈值 / RSI 周期与上下边界 / 布林线周期与标准差 / BBW 窗口与高低波动线 / Return Z 窗口与上下边界`

- 工具链
  - `web/eslint.config.mjs` 已补齐
  - `npm run lint` 当前可直接执行
  - 本地查看统一使用 `43126` 端口
  - `web/next.config.ts` 已把构建输出目录切到 `.next-runtime`
  - 当前仓库以 Ubuntu 为唯一运行环境，已切到 shell 启动脚本与自定义白名单服务器

当前建议直接从 `docs/2026-04-03-next-phase-plan.md` 接着看，因为那里记录会更详细。

## Git 同步

Ubuntu 下可直接使用 shell 辅助脚本：

```bash
./scripts/git-sync.sh
```

它会执行 `pull --rebase / add / commit / push`。

传提交说明：

```bash
./scripts/git-sync.sh "chore: your message"
```

如果你需要代理，可临时传环境变量：

```bash
GIT_PROXY_URL="socks5h://127.0.0.1:10808" ./scripts/git-sync.sh
```

## 启动与重启网页

如果只想清掉网页端口并干净重启，不要执行“杀所有 node”。

直接在仓库根目录运行：

```bash
./scripts/restart-web.sh
```

这个脚本会：

- 只停止当前监听 `43126` 的进程
- 先执行 `npm run build`
- 再在 `web/` 下后台启动生产服务
- 用 `http://127.0.0.1:43126/__health` 做本地健康检查
- 输出新的日志文件路径和实际监听 PID

这样不会把本机其他 `node` 进程一并杀掉。

如果你准备长期常驻，建议改成 `systemd` 服务。仓库里已放模板：

`deploy/bian-rate-web.service`

它默认：

- 监听 `0.0.0.0:43126`
- 使用 `/home/ben/server/vibecode/ip_allowlist.json` 做白名单
- 若构建产物不存在，会自动执行一次 `npm run build`
- 失败后自动重启

配套环境文件：

`deploy/bian-rate.env`

建议安装方式：

```bash
sudo cp deploy/bian-rate.env /home/ben/server/vibecode/bian_rate/deploy/bian-rate.env
sudo cp deploy/bian-rate-web.service /etc/systemd/system/bian-rate-web.service
sudo systemctl daemon-reload
sudo systemctl enable --now bian-rate-web.service
sudo systemctl status bian-rate-web.service
```

查看日志：

```bash
journalctl -u bian-rate-web.service -f
```

## 定时任务

仓库里已补 `systemd timer`：

- `deploy/bian-rate-collector.service`
- `deploy/bian-rate-collector.timer`

定时策略默认是每天 `00:15 / 08:15 / 16:15` 运行一次采集。

说明：

- 这个时间按服务器本地时区解释
- 当前默认假设你的机器时区就是 `Asia/Shanghai`
- 如果服务器时区不是 `Asia/Shanghai`，要么改系统时区，要么改 timer
- 采集脚本带文件锁，若上一次还没跑完，本次会自动跳过，不会重入

安装方式：

```bash
sudo cp deploy/bian-rate-collector.service /etc/systemd/system/bian-rate-collector.service
sudo cp deploy/bian-rate-collector.timer /etc/systemd/system/bian-rate-collector.timer
sudo systemctl daemon-reload
sudo systemctl enable --now bian-rate-collector.timer
sudo systemctl list-timers bian-rate-collector.timer
```

手动触发一次采集：

```bash
sudo systemctl start bian-rate-collector.service
journalctl -u bian-rate-collector.service -n 100 --no-pager
```

## IP 白名单

网页生产服务会读取：

```text
/home/ben/server/vibecode/ip_allowlist.json
```

这是新的共享白名单配置，建议以后 `/home/ben/server/vibecode` 下所有需要白名单的程序都统一读取它。

当前格式是结构化 JSON，优点是：

- 可以保留 `id / label / system / tags / enabled` 等元信息
- 可以临时禁用某台设备，而不是直接删记录
- 可以后续扩展 `cidr`
- 更适合被脚本、服务、面板统一读取

当前 `bian_rate` 已兼容：

- 新格式 `ip_allowlist.json`
- 旧格式 `ip_tailscale.txt`

建议以后以 `ip_allowlist.json` 为主，`ip_tailscale.txt` 只作为过渡或人工备忘。

按我本次读取到的内容，当前允许的 Tailscale 客户端包括：

- `100.89.9.119`
- `100.82.170.71`
- `100.94.105.9`
- `100.79.204.72`

此外，本机回环地址 `127.0.0.1` 和 `::1` 永远允许访问。

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
