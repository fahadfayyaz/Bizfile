@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   BizFile Filings Service - demo
echo   No CAPTCHA solver, no API key
echo ============================================================
echo.

echo [1/4] Starting the API server...
start "bizfile-api" /min cmd /c "npm start"

:wait
timeout /t 2 /nobreak >nul
curl -s -o nul http://localhost:3000/health || goto wait
echo       Server is up on http://localhost:3000
echo.

echo [2/4] Lookup by UEN
echo       POST /api/sgp/filings  {"companyNumber":"196300440G"}
echo ------------------------------------------------------------
curl -s -X POST http://localhost:3000/api/sgp/filings -H "Content-Type: application/json" -d "{\"companyNumber\":\"196300440G\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))"
echo.

echo [3/4] Lookup by company NAME
echo       POST /api/sgp/filings  {"companyName":"KODLAND PTE. LTD."}
echo ------------------------------------------------------------
curl -s -X POST http://localhost:3000/api/sgp/filings -H "Content-Type: application/json" -d "{\"companyName\":\"KODLAND PTE. LTD.\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))"
echo.

echo [4/4] Error handling - a company that does not exist
echo       POST /api/sgp/filings  {"companyNumber":"999999999Z"}
echo ------------------------------------------------------------
curl -s -X POST http://localhost:3000/api/sgp/filings -H "Content-Type: application/json" -d "{\"companyNumber\":\"999999999Z\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))"
echo.

echo ============================================================
echo   Done. Shutting the server down.
echo ============================================================
rem Kill by listening port - the window-title filter misses npm's child node process.
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /PID %%a /T /F >nul 2>&1
endlocal
pause
