# Research2 Family Grid Backtest

生成时间: 2026-04-07T05:29:29.550Z

样本预热: 104 周
总事件数(全部参数合并): 256
全部参数合并后的打回上一个家族概率: 10.5%
全部参数合并后的延续新家族概率: 77.0%

## 全部参数合并后的 Top Rules
- Close aligns prev EMA side + Seg ADX<TrendLevel + Seg posShare 40-60: precision=66.7%, support=6, wins=4, lift=6.32
- 1W price aligns prev side + Seg ADX<TrendLevel + Seg posShare 40-60: precision=66.7%, support=6, wins=4, lift=6.32
- Segment slope aligns prev side + Seg ADX<TrendLevel + Seg posShare 40-60: precision=66.7%, support=6, wins=4, lift=6.32
- Segment avg return aligns prev side + Seg ADX<TrendLevel + Seg posShare 40-60: precision=66.7%, support=6, wins=4, lift=6.32
- 1W price aligns prev side + Segment avg return aligns prev side + Seg ADX<TrendLevel: precision=62.5%, support=8, wins=5, lift=5.93
- BBW<70 + Segment slope aligns prev side + Seg posShare 40-60: precision=60.0%, support=10, wins=6, lift=5.69
- ADX<25 + Close aligns prev SMA side + Segment avg return aligns prev side: precision=60.0%, support=5, wins=3, lift=5.69
- ADX<TrendLevel + Close aligns prev SMA side + Segment avg return aligns prev side: precision=60.0%, support=5, wins=3, lift=5.69
- Close aligns prev SMA side + Segment slope aligns prev side + Seg ADX<TrendLevel: precision=60.0%, support=5, wins=3, lift=5.69
- Close aligns prev SMA side + Seg ADX<TrendLevel + Seg posShare 40-60: precision=60.0%, support=5, wins=3, lift=5.69
- BBW<70 + Close aligns prev SMA side + Segment slope aligns prev side: precision=57.1%, support=7, wins=4, lift=5.42
- BBW<70 + Segment slope aligns prev side + Seg |cumReturn|<8: precision=55.6%, support=9, wins=5, lift=5.27

## 全部参数合并后的 6 类变色路径
- 牛 -> 震荡灰: 样本=56, 打回=8, 打回率=14.3%, 延续新色率=73.2%
- 熊 -> 震荡灰: 样本=60, 打回=8, 打回率=13.3%, 延续新色率=75.0%
- 震荡灰 -> 牛: 样本=36, 打回=4, 打回率=11.1%, 延续新色率=88.9%
- 震荡灰 -> 熊: 样本=52, 打回=6, 打回率=11.5%, 延续新色率=88.5%
- 牛 -> 熊: 样本=23, 打回=1, 打回率=4.3%, 延续新色率=47.8%
- 熊 -> 牛: 样本=29, 打回=0, 打回率=0.0%, 延续新色率=75.9%

## 分参数结果
### 8-5-7.8-40
- 参数: min=8, latestMin=5, penalty=7.8, max=40
- 总事件数: 45
- 打回上一个家族概率: 20.0%
- 延续新家族概率: 71.1%
- 6 类变色路径:
  牛 -> 震荡灰: 样本=14, 打回率=14.3%, 延续新色率=78.6%
  熊 -> 震荡灰: 样本=11, 打回率=18.2%, 延续新色率=72.7%
  震荡灰 -> 牛: 样本=8, 打回率=25.0%, 延续新色率=75.0%
  震荡灰 -> 熊: 样本=9, 打回率=33.3%, 延续新色率=66.7%
  牛 -> 熊: 样本=1, 打回率=0.0%, 延续新色率=0.0%
  熊 -> 牛: 样本=2, 打回率=0.0%, 延续新色率=50.0%
- Top Rules:
- BBW<70 + Segment slope aligns prev side: precision=60.0%, support=5, wins=3, lift=3.00
- BBW<70 + Close aligns prev EMA side + Segment slope aligns prev side: precision=60.0%, support=5, wins=3, lift=3.00
- BBW<70 + ReturnZ aligns prev side + Segment slope aligns prev side: precision=60.0%, support=5, wins=3, lift=3.00
- BBW<70 + 1W price aligns prev side + Segment slope aligns prev side: precision=60.0%, support=5, wins=3, lift=3.00
- BBW<70 + Segment slope aligns prev side + Segment avg return aligns prev side: precision=60.0%, support=5, wins=3, lift=3.00
- BBW<70 + Segment slope aligns prev side + Seg posShare 40-60: precision=60.0%, support=5, wins=3, lift=3.00
- BBW<70 + Segment avg return aligns prev side: precision=50.0%, support=8, wins=4, lift=2.50
- BBW<30 + |ReturnZ|<0.5: precision=50.0%, support=8, wins=4, lift=2.50

### 8-4-7.8-40
- 参数: min=8, latestMin=4, penalty=7.8, max=40
- 总事件数: 36
- 打回上一个家族概率: 5.6%
- 延续新家族概率: 86.1%
- 6 类变色路径:
  牛 -> 震荡灰: 样本=13, 打回率=7.7%, 延续新色率=92.3%
  熊 -> 震荡灰: 样本=10, 打回率=0.0%, 延续新色率=90.0%
  震荡灰 -> 牛: 样本=5, 打回率=20.0%, 延续新色率=80.0%
  震荡灰 -> 熊: 样本=6, 打回率=0.0%, 延续新色率=100.0%
  牛 -> 熊: 样本=1, 打回率=0.0%, 延续新色率=0.0%
  熊 -> 牛: 样本=1, 打回率=0.0%, 延续新色率=0.0%
- Top Rules:
- |ReturnZ|<0.5 + Seg ADX<TrendLevel: precision=28.6%, support=7, wins=2, lift=5.14
- ADX<25 + |ReturnZ|<0.5 + Seg ADX<TrendLevel: precision=28.6%, support=7, wins=2, lift=5.14
- ADX<TrendLevel + |ReturnZ|<0.5 + Seg ADX<TrendLevel: precision=28.6%, support=7, wins=2, lift=5.14
- BBW<70 + |ReturnZ|<0.5 + Seg ADX<TrendLevel: precision=28.6%, support=7, wins=2, lift=5.14
- ADX<25 + |ReturnZ|<0.5: precision=22.2%, support=9, wins=2, lift=4.00
- ADX<TrendLevel + |ReturnZ|<0.5: precision=22.2%, support=9, wins=2, lift=4.00
- ADX<25 + ADX<TrendLevel + |ReturnZ|<0.5: precision=22.2%, support=9, wins=2, lift=4.00
- ADX<25 + BBW<70 + |ReturnZ|<0.5: precision=22.2%, support=9, wins=2, lift=4.00

### 8-3-7.8-40
- 参数: min=8, latestMin=3, penalty=7.8, max=40
- 总事件数: 26
- 打回上一个家族概率: 15.4%
- 延续新家族概率: 80.8%
- 6 类变色路径:
  牛 -> 震荡灰: 样本=11, 打回率=9.1%, 延续新色率=81.8%
  熊 -> 震荡灰: 样本=7, 打回率=0.0%, 延续新色率=100.0%
  震荡灰 -> 牛: 样本=3, 打回率=33.3%, 延续新色率=66.7%
  震荡灰 -> 熊: 样本=5, 打回率=40.0%, 延续新色率=60.0%
  牛 -> 熊: 样本=0, 打回率=0.0%, 延续新色率=0.0%
  熊 -> 牛: 样本=0, 打回率=0.0%, 延续新色率=0.0%
- Top Rules:
- Segment avg return aligns prev side: precision=40.0%, support=5, wins=2, lift=2.60
- ADX<25 + Close aligns prev EMA side: precision=40.0%, support=5, wins=2, lift=2.60
- ADX<25 + 1W price aligns prev side: precision=40.0%, support=5, wins=2, lift=2.60
- ADX<TrendLevel + Close aligns prev EMA side: precision=40.0%, support=5, wins=2, lift=2.60
- ADX<TrendLevel + 1W price aligns prev side: precision=40.0%, support=5, wins=2, lift=2.60
- Close aligns prev EMA side + Segment avg return aligns prev side: precision=40.0%, support=5, wins=2, lift=2.60
- ReturnZ aligns prev side + Segment avg return aligns prev side: precision=40.0%, support=5, wins=2, lift=2.60
- ADX<25 + ADX<TrendLevel + Close aligns prev EMA side: precision=40.0%, support=5, wins=2, lift=2.60

### 7-5-7.8-40
- 参数: min=7, latestMin=5, penalty=7.8, max=40
- 总事件数: 61
- 打回上一个家族概率: 9.8%
- 延续新家族概率: 73.8%
- 6 类变色路径:
  牛 -> 震荡灰: 样本=7, 打回率=28.6%, 延续新色率=42.9%
  熊 -> 震荡灰: 样本=9, 打回率=33.3%, 延续新色率=55.6%
  震荡灰 -> 牛: 样本=9, 打回率=0.0%, 延续新色率=100.0%
  震荡灰 -> 熊: 样本=14, 打回率=7.1%, 延续新色率=92.9%
  牛 -> 熊: 样本=8, 打回率=0.0%, 延续新色率=50.0%
  熊 -> 牛: 样本=14, 打回率=0.0%, 延续新色率=78.6%
- Top Rules:
- 1W price aligns prev side + Segment slope aligns prev side: precision=80.0%, support=5, wins=4, lift=8.13
- Close aligns prev EMA side + 1W price aligns prev side + Segment slope aligns prev side: precision=80.0%, support=5, wins=4, lift=8.13
- 1W price aligns prev side + Segment slope aligns prev side + Seg |cumReturn|<8: precision=80.0%, support=5, wins=4, lift=8.13
- 1W price aligns prev side + Segment slope aligns prev side + Seg posShare 40-60: precision=80.0%, support=5, wins=4, lift=8.13
- Segment slope aligns prev side: precision=66.7%, support=6, wins=4, lift=6.78
- Close aligns prev EMA side + Segment slope aligns prev side: precision=66.7%, support=6, wins=4, lift=6.78
- Segment slope aligns prev side + Seg |cumReturn|<8: precision=66.7%, support=6, wins=4, lift=6.78
- Segment slope aligns prev side + Seg posShare 40-60: precision=66.7%, support=6, wins=4, lift=6.78

### 7-4-7.8-40
- 参数: min=7, latestMin=4, penalty=7.8, max=40
- 总事件数: 50
- 打回上一个家族概率: 6.0%
- 延续新家族概率: 74.0%
- 6 类变色路径:
  牛 -> 震荡灰: 样本=7, 打回率=14.3%, 延续新色率=42.9%
  熊 -> 震荡灰: 样本=12, 打回率=16.7%, 延续新色率=58.3%
  震荡灰 -> 牛: 样本=6, 打回率=0.0%, 延续新色率=100.0%
  震荡灰 -> 熊: 样本=11, 打回率=0.0%, 延续新色率=100.0%
  牛 -> 熊: 样本=6, 打回率=0.0%, 延续新色率=50.0%
  熊 -> 牛: 样本=8, 打回率=0.0%, 延续新色率=87.5%
- Top Rules:
- |ReturnZ|<0.5 + 1W price aligns prev side + Seg posShare 40-60: precision=20.0%, support=5, wins=1, lift=3.33
- Close aligns prev EMA side + 1W price aligns prev side + Seg posShare 40-60: precision=20.0%, support=5, wins=1, lift=3.33
- 1W price aligns prev side + Seg |cumReturn|<8 + Seg posShare 40-60: precision=20.0%, support=5, wins=1, lift=3.33
- Close aligns prev EMA side + Seg |cumReturn|<8: precision=18.8%, support=16, wins=3, lift=3.13
- Close aligns prev EMA side + Close aligns prev SMA side + Seg |cumReturn|<8: precision=16.7%, support=12, wins=2, lift=2.78
- |ReturnZ|<0.5 + Seg posShare 40-60: precision=16.7%, support=6, wins=1, lift=2.78
- Close aligns prev EMA side + ReturnZ aligns prev side: precision=16.7%, support=6, wins=1, lift=2.78
- 1W price aligns prev side + Seg posShare 40-60: precision=16.7%, support=6, wins=1, lift=2.78

### 7-3-7.8-40
- 参数: min=7, latestMin=3, penalty=7.8, max=40
- 总事件数: 38
- 打回上一个家族概率: 7.9%
- 延续新家族概率: 81.6%
- 6 类变色路径:
  牛 -> 震荡灰: 样本=4, 打回率=25.0%, 延续新色率=75.0%
  熊 -> 震荡灰: 样本=11, 打回率=9.1%, 延续新色率=81.8%
  震荡灰 -> 牛: 样本=5, 打回率=0.0%, 延续新色率=100.0%
  震荡灰 -> 熊: 样本=7, 打回率=0.0%, 延续新色率=100.0%
  牛 -> 熊: 样本=7, 打回率=14.3%, 延续新色率=57.1%
  熊 -> 牛: 样本=4, 打回率=0.0%, 延续新色率=75.0%
- Top Rules:
- ADX<25 + |ReturnZ|<0.5 + RSI 40-60: precision=20.0%, support=5, wins=1, lift=2.53
- ADX<25 + RSI 40-60 + Seg ADX<TrendLevel: precision=20.0%, support=5, wins=1, lift=2.53
- ADX<TrendLevel + |ReturnZ|<0.5 + RSI 40-60: precision=20.0%, support=5, wins=1, lift=2.53
- ADX<TrendLevel + RSI 40-60 + Seg ADX<TrendLevel: precision=20.0%, support=5, wins=1, lift=2.53
- BBW<70 + |ReturnZ|<0.5 + Seg |cumReturn|<8: precision=20.0%, support=5, wins=1, lift=2.53
- Close aligns prev EMA side: precision=16.7%, support=18, wins=3, lift=2.11
- Close aligns prev EMA side + Seg |cumReturn|<8: precision=16.7%, support=18, wins=3, lift=2.11
- |ReturnZ|<0.5 + Seg ADX<TrendLevel: precision=16.7%, support=6, wins=1, lift=2.11

