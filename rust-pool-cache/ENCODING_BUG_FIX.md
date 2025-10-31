# PowerShell Encoding Bug Fix

## Problem

When running `.\START.ps1 fix`, PowerShell threw parsing errors:

```
表达式中缺少右")"
表达式或语句中包含意外的标记"}"
字符串缺少终止符
```

Chinese characters appeared as gibberish:
- `娓呯悊缂栬瘧鍚庡惎鍔` (garbled)
- Should be: `清理编译后启动` (clean build then start)

## Root Cause

**PowerShell file encoding issue**

PowerShell scripts (.ps1) require specific encoding:
- Windows PowerShell: UTF-8 with BOM or UTF-16 LE
- PowerShell Core: UTF-8 with BOM

When files contain Chinese characters but are saved with incorrect encoding (e.g., UTF-8 without BOM), PowerShell cannot parse them correctly, leading to syntax errors.

## Solution

### Option 1: Fix Encoding (Complex)
Save files with UTF-8 with BOM encoding.

### Option 2: Remove Chinese Characters (Simple) ✅
**We used this approach:**
- Rewrote all PowerShell scripts in English
- Removed all Chinese comments and messages
- Used simple ASCII characters only

## Files Fixed

1. **`START.ps1`** - Unified startup script
   - Changed all Chinese UI text to English
   - Simplified string formatting
   - Avoided parentheses in display strings

2. **`fix_and_test.ps1`** - Vault fix script
   - Translated all Chinese text to English
   - Maintained all functionality

## Changes Made

### Before (Chinese with encoding issues):
```powershell
Write-Host "  clean            - 清理编译后启动" -ForegroundColor Gray
Write-Host "`n示例:" -ForegroundColor Yellow
Write-Host "   使用 '.\START.ps1 help' 查看可用模式`n" -ForegroundColor Gray
```

### After (English, no encoding issues):
```powershell
Write-Host "  clean            - Clean build" -ForegroundColor Gray
Write-Host "Examples:" -ForegroundColor Yellow
Write-Host "Use '.\START.ps1 help' to see available modes" -ForegroundColor Gray
```

## Testing

```powershell
# Test help command
.\START.ps1 help
# Output: Success! Shows all modes correctly

# Test fix mode
.\START.ps1 fix
# Output: Executes fix_and_test.ps1 successfully
```

## Key Takeaways

1. **PowerShell + Chinese = Encoding Hell**
   - Always use English for scripts
   - Or ensure correct encoding (UTF-8 with BOM)

2. **Simplify Strings**
   - Avoid complex characters in strings
   - Use simple ASCII when possible

3. **Test After Save**
   - Different editors save with different encodings
   - VS Code default: UTF-8 without BOM (problematic)
   - Notepad++ / VS: Can specify UTF-8 with BOM

## How to Avoid This

### For Future Scripts:

1. **Use English only** (recommended)
2. **If using Chinese:**
   - Save as UTF-8 with BOM
   - VS Code: Add to settings.json:
     ```json
     "[powershell]": {
       "files.encoding": "utf8bom"
     }
     ```
   - Notepad++: Encoding → UTF-8-BOM

3. **Test immediately after saving**

## Current Status

✅ **FIXED**

All PowerShell scripts now use English and work correctly:
- `START.ps1` - 8 modes available
- `fix_and_test.ps1` - Complete fix workflow
- No encoding issues
- No parsing errors

## Usage

```powershell
# Now you can use:
cd rust-pool-cache

.\START.ps1              # Normal startup
.\START.ps1 fix          # Vault fix
.\START.ps1 test         # Quick test
.\START.ps1 help         # Show all modes
```

Everything works! 🎉



