# P5 密钥库+指纹+日志+转发 UI

> 父任务：`.trellis/tasks/07-07-ssh-host-manager`（design.md 第 2、4 节 + implement.md P5 清单为权威）。**依赖 P3**（ssh-screen 骨架）；转发 runtime 依赖 P2 连接池。

## Goal

补齐其余 4 个 section：密钥库（Keychain）、设备指纹（Known Hosts）、连接日志（Logs）、端口映射（含 daemon 侧 forward runtime）。

## Requirements

- 密钥库：列表 + 新建/编辑表单（Label/私钥/公钥/证书/passphrase）+ 文件导入（expo-document-picker / web input file，客户端读文本走 create RPC）。
- 设备指纹：指纹表（host/keyType/SHA256/首见时间/来源）+ `~/.ssh/known_hosts` 导入 + 删除/更新；指纹不匹配对话框（显示新旧指纹，确认后更新并重连）。
- 连接日志：表格（日期/时长/用户/主机/协议），来自 ssh.logs.list。
- 端口映射：daemon `ssh-forward-runtime.ts`（local=net server→forwardOut；remote=forwardIn→net.connect；dynamic=自维护最小 SOCKS5 仅 CONNECT；状态机 + autoStart 指数退避 ≤5 次）+ 规则卡片 UI（状态点 + start/stop + 编辑表单：Label/本地端口/绑定地址/所属主机/目标地址/目标端口）。

## Acceptance Criteria

- [ ] ssh-forward-runtime.test：local/remote/dynamic 三型各一条通过（本机 sshd + echo server）。
- [ ] 手动：-L 规则 start 后 curl 通；断连自动重试；stop 释放端口。
- [ ] 指纹篡改后重连被拒，UI 更新指纹后连通；known_hosts 导入出条目。
- [ ] 密钥增删改 + 导入可用；私钥不出现在下行消息。
- [ ] typecheck + lint 全绿。
