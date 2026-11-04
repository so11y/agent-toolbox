param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$sshExe = 'C:\Program Files\Git\usr\bin\ssh.exe'
$keyFile = Join-Path $env:USERPROFILE '.ssh\reverse_tunnel_ed25519'
$localPort = 16080
$serverAddress = '43.133.218.55'
$desktopUrl = 'http://127.0.0.1:16080/vnc.html?autoconnect=true&resize=scale&reconnect=true&reconnect_delay=2000'
if (-not (Test-Path -LiteralPath $sshExe)) { throw 'Git OpenSSH が見つかりません。' }
if (-not (Test-Path -LiteralPath $keyFile)) { throw 'SSH 秘密鍵が見つかりません。' }
$listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $localPort -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    $ownerProcess = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $listener[0].OwningProcess)
    if ($ownerProcess.Name -ne 'ssh.exe' -or $ownerProcess.CommandLine -notmatch [regex]::Escape($serverAddress)) {
        throw 'ローカルポート 16080 は別のアプリで使用されています。'
    }
} else {
    $sshArgs = @('-N', '-T', '-n', '-i', ('"' + $keyFile + '"'), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=12', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', '-L', '127.0.0.1:16080:127.0.0.1:6080', 'desktop@43.133.218.55')
    $errorLog = Join-Path $PSScriptRoot 'tunnel-error.log'
    $tunnelProcess = Start-Process -FilePath $sshExe -ArgumentList $sshArgs -WindowStyle Hidden -RedirectStandardError $errorLog -RedirectStandardOutput (Join-Path $PSScriptRoot 'tunnel-output.log') -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($tunnelProcess.HasExited) {
            throw ('SSH 接続に失敗しました。' + [Environment]::NewLine + (Get-Content -LiteralPath $errorLog -Raw))
        }
        $listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $localPort -State Listen -ErrorAction SilentlyContinue
        if ($listener) { $ready = $true; break }
        Start-Sleep -Milliseconds 250
    }
    if (-not $ready) { throw 'SSH 接続がタイムアウトしました。' }
}
$response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:16080/vnc.html' -TimeoutSec 10
if ($response.StatusCode -ne 200 -or $response.Content -notmatch 'noVNC') { throw 'デスクトップ接続ページを確認できませんでした。' }
if (-not $NoBrowser) { Start-Process -FilePath $desktopUrl }
Write-Output 'クラウドデスクトップに接続できます。'
