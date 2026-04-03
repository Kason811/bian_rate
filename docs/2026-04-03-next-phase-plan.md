# 2026-04-03 下一阶段工作计划

这份文档用于明天继续工作时直接接续，不再重新梳理上下文。

## 1. 当前项目状态

当前主线已经明确：

1. Python 采集 Binance COIN-M 永续资金费率与成交量
2. 数据写入本地 SQLite
3. Next.js 页面直接读取 SQLite 展示

当前前端页面：

- `/` 费率总览
- `/monthly` 月费率明细表
- `/volume` 成交量观察
- `/combined` 联合筛选
- `/heatmap` 热力图

当前数据库实际范围：

- 日费率：`2023-04-03` 到 `2026-04-02`
- 月费率：`2023-04` 到 `2026-04`
- 日成交量：`2023-04-05` 到 `2026-04-02`
- 覆盖币种：`22`

当前资金费率数据层：

- `funding_rates_raw`
- `daily_funding_metrics`
- `monthly_funding_metrics`
- `market_snapshots`

当前成交量数据层：

- `daily_volume_metrics`

## 2. 当前确认过的设计原则

### 2.1 页面侧

- `/` 费率总览作为主页
- 左侧保留小导航，用于跳转不同页面
- 费率页面优先，其他页面暂时是辅助页

### 2.2 数据侧

- 数据准确性优先于页面扩展
- 不允许伪造数据
- 新币数据不足时允许空值，不能补幻想值
- 当前统计口径默认使用中国时区 `Asia/Shanghai`
- 原始 funding 事件必须保留，便于后续按其他时区重建

## 3. 下一阶段目标

下一阶段不是继续快速堆页面，而是先把数据层做成“可校验、可重建、可定时运行”。

核心目标：

1. 新增周费率层，作为日/月之间的备用聚合口径
2. 增强 funding 数据完整性校验
3. 增强 volume 数据口径校验
4. 让时区聚合可配置并可重建
5. 为后续每日定时拉取和补数做好结构准备

## 4. 明确要做的事情

### 第一组：周费率层

目标：

- 在现有 `raw -> daily -> monthly` 之间，增加 `weekly_funding_metrics`

建议实现：

1. SQLite 新增 `weekly_funding_metrics`
2. 由 raw 或 daily 重建周费率
3. 周聚合口径与当前时区配置一致
4. 周表至少保存：
   - `symbol`
   - `metric_week`
   - `weekly_funding_rate`
   - `positive_days`
   - `negative_days`
   - `zero_days`
   - `run_id`
   - `updated_at`

说明：

- 周表不是页面立即必须，但后续分析会用到
- 周层最好和月层一样是正式持久化，不要只在前端临时现算

### 第二组：funding 完整性校验

目标：

- 证明 funding 抓取是完整的，不只是“代码看起来对”

建议实现：

1. 针对每个 symbol 检查：
   - 原始事件时间是否去重成功
   - 是否存在逆序、重复、异常间隔
2. 增加按天的事件数统计：
   - 每天实际 funding event 数量
   - 是否明显异常
3. 在 collector run 完成后输出质量摘要：
   - 哪些 symbol 正常
   - 哪些 symbol 存在缺口
   - 哪些 symbol 被跳过
4. 质量结果写入数据库或单独报告文件

优先原因：

- 现在日/月聚合逻辑本身是合理的
- 更大的风险在“事件是否漏抓”

### 第三组：volume 口径校验

目标：

- 确认当前 COIN-M 成交量统计没有错位

建议实现：

1. 明确 Binance COIN-M K 线各字段含义
2. 复核当前 `contract_volume` / `usd_volume` 计算方式
3. 抽样验证 BTC / ETH / 小币种
4. 对新币不足历史的数据保持空值，不做补造
5. 质量结果写入 run 摘要

优先原因：

- 成交量口径错，比缺几天数据更危险
- 现在这块需要工程化核验，而不是继续凭经验默认

### 第四组：时区配置化与可重建

目标：

- 将当前固定中国时区的聚合方式，升级成可配置聚合

建议实现：

1. 将 `GROUP_TIMEZONE = "Asia/Shanghai"` 抽成配置
2. 保持 `funding_rates_raw` 为唯一原始真相层
3. 提供聚合重建流程：
   - raw -> daily
   - daily/raw -> weekly
   - daily -> monthly
   - monthly -> snapshot
4. 后续如果切 UTC，不直接改表，而是重建聚合表

说明：

- 这不是简单前端切换
- 正确方式是保留 raw，重新生成聚合层

### 第五组：定时任务和补数

目标：

- 为后续稳定运行做准备

建议实现：

1. 日更主采集
2. 周期性补数扫描
3. run 失败重试
4. run 质量报告
5. 异常 symbol 清单

说明：

- 这部分现在先设计，不急着立刻全做完
- 但结构最好尽快留出来

## 5. 建议的执行顺序

按这个顺序做最稳：

1. 先完成当前页面框架确认
2. 新增 `weekly_funding_metrics`
3. 增加 funding 完整性校验
4. 增加 volume 口径校验
5. 抽出时区配置并支持重建聚合层
6. 设计并落地每日定时采集方案
7. 最后再考虑是否扩展到 Binance 更长历史

## 6. 关于是否现在就抓全历史

当前建议：

- 暂时不要立刻做“币安全部历史回补”

原因：

1. 当前 3 年数据对现阶段分析已经足够
2. 现在最重要的是先把口径和校验做好
3. 如果基础口径没完全校验，先拉更长历史只会放大潜在问题

更合理的做法：

- 先把 3 年数据做成可信数据层
- 再规划一次独立的全历史 backfill

## 7. 明天开始时优先看的文件

- `binance_coin_funding_rate_collector.py`
- `sqlite_store.py`
- `web/lib/sqlite-workbench-data.ts`
- `web/lib/workbench-data.ts`
- `web/components/market-workbench.tsx`
- `README.md`
- 本文件：`docs/2026-04-03-next-phase-plan.md`

## 8. 明天建议的第一步

不要先继续改页面细节。

明天第一步建议直接做：

1. 设计 `weekly_funding_metrics` 表结构
2. 在 collector 中补齐周聚合写入
3. 顺手加入 funding 质量校验的第一版骨架

如果当天还有余量，再继续做 volume 口径核验。
