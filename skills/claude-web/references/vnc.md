# VNC 操作

## 环境与调用

随附 scripts/vnc.cjs 使用 Node.js 22+ 的原生 WebSocket，无需 npm 包。优先复用会话。默认目标是用户提供的本地 noVNC（本环境服务在 http://127.0.0.1:16080）；完整路径、连接参数和凭据沿用用户提供的链接，不猜密码。

脚本从 stdin 接收一个 JSON 对象，并在 stdout 返回一行 JSON。每次都提供 action 与绝对 sessionDir；失败返回 ok:false 和非零退出码。运行时目录使用当前工作区 work/claude-web。截图先保存到 work/ 下再用图像工具查看。

参数通过 stdin 或 JSON 文件传递，不拼接进 shell 命令。若 exec_command 出现本机 CET 错误，可用 node_repl 的 node:child_process 启动 Node，设置 windowsHide:true；无需调整系统配置。

从本 SKILL.md 所在目录解析脚本绝对路径。node_repl 示例（变量改为实际绝对路径）：

```javascript
var cp = await import('node:child_process');
var scriptPath = '绝对技能目录/scripts/vnc.cjs';
var sessionDir = '绝对工作区/work/claude-web';
var vncCall = input => new Promise((resolve, reject) => {
  const child = cp.spawn('node', [scriptPath], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
  });
  let out = '', err = '';
  child.stdout.on('data', d => out += d);
  child.stderr.on('data', d => err += d);
  child.on('error', reject);
  child.on('close', code => {
    if (code !== 0) reject(new Error(out || err));
    else resolve(JSON.parse(out));
  });
  child.stdin.end(JSON.stringify({ sessionDir, ...input }));
});
```

不要把整个截图 base64 或完整页面日志打印出来。截图用 view_image 或 nodeRepl.emitImage 显示。

## 可用操作

| action | 额外参数 | 作用 |
| --- | --- | --- |
| connect | 首次传 url；可选 browserPath | 启动隔离的无窗口 Chromium，连接 noVNC；已有 session.json 时复用原页面。 |
| connect | debugPort | 附着已知由本任务控制的 Chromium 中现有 noVNC 标签页。 |
| status | 无 | 返回是否连接、是否只读、画布大小、剪贴板版本。 |
| screenshot | output：绝对 PNG 路径 | 截图，包括连接失败或登录画面。 |
| click | x、y | 在最新截图的 CSS 像素坐标左击。 |
| scroll | x、y、dy；可选 dx | 鼠标位于指定位置滚动。 |
| paste | text | 将 Unicode 文本放远端剪贴板并 Ctrl+V，不发送；先聚焦正确输入框。 |
| type | text | 单行 Unicode 键盘输入；用于粘贴不可用时。换行会报错。 |
| key | keys | 例如 CTRL+a、BACKSPACE、ENTER、ESCAPE、PAGEDOWN。ENTER 可能发送，只在本轮明确要发送时调用。 |
| clipboard | 无 | 返回已接收的剪贴板 text 与 revision；不主动复制内容。 |

除 status/screenshot 外，写入操作要求 VNC 已连接且非只读。paste 要求服务端支持扩展 Unicode 剪贴板；若不支持，单行可用 type，多行需选择已验证的其他输入通道，不直接发送 Enter 模拟换行。

首次 connect 返回 connected:false 时先截图查看连接/认证状态，不开始输入。保存的浏览器已退出时，核对情况后使用新的 work/ 会话目录连接；不要删掉用户浏览器配置。浏览器启动需要 Chrome/Edge/Chromium，本环境 Chrome 路径由脚本自动发现。

connect 的已有会话不会因提供了不同 url 而自动换目标；要换另一个 VNC，使用新的 sessionDir 和用户指定的 URL。

## 读取远端 Claude 回复

1. 查看最新截图，确定正确聊天和目标回复；长消息向下滚动。
2. 先记录 status 的 clipboardRevision，确保复制监听已安装。
3. 在画面中找到目标回复自己的复制按钮并点击；待剪贴板 revision 增长后读取 clipboard。
4. 校验正文开头/结尾与目标回复匹配；没有更新不能使用旧剪贴板。无法复制时按截图滚动读取。
5. 流式生成时读取稳定完整段落；回复结束后复核整条正文并补齐遗漏，不重复输出已译部分。

远端的界面输入需要传播时间。一次派发返回不是完成证据；查看后续截图或复制事件再判断。不要为了测试本技能给 Claude 发送额外消息。
