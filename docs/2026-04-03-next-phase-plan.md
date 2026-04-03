# 2026-04-04 交接与下一步计划

这份文档的目标不是记录聊天过程，而是让人在没有上下文历史的情况下，打开仓库就能知道：

- 这个程序是什么
- 现在已经做到哪一步
- 当前哪些结论已经确认
- 明天继续时应该先做什么
- 哪些事情暂时不要做

## 1. 程序是什么

这是一个围绕 Binance 币本位永续合约建立的本地分析系统，主线非常明确：

1. Python 采集 Binance COIN-M 永续合约的资金费率和成交量
2. 原始数据和聚合数据写入本地 SQLite
3. Next.js 网页直接读取 SQLite 展示分析结果

当前仓库已经不是早期原型，不再以静态样例页为主，也不再以 Excel 为唯一数据源。

现在的真实数据链路是：

`Binance API -> funding_rates_raw / daily_volume_metrics -> daily / weekly / monthly 聚合 -> SQLite -> Web 页面`

## 2. 现在这套系统的核心原则

### 2.1 数据原则

- 数据准确性是第一优先级
- 不允许伪造历史数据
- 新币历史不够时可以缺失，不能补幻想值
- funding 的唯一真相层是 `funding_rates_raw`
- 日 / 周 / 月费率都应该是从 raw 或 daily 正规聚合出来
- 当前统计口径默认使用中国时区 `Asia/Shanghai`
- 如果以后改为 UTC，不应该直接硬改现有聚合结果，而是重建聚合层

### 2.2 页面原则

- `/` 是主页，也是费率总览
- 当前阶段先把费率页打磨清楚，其它页面都是辅助页
- 页面可以慢慢改，但数据层必须先可靠

### 2.3 运行原则

- 目前仍以手动运行脚本为主
- 定时任务和服务器部署放到后面
- 在页面结构和数据口径没有彻底确认前，不急着做自动调度

## 3. 当前页面结构

当前网页有 6 个页面：

- `/` 费率总览
- `/monthly` 月费率明细表
- `/audit` 数据审计
- `/volume` 成交量观察
- `/combined` 联合筛选
- `/heatmap` 热力图

当前共识：

- `/` 是当前最重要页面
- 其它页面暂时保留，但很多仍处于辅助阶段
- 左侧小导航保留，用于页面切换

## 4. 当前数据结构

SQLite 默认路径：

- `data/bian_rate.sqlite3`

当前核心表：

- `symbols`
- `collector_runs`
- `funding_rates_raw`
- `daily_funding_metrics`
- `weekly_funding_metrics`
- `monthly_funding_metrics`
- `daily_volume_metrics`
- `funding_quality_audits`
- `volume_quality_audits`
- `market_snapshots`

这些表现在的角色要这样理解：

- `funding_rates_raw`
  - 原始 funding 事件
  - 最重要
  - 以后改时区或重建聚合，都依赖它
- `daily_funding_metrics`
  - 按时区聚合后的日费率
- `weekly_funding_metrics`
  - 周费率备用层
  - 已经落库，不再只是计划
- `monthly_funding_metrics`
  - 月费率
- `daily_volume_metrics`
  - 日成交量
- `funding_quality_audits`
  - funding 完整性审计
- `volume_quality_audits`
  - volume 覆盖和口径审计
- `market_snapshots`
  - 供页面快速读取的摘要快照

## 5. 当前已确认的数据范围

基于当前本地库，已确认的覆盖范围是：

- 日费率：`2023-04-03` 到 `2026-04-02`
- 周费率：`2023-04-03/2023-04-09` 到 `2026-03-30/2026-04-05`
- 月费率：`2023-04` 到 `2026-04`
- 日成交量：`2023-04-05` 到 `2026-04-03`
- 覆盖币种：`22`

当前 22 个币在 `symbols` 表中仍是活跃状态。

## 6. 当前已经完成的关键工作

### 6.1 funding 侧

已经完成：

- funding 原始事件写入 `funding_rates_raw`
- 日费率写入 `daily_funding_metrics`
- 周费率写入 `weekly_funding_metrics`
- 月费率写入 `monthly_funding_metrics`
- funding 审计写入 `funding_quality_audits`
- `rebuild_funding_from_raw.py` 已可从 raw 重建日 / 周 / 月聚合
- 主采集脚本已支持 `--timezone`
- 重建脚本已支持 `--timezone`

当前已验证结论：

- 最新 funding 审计结果中，22 个币全部是 `ok`
- 说明当前 funding 数据没有被审计层发现明显 gap 或 0 事件天异常

### 6.2 volume 侧

已经完成：

- `daily_volume_metrics` 落库
- `volume_quality_audits` 落库
- COIN-M 1d kline 历史分页逻辑已修正
- volume 审计页已接到前端

之前明确发现并修掉的问题：

- 旧逻辑只抓到约 230 天 volume
- 根因是分页窗口逻辑不对
- 修正后已恢复长历史抓取

关于新币 `SUI / WIF / WLD`：

- 它们之前被误显示为 `failed`
- 真正原因不是抓取失败，而是上线较晚、历史较短
- 现在审计结果已改为正常，只在备注中标记 `short_history_or_new_listing`

当前已验证结论：

- 22 个币当前都有 volume 数据
- `SUI / WIF / WLD` 属于正常短历史，不应视为异常失败

### 6.3 Web 侧

已经完成：

- 页面改为直接读 SQLite
- 页面不再依赖样例数据回退
- `/audit` 已能展示 funding / volume 审计状态
- `/monthly` 已有月费率热力表
- 首页 `/` 已按当前需求进行了大量定制

## 7. 当前最重要的代码文件

明天继续工作时，优先看这些文件：

- `binance_coin_funding_rate_collector.py`
- `sqlite_store.py`
- `rebuild_funding_from_raw.py`
- `import_outputs_to_sqlite.py`
- `backfill_volume_history.py`
- `web/lib/sqlite-workbench-data.ts`
- `web/lib/workbench-data.ts`
- `web/components/market-workbench.tsx`
- `README.md`
- 本文件

## 8. 常用命令

### 主采集

```bash
python binance_coin_funding_rate_collector.py
```

切到 UTC 聚合示例：

```bash
python binance_coin_funding_rate_collector.py --timezone UTC
```

### 从 raw 重建 funding 聚合

```bash
python rebuild_funding_from_raw.py
```

切到 UTC 重建示例：

```bash
python rebuild_funding_from_raw.py --timezone UTC
```

### 回填 volume

```bash
python backfill_volume_history.py
```

### 启动网页

```bash
cd web
npm run build
npm run start -- --hostname 127.0.0.1 --port 3026
```

访问：

- `http://127.0.0.1:3026/`

## 9. 当前不要误判的几件事

### 9.1 Funding 审计不是“没数据”

如果以后看到审计为空，要区分两件事：

- 没有 funding 数据
- 有 funding 数据，但还没跑审计

这两者不是一回事。

### 9.2 新币短历史不是异常

如果新上币上线较晚：

- 它的 volume 或 funding 历史可能不足 3 年
- 这种情况应显示为短历史
- 不能误标成失败
- 更不能补造历史

### 9.3 时区切换不是前端改一下就完了

如果后面从 `Asia/Shanghai` 改到 `UTC`：

- 不能只改页面显示
- 应该基于 `funding_rates_raw` 重新生成 daily / weekly / monthly

## 10. 明天应继续做什么

明天不建议先做定时任务。

定时任务放后面，等页面和数据口径都更稳定、并且程序准备上服务器时再做。

明天建议继续的方向是：

1. 继续完善主要页面，尤其是 `/`
2. 评估 `weekly_funding_metrics` 在页面里如何消费
3. 继续收紧审计页表达，让异常、短历史、正常三类更好区分
4. 对 volume 口径做进一步人工抽样核验
5. 再决定是否需要新增更多页面或删减辅助页

## 11. 明天开工的第一步建议

如果明天重新开始，建议按这个顺序：

1. 先看本文件
2. 再看 `README.md`
3. 打开首页 `/` 和审计页 `/audit`
4. 确认今天的数据状态是否仍然成立
5. 再继续做页面或数据口径调整

## 12. 暂时不要做的事

当前暂时不要优先做这些：

- 不要先做定时任务
- 不要先做服务器部署
- 不要先回补 Binance 全历史
- 不要为了页面完整度去放松数据准确性

## 13. 当前一句话结论

这套系统现在已经从“页面原型”进入“本地可用的数据分析台”阶段。

当前最重要的不是加更多功能，而是：

- 保持数据层可信
- 继续把首页做顺手
- 让审计结果更直观
- 等页面和口径稳定后，再做自动化运行
