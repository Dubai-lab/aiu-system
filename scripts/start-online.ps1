# Start the AIU system on this laptop and make it reachable online through a free
# Cloudflare quick tunnel. Run it by right-clicking the file -> "Run with PowerShell".
#
# 1. stops old copies, 2. starts the face service and the backend (hidden),
# 3. starts the tunnel, 4. prints the value to put into Vercel (VITE_API_BASE_URL).
# The tunnel address changes every time this script runs.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$cloudflared = @("C:\Program Files (x86)\cloudflared\cloudflared.exe", "C:\Program Files\cloudflared\cloudflared.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $cloudflared) { throw "cloudflared is not installed. Run: winget install --id Cloudflare.cloudflared" }

function Wait-Health($url, $pattern, $seconds) {
    for ($i = 0; $i -lt $seconds; $i++) {
        Start-Sleep 1
        try { $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 3; if ($r.Content -match $pattern) { return $r.Content } } catch {}
    }
    throw "Timed out waiting for $url"
}

Write-Host "Stopping old copies..." -ForegroundColor Cyan
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Get-NetTCPConnection -LocalPort 8000, 8001 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep 2

Write-Host "Starting the face service (loading the face model)..." -ForegroundColor Cyan
Start-Process -FilePath "$root\face-service\.venv\Scripts\uvicorn.exe" -ArgumentList "main:app", "--host", "127.0.0.1", "--port", "8001" `
    -WorkingDirectory "$root\face-service" -WindowStyle Hidden `
    -RedirectStandardOutput "$env:TEMP\aiu_face.out" -RedirectStandardError "$env:TEMP\aiu_face.err"
Wait-Health "http://127.0.0.1:8001/health" '"model_loaded":true' 120 | Out-Null
Write-Host "  face service OK" -ForegroundColor Green

Write-Host "Starting the backend..." -ForegroundColor Cyan
Start-Process -FilePath "$root\backend\.venv\Scripts\uvicorn.exe" -ArgumentList "app.main:app", "--host", "127.0.0.1", "--port", "8000" `
    -WorkingDirectory "$root\backend" -WindowStyle Hidden `
    -RedirectStandardOutput "$env:TEMP\aiu_be.out" -RedirectStandardError "$env:TEMP\aiu_be.err"
Wait-Health "http://127.0.0.1:8000/health" '"database":"ok"' 60 | Out-Null
Write-Host "  backend OK" -ForegroundColor Green

Write-Host "Starting the Cloudflare tunnel..." -ForegroundColor Cyan
$log = "$env:TEMP\aiu_tunnel.log"
Remove-Item $log -ErrorAction SilentlyContinue
Start-Process -FilePath $cloudflared -ArgumentList "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:8000" `
    -WindowStyle Hidden -RedirectStandardError $log -RedirectStandardOutput "$env:TEMP\aiu_tunnel.out"
$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
    Start-Sleep 1
    if (Test-Path $log) {
        $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
        if ($m) { $url = $m.Matches[0].Value }
    }
}
if (-not $url) { throw "The tunnel did not start. Check your internet connection and run this again." }
Wait-Health "$url/health" '"database":"ok"' 60 | Out-Null

Write-Host ""
Write-Host "Everything is running and online." -ForegroundColor Green
Write-Host ""
Write-Host "In Vercel (Settings -> Environment Variables), set VITE_API_BASE_URL to:" -ForegroundColor Yellow
Write-Host "$url/api/v1" -ForegroundColor White
Write-Host "then Deployments -> ... -> Redeploy. (Only needed when this address changes.)" -ForegroundColor Yellow
Set-Clipboard -Value "$url/api/v1"
Write-Host "(The value has been copied to your clipboard.)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Keep this laptop on and connected. To stop everything, restart the laptop." -ForegroundColor Cyan
Read-Host "Press Enter to close this window (the system keeps running)"
