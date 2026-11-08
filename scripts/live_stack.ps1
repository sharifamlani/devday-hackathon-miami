<#
.SYNOPSIS
  Start, stop, restart, reset or check the LIVE and TEST stacks of the integration wheel.

.DESCRIPTION
  LIVE  service :8000  web :5173  code + data in the LIVE worktree (default C:\Users\Shari\dd-live-main)
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
  [string]$Python = "C:\Users\Shari\Dropbox (Personal)\GenAI Company\Projects\devday_hackathon\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
$Stacks = @{
  live = @{ ServicePort = 8000; WebPort = 5173; ServiceRoot = $LiveRoot }
  test = @{ ServicePort = 8101; WebPort = 5174; ServiceRoot = $TestRoot }
}
# Runtime files the service writes under data/ (gitignored). A TEST reset deletes these; tracked caches are restored
# from git and data/ingest_cache/ is kept warm, as on stage.
$RuntimeFiles = @("donors.db", "donors.db-wal", "donors.db-shm", "research_facts.json", "outreach_drafts.json",
                  "context_live.json", "events_live.json", "event_drafts.json", "after_call_proposals.json")

New-Item -ItemType Directory -Force (Join-Path $StateDir "logs") | Out-Null
$PidFile = Join-Path $StateDir "pids.json"

function Read-Pids {
  if (Test-Path $PidFile) {
    $obj = Get-Content $PidFile -Raw | ConvertFrom-Json
    $h = @{}
    foreach ($p in $obj.PSObject.Properties) { $h[$p.Name] = [int]$p.Value }
    return $h
  }
  return @{}
}
function Write-Pids($h) { ($h | ConvertTo-Json) | Out-File -Encoding utf8 $PidFile }

function Test-Alive([int]$procId) { return [bool](Get-Process -Id $procId -ErrorAction SilentlyContinue) }

function Get-PortOwner([int]$port) {
  $line = netstat -ano | Select-String -Pattern "TCP\s+\S+:$port\s+\S+\s+LISTENING\s+(\d+)" | Select-Object -First 1
  if ($line) { return [int]$line.Matches[0].Groups[1].Value }
  return $null
}

function Test-Http([string]$url) {
  try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 $url).StatusCode } catch { return 0 }
}

function Start-Part([string]$name, [string]$part) {
  $cfg = $Stacks[$name]; $key = "$name-$part"; $pids = Read-Pids
  if ($pids.ContainsKey($key) -and (Test-Alive $pids[$key])) { Write-Host "$key already running (pid $($pids[$key]))"; return }
  $port = if ($part -eq "service") { $cfg.ServicePort } else { $cfg.WebPort }
  $owner = Get-PortOwner $port
  if ($owner) { Write-Host "BUSY  :$port is held by pid $owner (not ours). Not starting $key; tell the lead."; $script:Bad = $true; return }

  $log = Join-Path $StateDir "logs\$key.log"; $err = Join-Path $StateDir "logs\$key.err.log"
  if ($part -eq "service") {
    $env:DONORS_DB = Join-Path $cfg.ServiceRoot "data\donors.db"
    $env:AFTER_CALL_PROPOSALS = Join-Path $cfg.ServiceRoot "data\after_call_proposals.json"
    $proc = Start-Process -FilePath $Python -WorkingDirectory $cfg.ServiceRoot -PassThru -WindowStyle Hidden `
      -RedirectStandardOutput $log -RedirectStandardError $err `
      -ArgumentList @("-m", "uvicorn", "service.main:app", "--host", "127.0.0.1", "--port", "$port")
    Remove-Item Env:DONORS_DB, Env:AFTER_CALL_PROPOSALS
  } else {
    $env:VITE_DATA_MODE = "local"; $env:VITE_API_URL = "http://127.0.0.1:$($cfg.ServicePort)"
    # Run vite's own entry with node so the PID we keep is the server, not a cmd/npx wrapper. No --force: both web
    # servers share LIVE's node_modules/.vite and vite re-optimizes by itself when the lockfile changes.
    $proc = Start-Process -FilePath "node" -WorkingDirectory (Join-Path $LiveRoot "web") -PassThru -WindowStyle Hidden `
      -RedirectStandardOutput $log -RedirectStandardError $err `
      -ArgumentList @("node_modules\vite\bin\vite.js", "--port", "$port", "--strictPort")
    Remove-Item Env:VITE_DATA_MODE, Env:VITE_API_URL
  }
  $pids[$key] = $proc.Id; Write-Pids $pids
  Write-Host "started $key pid $($proc.Id) on :$port (log $log)"
}

function Stop-Part([string]$name, [string]$part) {
  $key = "$name-$part"; $pids = Read-Pids
  if (-not $pids.ContainsKey($key)) { Write-Host "$key not in pid file"; return }
  $procId = $pids[$key]
  if (Test-Alive $procId) { & taskkill.exe /PID $procId /T /F | Out-Null; Write-Host "stopped $key (pid $procId)" }
  else { Write-Host "$key pid $procId already gone" }
  $pids.Remove($key); Write-Pids $pids
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
    $mine = if ($pids.ContainsKey($key)) { $pids[$key] } else { "-" }
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
  "restart" { foreach ($n in $Names) { foreach ($p in $Parts) { Stop-Part $n $p; Start-Part $n $p } } }
  "reset"   {
    # LIVE holds Sharif's data: only an explicit -Stack live resets it (on Sharif's or the lead's ask)
    if ($Stack -eq "all") { $Names = @("test") }
    foreach ($n in $Names) { Stop-Part $n "service"; Start-Sleep -Milliseconds 500; Reset-Data $n; Start-Part $n "service" }
    $Parts = @("service")
  }
}
if ($Action -ne "stop") {
  foreach ($n in $Names) { foreach ($p in $Parts) { if ($Action -ne "status") { [void](Wait-Healthy $n $p) } } }
  foreach ($n in $Names) { Show-Status $n }
}
if ($script:Bad) { exit 1 } else { exit 0 }
