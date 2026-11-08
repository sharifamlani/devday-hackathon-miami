<#
.SYNOPSIS
  Start, stop, restart, reset or check the LIVE and TEST stacks of the integration wheel.

.DESCRIPTION
  LIVE  service :8001  web :5173  code + data in the LIVE worktree (default C:\Users\Shari\dd-live-main)
  TEST  service :8101  web :5174  service code + data in the TEST worktree (default C:\Users\Shari\dd-live-test)
        web runs from the LIVE worktree's web/ (one node_modules install), pointed at :8101

  Each service reads REPO_ROOT/data of its own worktree, so the two stacks never share a db or a cache file.
  PIDs this script starts go to <StateDir>\pids.json. stop kills only those PIDs (and their child trees),
  never a process found by port or image name. A reserved port held by someone else is reported, not killed.

    .\scripts\live_stack.ps1 start  -Stack all
    .\scripts\live_stack.ps1 status
    .\scripts\live_stack.ps1 reset  -Stack test     # stop TEST service, empty its db + runtime files, start it
    .\scripts\live_stack.ps1 restart -Stack live -Only service

  Exit code: 0 = every asked-for part healthy, 1 = something unhealthy or a port held by another process.
#>
param(
  [Parameter(Position = 0)][ValidateSet("start", "stop", "restart", "status", "reset")][string]$Action = "status",
  [ValidateSet("live", "test", "all")][string]$Stack = "all",
  [ValidateSet("service", "web", "both")][string]$Only = "both",
  [string]$LiveRoot = "C:\Users\Shari\dd-live-main",
  [string]$TestRoot = "C:\Users\Shari\dd-live-test",
  [string]$StateDir = "C:\Users\Shari\dd-live-state",
  [string]$Python = "C:\Users\Shari\Dropbox (Personal)\GenAI Company\Projects\devday_hackathon\.venv\Scripts\python.exe",
  # Today's reserved ports. QA can run a copy on spare ports: a web port other than 5173/5174 is passed to the
  # service as CORS_ORIGINS (service/config.py), so its requests and the dictation WebSocket are allowed.
  [int]$LiveServicePort = 8001,
  [int]$LiveWebPort = 5173,
  [int]$TestServicePort = 8101,
  [int]$TestWebPort = 5174
)

$ErrorActionPreference = "Stop"
$Stacks = @{
  live = @{ ServicePort = $LiveServicePort; WebPort = $LiveWebPort; ServiceRoot = $LiveRoot }
  test = @{ ServicePort = $TestServicePort; WebPort = $TestWebPort; ServiceRoot = $TestRoot }
}
# Runtime files the service writes under data/ (gitignored). A TEST reset deletes these; tracked caches are restored
# from git and data/ingest_cache/ is kept warm, as on stage.
$RuntimeFiles = @("donors.db", "donors.db-wal", "donors.db-shm", "research_facts.json", "outreach_drafts.json",
                  "context_live.json", "events_live.json", "event_drafts.json", "after_call_proposals.json")

New-Item -ItemType Directory -Force (Join-Path $StateDir "logs") | Out-Null
$PidFile = Join-Path $StateDir "pids.json"

$LockFile = Join-Path $StateDir "pids.lock"

# pids.json: { "<stack>-<part>": { pid, name, start } }. name + start time identify the process we started, so a PID
# that Windows has reused for an unrelated process never matches and is never killed.
function Read-Pids {
  $h = @{}
  if (Test-Path $PidFile) {
    $obj = Get-Content $PidFile -Raw | ConvertFrom-Json
    foreach ($p in $obj.PSObject.Properties) {
      if ($p.Value -is [int] -or $p.Value -is [long]) { $h[$p.Name] = @{ pid = [int]$p.Value; name = $null; start = $null } }  # pre-identity file
      else { $h[$p.Name] = @{ pid = [int]$p.Value.pid; name = $p.Value.name; start = $p.Value.start } }
    }
  }
  return $h
}

# Write to a temp file in the same folder, then rename over pids.json, so a reader never sees half a file.
function Write-Pids($h) {
  $tmp = "$PidFile.$PID.tmp"
  ($h | ConvertTo-Json) | Out-File -Encoding utf8 $tmp
  Move-Item -Force $tmp $PidFile
}

# One writer at a time: a lock file opened exclusively (FileShare None) for the read-modify-write.
function Use-PidLock([scriptblock]$body) {
  $deadline = (Get-Date).AddSeconds(30); $lock = $null
  while (-not $lock) {
    try { $lock = [System.IO.File]::Open($LockFile, "OpenOrCreate", "ReadWrite", "None") }
    catch { if ((Get-Date) -gt $deadline) { throw "pids.lock held for 30 s: another live_stack.ps1 is running" }; Start-Sleep -Milliseconds 200 }
  }
  try { & $body } finally { $lock.Close() }
}

function Get-Identity([int]$procId) {
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if (-not $p) { return $null }
  return @{ pid = $procId; name = $p.ProcessName; start = $p.StartTime.ToUniversalTime().ToString("o") }
}

# True only when the PID is alive AND is still the process we recorded. A pre-identity entry is accepted only if
# the live process's command line still carries the port we started it on.
function Test-Ours($entry, [int]$port) {
  $now = Get-Identity $entry.pid
  if (-not $now) { return $false }
  if ($entry.name) { return ($now.name -eq $entry.name -and $now.start -eq $entry.start) }
  $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($entry.pid)").CommandLine
  return [bool]($cmd -and $cmd -match "--port\s+$port\b")
}

function Get-Port([string]$name, [string]$part) {
  if ($part -eq "service") { return $Stacks[$name].ServicePort } else { return $Stacks[$name].WebPort }
}

function Get-PortOwner([int]$port) {
  $line = netstat -ano | Select-String -Pattern "TCP\s+\S+:$port\s+\S+\s+LISTENING\s+(\d+)" | Select-Object -First 1
  if ($line) { return [int]$line.Matches[0].Groups[1].Value }
  return $null
}

function Test-Http([string]$url) {
  try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 $url).StatusCode } catch { return 0 }
}

function Start-Part([string]$name, [string]$part) { Use-PidLock { Start-PartLocked $name $part } }
function Start-PartLocked([string]$name, [string]$part) {
  $cfg = $Stacks[$name]; $key = "$name-$part"; $pids = Read-Pids
  $port = Get-Port $name $part
  if ($pids.ContainsKey($key) -and (Test-Ours $pids[$key] $port)) { Write-Host "$key already running (pid $($pids[$key].pid))"; return }
  $owner = Get-PortOwner $port
  if ($owner) { Write-Host "BUSY  :$port is held by pid $owner (not ours). Not starting $key; tell the lead."; $script:Bad = $true; return }

  $log = Join-Path $StateDir "logs\$key.log"; $err = Join-Path $StateDir "logs\$key.err.log"
  if ($part -eq "service") {
    $env:DONORS_DB = Join-Path $cfg.ServiceRoot "data\donors.db"
    $env:AFTER_CALL_PROPOSALS = Join-Path $cfg.ServiceRoot "data\after_call_proposals.json"
    $env:CORS_ORIGINS = "http://localhost:$($cfg.WebPort),http://127.0.0.1:$($cfg.WebPort)"   # no-op on 5173/5174
    $proc = Start-Process -FilePath $Python -WorkingDirectory $cfg.ServiceRoot -PassThru -WindowStyle Hidden `
      -RedirectStandardOutput $log -RedirectStandardError $err `
      -ArgumentList @("-m", "uvicorn", "service.main:app", "--host", "127.0.0.1", "--port", "$port")
    Remove-Item Env:DONORS_DB, Env:AFTER_CALL_PROPOSALS, Env:CORS_ORIGINS
  } else {
    $env:VITE_DATA_MODE = "local"; $env:VITE_API_URL = "http://127.0.0.1:$($cfg.ServicePort)"
    # Run vite's own entry with node so the PID we keep is the server, not a cmd/npx wrapper. A stack whose worktree has
    # its own web/node_modules serves its own web code (TEST can run a new merge while LIVE holds); otherwise it serves
    # LIVE's web/. No --force: vite re-optimizes by itself when the lockfile changes.
    $ownWeb = Join-Path $cfg.ServiceRoot "web"
    $webDir = if (Test-Path (Join-Path $ownWeb "node_modules\vite\bin\vite.js")) { $ownWeb } else { Join-Path $LiveRoot "web" }
    $proc = Start-Process -FilePath "node" -WorkingDirectory $webDir -PassThru -WindowStyle Hidden `
      -RedirectStandardOutput $log -RedirectStandardError $err `
      -ArgumentList @("node_modules\vite\bin\vite.js", "--port", "$port", "--strictPort")
    Remove-Item Env:VITE_DATA_MODE, Env:VITE_API_URL
  }
  $id = Get-Identity $proc.Id
  if (-not $id) { $id = @{ pid = $proc.Id; name = $null; start = $null } }   # exited at once; see the err log
  $pids[$key] = $id; Write-Pids $pids
  $from = if ($part -eq "web") { " from $webDir" } else { "" }
  Write-Host "started $key pid $($proc.Id) on :$port$from (log $log)"
}

function Stop-Part([string]$name, [string]$part) { Use-PidLock { Stop-PartLocked $name $part } }
function Stop-PartLocked([string]$name, [string]$part) {
  $key = "$name-$part"; $pids = Read-Pids
  if (-not $pids.ContainsKey($key)) { Write-Host "$key not in pid file"; return }
  $entry = $pids[$key]
  if (Test-Ours $entry (Get-Port $name $part)) { & taskkill.exe /PID $entry.pid /T /F | Out-Null; Write-Host "stopped $key (pid $($entry.pid))" }
  elseif (Get-Process -Id $entry.pid -ErrorAction SilentlyContinue) { Write-Host "$key pid $($entry.pid) is now a different process; not killed" }
  else { Write-Host "$key pid $($entry.pid) already gone" }
  $pids.Remove($key); Write-Pids $pids
}

# taskkill returns before Windows releases the listening socket; starting at once can see our own dying process
# as a foreign "BUSY" owner. Wait (up to 10 s) for the port to close before starting again.
function Wait-PortFree([int]$port, [int]$seconds = 10) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline -and (Get-PortOwner $port)) { Start-Sleep -Milliseconds 300 }
}

function Wait-Healthy([string]$name, [string]$part, [int]$seconds = 90) {
  $cfg = $Stacks[$name]
  $url = if ($part -eq "service") { "http://127.0.0.1:$($cfg.ServicePort)/health" } else { "http://127.0.0.1:$($cfg.WebPort)/" }
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) { if ((Test-Http $url) -eq 200) { return $true }; Start-Sleep -Milliseconds 700 }
  return $false
}

function Show-Status([string]$name) {
  $cfg = $Stacks[$name]; $pids = Read-Pids
  foreach ($part in $Parts) {
    $key = "$name-$part"
    $port = if ($part -eq "service") { $cfg.ServicePort } else { $cfg.WebPort }
    $url = if ($part -eq "service") { "http://127.0.0.1:$port/health" } else { "http://127.0.0.1:$port/" }
    $code = Test-Http $url
    $mine = if ($pids.ContainsKey($key)) { $pids[$key].pid } else { "-" }
    $owner = Get-PortOwner $port
    $state = if ($code -eq 200) { "OK" } else { "DOWN"; $script:Bad = $true }
    Write-Host ("{0,-5} {1,-13} :{2,-5} http {3,-3} pid(ours) {4,-6} listener {5}" -f $state, $key, $port, $code, $mine, $owner)
  }
}

function Reset-Data([string]$name) {
  $root = $Stacks[$name].ServiceRoot
  foreach ($f in $RuntimeFiles) { $p = Join-Path $root "data\$f"; if (Test-Path $p) { Remove-Item -Force $p } }
  Get-ChildItem (Join-Path $root "data") -Filter "donors.backup-*.db" -ErrorAction SilentlyContinue | Remove-Item -Force
  & git -C $root checkout -- data/ 2>$null
  Write-Host "reset $name data in $root\data (ingest_cache kept)"
}

$Names = if ($Stack -eq "all") { @("live", "test") } else { @($Stack) }
$Parts = if ($Only -eq "both") { @("service", "web") } else { @($Only) }
$script:Bad = $false

switch ($Action) {
  "start"   { foreach ($n in $Names) { foreach ($p in $Parts) { Start-Part $n $p } } }
  "stop"    { foreach ($n in $Names) { foreach ($p in $Parts) { Stop-Part $n $p } } }
  "restart" { foreach ($n in $Names) { foreach ($p in $Parts) { Stop-Part $n $p; Wait-PortFree (Get-Port $n $p); Start-Part $n $p } } }
  "reset"   {
    # LIVE holds Sharif's data: only an explicit -Stack live resets it (on Sharif's or the lead's ask)
    if ($Stack -eq "all") { $Names = @("test") }
    foreach ($n in $Names) { Stop-Part $n "service"; Wait-PortFree (Get-Port $n "service"); Reset-Data $n; Start-Part $n "service" }
    $Parts = @("service")
  }
}
if ($Action -ne "stop") {
  foreach ($n in $Names) { foreach ($p in $Parts) { if ($Action -ne "status") { [void](Wait-Healthy $n $p) } } }
  foreach ($n in $Names) { Show-Status $n }
}
if ($script:Bad) { exit 1 } else { exit 0 }
