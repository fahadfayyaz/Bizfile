# bizfile

## Change Chrome Profile Path From Command Line

Set `CHROME_USER_DATA_DIR` before starting the API server:

```powershell
$env:CHROME_USER_DATA_DIR="C:/Users/Fahad Fayyaz/AppData/Local/Google/Chrome/User Data/Profile 4"
npm start
```

Use the same pattern for the manual debug runner:

```powershell
$env:CHROME_USER_DATA_DIR="C:/Users/Fahad Fayyaz/AppData/Local/Google/Chrome/User Data/Profile 4"
node .\index.js
```

You can also set Chrome executable path if needed:

```powershell
$env:CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"
```

Use one stable Chrome profile that can open BizFile normally. Avoid switching profiles repeatedly during testing because inconsistent session history can increase suspicious-activity risk.
