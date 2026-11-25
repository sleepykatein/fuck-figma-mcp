$ErrorActionPreference = 'Stop'

$Repo = if ($env:FFM_REPO) { $env:FFM_REPO } else { 'https://github.com/oneuse1337/fuck-figma-mcp' }
$Branch = if ($env:FFM_BRANCH) { $env:FFM_BRANCH } else { 'main' }
$Dir = if ($env:FFM_DIR) { $env:FFM_DIR } else { Join-Path $HOME '.fuck-figma-mcp' }
$Name = if ($env:FFM_NAME) { $env:FFM_NAME } else { 'fuck-figma-mcp' }

function Step($text) { Write-Host '-> ' -ForegroundColor DarkGray -NoNewline; Write-Host $text }
function Fail($text) { Write-Host "error: $text" -ForegroundColor Red; throw $text }
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

if (-not (Has 'node')) { Fail 'Node.js 18 or newer is required. Get it from https://nodejs.org and run this again.' }
if (-not (Has 'npm')) { Fail 'npm is missing. Reinstall Node.js from https://nodejs.org and run this again.' }
$NodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($NodeMajor -lt 18) { Fail "Node.js $(& node -v) is too old. Install Node.js 18 or newer from https://nodejs.org." }

$Local = $null
if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot 'server.mjs')) -and (Test-Path (Join-Path $PSScriptRoot 'plugin\manifest.json'))) {
  $Local = $PSScriptRoot
}

if ($Local) {
  $Dir = $Local
  Step "Using local copy in $Dir"
} elseif ((Test-Path (Join-Path $Dir '.git')) -and (Has 'git')) {
  Step "Updating $Dir"
  & git -C $Dir pull --ff-only --quiet
  if ($LASTEXITCODE -ne 0) { Fail "git pull failed in $Dir." }
} elseif (Has 'git') {
  if (Test-Path $Dir) { Fail "$Dir already exists and is not a git checkout. Remove it or set FFM_DIR to another folder." }
  Step "Cloning $Repo into $Dir"
  & git clone --quiet --depth 1 --branch $Branch $Repo $Dir
  if ($LASTEXITCODE -ne 0) { Fail "git clone failed for $Repo." }
} else {
  Step "Downloading $Repo into $Dir"
  $Tmp = Join-Path ([IO.Path]::GetTempPath()) ("ffm-" + [Guid]::NewGuid())
  New-Item -ItemType Directory -Path $Tmp | Out-Null
  $Zip = Join-Path $Tmp 'src.zip'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri "$Repo/archive/refs/heads/$Branch.zip" -OutFile $Zip
  Expand-Archive -Path $Zip -DestinationPath $Tmp -Force
  $Inner = Get-ChildItem -Path $Tmp -Directory | Select-Object -First 1
  New-Item -ItemType Directory -Path $Dir -Force | Out-Null
  Copy-Item -Path (Join-Path $Inner.FullName '*') -Destination $Dir -Recurse -Force
  Remove-Item -Path $Tmp -Recurse -Force
}

Step 'Installing dependencies'
Push-Location $Dir
try {
  & npm ci --omit=dev --no-audit --no-fund --loglevel=error --update-notifier=false
  if ($LASTEXITCODE -ne 0) { Fail 'npm ci failed. Check your internet connection and run this again.' }
} finally {
  Pop-Location
}

$Server = Join-Path $Dir 'server.mjs'
$NodeBin = (Get-Command node).Source
$Registered = $false

if (Has 'claude') {
  Step "Registering MCP server `"$Name`" in Claude Code"
  & claude mcp remove --scope user $Name *> $null
  & claude mcp add --scope user $Name '--' $NodeBin $Server | Out-Null
  if ($LASTEXITCODE -eq 0) { $Registered = $true }
}

Write-Host ''
Write-Host 'fuck-figma-mcp is installed' -ForegroundColor White
Write-Host ''
if ($Registered) {
  Write-Host "  Claude Code: added as `"$Name`" (user scope). Restart Claude Code or run /mcp to load it."
} else {
  $J = { param($s) $s.Replace('\', '\\') }
  Write-Host '  Claude Code was not found. Add this to your MCP client config (Claude Desktop, Cursor, etc.):'
  Write-Host ''
  Write-Host ("    `"{0}`": {{ `"command`": `"{1}`", `"args`": [`"{2}`"] }}" -f $Name, (& $J $NodeBin), (& $J $Server))
}
Write-Host ''
Write-Host '  In the Figma desktop app, once:'
Write-Host '    Plugins > Development > Import plugin from manifest...'
Write-Host ("    " + (Join-Path $Dir 'plugin\manifest.json'))
Write-Host ''
Write-Host '  Then in every file you want the AI to edit:'
Write-Host '    Plugins > Development > fuck-figma-mcp'
Write-Host ''
