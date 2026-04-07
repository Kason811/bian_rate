# Research2 8-4 Directional RR1.5 Backtest

生成时间: 2026-04-07T05:40:04.219Z

参数: min=8, latestMin=4, penalty=7.8, max=40
交易方向: 只做 Bull / Bear 新家族信号，忽略 Sideways
入场: 信号后的下一周开盘
止盈: 1:1.5
每笔仓位: 1000U
未命中止损止盈时: 下一次方向信号开盘平仓
同周同时触发止损止盈: 先按止损

方向信号数: 13

## Stop Comparison
- ema21_anchor: trades=13, winRate=46.2%, net=342.13U, avg=26.32U, PF=1.5526, maxDD=-365.03U
- fixed_9.5pct: trades=13, winRate=46.2%, net=163.68U, avg=12.59U, PF=1.3037, maxDD=-355.39U
- fixed_9.0pct: trades=13, winRate=46.2%, net=158.68U, avg=12.21U, PF=1.3087, maxDD=-337.89U
- fixed_8.5pct: trades=13, winRate=46.2%, net=153.68U, avg=11.82U, PF=1.3143, maxDD=-320.39U
- fixed_10.0pct: trades=13, winRate=46.2%, net=97.18U, avg=7.48U, PF=1.1723, maxDD=-372.89U
- fixed_4.5pct: trades=13, winRate=46.2%, net=67.98U, avg=5.23U, PF=1.2158, maxDD=-202.50U
- segment_extreme: trades=13, winRate=46.2%, net=43.56U, avg=3.35U, PF=1.0452, maxDD=-758.06U
- fixed_3.5pct: trades=13, winRate=38.5%, net=-17.50U, avg=-1.35U, PF=0.9375, maxDD=-157.50U
- fixed_7.5pct: trades=13, winRate=38.5%, net=-18.53U, avg=-1.43U, PF=0.964, maxDD=-285.39U
- fixed_4.0pct: trades=13, winRate=38.5%, net=-34.52U, avg=-2.66U, PF=0.8921, maxDD=-180.00U
- fixed_6.0pct: trades=13, winRate=38.5%, net=-37.41U, avg=-2.88U, PF=0.9155, maxDD=-232.89U
- fixed_6.5pct: trades=13, winRate=38.5%, net=-42.41U, avg=-3.26U, PF=0.9113, maxDD=-250.39U
- fixed_7.0pct: trades=13, winRate=38.5%, net=-47.41U, avg=-3.65U, PF=0.9076, maxDD=-267.89U
- fixed_8.0pct: trades=13, winRate=38.5%, net=-51.32U, avg=-3.95U, PF=0.9057, maxDD=-302.89U
- fixed_5.0pct: trades=13, winRate=38.5%, net=-54.52U, avg=-4.19U, PF=0.8637, maxDD=-225.00U
- fixed_2.5pct: trades=13, winRate=30.8%, net=-75.00U, avg=-5.77U, PF=0.6667, maxDD=-150.00U
- fixed_3.0pct: trades=13, winRate=30.8%, net=-90.00U, avg=-6.92U, PF=0.6667, maxDD=-180.00U
- signal_week_extreme: trades=13, winRate=38.5%, net=-91.98U, avg=-7.08U, PF=0.8165, maxDD=-387.11U
- fixed_2.0pct: trades=13, winRate=23.1%, net=-110.00U, avg=-8.46U, PF=0.45, maxDD=-120.00U
- fixed_5.5pct: trades=13, winRate=30.8%, net=-202.02U, avg=-15.54U, PF=0.5919, maxDD=-330.00U

## Best Stop
- candidate: ema21_anchor
- trades: 13
- winRate: 46.2%
- netProfit: 342.13U
- avgPnlPerTrade: 26.32U
- profitFactor: 1.5526
- maxDrawdown: -365.03U

## Trades
- 2023-01-16 LONG Sideways->Bull: entry=20886.8, stop=19421.53, target=23084.71, exit=23084.71, reason=target, pnl=105.23U
- 2023-01-23 LONG Sideways->Bull: entry=22708.3, stop=19720.33, target=27190.25, exit=23741.1, reason=next_signal_open, pnl=45.48U
- 2023-01-30 LONG Sideways->Bull: entry=23741.1, stop=20085.85, target=29223.97, exit=20085.85, reason=stop, pnl=-153.96U
- 2023-09-04 SHORT Sideways->Bear: entry=25955.9, stop=27487.91, target=23657.89, exit=27487.91, reason=stop, pnl=-59.02U
- 2023-11-06 LONG Sideways->Bull: entry=35044.1, stop=28798.22, target=44412.92, exit=44412.92, reason=target, pnl=267.34U
- 2024-07-08 SHORT Bull->Bear: entry=55830, stop=60913.45, target=48204.83, exit=60913.45, reason=stop, pnl=-91.05U
- 2024-11-25 LONG Sideways->Bull: entry=98068.7, stop=69881.89, target=140348.91, exit=80695.7, reason=next_signal_open, pnl=-177.15U
- 2025-03-10 SHORT Sideways->Bear: entry=80695.7, stop=89255.64, target=67855.79, exit=82542.6, reason=next_signal_open, pnl=-22.89U
- 2025-03-17 SHORT Sideways->Bear: entry=82542.6, stop=88645.35, target=73388.48, exit=88645.35, reason=stop, pnl=-73.93U
- 2025-05-12 LONG Bear->Bull: entry=104089.1, stop=89320.17, target=126242.5, exit=126242.5, reason=target, pnl=212.83U
- 2025-11-17 SHORT Sideways->Bear: entry=94162, stop=109049.35, target=71830.97, exit=86770.3, reason=next_signal_open, pnl=78.5U
- 2025-11-24 SHORT Sideways->Bear: entry=86770.3, stop=107023.98, target=56389.78, exit=90338, reason=next_signal_open, pnl=-41.12U
- 2025-12-01 SHORT Sideways->Bear: entry=90338, stop=105507.08, target=67584.38, exit=67584.38, reason=target, pnl=251.87U
