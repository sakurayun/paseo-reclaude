# P6 Mosh/FIDO2 降级+平台检测打磨

> 父任务：`.trellis/tasks/07-07-ssh-host-manager`（design.md 第 1 节「降级路径」+ implement.md P6 清单为权威）。**依赖 P2**。收尾阶段。

## Goal

Mosh 与 FIDO2（sk- 密钥）降级到系统 ssh/mosh 二进制；OS 图标全套；空态/加载态打磨。

## Requirements

- `buildFallbackSshArgv(host, keyFilePath)`：-p / -J（chain）/ -i（临时私钥 0o600 落盘 `paseoHome/ssh/tmp-keys/`，退出即删）/ -o SetEnv；mosh 用 `--ssh="ssh -p N -i …"`；走现有 worker 终端（交互提示显示在终端内）。
- mosh 二进制缺失时给明确报错文案；降级路径在 UI 注明不支持 proxy 与 daemon 侧指纹钩子。
- OS 图标 11 个（ubuntu/debian/fedora/centos/arch/alpine/redhat/suse/nixos/linux/apple，react-native-svg 照 claude-icon.tsx）+ `os-icons.ts` 映射兜底 linux。
- 空态/加载态；日志 500 条环形截断验证；`ssh-secrets` 留 tweetnacl 加密 TODO 注释。

## Acceptance Criteria

- [ ] mosh=true 的主机连接走系统 mosh；sk- 密钥主机走系统 ssh；临时密钥文件退出后被清理。
- [ ] 全部平台 logo 正确渲染（含未知平台兜底）。
- [ ] 全量 typecheck + lint + format 通过。
