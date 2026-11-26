# agent-toolbox

个人 Agent 技能与服务器配套程序。仓库位于 `D:\code\agent-toolbox`，GitHub 仓库为 [so11y/agent-toolbox](https://github.com/so11y/agent-toolbox)。

## 目录归属

```text
skills/                         八个技能的唯一源码，说明和界面元数据均为英文
  claude-web/
    scripts/vnc.cjs             本地执行，随技能一起安装
  claude-consult/
    scripts/                    本地 SSH 调用、心跳发送、停止钩子和会话管理
    references/
    tests/                      本地停止测试和可选真实请求测试
  codex-worker/
    scripts/run-codex.mjs       本地无头调用 Codex CLI 的隔离包装脚本
    references/
    tests/                      参数构建与 JSONL 解析测试
  audit-refactor-project/
  code-analysis/
  concise-plan-docs/
  decision-lock/
  tidy-code/
server/                         服务器独立安装的程序及其部署工具
  claude-consult/
    remote_review.py            服务器桥接入口
    run_control.py              服务器心跳超时、取消和进程组清理
    history.py                  服务器会话历史入口
  skills.json                   需要安装到 Claude 的技能名称
  install.py                    服务器安装器
  deploy.mjs                    本地执行的 SSH 部署入口
  tests/                        Linux 服务器测试
cloud-desktop/                  本地云桌面启动工具和连接模板
install.mjs                     本地技能目录链接安装器
tests/                          本地安装器的隔离测试
```

`skills/` 中的每个目录都是完整技能。`server/skills.json` 只选取技能名称；部署时从 `skills/` 读取源码，安装到服务器。技能源码只维护这一套。

| 界面名称 | 技能源码 | 安装位置 |
| --- | --- | --- |
| Repository Audit | `skills/audit-refactor-project` | Codex、Cursor、Claude、Antigravity |
| Code Analysis | `skills/code-analysis` | Codex、Cursor、Claude、Antigravity |
| Concise Plan Documents | `skills/concise-plan-docs` | Codex、Cursor、Claude、Antigravity |
| Decision Lock | `skills/decision-lock` | Codex、Cursor、Claude、Antigravity |
| Tidy Code | `skills/tidy-code` | Codex、Cursor、Claude、Antigravity |
| Claude Analysis, Codex Execution | `skills/claude-consult` | 本地 Codex |
| Claude Web | `skills/claude-web` | 本地 Codex |
| Codex Worker | `skills/codex-worker` | 本地 Antigravity |

Caveman、Find Skills、Codex 自带的 `.system` 技能和插件缓存不在本次范围内。

## 本地安装

从仓库根目录执行：

```powershell
node install.mjs codex cursor
```

安装器给完整技能目录建立链接：Windows 使用 Junction，其他系统使用目录符号链接。修改仓库文件后，工具通过链接读取同一份源码；通过链接编辑也会修改仓库。

| 工具 | 安装入口 | 技能选择 |
| --- | --- | --- |
| Codex | `$CODEX_HOME/skills/`，未设置时为 `~/.codex/skills/` | 七个技能（不含 `codex-worker`）；本机入口为 `D:\codex\home\skills` |
| Cursor | `~/.cursor/skills/` | 表中的五个开发技能 |
| 本地 Claude | `~/.claude/skills/` | 五个开发技能；显式运行 `node install.mjs claude` 安装 |
| Antigravity | `~/.gemini/config/skills.json` | 五个开发技能 + `codex-worker`；直接引用仓库目录（避免 Windows Junction 被忽略），显式运行 `node install.mjs antigravity` 配置 |

省略参数时安装 Codex 和 Cursor。原有同名目录移到各工具真实配置目录中的 `skill-backups/<时间>/`，与技能入口位于同一磁盘并处于扫描目录之外；其他技能、`.system` 和插件保持原位。重复执行会保留正确的链接。移动仓库后重新运行安装器，更新链接目标。

`claude-consult` 的本机连接配置保存在 `~/.config/agent-toolbox/claude-consult.json`，独立于仓库与链接。首次安装会从旧 Codex 技能目录中的 `connection.json` 迁移配置，保留已有的新配置。新机器使用 `skills/claude-consult/connection.example.json` 填写该文件，设置 SSH 地址、用户、可执行文件和私钥路径；私钥单独保管。运行接口的 `configFile` 参数和服务器部署命令的可选参数可指定其他配置文件。

`claude-web` 使用随附的 `scripts/vnc.cjs` 操作现有 noVNC 桌面，需要 Node.js 22+ 和 Chrome/Edge/Chromium，无需额外 npm 包。

停止联动使用技能自带的 `scripts/interrupt.ps1`：

1. 将 `hooks.example.json` 的 `Interrupt` 和 `SessionEnd` 合并到实际 Codex 配置目录的 `hooks.json`，保留其他钩子。新机器需替换示例中的 PowerShell 和脚本绝对路径。
2. 在 Codex「设置 → Hooks」中信任这两项，并确认已启用。信任状态由本机管理，不随仓库迁移；变更定义后需重新检查。

停止会取消当前远端运行，保留会话供继续使用。接口和恢复流程见 [停止与恢复说明](skills/claude-consult/references/usage.md#stop-interruption-and-recovery)。

## 服务器安装

服务器使用运行 Claude 的普通用户，需要 Linux、Python 3 和已登录的 Claude CLI。本地从仓库根目录执行：

```powershell
node server/deploy.mjs
```

部署入口读取上述本机连接配置，也可通过第一个参数指定其他配置文件，通过 SSH 把程序和选定技能交给 `server/install.py`。安装目标为：

| 仓库来源 | 服务器安装目标 |
| --- | --- |
| `server/claude-consult/*.py` | `~/.local/lib/project-consult/` |
| 连接配置中的代理地址 | `~/.local/lib/project-consult/history-config.json` |
| `skills/<server/skills.json 中的名称>/SKILL.md` | `~/.claude/skills/<名称>/SKILL.md` |
| 安装器生成的描述和 SHA-256 目录 | `~/.claude/skills/.project-consult.json` |
| 安装器生成的历史启动命令 | `~/.local/bin/claude-history` |

本地 `claude-consult` 每次只发送任务数据，调用已安装的 `remote_review.py`。`run_control.py` 在服务器监测心跳并清理本次运行的进程组。安装器保留服务器上其他无关技能、会话和项目缓存。

修改服务器程序或上述五个共享技能后，重新执行部署命令。更新已有安装时，先结束正在运行的咨询；先部署服务器，再更新本地技能。安装器根据当前技能原始字节生成哈希目录，本仓库通过 `.gitattributes` 保持字节稳定。

## 验证

从仓库根目录运行：

```powershell
# 隔离的链接安装、配置迁移和重复安装测试
node --test tests/install_test.mjs

# 本机执行；需要连接配置，使用隔离记录，通过 SSH 验证停止和恢复，不调用模型
node skills/claude-consult/tests/local_stop_test.mjs
```

在具有仓库源码的 Linux 环境运行：

```sh
python3 server/tests/install_test.py
python3 server/tests/remote_stop_test.py
```

`skills/claude-consult/tests/live_stop_test.mjs` 接受相同的可选连接配置参数，会发起真实 Claude 请求，仅在需要验证时手动运行。脚本测试不等于已验证桌面停止按钮。

## 云桌面

`cloud-desktop/open-cloud-desktop.cmd` 调用同目录的 PowerShell 脚本。它使用本机 `~/.ssh/reverse_tunnel_ed25519` 建立 SSH 隧道，将本地 `127.0.0.1:16080` 转发到服务器的 `127.0.0.1:6080`。脚本保留 SSH 主机密钥检查，新机器需先核验服务器指纹。

仓库版启动链接已移除内嵌桌面密码。浏览器打开后手动输入自己的桌面密码；本机桌面文件夹中的原件未作改动。`接続情報.example.txt` 的密码字段只有占位值。更换服务器时需同步调整脚本和连接配置。

## 凭据与访问

本仓库不保存 SSH 私钥、桌面密码、Linux/sudo 密码、GitHub 令牌、应用登录凭据、会话数据或隧道日志。服务器地址、用户名和私钥文件路径本身不能用于完成 SSH 身份验证。

2026-11-04 只读检查时，服务器 SSH 仍同时提供 `publickey,password` 认证；VNC/noVNC 监听在服务器回环地址。因此，仅取得本仓库没有提供登录凭据，但“没有私钥就一定无法登录”并不成立：有效的 SSH 密码也能用于认证。本次未修改服务器认证设置。

GitHub 仓库已设为私有。原仓库当前目录已替换，Git 提交历史保留；私有化和删除当前文件不会撤回以前已经被下载的副本。
