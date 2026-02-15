param(
  [string]$InputPath = (Join-Path $PSScriptRoot '..\\Mega-Sena.xlsx'),
  [string]$OutputDir = (Join-Path $PSScriptRoot '..\\data'),
  [switch]$KeepTemp,
  [switch]$PassThru
)

$ErrorActionPreference = 'Stop'

function To-NullableInt {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  return [int]$Value
}

function To-NullableDecimal {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  $clean = $Value -replace '[^0-9,.-]', ''
  if ($clean -match ',') {
    $clean = $clean -replace '\.', '' -replace ',', '.'
  }
  $result = 0
  if ([decimal]::TryParse($clean, [Globalization.NumberStyles]::Any, [Globalization.CultureInfo]::InvariantCulture, [ref]$result)) {
    return $result
  }
  return $null
}

if (-not (Test-Path $InputPath)) {
  throw "Input file not found: $InputPath"
}

$tempDir = Join-Path $PSScriptRoot '..\\.tmp_xlsx'
if (Test-Path $tempDir) {
  Remove-Item -Recurse -Force $tempDir
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($InputPath, $tempDir)

$sharedPath = Join-Path $tempDir 'xl\\sharedStrings.xml'
$sheetPath = Join-Path $tempDir 'xl\\worksheets\\sheet1.xml'

$sharedStrings = @()
if (Test-Path $sharedPath) {
  $sharedXml = [xml](Get-Content -Raw $sharedPath)
  $sharedStrings = $sharedXml.sst.si | ForEach-Object { $_.t }
}

$sheetXml = [xml](Get-Content -Raw $sheetPath)
$ns = New-Object Xml.XmlNamespaceManager($sheetXml.NameTable)
$ns.AddNamespace('x','http://schemas.openxmlformats.org/spreadsheetml/2006/main')

$rows = $sheetXml.SelectNodes('//x:sheetData/x:row', $ns)
if ($rows.Count -lt 2) {
  throw 'No data rows found in sheet.'
}

$columns = @(
  'concurso',
  'data_sorteio',
  'bola1',
  'bola2',
  'bola3',
  'bola4',
  'bola5',
  'bola6',
  'ganhadores_6',
  'cidade_uf',
  'rateio_6',
  'ganhadores_5',
  'rateio_5',
  'ganhadores_4',
  'rateio_4',
  'acumulado_6',
  'arrecadacao_total',
  'estimativa_premio',
  'acumulado_mega_virada',
  'observacao'
)

$records = @()
for ($i = 1; $i -lt $rows.Count; $i++) {
  $row = $rows[$i]
  $values = @()
  foreach ($c in $row.SelectNodes('x:c', $ns)) {
    $t = $c.GetAttribute('t')
    $vNode = $c.SelectSingleNode('x:v', $ns)
    $v = if ($vNode) { $vNode.InnerText } else { '' }
    if ($t -eq 's') {
      $values += $sharedStrings[[int]$v]
    } else {
      $values += $v
    }
  }

  while ($values.Count -lt $columns.Count) {
    $values += ''
  }

  $date = [datetime]::ParseExact($values[1], 'dd/MM/yyyy', $null)
  $drawDate = $date.ToString('yyyy-MM-dd')
  $drawDateTimeLocal = "$drawDate" + 'T21:00:00'

  $record = [pscustomobject]@{
    concurso = To-NullableInt $values[0]
    data_sorteio = $drawDate
    draw_datetime_local = $drawDateTimeLocal
    timezone = 'America/Sao_Paulo'
    latitude = -23.5640
    longitude = -46.6510
    bola1 = To-NullableInt $values[2]
    bola2 = To-NullableInt $values[3]
    bola3 = To-NullableInt $values[4]
    bola4 = To-NullableInt $values[5]
    bola5 = To-NullableInt $values[6]
    bola6 = To-NullableInt $values[7]
    ganhadores_6 = To-NullableInt $values[8]
    cidade_uf = $values[9]
    rateio_6 = To-NullableDecimal $values[10]
    ganhadores_5 = To-NullableInt $values[11]
    rateio_5 = To-NullableDecimal $values[12]
    ganhadores_4 = To-NullableInt $values[13]
    rateio_4 = To-NullableDecimal $values[14]
    acumulado_6 = To-NullableDecimal $values[15]
    arrecadacao_total = To-NullableDecimal $values[16]
    estimativa_premio = To-NullableDecimal $values[17]
    acumulado_mega_virada = To-NullableDecimal $values[18]
    observacao = $values[19]
  }

  $records += $record
}

if (-not (Test-Path $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

$csvPath = Join-Path $OutputDir 'mega_sena.csv'
$jsonPath = Join-Path $OutputDir 'mega_sena.json'

$records | Export-Csv -NoTypeInformation -Path $csvPath -Encoding UTF8
$records | ConvertTo-Json -Depth 3 | Set-Content -Path $jsonPath -Encoding UTF8

if (-not $KeepTemp) {
  Remove-Item -Recurse -Force $tempDir
}

if ($PassThru) {
  $records
}
