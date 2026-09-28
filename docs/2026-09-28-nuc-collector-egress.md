# NUC 采集任务专用马来西亚出口

运维方案日期：2026-09-28（Asia/Shanghai）。适用 NUC 当前 Mihomo v1.19.20，以及 `bian-rate-collector.service`、`bian-rate-research-4h-cache.service`。

## 故障与方案

默认 `节点选择` 为 `LAX_洛杉矶_直出`。日频在 Python Binance Client 初始化 ping 时被地区限制拒绝；4h 在 COIN-M exchangeInfo 请求处出现 HTTP 451，部分旧记录还有 TLS EOF。2026-09-28 对比测试：默认 7890 出口访问 api/dapi/fapi 三个域名均为 451；指定 `MY_马来西亚_直出` 的相同接口及资金费率、4h K 线接口均为 200。

采用独立 loopback mixed listener：`127.0.0.1:7891` → `MY_马来西亚_直出`。只有两个定时任务通过独立环境文件使用它。Mihomo 的 listener `proxy` 字段直接指定出站，无须把所有 Binance 域名改为马来西亚，也无须识别共享 Python 进程名。默认节点切换不影响这两个任务；马来西亚节点不可用时任务失败，不自动回退到美国出口。

该方案只适用于公共行情采集；不会改动其他交易服务、Web 服务或全局节点选择。节点是否可用以实际接口测试为准，不能只看名称或 alive 标记。

## 文件与安装

本仓库可公开保留：

- `deploy/mihomo-bian-rate-listener.yaml`：配置片段，不含节点参数，合并到既有 `/etc/mihomo/config.yaml` 的 listeners 数组，不能用它覆盖主配置。
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

安装前备份主配置、unit/drop-in、数据库和缓存，检查 7891 未占用及目标节点存在。先用 `mihomo -t -d /etc/mihomo -f <候选配置>` 校验，再通过仅本机的 Mihomo API 热加载；API Secret 仅在内存中读取，不写入命令行或日志。核对默认节点选择与 Mihomo PID保持一致。

安装 drop-in 会修改服务配置：

```bash
sudo install -d /etc/systemd/system/bian-rate-collector.service.d
sudo install -d /etc/systemd/system/bian-rate-research-4h-cache.service.d
sudo install -m 0644 deploy/bian-rate-malaysia-proxy.conf /etc/systemd/system/bian-rate-collector.service.d/20-malaysia-proxy.conf
sudo install -m 0644 deploy/bian-rate-malaysia-proxy.conf /etc/systemd/system/bian-rate-research-4h-cache.service.d/20-malaysia-proxy.conf
sudo systemctl daemon-reload
```

`deploy/bian-rate-proxy.env` 必须在上述固定业务路径存在。两个任务正常计划保持：日频每天 08:06；4h 每天 00:03/04:03/08:03/12:03/16:03/20:03（Asia/Shanghai）。

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

看板登记为 `/home/ben/server/vibecode/taskboard/tasks.json`，使用原日志与状态文件；两项 notes 应写明专用端口、节点、依赖和最新恢复结论。更新后运行 `python3 /home/ben/server/vibecode/taskboard/refresh_dashboard.py`，检查真实采样时间和两项状态，不能手工伪造成功状态。

## 回退与维护

回退是写入操作，先检查有无后续配置和数据变更。停止恢复中的采集，撤销仅本次的两个 20-malaysia-proxy.conf，并移除仅本次的 listener；daemon-reload 与 Mihomo 校验/热加载后核对默认节点。不要直接覆盖其他任务登记或整个共享配置。恢复数据库/缓存仅在确认需要时进行，不能覆盖恢复期间的新数据。

2026-09-28 变更前备份在业务目录 `run/ops-backups/20260928-malaysia-105048/`（root 私有），包含原主配置、unit、共享环境、README、看板登记与说明、SQLite 在线备份和研究缓存归档。数据库备份通过 integrity_check。完整配置备份含凭据，只留服务器，不能复制到公开资料或 Git。

生产 clone 原有研究缓存改动保留。通过维护 clone 同步本次文档和三个配置样例，禁止 add 全部运行缓存。该文档说明运行机制；历史验收结果以本地 NUC 项目入口的报告和当前状态为准。
