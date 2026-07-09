# P3 侧边栏+主机 UI+内嵌终端

> 父任务：`.trellis/tasks/07-07-ssh-host-manager`（design.md 第 4 节 + implement.md P3 清单为权威）。**依赖 P1+P2**。

## Goal

侧边栏「定时任务」→「SSH」原地切换 + `/ssh` 主面板（主机卡片网格 + 内嵌多连接终端）+ i18n。

## Requirements

- `sidebar-view-store` 加 `sidebarContentMode: "sessions" | "ssh"`（照 groupMode，persist）。
- `left-sidebar.tsx`：classic 桌面/移动 2 处入口替换（门控=已连接 daemon && features.sshHosts，否则保留原定时任务入口）；new-theme 走 `sidebar-sessions-toolbar.tsx`；4 处列表渲染点包三元切换 `SidebarSshList`。
- `components/sidebar/sidebar-ssh-list.tsx`：5 个功能入口（主机/密钥/端口映射/设备指纹/连接日志 → `/ssh?section=…`）+ 分组主机列表（OS logo + label，单击 → `/ssh?section=hosts&connect=<hostId>`）。
- `app/ssh.tsx` 薄壳 + `_layout.tsx` 注册（Stack.Protected + shouldShowAppChrome）；`screens/ssh/ssh-screen.tsx`（?section&connect，compact 单点分叉）；hosts 卡片网格照 open-project tiles；`ssh-terminal-area.tsx` 多连接 tab + 内嵌 TerminalPane。
- `terminal-pane.tsx` 仅加 `localFileLinks?: boolean` / `paletteOverride` 两个可选 prop。
- i18n `ssh.*` 8 语言 parity。

## Acceptance Criteria

- [ ] 4 条渲染路径（classic/new-theme × 桌面/移动）切换往返正常；fork 定制（多主机分组/分组头+按钮）不回退。
- [ ] 点侧边栏主机或卡片 → 终端出画面；resize/中文输出/退出重连正常。
- [ ] SSH 终端不泄漏进 workspace 终端列表（workspaceId `ssh:` 前缀过滤）。
- [ ] 旧 daemon（无 sshHosts）显示原定时任务入口。
- [ ] typecheck + lint + resources.test + terminal-pane 回归全绿。
