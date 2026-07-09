# P1 协议+store+RPC 骨架

> 父任务：`.trellis/tasks/07-07-ssh-host-manager`（design.md 第 1、3 节 + implement.md P1 清单为权威）。依赖：无（首个子任务）。

## Goal

打通 SSH 管理器的协议层与 daemon 持久化骨架：全部 `ssh.*` wire schema、5 个 store、RPC CRUD、changed 推送、client SDK 方法。connect 暂返回 not_implemented。

## Requirements

- `packages/protocol/src/messages.ts` 新增 SSH 段（Info schema + `ssh.hosts/host_groups/keys/forwards/known_hosts/logs` 的 request/response + 4 个 changed 推送 + inbound/outbound union 注册 + `features.sshHosts` COMPAT flag）；AOT 再生成。
- `packages/server/src/ssh/`：5 个 store（照 port-forward-manager 模式）；`ssh-secrets.json`/`ssh-keys.json` 用 `writePrivateFileAtomicSync` 0o600；密码/私钥永不下行（wire 只有 hasPassword/元数据）。
- `ssh-session-controller.ts` dispatch + session.ts/bootstrap.ts/websocket-server.ts 接线；`packages/client/src/daemon-client.ts` 22 个方法。
- 协议红线：全 optional、discriminatedUnion、禁 transform/catch/preprocess、default 仅原始叶子。
- server 依赖安装：ssh2/@types/ssh2/socks/iconv-lite（本阶段只装不用，为 P2 铺路）。

## Acceptance Criteria

- [ ] typecheck + lint 全绿；AOT 生成无回归（ws-outbound.test、wire-compat.test 通过）。
- [ ] 5 个 store 单测通过：宽容解析（坏文件降级空列表）、0o600 权限、写串行化。
- [ ] e2e harness 里 ssh.hosts.create/list/update/delete 走通，changed 推送可收到。
- [ ] 下行消息中不含 password/privateKey/passphrase 字段。
