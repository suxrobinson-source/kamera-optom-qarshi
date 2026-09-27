Add-Type -AssemblyName System.Drawing

$inputPath = "C:\Users\suxro\.gemini\antigravity\brain\bd1d0a22-e371-4711-8112-093f1394ecff\.user_uploaded\media_1789457559700.png"
$outDir = "d:\QARSHI_OPTOM_KAMERA"

if (-not (Test-Path $inputPath)) {
    Write-Error "Input file not found: $inputPath"
    exit 1
}

$bmp = [System.Drawing.Bitmap]::FromFile($inputPath)
$w = $bmp.Width
$h = $bmp.Height
Write-Output "Original Image Dimensions: ${w}x${h}"

# In media_1789457559700.png:
# Let's inspect the middle photo.
# There are three photos side by side:
# Photo 1 (left): has a finger/thumb on the top left
# Photo 2 (middle): perfectly unobstructed
# Photo 3 (right): unobstructed
# Let's scan horizontally across a line around Y = 0.25 * h to find the boundaries of the middle photo.
$sampleY = [int]($h * 0.25)

# We can also crop several candidate regions around the middle photo so we get the exact perfect one.
# Middle photo is roughly:
# X: from 0.32 * w to 0.61 * w
# Y: from 0.08 * h to 0.38 * h

$cropX = [int]($w * 0.32)
$cropY = [int]($h * 0.08)
$cropW = [int]($w * 0.29)
$cropH = [int]($h * 0.30)

Write-Output "Estimated crop box: X=$cropX, Y=$cropY, W=$cropW, H=$cropH"

# We will search for the exact border lines around the middle photo.
# The border between photo 1 and photo 2 is a vertical line.
# The border between photo 2 and photo 3 is a vertical line.
# The bottom border of the photos is a horizontal line separating the photos from the gray card footer.

# Let's write out information and also do smart detection:
# Find horizontal boundary below the photo:
# Looking down column (0.46 * w) from Y=0.25*h to Y=0.45*h:
# The jacket is dark (low brightness), the gray area below is medium gray (higher brightness).
$bottomY = -1
for ($y = [int]($h * 0.28); $y -lt [int]($h * 0.45); $y++) {
    $c = $bmp.GetPixel([int]($w * 0.46), $y)
    $b = ($c.R + $c.G + $c.B) / 3
    # Look for sharp transition from dark jacket (b < 60) to gray card (b > 140)
    if ($b -gt 150) {
        $bottomY = $y
        break
    }
}

# Find top boundary:
# Look up from Y=0.15*h to Y=0.04*h:
# Top background is light off-white (b > 200), card top edge / border might be visible
$topY = -1
for ($y = [int]($h * 0.06); $y -lt [int]($h * 0.15); $y++) {
    $c = $bmp.GetPixel([int]($w * 0.46), $y)
    # Background above head is very light
    $b = ($c.R + $c.G + $c.B) / 3
    if ($b -gt 180) {
        $topY = $y
        break
    }
}

# Find left boundary of middle photo:
# Between photo 1 and photo 2, there is a thin white/gray border line around X=0.32*w to 0.35*w
$leftX = -1
# Find right boundary of middle photo:
# Between photo 2 and photo 3, around X=0.59*w to 0.63*w
$rightX = -1

Write-Output "Detected bottomY: $bottomY, topY: $topY"

# Let's save a test crop of middle photo
$rect = New-Object System.Drawing.Rectangle($cropX, $cropY, $cropW, $cropH)
$croppedBmp = $bmp.Clone($rect, $bmp.PixelFormat)

$outputPath = Join-Path $outDir "cropped_photo_candidate.png"
$croppedBmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$croppedBmp.Dispose()
$bmp.Dispose()

Write-Output "Saved candidate crop to $outputPath"
