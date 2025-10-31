# 🚀 **简化启动指南**

## **只需要记住一个命令！**

```powershell
.\START.ps1 fix
```

就这么简单！

---

## **详细说明**

### **统一启动脚本：`START.ps1`**

#### **所有可用模式：**

```powershell
# 查看帮助
.\START.ps1 help

# 正常启动
.\START.ps1

# Vault修复启动（推荐用于修复13个池子问题）
.\START.ps1 fix

# 快速测试（30秒）
.\START.ps1 test

# 长时间测试（5分钟）
.\START.ps1 test-long

# 生产环境启动
.\START.ps1 production

# 使用Clash代理启动
.\START.ps1 proxy

# 监控模式
.\START.ps1 monitor

# 清理后重新编译
.\START.ps1 clean
```

---

## **简化启动（不带参数）**

如果您只是想快速启动，也可以用：

```bash
# Windows
.\run.bat

# Linux/WSL
./run.sh

# 或直接用cargo
cargo run --release --bin solana-pool-cache
```

---

## **当前推荐（修复13个池子问题）**

```powershell
.\START.ps1 fix
```

这会自动：
1. ✅ 停止旧进程
2. ✅ 清理编译缓存
3. ✅ 完全重新编译
4. ✅ 启动并监控60秒
5. ✅ 检查数据质量
6. ✅ 分析日志
7. ✅ 显示修复效果

---

## **其他保留的核心脚本**

| 脚本 | 用途 |
|------|------|
| `START.ps1` | 统一启动（所有功能） |
| `fix_and_test.ps1` | Vault修复（被START.ps1调用） |
| `run.bat` | 简单启动（Windows） |
| `run.sh` | 简单启动（Linux/WSL） |

---

## **清理说明**

已删除30+个冗余的启动脚本，只保留上述4个核心脚本。

如果您需要特定功能，都可以通过 `START.ps1` 的不同模式实现。

---

**就是这么简单！** 🎯




