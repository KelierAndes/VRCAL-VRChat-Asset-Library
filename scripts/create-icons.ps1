$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\assets'))
New-Item -ItemType Directory -Force -Path $assetDirectory | Out-Null
$image = New-Object System.Drawing.Bitmap 256,256
$graphics = [System.Drawing.Graphics]::FromImage($image)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(103,86,141))
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(226,217,255)),13
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
function Point([int]$x,[int]$y) { New-Object System.Drawing.Point $x,$y }
$points = [System.Drawing.Point[]]@((Point 128 57),(Point 197 96),(Point 197 173),(Point 128 212),(Point 59 173),(Point 59 96))
$graphics.DrawPolygon($pen,$points)
$graphics.DrawLine($pen,128,135,128,212)
$graphics.DrawLines($pen,[System.Drawing.Point[]]@((Point 59 96),(Point 128 135),(Point 197 96)))
$graphics.DrawLine($pen,93,77,162,116)
$memory = New-Object System.IO.MemoryStream
$image.Save($memory,[System.Drawing.Imaging.ImageFormat]::Png)
$bytes = $memory.ToArray()
[System.IO.File]::WriteAllBytes((Join-Path $assetDirectory 'library.png'),$bytes)
$output = [System.IO.File]::Create((Join-Path $assetDirectory 'library.ico'))
$writer = New-Object System.IO.BinaryWriter $output
$writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([UInt16]1); $writer.Write([UInt16]32); $writer.Write([UInt32]$bytes.Length); $writer.Write([UInt32]22); $writer.Write($bytes)
$writer.Dispose(); $memory.Dispose(); $pen.Dispose(); $graphics.Dispose(); $image.Dispose()
Write-Output 'Application icon prepared'
