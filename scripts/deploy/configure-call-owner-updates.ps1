# Windows PowerShell 5-compatible. Run after reviewing the ownership-update PR.
# Transfers the existing Communications write credential to the server-only,
# narrowly routed Padawan owner-update integration. Never writes it to disk or argv.
$ErrorActionPreference = 'Stop'
$fly = Join-Path $env:USERPROFILE '.fly\bin\flyctl.exe'
if (-not (Test-Path $fly)) { throw 'Fly CLI was not found.' }
$reader = $null
$writer = $null
$payload = $null
$bytes = $null
$previousInputEncoding = [Console]::InputEncoding
try {
    # .NET Framework creates the stdin StreamWriter at Process.Start and can
    # flush a preamble before BaseStream is available. Set the encoding first.
    [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
    $readInfo = New-Object System.Diagnostics.ProcessStartInfo
    $readInfo.FileName = $fly
    $readInfo.Arguments = 'ssh console --app justice-exteriors-communications-nonprod -C "node -e process.stdout.write(JSON.stringify({key:process.env.COMMUNICATIONS_API_WRITE_KEY}))"'
    $readInfo.UseShellExecute = $false
    $readInfo.RedirectStandardOutput = $true
    $readInfo.RedirectStandardError = $true
    $reader = [System.Diagnostics.Process]::Start($readInfo)
    $outTask = $reader.StandardOutput.ReadToEndAsync()
    $errTask = $reader.StandardError.ReadToEndAsync()
    $reader.WaitForExit()
    $captured = $outTask.GetAwaiter().GetResult()
    $null = $errTask.GetAwaiter().GetResult()
    if ($reader.ExitCode -ne 0) { throw 'Could not read the existing server credential. Check Fly login; no secrets were imported.' }
    $match = [regex]::Match($captured, '\{"key":"(?:[^"\\]|\\.)*"\}')
    if (-not $match.Success) { throw 'The server credential was not returned. Nothing was imported.' }
    $credential = ($match.Value | ConvertFrom-Json).key
    if ([string]::IsNullOrWhiteSpace($credential) -or $credential.Length -lt 16 -or $credential -match '[\r\n]') {
        throw 'The credential format was unexpected. Nothing was imported.'
    }
    $payload = 'COMMUNICATIONS_OWNER_WRITE_KEY=' + $credential + "`n"
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($payload)
    $writeInfo = New-Object System.Diagnostics.ProcessStartInfo
    $writeInfo.FileName = $fly
    $writeInfo.Arguments = 'secrets import --app justiceos --stage'
    $writeInfo.UseShellExecute = $false
    $writeInfo.RedirectStandardInput = $true
    $writeInfo.RedirectStandardOutput = $true
    $writeInfo.RedirectStandardError = $true
    $writer = [System.Diagnostics.Process]::Start($writeInfo)
    $writeOut = $writer.StandardOutput.ReadToEndAsync()
    $writeErr = $writer.StandardError.ReadToEndAsync()
    # Write raw UTF-8 bytes so Windows PowerShell cannot prepend a BOM.
    $writer.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $writer.StandardInput.BaseStream.Flush()
    $writer.StandardInput.BaseStream.Close()
    $writer.WaitForExit()
    $importOutput = $writeOut.GetAwaiter().GetResult()
    $importError = $writeErr.GetAwaiter().GetResult()
    if ($writer.ExitCode -ne 0) {
        $details = ($importError + "`n" + $importOutput).Replace($credential, '[REDACTED]')
        $details = [regex]::Replace($details, '[A-Za-z0-9+/_=-]{24,}', '[REDACTED]')
        throw ('Owner-update credential import failed. Sanitized Fly output: ' + $details)
    }
    Write-Host 'Owner-update credential staged for justiceos. Deploy the reviewed Padawan revision to enable it.'
}
finally {
    [Console]::InputEncoding = $previousInputEncoding
    if ($bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
    $credential = $null
    $captured = $null
    $payload = $null
    $match = $null
    if ($reader) { $reader.Dispose() }
    if ($writer) { $writer.Dispose() }
}
