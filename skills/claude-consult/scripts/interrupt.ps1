$ErrorActionPreference = 'Stop'
try {
    $eventData = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($eventData.hook_event_name -notin @('Interrupt','SessionEnd')) { exit 0 }
    $chatId = [string]$eventData.session_id
    if ($chatId -notmatch '^[0-9a-fA-F-]{36}$') { exit 0 }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $digest = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($chatId.ToLowerInvariant())) }
    finally { $sha.Dispose() }
    $hash = ([System.BitConverter]::ToString($digest)).Replace('-','').ToLowerInvariant()
    $chatDir = Join-Path ([Environment]::GetFolderPath('UserProfile')) ('.cache\claude-consult\chats\' + $hash)
    if (-not (Test-Path -LiteralPath $chatDir -PathType Container)) { exit 0 }
    $turnId = [string]$eventData.turn_id
    $activeFile = Join-Path $chatDir 'active-run.json'
    if ($eventData.hook_event_name -eq 'SessionEnd') {
        if (-not (Test-Path -LiteralPath $activeFile)) { exit 0 }
        $activeRun = Get-Content -LiteralPath $activeFile -Raw | ConvertFrom-Json
        $turnId = [string]$activeRun.turnId
    }
    if ($turnId -notmatch '^[0-9a-fA-F-]{36}$') { exit 0 }
    $markerDir = Join-Path $chatDir 'cancelled-turns'
    [System.IO.Directory]::CreateDirectory($markerDir) | Out-Null
    $markerFile = Join-Path $markerDir ($turnId + '.json')
    $temporaryFile = $markerFile + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    $payload = @{reason='user_interrupt'; turnId=$turnId; requestedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($temporaryFile,$payload,[System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporaryFile -Destination $markerFile -Force
    exit 0
} catch {
    [Console]::Out.WriteLine('{"systemMessage":"Claude stop notification could not be recorded. Remote stop is not confirmed."}')
    exit 0
}
