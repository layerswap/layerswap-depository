<#
.SYNOPSIS
    Verifies LayerswapDepository on all specified networks using a single unified Etherscan API key.

.DESCRIPTION
    Reads CONTRACT_ADDRESS, ETHERSCAN_API_KEY, VERIFY_CHAINS, and CONSTRUCTOR_ARGS
    from .env. Iterates over each network in VERIFY_CHAINS and runs forge verify-contract
    with --chain (no RPC URLs needed).

.EXAMPLE
    .\script\VerifyAllFromBroadcast.ps1
#>

# ── Chain name -> chain ID (all Etherscan V2 unified API networks) ─────────────
# Source: https://docs.etherscan.io/supported-chains
$NameToId = @{
    "mainnet"            = "1"
    "sepolia"            = "11155111"
    "hoodi"              = "560048"
    "holesky"            = "17000"
    "arbitrum"           = "42161"
    "arbitrum-sepolia"   = "421614"
    "optimism"           = "10"
    "optimism-sepolia"   = "11155420"
    "base"               = "8453"
    "base-sepolia"       = "84532"
    "polygon"            = "137"
    "polygon-amoy"       = "80002"
    "bsc"                = "56"
    "bsc-testnet"        = "97"
    "avalanche"          = "43114"
    "avalanche-fuji"     = "43113"
    "linea"              = "59144"
    "linea-sepolia"      = "59141"
    "blast"              = "81457"
    "blast-sepolia"      = "168587773"
    "scroll"             = "534352"
    "scroll-sepolia"     = "534351"
    "mantle"             = "5000"
    "mantle-sepolia"     = "5003"
    "gnosis"             = "100"
    "celo"               = "42220"
    "celo-sepolia"       = "11142220"
    "fraxtal"            = "252"
    "fraxtal-testnet"    = "2523"
    "moonbeam"           = "1284"
    "moonriver"          = "1285"
    "moonbase-alpha"     = "1287"
    "taiko"              = "167000"
    "taiko-hoodi"        = "167013"
    "bttc"               = "199"
    "bttc-testnet"       = "1029"
    "opbnb-mainnet"      = "204"
    "opbnb-testnet"      = "5611"
    "xdc-mainnet"        = "50"
    "xdc-testnet"        = "51"
    "world"              = "480"
    "world-sepolia"      = "4801"
    "sonic"              = "146"
    "sonic-testnet"      = "14601"
    "unichain"           = "130"
    "unichain-sepolia"   = "1301"
    "abstract"           = "2741"
    "abstract-testnet"   = "11124"
    "berachain"          = "80094"
    "berachain-bepolia"  = "80069"
    "swellchain"         = "1923"
    "swellchain-testnet" = "1924"
    "monad"              = "143"
    "monad-testnet"      = "10143"
    "hyperliquid"        = "999"
    "apechain"           = "33139"
    "apechain-curtis"    = "33111"
    "sei"                = "1329"
    "sei-testnet"        = "1328"
    "katana"             = "747474"
    "katana-bokuto"      = "737373"
    "memecore"           = "4352"
    "memecore-testnet"   = "43522"
    "megaeth"            = "4326"
    "megaeth-testnet"    = "6343"
    "stable-mainnet"     = "988"
    "stable-testnet"     = "2201"
    "plasma"             = "9745"
    "plasma-testnet"     = "9746"
    "mode"               = "34443"
    "zora"               = "7777777"
}

# ── Parse .env into a hashtable ────────────────────────────────────────────────
$envPath = Join-Path (Join-Path $PSScriptRoot "..") ".env"
$cfg = @{}
if (Test-Path $envPath) {
    foreach ($line in [System.IO.File]::ReadAllLines((Resolve-Path $envPath).Path)) {
        $t = $line.Trim()
        if ($t.Length -eq 0 -or $t.StartsWith("#")) { continue }
        $i = $t.IndexOf('=')
        if ($i -lt 1) { continue }
        $k = $t.Substring(0, $i).Trim()
        $v = $t.Substring($i + 1).Trim()
        if ($k.Length -gt 0 -and $v.Length -gt 0) { $cfg[$k] = $v }
    }
    Write-Host "[*] Loaded .env ($($cfg.Count) vars)" -ForegroundColor Cyan
} else {
    Write-Host "[!] .env not found -aborting" -ForegroundColor Red
    return
}

# ── Validate required vars ─────────────────────────────────────────────────────
$reqKeys = @("CONTRACT_ADDRESS", "ETHERSCAN_API_KEY", "CONSTRUCTOR_ARGS", "VERIFY_CHAINS")
$miss = @()
foreach ($rk in $reqKeys) {
    if (-not $cfg.ContainsKey($rk)) { $miss += $rk }
}
if ($miss.Count -gt 0) {
    Write-Host "[!] Missing .env vars: $($miss -join ', ')" -ForegroundColor Red
    return
}

$addr   = $cfg["CONTRACT_ADDRESS"]
$apiKey = $cfg["ETHERSCAN_API_KEY"]
$cArgs  = $cfg["CONSTRUCTOR_ARGS"]
$chains = $cfg["VERIFY_CHAINS"]

Write-Host "[*] Contract: $addr" -ForegroundColor Cyan
Write-Host "[*] Chains:   $chains" -ForegroundColor Cyan
Write-Host ""

# ── Split chain list ───────────────────────────────────────────────────────────
$netList = $chains.Split(',') | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_.Length -gt 0 }

# ── Verify each chain ─────────────────────────────────────────────────────────
[System.Collections.ArrayList]$results = @()

foreach ($net in $netList) {
    $cid = $null
    if ($NameToId.ContainsKey($net)) {
        $cid = $NameToId[$net]
    } else {
        Write-Host "[!] Unknown network '$net' -skipping" -ForegroundColor Yellow
        $null = $results.Add([PSCustomObject]@{ Network = $net; Status = "SKIPPED (unknown)" })
        continue
    }

    Write-Host "========================================" -ForegroundColor White
    Write-Host "  $net (chain $cid)" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor White
    Write-Host "[*] forge verify-contract $addr --chain $cid" -ForegroundColor DarkGray

    $output = & forge verify-contract "$addr" "src/LayerswapDepository.sol:LayerswapDepository" --chain "$cid" --etherscan-api-key "$apiKey" --constructor-args "$cArgs" --watch 2>&1 | Out-String

    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] $net verified!" -ForegroundColor Green
        $null = $results.Add([PSCustomObject]@{ Network = $net; Status = "SUCCESS" })
    } elseif ($output -match "already verified") {
        Write-Host "[OK] $net already verified" -ForegroundColor Green
        $null = $results.Add([PSCustomObject]@{ Network = $net; Status = "ALREADY VERIFIED" })
    } else {
        Write-Host "[X] $net -failed" -ForegroundColor Red
        Write-Host $output -ForegroundColor DarkRed
        $null = $results.Add([PSCustomObject]@{ Network = $net; Status = "FAILED" })
    }
    Write-Host ""
}

# ── Summary ────────────────────────────────────────────────────────────────────
Write-Host "========================================" -ForegroundColor White
Write-Host "         VERIFICATION SUMMARY           " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor White

if ($results.Count -gt 0) {
    $results | Format-Table -AutoSize -Property Network, Status
}

$ok   = @($results | Where-Object { $_.Status -match "SUCCESS|ALREADY" }).Count
$fail = @($results | Where-Object { $_.Status -match "FAILED" }).Count
$skip = @($results | Where-Object { $_.Status -match "SKIPPED" }).Count

Write-Host "  Verified: $ok | Failed: $fail | Skipped: $skip" -ForegroundColor $(if ($fail -gt 0) { "Yellow" } else { "Green" })
Write-Host ""

if ($fail -gt 0) { exit 1 }
