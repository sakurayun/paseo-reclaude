# P4 主机编辑面板全字段

> 父任务：`.trellis/tasks/07-07-ssh-host-manager`（design.md 第 4 节「编辑面板」+ implement.md P4 清单为权威）。**依赖 P3**（ssh-screen 骨架）。

## Goal

Termius 式全字段主机编辑面板：docs/forms.md 三件套（纯 TS form model + hook + 渲染），桌面右侧 detail pane / compact AdaptiveModalSheet 共用。

## Requirements

- `ssh/ssh-host-form-model.ts`（零 React，先测后码）+ `use-ssh-host-form-model.ts` + `components/ssh/ssh-host-form.tsx`。
- 分节：基本（Address/Label/Parent Group/Tags chips）→ 凭据（用户名/密码/私钥 SelectField 连密钥库/证书状态/FIDO2 Switch/Agent Forwarding Switch）→ 连接（端口/Host Chaining 有序多选/Proxy disclosure/Mosh Switch）→ 终端（Backspace SegmentedControl/字符集 SelectField/主题 SelectField/Startup Snippet 多行/环境变量 KV 列表）。
- disclosure 在 model 内派生；FIDO2/Mosh 开启时提示走系统 ssh 降级；密码仅在用户修改时进 submit payload（null=清除）。
- 分组管理（ssh.host_groups.* 增改删）；forms.md 生命周期规则（key 派生、useState(()=>open()) 一次构造、sheet 内 0 useEffect）。

## Acceptance Criteria

- [ ] form-model 单测覆盖 disclosure/编辑种子/submit payload 全部命令。
- [ ] create/edit 互不串味；保存后 changed 推送即时反映到卡片与侧边栏。
- [ ] 全部字段保存后重连生效（端口/env/snippet/字符集/backspace 手动抽验）。
- [ ] typecheck + lint 全绿。
