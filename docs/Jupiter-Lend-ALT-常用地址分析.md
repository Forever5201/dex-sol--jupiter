# Jupiter Lend ALT 常用地址分析

## 📋 概述

本文档说明了如何预先创建包含常用地址的 Jupiter Lend ALT，以减少运行时的扩展交易和费用。

## 🔍 常用地址分类

### 1. 系统账户（必需）

这些是 Solana 系统级别的账户，几乎每笔交易都会用到：

- **Token Program**: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
- **Associated Token Program**: `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`
- **System Program**: `11111111111111111111111111111111`
- **Sysvar Clock**: `SysvarC1ock11111111111111111111111111111111`
- **Sysvar Rent**: `SysvarRent111111111111111111111111111111111`
- **Sysvar Recent Blockhashes**: `SysvarRecentB1ockHashes11111111111111111111`
- **Sysvar Instructions**: `Sysvar1nstructions1111111111111111111111111`

### 2. 常用代币 Mint 地址

这些是 Solana 生态系统中最常见的代币，按使用频率排序：

#### 稳定币（最高优先级）
- **USDC**: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- **USDT**: `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`

#### 主流代币
- **SOL**: `So11111111111111111111111111111111111111112`
- **ETH**: `7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs`
- **JUP**: `JUPyiwrY2skk1h7UXgy8JXctVyAVk3QW6XeZ6kRYfT4U`
- **RAY**: `4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R`
- **BONK**: `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263`

#### DEX 代币
- **ORCA**: `orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE`
- **STEP**: `StepAscQoEioFxxWGnh2sLBDFp9d8rvKz2Yp39iDpyT`

#### 其他常用代币
- **SAMO**: `7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU`
- **COPE**: `8HGyAAB1yoM1ttS7pXjHMa3dukTFGQggnFFH3hJZgzQh`
- **SRM**: `SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt`
- **FIDA**: `EchesyfXePKdLtoiZSL8pBe8Myagyy8ZRqsACNCFGnvp`
- **STEP**: `StepAscQoEioFxxWGnh2sLBDFp9d8rvKz2Yp39iDpyT`
- **MEDIA**: `ETAtLmCmsoiEEKfNrHKJ2kYy3MoABhU6NQvpSfij5tDs`
- **ROPE**: `8PMHT4swUMtBzgYnh5Zh564jKufHLaq4GMH49zKa5ida`
- **TULIP**: `TuLipcqtGVXP9XR62wM8WWCm6a9pxLs37N1jet5TLpZ`
- **SLRS**: `SLRSSpSLUTP7okbCUBYStWCo1vUgyt775faPqz8HUMr`
- **PORT**: `PoRTjZMPXb9T7dyU7tpLEZRQj7e7ssdAEcTt4V2FwD5`
- **MNDE**: `MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac`
- **LDO**: `HZRCwxP2Vq9PCpPXooayhJ2bxTzp5i8xht1p9cvvbD7p`
- **HNT**: `hntyVP6YFq1ige15qAsu1Z3qibwWSat4TKX2yoe2Xsf`
- **ATLAS**: `ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx`
- **GRAPE**: `8upjSpvjcdpuzhfR1zriwg5NXoDrKVukAHK5XR1Uqe6J`
- **C98**: `C98A4nkJXhpVZNAZdHUA95RpTF3T4whtQubL3YobiUX9`
- **WIF**: `EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm`

### 3. Jupiter Lend 协议地址（动态）

**注意**: Jupiter Lend 的协议地址（如程序 ID、池地址等）是动态的，会从 SDK 生成的指令中自动提取。这些地址无法预先知道，会在第一次使用时自动添加到 ALT。

## 📊 地址统计

- **系统账户**: 7 个
- **常用代币**: 约 30 个
- **总计**: 约 37 个地址

## 🚀 使用方法

### 1. 运行预创建脚本

```bash
pnpm tsx scripts/create-jupiter-lend-alt.ts
```

### 2. 脚本功能

脚本会：
1. ✅ 创建空的 ALT
2. ✅ 验证 ALT 创建成功
3. ✅ **自动添加所有常用地址**（系统账户 + 常用代币）
4. ✅ 保存 ALT 地址到 `.env` 文件
5. ✅ 显示 ALT 统计信息

### 3. 预期结果

运行成功后，ALT 将包含：
- 约 **37 个预填充地址**
- 系统会在遇到新地址时自动扩展（费用约 0.0001-0.0005 SOL）

## 💰 费用说明

### 创建 ALT
- **ALT 创建**: 约 0.001-0.002 SOL（一次性费用）
- **ALT 租金**: 约 0.003 SOL（一次性费用，用于存储 ALT 数据）

### 扩展 ALT
- **每批扩展（20个地址）**: 约 0.0001-0.0005 SOL
- **预填充 37 个地址**: 约 2 批 = 0.0002-0.001 SOL

### 总费用
- **总计**: 约 **0.004-0.006 SOL**（一次性费用）

## 🎯 优势

### 预先创建 ALT 的好处：

1. **减少运行时扩展交易**
   - 常用代币的地址已预先添加
   - 避免频繁的扩展交易和费用

2. **提高交易成功率**
   - ALT 已包含常用地址
   - 减少交易大小超限的风险

3. **节省 Gas 费用**
   - 一次性添加常用地址
   - 避免多次小额扩展费用

4. **更好的用户体验**
   - 首次运行时无需等待 ALT 扩展
   - 更快的交易构建速度

## ⚠️ 注意事项

1. **新代币仍需扩展**
   - 如果遇到预填充列表中没有的代币，系统会自动扩展 ALT
   - 这是正常的，无需担心

2. **地址数量限制**
   - ALT 最多可包含 256 个地址
   - 预填充的 37 个地址远低于限制

3. **费用透明**
   - 所有费用都是链上操作成本
   - 模拟交易不会产生费用

## 📝 自定义地址列表

如果需要添加更多地址，可以修改 `scripts/create-jupiter-lend-alt.ts` 中的 `collectCommonJupiterLendAddresses()` 函数：

```typescript
function collectCommonJupiterLendAddresses(): PublicKey[] {
  const addressSet = new Set<string>();
  
  // 添加你的自定义地址
  addressSet.add('YourCustomAddressHere...');
  
  // ...
}
```

## 🔍 验证 ALT

创建完成后，可以运行以下命令验证 ALT：

```bash
pnpm tsx scripts/check-alt.ts
```

或查看 `.env` 文件中的 `JUPITER_LEND_ALT_ADDRESS` 变量。

## 📚 相关文档

- [ALT 地址详解](./ALT地址详解.md)
- [预先创建 ALT 指南](./预先创建ALT指南.md)







































































































































