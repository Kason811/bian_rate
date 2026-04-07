# Research2 Latest-5 Reversion Backtest

生成时间: 2026-04-07T05:20:43.219Z

参数: min=8, latestMin=5, penalty=7.8, max=40

样本预热: 104 周

总事件数: 55
其中直接 family 变色事件: 45
精确标签打回率: 5.5%
family 打回率: 30.9%
直接 family 变色下的精确标签打回率: 6.7%
直接 family 变色下的 family 打回率: 20.0%

## Top Rules: Exact Reversion
- BBW<70 + Segment slope aligns prev side: precision=40.0%, support=5, wins=2, lift=7.33
- BBW<70 + Close aligns prev EMA side + Segment slope aligns prev side: precision=40.0%, support=5, wins=2, lift=7.33
- BBW<70 + ReturnZ aligns prev side + Segment slope aligns prev side: precision=40.0%, support=5, wins=2, lift=7.33
- BBW<70 + 1W price aligns prev side + Segment slope aligns prev side: precision=40.0%, support=5, wins=2, lift=7.33
- BBW<70 + Segment slope aligns prev side + Segment avg return aligns prev side: precision=40.0%, support=5, wins=2, lift=7.33
- BBW<70 + Segment slope aligns prev side + Seg posShare 40-60: precision=40.0%, support=5, wins=2, lift=7.33
- BBW<70 + Segment slope aligns prev side + Direct family flip: precision=40.0%, support=5, wins=2, lift=7.33
- BBW<70 + ReturnZ aligns prev side + Segment avg return aligns prev side: precision=33.3%, support=6, wins=2, lift=6.11
- ReturnZ aligns prev side + Segment slope aligns prev side + Segment avg return aligns prev side: precision=33.3%, support=6, wins=2, lift=6.11
- ReturnZ aligns prev side + Segment avg return aligns prev side: precision=28.6%, support=7, wins=2, lift=5.24
- Segment slope aligns prev side + Segment avg return aligns prev side: precision=28.6%, support=7, wins=2, lift=5.24
- BBW<70 + Close aligns prev EMA side + Segment avg return aligns prev side: precision=28.6%, support=7, wins=2, lift=5.24

## Top Rules: Family Reversion
- Seg ADX<TrendLevel + Seg posShare 40-60: precision=71.4%, support=7, wins=5, lift=2.31
- BBW<70 + Seg ADX<TrendLevel + Seg posShare 40-60: precision=71.4%, support=7, wins=5, lift=2.31
- BBW<30 + |ReturnZ|<0.5 + Seg |cumReturn|<8: precision=70.0%, support=10, wins=7, lift=2.26
- BBW<30 + |ReturnZ|<0.5: precision=66.7%, support=15, wins=10, lift=2.16
- BBW<70 + BBW<30 + |ReturnZ|<0.5: precision=66.7%, support=15, wins=10, lift=2.16
- BBW<30 + |ReturnZ|<0.5 + RSI 40-60: precision=66.7%, support=9, wins=6, lift=2.16
- BBW<30 + |ReturnZ|<0.5 + Seg posShare 40-60: precision=66.7%, support=9, wins=6, lift=2.16
- ADX<25 + Seg ADX<TrendLevel + Seg posShare 40-60: precision=66.7%, support=6, wins=4, lift=2.16
- ADX<TrendLevel + Seg ADX<TrendLevel + Seg posShare 40-60: precision=66.7%, support=6, wins=4, lift=2.16
- |ReturnZ|<0.5 + RSI 40-60 + Seg |cumReturn|<8: precision=66.7%, support=6, wins=4, lift=2.16
- BBW<70 + |ReturnZ|<0.5 + Seg |cumReturn|<8: precision=63.6%, support=11, wins=7, lift=2.06
- |ReturnZ|<0.5 + RSI 40-60: precision=60.0%, support=10, wins=6, lift=1.94

## Top Rules: Exact Reversion, Direct Family Flip Only
- BBW<70 + Segment slope aligns prev side: precision=40.0%, support=5, wins=2, lift=6.00
- BBW<70 + Close aligns prev EMA side + Segment slope aligns prev side: precision=40.0%, support=5, wins=2, lift=6.00
- BBW<70 + ReturnZ aligns prev side + Segment slope aligns prev side: precision=40.0%, support=5, wins=2, lift=6.00
- BBW<70 + 1W price aligns prev side + Segment slope aligns prev side: precision=40.0%, support=5, wins=2, lift=6.00
- BBW<70 + Segment slope aligns prev side + Segment avg return aligns prev side: precision=40.0%, support=5, wins=2, lift=6.00
- BBW<70 + Segment slope aligns prev side + Seg posShare 40-60: precision=40.0%, support=5, wins=2, lift=6.00
- BBW<70 + Segment slope aligns prev side + Direct family flip: precision=40.0%, support=5, wins=2, lift=6.00
- BBW<70 + ReturnZ aligns prev side + Segment avg return aligns prev side: precision=33.3%, support=6, wins=2, lift=5.00
- ReturnZ aligns prev side + Segment slope aligns prev side + Segment avg return aligns prev side: precision=33.3%, support=6, wins=2, lift=5.00
- ReturnZ aligns prev side + Segment avg return aligns prev side: precision=28.6%, support=7, wins=2, lift=4.29
- Segment slope aligns prev side + Segment avg return aligns prev side: precision=28.6%, support=7, wins=2, lift=4.29
- BBW<70 + Close aligns prev EMA side + Segment avg return aligns prev side: precision=28.6%, support=7, wins=2, lift=4.29

## Top Rules: Family Reversion, Direct Family Flip Only
- BBW<70 + Segment slope aligns prev side: precision=60.0%, support=5, wins=3, lift=3.00
- BBW<70 + Close aligns prev EMA side + Segment slope aligns prev side: precision=60.0%, support=5, wins=3, lift=3.00
- BBW<70 + ReturnZ aligns prev side + Segment slope aligns prev side: precision=60.0%, support=5, wins=3, lift=3.00
- BBW<70 + 1W price aligns prev side + Segment slope aligns prev side: precision=60.0%, support=5, wins=3, lift=3.00
- BBW<70 + Segment slope aligns prev side + Segment avg return aligns prev side: precision=60.0%, support=5, wins=3, lift=3.00
- BBW<70 + Segment slope aligns prev side + Seg posShare 40-60: precision=60.0%, support=5, wins=3, lift=3.00
- BBW<70 + Segment slope aligns prev side + Direct family flip: precision=60.0%, support=5, wins=3, lift=3.00
- BBW<70 + Segment avg return aligns prev side: precision=50.0%, support=8, wins=4, lift=2.50
- BBW<30 + |ReturnZ|<0.5: precision=50.0%, support=8, wins=4, lift=2.50
- BBW<70 + BBW<30 + |ReturnZ|<0.5: precision=50.0%, support=8, wins=4, lift=2.50
- BBW<70 + Segment avg return aligns prev side + Seg posShare 40-60: precision=50.0%, support=8, wins=4, lift=2.50
- BBW<70 + Segment avg return aligns prev side + Direct family flip: precision=50.0%, support=8, wins=4, lift=2.50

