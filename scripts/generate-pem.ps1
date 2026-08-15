# PEM 인증서 생성 / 다운로드용 zip 패키징 (Windows)
#
# 사용법 (PowerShell):
#   .\scripts\generate-pem.ps1
#   .\scripts\generate-pem.ps1 -Domain example.com
#   .\scripts\generate-pem.ps1 -Serve
#   .\scripts\generate-pem.ps1 -Serve -Port 9000
#
# OpenSSL 이 PATH 에 있으면 PEM 을 직접 생성합니다.
# 없으면 New-SelfSignedCertificate + certutil 로 PFX 를 만든 뒤 OpenSSL 로 변환합니다.
# Git for Windows 의 openssl.exe 가 있으면 자동으로 사용합니다.

param(
    [string]$Domain = "server.lunarsystem.co.kr",
    [switch]$Serve,
    [int]$Port = 8080
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$CertsDir = Join-Path $ProjectDir "certs"
$OutDir = Join-Path $CertsDir $Domain
$Fullchain = Join-Path $OutDir "fullchain.pem"
$Privkey = Join-Path $OutDir "privkey.pem"
$ZipPath = Join-Path $CertsDir "$Domain.zip"

function Find-OpenSsl {
    $cmd = Get-Command openssl -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidates = @(
        "C:\Program Files\Git\usr\bin\openssl.exe",
        "C:\Program Files\OpenSSL-Win64\bin\openssl.exe",
        "C:\Program Files (x86)\OpenSSL-Win32\bin\openssl.exe"
    )
    foreach ($path in $candidates) {
        if (Test-Path $path) { return $path }
    }
    return $null
}

function Write-Readme {
    $readme = Join-Path $OutDir "README.txt"
    @"
도메인: $Domain
생성 시각: $(Get-Date -Format o)

파일:
  fullchain.pem  — 인증서 체인 (config.json 의 certPath)
  privkey.pem    — 개인키 (config.json 의 keyPath)

config.json 예시:
  "certPath": "./certs/$Domain/fullchain.pem"
  "keyPath": "./certs/$Domain/privkey.pem"

주의: privkey.pem 은 비밀키입니다. git 에 커밋하거나 공유하지 마세요.
"@ | Set-Content -Path $readme -Encoding UTF8
}

function New-ZipPackage {
    New-Item -ItemType Directory -Force -Path $CertsDir | Out-Null
    if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }

    if (Get-Command Compress-Archive -ErrorAction SilentlyContinue) {
        Compress-Archive -Path $OutDir -DestinationPath $ZipPath -Force
    } else {
        Write-Error "Compress-Archive 를 사용할 수 없습니다. PowerShell 5 이상이 필요합니다."
    }

    Write-Host "[generate-pem] 다운로드 패키지: $ZipPath"
}

function New-PemWithOpenSsl {
    param([string]$OpenSslPath)

    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    Write-Host "[generate-pem] self-signed 인증서 생성 (openssl): $Domain"

    $subj = "/CN=$Domain"
    & $OpenSslPath req -x509 -nodes -newkey rsa:2048 `
        -keyout $Privkey `
        -out $Fullchain `
        -days 365 `
        -subj $subj

    Write-Readme
    New-ZipPackage

    Write-Host "[generate-pem] 완료"
    Write-Host "[generate-pem]   cert: $Fullchain"
    Write-Host "[generate-pem]   key:  $Privkey"
}

function New-PemWithCertUtil {
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    Write-Host "[generate-pem] self-signed 인증서 생성 (New-SelfSignedCertificate): $Domain"

    $tempDir = Join-Path $env:TEMP "lnteletranslate-pem-$Domain"
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    $pfxPath = Join-Path $tempDir "cert.pfx"
    $cerPath = Join-Path $tempDir "cert.cer"
    $password = ConvertTo-SecureString -String "temp-pass" -Force -AsPlainText

    $cert = New-SelfSignedCertificate `
        -DnsName $Domain, "localhost" `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -KeyExportPolicy Exportable `
        -NotAfter (Get-Date).AddDays(365)

    Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $password | Out-Null
    Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null

    $openssl = Find-OpenSsl
    if (-not $openssl) {
        Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
        Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -ErrorAction SilentlyContinue
        Write-Error "OpenSSL 이 없어 PEM 변환을 할 수 없습니다.`nGit for Windows 또는 OpenSSL 을 설치하세요."
    }

    & $openssl pkcs12 -in $pfxPath -nocerts -nodes -out $Privkey -passin pass:temp-pass | Out-Null
    & $openssl x509 -in $cerPath -out $Fullchain | Out-Null

    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
    Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -ErrorAction SilentlyContinue

    Write-Readme
    New-ZipPackage

    Write-Host "[generate-pem] 완료"
    Write-Host "[generate-pem]   cert: $Fullchain"
    Write-Host "[generate-pem]   key:  $Privkey"
}

function Start-DownloadServer {
    if (-not (Test-Path $OutDir)) {
        $openssl = Find-OpenSsl
        if ($openssl) {
            New-PemWithOpenSsl -OpenSslPath $openssl
        } else {
            New-PemWithCertUtil
        }
    } else {
        New-ZipPackage
    }

    $zipName = Split-Path $ZipPath -Leaf
    Write-Host ""
    Write-Host "[generate-pem] 다운로드 서버 시작 (Ctrl+C 로 종료)"
    Write-Host "[generate-pem]   http://127.0.0.1:$Port/$zipName"
    Write-Host ""

    Push-Location $CertsDir
    try {
        $listener = New-Object System.Net.HttpListener
        $prefix = "http://+:$Port/"
        $listener.Prefixes.Add($prefix)

        try {
            $listener.Start()
        } catch {
            $prefix = "http://127.0.0.1:$Port/"
            $listener = New-Object System.Net.HttpListener
            $listener.Prefixes.Add($prefix)
            $listener.Start()
            Write-Host "[generate-pem] localhost 전용으로 서버를 시작합니다: $prefix"
        }

        while ($listener.IsListening) {
            $context = $listener.GetContext()
            $request = $context.Request
            $response = $context.Response
            $path = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath).TrimStart("/")

            if ([string]::IsNullOrWhiteSpace($path)) {
                $path = $zipName
            }

            $filePath = Join-Path $CertsDir $path
            if ((Test-Path $filePath) -and -not (Get-Item $filePath).PSIsContainer) {
                $bytes = [System.IO.File]::ReadAllBytes($filePath)
                $response.ContentType = "application/octet-stream"
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $body = [System.Text.Encoding]::UTF8.GetBytes("Not found: $path")
                $response.StatusCode = 404
                $response.OutputStream.Write($body, 0, $body.Length)
            }
            $response.Close()
        }
    } finally {
        Pop-Location
    }
}

if ($Serve) {
    Start-DownloadServer
    exit 0
}

$opensslPath = Find-OpenSsl
if ($opensslPath) {
    New-PemWithOpenSsl -OpenSslPath $opensslPath
} else {
    New-PemWithCertUtil
}
