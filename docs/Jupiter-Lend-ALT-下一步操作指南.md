# Jupiter Lend ALT 创建指南

## 📋 当前状态

根据分析，你现在需要：

1. ✅ **脚本已准备好**：`scripts/create-jupiter-lend-alt.ts`
2. ✅ **脚本会预先添加常用地址**（系统账户 + 30+ 个主流代币）
3. ⚠️ **需要配置密钥对**才能运行脚本

## 🚀 下一步操作

### 方案 1：直接运行脚本（推荐）

如果你已经有密钥对文件（`keypairs/flashloan-wallet.json`），设置环境变量后运行：

```bash
# 设置密钥对路径
set SOLANA_KEYPAIR_PATH=keypairs/flashloan-wallet.json

# 运行脚本
cd packages/core
pnpm tsx ../../scripts/create-jupiter-lend-alt.ts
```

### 方案 2：先启动机器人（自动创建）

**如果你现在不想手动创建 ALT**，也可以直接启动机器人：

1. **机器人会在首次使用时自动创建 ALT**
2. **自动扩展 ALT**（添加需要的地址）
3. **自动保存 ALT 地址**到 `.env` 文件

**优点**：
- 无需手动操作
- 系统会自动处理

**缺点**：
- 首次运行时需要等待 ALT 创建（可能较慢）
- 可能需要支付扩展费用（如果遇到新代币）

## 📊 两种方案对比

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **预先创建 ALT** | ✅ 一次性添加常用地址<br>✅ 减少运行时扩展<br>✅ 更好的性能 | ⚠️ 需要手动操作<br>⚠️ 需要配置密钥对 | ⭐⭐⭐⭐⭐ |
| **自动创建 ALT** | ✅ 无需手动操作<br>✅ 自动处理 | ⚠️ 首次运行较慢<br>⚠️ 可能需要扩展费用 | ⭐⭐⭐ |

## 💡 推荐方案

**建议：预先创建 ALT**

**原因**：
1. ✅ 一次性添加常用地址，减少后续扩展
2. ✅ 更好的性能（无需等待 ALT 创建）
3. ✅ 减少费用（一次性支付，避免多次小额扩展）

## 🔧 如果选择预先创建 ALT

### 步骤 1：配置密钥对

在 `.env` 文件中添加（或直接设置环境变量）：

```bash
SOLANA_KEYPAIR_PATH=keypairs/flashloan-wallet.json
```

或者使用绝对路径：

```bash
SOLANA_KEYPAIR_PATH=E:\6666666666666666666666666666\dex-cex\dex-sol\keypairs\flashloan-wallet.json
```

### 步骤 2：运行脚本

```bash
cd packages/core
pnpm tsx ../../scripts/create-jupiter-lend-alt.ts
```

### 步骤 3：验证结果

脚本会自动：
- ✅ 创建 ALT
- ✅ 添加常用地址（系统账户 + 30+ 个代币）
- ✅ 保存 ALT 地址到 `.env` 文件
- ✅ 显示 ALT 统计信息

### 步骤 4：启动机器人

```bash
pnpm start:flashloan --config=configs/flashloan-serverchan.toml
```

## ⚠️ 注意事项

1. **确保钱包有足够余额**：
   - ALT 创建 + 租金：约 0.004 SOL
   - 预填充地址扩展：约 0.0002-0.001 SOL
   - **总计**：约 **0.004-0.006 SOL**

2. **如果密钥对文件不存在**：
   - 需要先创建密钥对
   - 或者使用其他密钥对文件

3. **如果脚本运行失败**：
   - 检查 RPC 连接
   - 检查钱包余额
   - 检查网络连接

## 🎯 总结

**下一步操作**：

1. **如果你想预先创建 ALT**（推荐）：
   ```bash
   # 设置密钥对路径
   set SOLANA_KEYPAIR_PATH=keypairs/flashloan-wallet.json
   
   # 运行脚本
   cd packages/core
   pnpm tsx ../../scripts/create-jupiter-lend-alt.ts
   ```

2. **如果你想直接启动机器人**（自动创建）：
   ```bash
   pnpm start:flashloan --config=configs/flashloan-serverchan.toml
   ```

**根据你的分析，不需要扩展更多地址**，脚本已经包含了足够的常用地址。







































































































































