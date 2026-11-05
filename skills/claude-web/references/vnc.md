# VNC Control

## Runtime and invocation

The bundled `scripts/vnc.cjs` runs locally with Node.js 22+ and native WebSocket; no npm package is required. Reuse existing sessions. Use the user's noVNC address (this environment uses http://127.0.0.1:16080), supplied URL, parameters, and credentials; never guess passwords.

The script accepts one JSON object on stdin and returns one JSON line on stdout. Always supply an action and absolute sessionDir. Failures return ok:false and a nonzero exit code. Keep runtime records under the workspace's work/claude-web. Save screenshots there and inspect them with an image tool.

Pass parameters through stdin or a JSON file, never shell interpolation. If exec_command fails with the Windows CET error, launch Node through node_repl's node:child_process with windowsHide:true; no system changes are needed.

Resolve the script relative to this skill's SKILL.md. Replace example paths with actual absolute paths:

~~~javascript
var cp = await import('node:child_process');
var scriptPath = 'ABSOLUTE_SKILL_DIRECTORY/scripts/vnc.cjs';
var sessionDir = 'ABSOLUTE_WORKSPACE/work/claude-web';
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
~~~

Do not print screenshot base64 or complete page logs. Use view_image or nodeRepl.emitImage.

## Actions

| action | Additional parameters | Behavior |
| --- | --- | --- |
| connect | url initially; optional browserPath | Start isolated hidden Chromium and connect; reuse the page when session.json exists. |
| connect | debugPort | Attach to a known Chromium noVNC tab controlled by this task. |
| status | None | Report connection, read-only state, canvas size, and clipboard revision. |
| screenshot | output: absolute PNG path | Capture the screen, including failures or login screens. |
| click | x, y | Left-click CSS pixel coordinates from the latest screenshot. |
| scroll | x, y, dy; optional dx | Scroll over the specified location. |
| paste | text | Set the remote Unicode clipboard and press Ctrl+V without sending; focus the input first. |
| type | text | Enter one Unicode line if paste is unavailable. Newlines are rejected. |
| key | keys | Examples: CTRL+a, BACKSPACE, ENTER, ESCAPE, PAGEDOWN. ENTER may send; use only when authorized for this turn. |
| clipboard | None | Return received text and revision without triggering a copy. |

Writes require a connected, writable VNC session. Paste requires extended Unicode clipboard support. Otherwise use type for a single line and a verified alternative for multiline text; never simulate multiline paste with Enter presses.

When initial connect returns connected:false, screenshot the connection/authentication state before typing. If a saved browser exited, verify it and start a new workspace session directory; do not delete user browser profiles. Chrome, Edge, or Chromium is required; this environment's Chrome path is discovered automatically.

Providing a new URL does not switch an existing session. For another VNC target, use a new sessionDir and the user's URL.

## Read Claude replies

1. Inspect a current screenshot and find the intended chat/reply; scroll as needed.
2. Record clipboardRevision from status and confirm the copy listener is installed.
3. Click that reply's copy button, wait for the revision to increase, then read clipboard.
4. Verify the beginning/end belong to the intended reply. Never reuse unchanged clipboard content. If copy is unavailable, read screenshots through the end.
5. During generation, read complete stable paragraphs. On completion, verify the entire reply and fill omissions without repeating earlier translations.

Input propagation takes time. Dispatch success alone is not reception; inspect a later screenshot or copy event. Do not send extra Claude messages solely to test this skill.
