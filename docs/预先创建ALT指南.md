# 📋 预先创建 ALT 地址指南

## 🎯 为什么需要预先创建 ALT？

ALT（Address Lookup Table）创建需要：
- ✅ 发送链上交易（需要 SOL 余额）
- ✅ 等待交易确认（1-2 秒）
- ✅ 等待 warmup period（1 个 slot）

如果在运行时创建 ALT，可能会导致：
- ❌ 交易失败（余额不足）
- ❌ 等待时间过长（错过套利机会）
- ❌ 创建失败后无法继续运行

**解决方案：提前创建 ALT！**

---

## 🚀 快速开始

### 1. 创建 Jupiter Lend ALT

```powershell
pnpm tsx scripts/create-jupiter-lend-alt.ts
```

**说明：**
- 创建空 ALT（稍后会自动扩展）
- 费用：约 0.001-0.002 SOL
- 自动保存到 `.env` 文件

### 2. 创建 Solend ALT

```powershell
pnpm tsx scripts/create-solend-alt.ts
```

**说明：**
- 创建 ALT 并立即添加所有 Solend 地址
- 费用：约 0.002-0.003 SOL（包含扩展费用）
- 自动保存到 `.env` 文件

---

## 📝 脚本功能

### ✅ 自动检查
- ✅ 钱包余额检查（至少需要 0.002 SOL）
- ✅ 交易状态验证
- ✅ ALT 账户验证

### ✅ 自动保存
- ✅ 保存 ALT 地址到 `.env` 文件
- ✅ 格式：`JUPITER_LEND_ALT_ADDRESS=...` 或 `SOLEND_ALT_ADDRESS=...`

### ✅ 详细日志
- ✅ 显示交易签名
- ✅ 显示 ALT 地址
- ✅ 显示包含的地址数量

---

## 🔍 验证 ALT 是否创建成功

运行脚本后，检查 `.env` 文件：

```env
# Jupiter Lend ALT
JUPITER_LEND_ALT_ADDRESS=GWp5m2EgXg58ZJxtnUn1kKbRVzgqNEB98Tk4ZhC3p4tF

# Solend ALT
SOLEND_ALT_ADDRESS=...
```

---

## ⚠️ 注意事项

### 1. 余额要求
- **创建 ALT**：至少需要 **0.002 SOL**
- **扩展 ALT**：每次扩展需要 **0.0001-0.0005 SOL**

### 2. 网络要求
- 需要稳定的 RPC 连接
- 建议使用付费 RPC（如 Helius、QuickNode）

### 3. ALT 复用
- ✅ ALT 地址可以**永久使用**
- ✅ 可以在多个钱包之间共享 ALT（但需要相同的 authority）
- ✅ 如果 ALT 无效，系统会自动清除并重新创建

---

## 🐛 常见问题

### Q: 创建失败，提示余额不足？
**A:** 检查钱包余额，确保至少有 0.002 SOL：
```powershell
pnpm tsx scripts/test-keypair.ts
```

### Q: 创建成功，但启动机器人时提示 ALT 无效？
**A:** 可能是网络问题或 ALT 账户未完全初始化。重新运行创建脚本：
```powershell
pnpm tsx scripts/create-jupiter-lend-alt.ts
```

### Q: 能否手动设置 ALT 地址？
**A:** 可以！直接在 `.env` 文件中添加：
```env
JUPITER_LEND_ALT_ADDRESS=你的ALT地址
SOLEND_ALT_ADDRESS=你的ALT地址
```

---

## 📊 费用对比

| 操作 | 费用范围 | 说明 |
|------|---------|------|
| 创建 ALT | 0.001-0.002 SOL | 一次性费用 |
| 扩展 ALT | 0.0001-0.0005 SOL | 每次扩展（约 20 个地址） |
| 使用 ALT | 0 SOL | 免费使用（只读操作） |

---

## 🎉 完成后的操作

创建 ALT 后，直接启动机器人：

```powershell
pnpm start:flashloan --config=configs/flashloan-serverchan.toml
```

系统会自动：
1. ✅ 从 `.env` 读取 ALT 地址
2. ✅ 验证 ALT 有效性
3. ✅ 如果 ALT 无效，自动清除并重新创建
4. ✅ 在使用时自动扩展 ALT（添加新地址）

---

## 💡 提示

- 🔄 **定期检查 ALT**：ALT 地址可以永久使用，但如果钱包余额不足导致扩展失败，可能需要重新创建
- 📦 **批量创建**：可以同时创建两个 ALT，互不影响
- 🚀 **性能优化**：预先创建 ALT 可以显著提高交易构建速度

