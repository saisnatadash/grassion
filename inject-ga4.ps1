# inject-ga4.ps1
# Run from: C:\Users\LENOVO\grassion
# Injects GA4 tag immediately after <head> in all public HTML files

$GA4_TAG = @'
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-814J68KF3J"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-814J68KF3J');
</script>
'@

$htmlFiles = Get-ChildItem -Path ".\public" -Filter "*.html" -Recurse

foreach ($file in $htmlFiles) {
    $content = Get-Content $file.FullName -Raw -Encoding UTF8

    # Skip if GA4 already injected
    if ($content -match 'G-814J68KF3J') {
        Write-Host "SKIP (already has GA4): $($file.Name)" -ForegroundColor Yellow
        continue
    }

    # Insert immediately after <head> tag
    if ($content -match '<head>') {
        $newContent = $content -replace '<head>', "<head>`n$GA4_TAG"
        Set-Content $file.FullName $newContent -Encoding UTF8 -NoNewline
        Write-Host "DONE: $($file.Name)" -ForegroundColor Green
    } else {
        Write-Host "WARN: No <head> tag found in $($file.Name)" -ForegroundColor Red
    }
}

Write-Host "`nAll done. Now run:" -ForegroundColor Cyan
Write-Host "  git add public/" -ForegroundColor White
Write-Host "  git commit -m 'Add GA4 tracking to all pages'" -ForegroundColor White
Write-Host "  git push origin master" -ForegroundColor White
