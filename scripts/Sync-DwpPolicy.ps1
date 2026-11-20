<#
.SYNOPSIS
  Copies the "Global" settings of Domain Whitelist Protector in a GPO to the
  Google Chrome and Microsoft Edge settings of the same GPO.

.DESCRIPTION
  The policy template created by scripts/enterprise.js contains a folder
  "Global" that no browser reads. Configure the extension there once, then
  run this script. It replaces all extension settings in the "Google Chrome"
  and "Microsoft Edge" folders of the GPO with the values from "Global".

  Only the extension's own settings are touched. Other settings of the GPO,
  including the force-install list, stay unchanged.

  Requires the GroupPolicy module (Group Policy Management Console / RSAT)
  and permission to edit the GPO. Run it with -WhatIf first.

.PARAMETER GpoName
  Display name of the GPO.

.PARAMETER ExtensionId
  Extension ID from gpo-values.txt.

.PARAMETER Scope
  User (default) when the settings are configured under User Configuration,
  Computer when they are configured under Computer Configuration.

.PARAMETER AllowEmpty
  Allows an empty "Global" folder, which removes all extension settings for
  Chrome and Edge. Without it, the script stops when "Global" is empty.

.EXAMPLE
  .\Sync-DwpPolicy.ps1 -GpoName "Domain Whitelist Protector" -ExtensionId abcdefghijklmnopabcdefghijklmnop -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string]$GpoName,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-p]{32}$')]
    [string]$ExtensionId,

    [ValidateSet('User', 'Computer')]
    [string]$Scope = 'User',

    [switch]$AllowEmpty
)

$ErrorActionPreference = 'Stop'
Import-Module GroupPolicy

$gpo = Get-GPO -Name $GpoName

if ($Scope -eq 'User') { $hive = 'HKCU' } else { $hive = 'HKLM' }

$sourceKey = "$hive\Software\Policies\DomainWhitelistProtector\Global"
$targets = [ordered]@{
    'Google Chrome'  = "$hive\Software\Policies\Google\Chrome\3rdparty\extensions\$ExtensionId\policy"
    'Microsoft Edge' = "$hive\Software\Policies\Microsoft\Edge\3rdparty\extensions\$ExtensionId\policy"
}

# Get-GPRegistryValue may return the long hive names.
function ConvertTo-ShortKey([string]$Key) {
    $Key = $Key.TrimEnd('\')
    $Key = $Key -replace '^HKEY_CURRENT_USER', 'HKCU'
    $Key = $Key -replace '^HKEY_LOCAL_MACHINE', 'HKLM'
    return $Key
}

# Returns all values below a key of the GPO, including subkeys
# (lists such as the whitelist are stored in a subkey).
function Get-PolicyValues([string]$Key, [hashtable]$Visited) {
    $Key = ConvertTo-ShortKey $Key
    if ($Visited.ContainsKey($Key.ToLowerInvariant())) { return @() }
    $Visited[$Key.ToLowerInvariant()] = $true

    try {
        $entries = @(Get-GPRegistryValue -Guid $gpo.Id -Key $Key -ErrorAction Stop)
    } catch {
        return @()
    }

    $result = @()
    foreach ($entry in $entries) {
        $entryKey = ConvertTo-ShortKey $entry.FullKeyPath
        if ($entry.ValueName) {
            # Skip deletion markers that the editor writes for lists and
            # disabled settings; only real values are copied.
            if ("$($entry.PolicyState)" -eq 'Set') {
                $result += [pscustomobject]@{
                    Key       = $entryKey
                    ValueName = $entry.ValueName
                    Type      = $entry.Type
                    Value     = $entry.Value
                }
            }
        } elseif ($entryKey -and $entryKey -ne $Key) {
            $result += Get-PolicyValues $entryKey $Visited
        }
    }
    return $result
}

$values = @(Get-PolicyValues $sourceKey @{})

if ($values.Count -eq 0 -and -not $AllowEmpty) {
    throw ("Nothing is configured in the folder 'Global' of GPO '$GpoName' " +
        "($Scope Configuration). Check -GpoName and -Scope, or use -AllowEmpty " +
        "to remove all extension settings for Chrome and Edge.")
}

Write-Host "Settings in 'Global' ($($values.Count) values):"
foreach ($value in $values) {
    $relative = $value.Key.Substring($sourceKey.Length).TrimStart('\')
    if ($relative) { $name = "$relative\$($value.ValueName)" } else { $name = $value.ValueName }
    Write-Host "  $name = $($value.Value)"
}
Write-Host ''

foreach ($target in $targets.GetEnumerator()) {
    $action = "Replace the extension settings with the $($values.Count) values from 'Global'"
    if ($PSCmdlet.ShouldProcess("$($target.Key) in GPO '$GpoName'", $action)) {
        # Remove the previous settings of this browser, subkeys first
        # (ignore keys that do not exist).
        $oldKeys = @(Get-PolicyValues $target.Value @{} | ForEach-Object { $_.Key }) + $target.Value
        $oldKeys = $oldKeys | Sort-Object -Unique | Sort-Object -Property Length -Descending
        foreach ($oldKey in $oldKeys) {
            try {
                Remove-GPRegistryValue -Guid $gpo.Id -Key $oldKey -ErrorAction Stop | Out-Null
            } catch { }
        }

        foreach ($value in $values) {
            $key = $target.Value + $value.Key.Substring($sourceKey.Length)
            Set-GPRegistryValue -Guid $gpo.Id -Key $key -ValueName $value.ValueName `
                -Type $value.Type -Value $value.Value | Out-Null
        }
        Write-Host "$($target.Key): updated."
    }
}

Write-Host ''
Write-Host 'Done. Computers apply the change at the next policy refresh (immediately: gpupdate /force).'
