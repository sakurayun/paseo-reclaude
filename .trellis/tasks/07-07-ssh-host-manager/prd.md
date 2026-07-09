# Paseo 内建 SSH 主机管理器

## Goal

在 Paseo 内建 Termius 式 SSH 主机管理：左侧导航栏「定时任务」入口替换为「SSH」，侧边栏原地切换 SSH 导航；主面板提供主机卡片、全字段编辑、密钥库、端口转发、设备指纹（known hosts）、连接日志；连接由 daemon 内嵌 ssh2 实现并桥接进现有终端管道。

## Requirements

1. **侧边栏入口**：顶部「定时任务」入口替换为「SSH」（仅当已连接 daemon 且 `features.sshHosts` 为真；否则保留原定时任务入口）。点击不跳转页面，侧边栏下方列表原地切换为 SSH 导航；再次点击切回会话列表。classic / new-theme × 桌面 / 移动共 4 处渲染路径都要生效。
2. **SSH 侧边栏导航**：顶部 5 个功能入口——主机、密钥、端口映射、设备指纹、SSH 连接日志；下方为已保存主机列表（按分组），每台主机显示远端平台 OS logo（ubuntu/debian/fedora/centos/arch/alpine/rhel/suse/nixos/linux/darwin 等），单击主机直接发起连接。
3. **主机面板**：主面板 `/ssh` 显示主机卡片网格；单击卡片即连接（在面板内打开 SSH 终端，支持多连接 tab）；卡片编辑按钮打开编辑面板。
4. **编辑面板（全字段一次实现）**：Address、Label、Parent Group、Tags、SSH 端口、用户名、密码、私钥选择（连密钥库）、SSH 证书状态、FIDO2 开关、Agent Forwarding、Startup Snippet、Host Chaining、Proxy（http/socks4/socks5）、环境变量、字符集、Backspace 键映射、Mosh 开关、终端主题。
5. **密钥库**：密钥列表 + 新建/导入（Label、私钥、公钥、证书、passphrase、从文件导入）。
6. **端口映射**：per-host 转发规则（local -L / remote -R / dynamic -D SOCKS5），带启停与运行状态。
7. **设备指纹**：TOFU 信任模型；指纹列表、不匹配时拒绝连接并可在 UI 更新；支持从 `~/.ssh/known_hosts` 导入。
8. **连接日志**：连接历史表格（日期、时长、用户、主机、协议），环形上限 500 条。
9. **平台检测**：连接成功后自动检测远端 OS（/etc/os-release）并缓存到主机记录，卡片与侧边栏显示对应 logo。
10. **数据存 daemon 端** PASEO_HOME；密码/私钥 0o600 私有文件，永不下行到客户端（wire 层只有 hasPassword/元数据）。
11. **Mosh / FIDO2（sk- 密钥）降级**：走现有 worker 终端 spawn 系统 `mosh`/`ssh` 二进制，交互提示显示在终端内。

## Constraints

- 协议向后兼容（CLAUDE.md 协议契约）：新字段全 optional、discriminatedUnion、禁 transform/catch/preprocess、feature flag `server_info.features.sshHosts` + COMPAT 注释。
- 新增 RPC 全部走 dotted namespace（docs/rpc-namespacing.md）。
- fork 定制（新主题侧栏、多主机分组、分组头 + 按钮等）不得回退；upstream 共享文件改动面收敛到最小（terminal.ts / terminal-manager.ts / messages.ts / session.ts / bootstrap.ts / websocket-server.ts / left-sidebar.tsx / _layout.tsx）。
- 表单遵守 docs/forms.md（纯 TS form model 三件套）；路由遵守 docs/expo-router.md；i18n 需 8 语言 parity。

## Acceptance Criteria

- [ ] 支持 sshHosts 的 daemon：侧边栏显示 SSH 入口，点击原地切换 SSH 导航并可切回；旧 daemon 显示原定时任务入口。
- [ ] 新建主机（密码认证与密钥认证各一）→ 卡片出现 → 单击连接出终端 → 平台 logo 异步出现。
- [ ] 编辑面板全部字段可保存并在重连后生效（端口/env/snippet/字符集/backspace 至少手动验证）。
- [ ] 首连 TOFU 记录指纹；篡改记录后重连被拒且可在 UI 更新指纹后连通。
- [ ] local 转发规则 start 后 `curl 127.0.0.1:<port>` 连通；断连后 autoStart 规则自动重试。
- [ ] 连接日志出现记录；`~/.ssh/known_hosts` 导入出条目；密钥库增删改可用。
- [ ] `ssh-secrets.json`/`ssh-keys.json` 权限 0o600；密码/私钥不出现在任何下行消息。
- [ ] 移动端 compact 布局可用（AdaptiveModalSheet 表单 + 全屏终端）。
- [ ] typecheck / lint / 相关 vitest 文件全绿；i18n parity 测试通过。

## 子任务

| 子任务 | 交付 |
|---|---|
| 07-07-p1-protocol-store-rpc | 协议 schema + 5 store + RPC 骨架 + client 方法 |
| 07-07-p2-connection-terminal-bridge | terminal backend 抽象 + ssh2 连接池 + 终端桥接 + connect RPC + 平台检测 |
| 07-07-p3-sidebar-hosts-ui | 侧边栏切换 + /ssh 路由 + 主机卡片 + 内嵌终端 + i18n |
| 07-07-p4-host-edit-form | 主机编辑表单全字段（form model 三件套）+ 分组/tags |
| 07-07-p5-keychain-knownhosts-logs-forwards | 密钥库/指纹/日志/转发 4 个 section + forward runtime |
| 07-07-p6-fallback-polish | Mosh/FIDO2 降级 + OS 图标全套 + 空态打磨 |

依赖顺序（也写入各子任务 prd）：P2 依赖 P1；P3 依赖 P1+P2；P4/P5 依赖 P3 的 screen 骨架；P6 依赖 P2。
