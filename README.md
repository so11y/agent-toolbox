# 个人技能与云桌面配套

本仓库保存 2026-11-04 用户截图红框中的 7 个个人技能，以及这些技能的脚本、参考资料、界面元数据和云桌面配套文件。

| 界面名称 | 目录 |
| --- | --- |
| 代码整理 | `skills/tidy-code` |
| 精简计划文档 | `skills/concise-plan-docs` |
| 文档约束 | `skills/decision-lock` |
| 重构 | `skills/audit-refactor-project` |
| Claude 决策 · Codex 执行 | `skills/claude-consult` |
| Claude Web | `skills/claude-web` |
| Code Analysis | `skills/code-analysis` |

Caveman、Find Skills、Codex 自带的 `.system` 技能和插件缓存不在本次范围内。

## 配套内容

- `skills/`：来自本机 `D:\codex\home\skills`，包含各技能原有的 `scripts/`、`references/` 和 `agents/`（如有）。
- `skills/claude-consult/connection.example.json`：不含凭据的连接模板。本机实际的 `connection.json` 只保留在本地，并已加入 `.gitignore`。
- `server/claude-skills/`：Claude 决策技能在服务器使用的 5 份英文技能副本及 `.project-consult.json` 哈希目录；属于该技能的服务器配套，不另计个人技能数量。文件按原始字节保存，已核验目录中的 SHA-256。
- `cloud-desktop/`：来自桌面的同名文件夹，保存启动脚本和不含密码的连接说明模板。

## 恢复个人技能

当前机器的个人技能目录为 `D:\codex\home\skills`。在新机器上，把 `skills/` 内这 7 个子目录放入该机器使用的个人技能目录。现有配置有改动时先备份，再替换对应目录。

`claude-consult` 需要把 `connection.example.json` 复制为同目录的 `connection.json`，填写 SSH 地址、用户、可执行文件和本机私钥路径。模板中的占位值需要替换；私钥单独保管。当前机器原有技能配置未作改动。

本地脚本使用 Node.js；`claude-web` 的 VNC 脚本需要 Node.js 22+ 和 Chrome/Edge/Chromium，使用原生 WebSocket，无需额外 npm 包。`claude-consult` 通过 SSH 调用服务器的 Python 3 和已登录的 Claude CLI。随附参考资料保留各技能的具体用法。

如需恢复 Claude 决策的服务器技能，将 `server/claude-skills/` 下的 5 个目录复制到服务器用户的 `~/.claude/skills/`，最后再复制 `.project-consult.json`。目录固定了原始文件哈希，不要转换换行符；本仓库的 `.gitattributes` 已关闭自动换行转换。保留服务器上其他无关技能。

## 云桌面

`cloud-desktop/open-cloud-desktop.cmd` 调用同目录的 PowerShell 脚本。它使用本机 `~/.ssh/reverse_tunnel_ed25519` 建立 SSH 隧道，将本地 `127.0.0.1:16080` 转发到服务器的 `127.0.0.1:6080`。脚本保留 SSH 主机密钥检查，新机器需先核验服务器指纹。

仓库版启动链接已移除内嵌桌面密码。浏览器打开后手动输入自己的桌面密码；本机桌面文件夹中的原件未作改动。`接続情報.example.txt` 的密码字段只有占位值。更换服务器时需同步调整脚本和连接配置。

## 凭据与访问

本仓库不保存 SSH 私钥、桌面密码、Linux/sudo 密码、GitHub 令牌、应用登录凭据、会话数据或隧道日志。服务器地址、用户名和私钥文件路径本身不能用于完成 SSH 身份验证。

2026-11-04 只读检查时，服务器 SSH 仍同时提供 `publickey,password` 认证；VNC/noVNC 监听在服务器回环地址。因此，仅取得本仓库没有提供登录凭据，但“没有私钥就一定无法登录”并不成立：有效的 SSH 密码也能用于认证。本次未修改服务器认证设置。

GitHub 仓库已设为私有。原仓库当前目录已替换，Git 提交历史保留；私有化和删除当前文件不会撤回以前已经被下载的副本。
