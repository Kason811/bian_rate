# NUC 采集任务专用马来西亚出口

运维方案日期：2026-09-28（Asia/Shanghai）。适用 NUC 当前 Mihomo v1.19.20，以及 `bian-rate-collector.service`、`bian-rate-research-4h-cache.service`。

最近恢复验收：2026-09-28 11:09。日频于 10:56:02、4h 于 11:08:48 成功结束，两个 service 退出码均为 0，真实状态文件均为 success。当前在采 COIN-M 20 个 + 同名单 USDT-M 20 个，最近 30 个完整日 funding/volume 无缺失，最近 30 天 4h/8h 无缺桶且 8h 均由完整两个 4h 桶组成；最新 4h 为中国时间 2026-09-28 04:00 开始、07:59:59 收线。原 42 项审计仍有 WIF/WLD 两项既有 warning，详见下方验收边界。日常 funding/volume 参数恢复为 14/45 天，未再次重启整机或等待后续自然定时触发。此段是历史验收，不代替当前任务状态。

## 故障与方案

默认 `节点选择` 为 `LAX_洛杉矶_直出`。日频在 Python Binance Client 初始化 ping 时被地区限制拒绝；4h 在 COIN-M exchangeInfo 请求处出现 HTTP 451，部分旧记录还有 TLS EOF。2026-09-28 对比测试：默认 7890 出口访问 api/dapi/fapi 三个域名均为 451；指定 `MY_马来西亚_直出` 的相同接口及资金费率、4h K 线接口均为 200。

采用独立 loopback mixed listener：`127.0.0.1:7891` → 手动选择组 `币安采集` → 所选马来西亚节点。默认 `MY_马来西亚_直出`。只有两个定时任务通过独立环境文件使用它。Mihomo 的 listener `proxy` 字段直接指定独立代理组，无须把所有 Binance 域名改为马来西亚，也无须识别共享 Python 进程名。日常 `节点选择` 切换不影响这两个任务；所选节点不可用时任务失败，组内不自动切换。

11:09 恢复时 listener 直接指定马来西亚直出；用户随后授权后台手动管理，11:26 改为独立 select 组。仍使用原来的同一个 Mihomo 服务，PID 2231，7891 是代理流量入口，9090 是控制器与 UI。11:27 验证：配置校验通过、热加载 204、默认五类接口 HTTP 200、马来西亚家宽 ping 200、手动切换后热加载保留选择；最终已恢复直出，日常洛杉矶选择保持不变。

该方案只适用于公共行情采集；不会改动其他交易服务、Web 服务或全局节点选择。节点是否可用以实际接口测试为准，不能只看名称或 alive 标记。

## 文件与安装

本仓库可公开保留：

- `deploy/mihomo-bian-rate-listener.yaml`：独立 select 组和 listener 的无凭据片段；分别合并到既有 `/etc/mihomo/config.yaml` 的 proxy-groups、listeners 数组，不能用它覆盖主配置。需要现有两个具名出站及 provider `mysub`。
- `deploy/bian-rate-proxy.env`：HTTP/HTTPS/ALL_PROXY（含大小写）指向 7891；NO_PROXY 仅为本机地址。
- `deploy/bian-rate-malaysia-proxy.conf`：两个 service 共用的 systemd drop-in，启动时要求 Mihomo，并加载专用代理环境。

运行文件：

```text
/etc/mihomo/config.yaml
/home/ben/server/vibecode/bian_rate/deploy/bian-rate-proxy.env
/etc/systemd/system/bian-rate-collector.service.d/20-malaysia-proxy.conf
/etc/systemd/system/bian-rate-research-4h-cache.service.d/20-malaysia-proxy.conf
```

不要把代理参数写进共享 `deploy/bian-rate.env`：Web 也加载该文件。不要把完整 Mihomo 配置、UUID、Reality 参数、Token 或节点地址提交到本仓库。

安装前备份主配置、unit/drop-in、数据库和缓存，检查 7891 未占用、具名节点和 provider 存在。先用 `mihomo -t -d /etc/mihomo -f <候选配置>` 校验，再通过仅本机的 Mihomo API 热加载；API Secret 仅在内存中读取，不写入命令行或日志。核对日常节点选择与 Mihomo PID 保持一致，以及独立组的实际选中节点。

安装 drop-in 会修改服务配置：

```bash
sudo install -d /etc/systemd/system/bian-rate-collector.service.d
sudo install -d /etc/systemd/system/bian-rate-research-4h-cache.service.d
sudo install -m 0644 deploy/bian-rate-malaysia-proxy.conf /etc/systemd/system/bian-rate-collector.service.d/20-malaysia-proxy.conf
sudo install -m 0644 deploy/bian-rate-malaysia-proxy.conf /etc/systemd/system/bian-rate-research-4h-cache.service.d/20-malaysia-proxy.conf
sudo systemctl daemon-reload
```

`deploy/bian-rate-proxy.env` 必须在上述固定业务路径存在。两个任务正常计划保持：日频每天 08:06；4h 每天 00:03/04:03/08:03/12:03/16:03/20:03（Asia/Shanghai）。

## 在后台更换采集节点

在 NUC 远程桌面的浏览器打开 <http://127.0.0.1:9090/ui/>，沿用原来的后台连接信息，在代理页展开 `币安采集`，点击需要的节点。日常 `节点选择` 控制通用 7890 与原有规则；`币安采集` 只控制专用 7891。不要通过切换日常组来管理采集出口。

当前候选：静态 `MY_马来西亚_直出`、`🇲🇾 马来西亚 02 家宽`，以及 provider `mysub` 中名称匹配 `(?i)马来西亚|malaysia` 的节点。2026-09-28 验收时另有两条马来西亚家宽订阅节点，共四个候选。筛选按节点名称，不代表出口所在地或 Binance 可用性已经验证；直出五类接口已验证，静态家宽仅验证 ping，另外两条未单独验收。组内无 DIRECT、日常组或自动回退，`interval: 0` 不启用该组的定时测速；现有 provider 自己的设置保持原样。

既有 `profile.store-selected: true` 会记住手动选择，本次实测热加载后选择保留；未为验证而重启整机。初次配置没有选择记录时，第一个候选是直出。切换后按下方命令验证真实接口。切换影响新连接，已建立连接可能继续用旧节点，尽量在两个采集 service 均为 inactive 时操作。

若在 Windows 浏览器访问，先在 PowerShell 运行以下 SSH 本地转发并保持窗口打开，再访问 <http://127.0.0.1:19090/ui/>：

```powershell
ssh -N -L 127.0.0.1:19090:127.0.0.1:9090 nuc-ubuntu
```

Windows 的 127.0.0.1 指 Windows 自己，NUC 内的同地址才指 NUC。控制器继续只监听 NUC 本机，不为访问后台开放公网端口；不在文档或命令行展示控制器 Secret。重装主配置时同时保留独立组、listener 和选择记忆设置。

机制依据：[Mihomo listeners](https://wiki.metacubex.one/config/inbound/listeners/)、[手动选择组](https://wiki.metacubex.one/config/proxy-groups/select/)、[组的 provider/filter 字段](https://wiki.metacubex.one/config/proxy-groups/)。

## 验收与故障恢复

网络只读检查：

```bash
curl --proxy http://127.0.0.1:7891 --fail --max-time 20 https://api.binance.com/api/v3/ping
curl --proxy http://127.0.0.1:7891 --fail --max-time 20 https://dapi.binance.com/dapi/v1/time
curl --proxy http://127.0.0.1:7891 --fail --max-time 20 https://fapi.binance.com/fapi/v1/time
```

通过注册 service 触发会实际写数据库、Excel、研究缓存、状态和日志：

```bash
sudo systemctl start bian-rate-collector.service
sudo systemctl start bian-rate-research-4h-cache.service
```

分开运行，避免恢复时同时重抓触发限流。不能只看 systemd 的 Result=success（重启后可能尚无执行结果）：必须核对真实状态 JSON、日志和完整性审计。日频正常 funding 回看 14 天、volume 45 天，超过 14 天的停采先扩大一次 funding 窗口，再恢复日常值。2026-09-28 的恢复临时使用 30 天；临时 ExecStart 覆盖只位于 `/run/systemd/system/bian-rate-collector.service.d/90-recovery-window.conf`，验收后撤销，不纳入持久模板。

4h 脚本当前从上市日期抓全历史，不能假设它只补最后一个窗口。8h 由 4h 派生。必须核对 COIN-M 和 USDT-M 两个市场的最新已收线、缺桶以及 8h 桶是否恰好由两个 4h 桶组成。日频原审计主要覆盖 COIN-M；恢复时另外检查 USDT-M 的 funding 与 volume 缺失日期。

验收范围须与真实采集目标一致：USDT-M 只采集与当前活跃 COIN-M 同名单的币种。数据库仍有 WIF/WLD 的历史 active 记录，但两个采集器都不再采集它们；原 4h 审计因此从恢复前就有两项长期 warning。本次不更改业务名单、不删除历史数据，也不伪造全部审计通过：真实服务状态与当前 20+20 个采集对象的补充验收分别记录，面板 notes 保留这两项既有问题。

看板登记为 `/home/ben/server/vibecode/taskboard/tasks.json`，使用原日志与状态文件；两项 notes 应写明专用端口、独立手动组、默认节点、后台入口、依赖和最新恢复结论。更新后运行 `python3 /home/ben/server/vibecode/taskboard/refresh_dashboard.py`，检查真实采样时间和两项状态，不能手工伪造成功状态。

## 回退与维护

回退是写入操作，先检查有无后续配置和数据变更。只撤销后台管理时，将该 listener 的 proxy 改回 `MY_马来西亚_直出`，确认无其他引用再移除 `币安采集` 组，校验并热加载。撤销整个专用出口时，停止恢复中的采集，撤销两个 20-malaysia-proxy.conf，并移除专用 listener 和无其他引用的独立组；daemon-reload 与 Mihomo 校验/热加载后核对日常节点。不要直接覆盖其他任务登记或整个共享配置。恢复数据库/缓存仅在确认需要时进行，不能覆盖恢复期间的新数据。

2026-09-28 变更前备份在业务目录 `run/ops-backups/20260928-malaysia-105048/`（root 私有），包含原主配置、unit、共享环境、README、看板登记与说明、SQLite 在线备份和研究缓存归档。数据库备份通过 integrity_check。完整配置备份含凭据，只留服务器，不能复制到公开资料或 Git。

11:26 独立选择组变更前另备份主配置和看板登记/README：`run/ops-backups/20260928-select-112617/`，root 私有。本次仅修改代理组和 listener 指向，未重新补采或修改业务数据。验收证据 `run/collector-select-group-20260928.json` 记录配置校验、PID、选择记忆、真实接口及连接链。

生产 clone 原有研究缓存改动保留。通过维护 clone 同步本次文档和三个配置样例，禁止 add 全部运行缓存。该文档说明运行机制；历史验收结果以本地 NUC 项目入口的报告和当前状态为准。
