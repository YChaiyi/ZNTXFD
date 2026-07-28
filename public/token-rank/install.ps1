function znt-tokenrank {
  param(
    [Parameter(Position=0)][string]$Command,
    [string]$Token,
    [string]$Endpoint,
    [switch]$NoSchedule
  )

  $ErrorActionPreference = "Stop"

  $InstallDir = Join-Path $env:USERPROFILE ".znt-tokenrank"
  $Client = Join-Path $InstallDir "client.mjs"
  $ClientDownload = Join-Path $InstallDir "client.download.mjs"
  $ClientBackup = Join-Path $InstallDir "client.previous.mjs"
  $ConfigDir = if ($env:ZNT_TOKENRANK_HOME) { $env:ZNT_TOKENRANK_HOME } else { $InstallDir }
  $Config = Join-Path $ConfigDir "config.json"
  $ConfigBackup = Join-Path $InstallDir "config.previous.json"

  if (-not $Token -or -not $Endpoint) {
    throw "缺少 --token 或 --endpoint，请从 Token 消耗榜页面复制专属命令。"
  }

  if ($Token -like "*xxx*" -or $Token -like "*your_private_token*") {
    throw "令牌还是占位符。请先在 Token 消耗榜页面点击「生成命令」，复制生成后的真实专属命令。"
  }

  $NodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $NodePath) {
    throw "没有找到 node。请先安装 Node.js，再重新运行接入命令。"
  }
  $NodeMajor = [int](& $NodePath -p 'Number(process.versions.node.split(".")[0])')
  if ($NodeMajor -lt 18) {
    throw "Node.js 版本过旧。Token 消耗榜需要 Node.js 18 或更高版本。"
  }

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $ScriptUrl = $Endpoint -replace "/api/token-rank/upload$", "/token-rank/client.mjs"
  Invoke-WebRequest -Uri $ScriptUrl -OutFile $ClientDownload
  & $NodePath --check $ClientDownload
  if ($LASTEXITCODE -ne 0) {
    Remove-Item $ClientDownload -Force -ErrorAction SilentlyContinue
    throw "下载的客户端脚本校验失败，现有客户端未修改。"
  }
  $ClientVersion = (& $NodePath $ClientDownload --version | Select-Object -First 1)
  if ($ClientVersion -notmatch '^\d+\.\d+\.\d+$') {
    Remove-Item $ClientDownload -Force -ErrorAction SilentlyContinue
    throw "下载的客户端没有返回有效版本号，现有客户端未修改。"
  }

  $HadClient = Test-Path $Client
  if ($HadClient) {
    Copy-Item $Client $ClientBackup -Force
  }
  $HadConfig = Test-Path $Config
  if ($HadConfig) {
    Copy-Item $Config $ConfigBackup -Force
  }
  Move-Item $ClientDownload $Client -Force

  $RestoreClientAndConfig = {
    if ($HadClient -and (Test-Path $ClientBackup)) {
      Move-Item $ClientBackup $Client -Force
    } else {
      Remove-Item $Client -Force -ErrorAction SilentlyContinue
    }
    if ($HadConfig -and (Test-Path $ConfigBackup)) {
      New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
      Copy-Item $ConfigBackup $Config -Force
    } else {
      Remove-Item $Config -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $ConfigBackup -Force -ErrorAction SilentlyContinue
  }

  & $NodePath $Client --token $Token --endpoint $Endpoint --rebuild-history
  if ($LASTEXITCODE -ne 0) {
    & $RestoreClientAndConfig
    throw "首次同步失败，未安装后台任务。请确认你复制的是页面生成的真实专属命令。"
  }

  if ($NoSchedule) {
    Remove-Item $ClientBackup -Force -ErrorAction SilentlyContinue
    Remove-Item $ConfigBackup -Force -ErrorAction SilentlyContinue
    Write-Output "Token 消耗榜客户端已验证，未安装后台任务（-NoSchedule）。客户端版本：$ClientVersion"
    return
  }

  $TaskName = "ZNT Token Rank Sync"
  $PreviousTaskXml = $null
  $TaskMutationStarted = $false
  try {
    $ExistingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($ExistingTask) {
      $PreviousTaskXml = Export-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    }
    $Action = New-ScheduledTaskAction -Execute $NodePath -Argument "`"$Client`""
    $Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 30)
    $TaskMutationStarted = $true
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Description "Sync AI coding tool token usage to znt.group" -Force -ErrorAction Stop | Out-Null
  } catch {
    & $RestoreClientAndConfig
    if ($TaskMutationStarted) {
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
      if ($PreviousTaskXml) {
        Register-ScheduledTask -TaskName $TaskName -Xml $PreviousTaskXml -Force -ErrorAction SilentlyContinue | Out-Null
      }
    }
    throw "后台任务安装失败，已恢复原客户端与配置。$($_.Exception.Message)"
  }
  Remove-Item $ClientBackup -Force -ErrorAction SilentlyContinue
  Remove-Item $ConfigBackup -Force -ErrorAction SilentlyContinue

  Write-Output "Token 消耗榜已接入。配置目录：$InstallDir。客户端版本：$ClientVersion"
}
