# Jupiter Quote API 修复完成指南

## 📋 问题分析

### 原始错误
```
Failed to build swap instructions from Quote API: 
Client network socket disconnected before secure TLS connection was established
```

### 根本原因
1. **错误的 API Endpoint**: 代码使用了 `https://quote-api.jup.ag/v6`
2. **API 版本混淆**: Quote API V6 已经被废弃，应该使用 Legacy Swap API
3. **连接配置问题**: 超时时间不足，缺少重试机制

---

## ✅ 已完成的修复

### 1. 更正 API Endpoint

**修改前**:
```typescript
baseURL: 'https://quote-api.jup.ag/v6'  // ❌ 错误
```

**修改后**:
```typescript
baseURL: 'https://lite-api.jup.ag/swap/v1'  // ✅ 正确 (Legacy Swap API)
```

### 2. 优化连接配置

| 配置项 | 修改前 | 修改后 |
|--------|--------|--------|
| `timeout` | 20000ms | 30000ms |
| `Connection` | keep-alive | 移除 |
| `Accept-Encoding` | br, gzip, deflate | 移除 |
| `User-Agent` | 无 | FlashloanBot/1.0 |

### 3. 添加智能重试机制

```typescript
const maxRetries = 3;
const retryDelay = 100; // ms

for (let attempt = 1; attempt <= maxRetries; attempt++) {
  try {
    // API 调用...
  } catch (error) {
    if (isTlsError && attempt < maxRetries) {
      const delay = retryDelay * attempt * 2; // 递增延迟
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }
  }
}
```

**重试策略**:
- TLS/网络错误: 自动重试，递增延迟 (100ms → 200ms → 400ms)
- DEX 约束失败: 移除 `dexes` 参数后重试
- 其他错误: 立即返回

### 4. 优化路由参数

| 参数 | 修改前 | 修改后 | 说明 |
|------|--------|--------|------|
| `onlyDirectRoutes` | true | false | 允许多跳，提高成功率 |
| `maxAccounts` | 20 | 32 | 平衡交易大小和路由质量 |
| `dexes` | 强制指定 | 失败后自动移除 | Ultra 路由引导 + 降级策略 |

---

## 🧪 测试方法

### 方法 1: 独立测试脚本

运行专门的测试脚本，验证 Jupiter API 的各个方面：

```bash
# Windows
test-jupiter-quote-api.bat

# Linux/Mac
pnpm exec ts-node test-jupiter-quote-api.ts
```

**测试内容**:
1. ✅ Legacy Quote API (`/quote`)
2. ✅ Legacy Swap Instructions (`/swap-instructions`)
3. ✅ Quote API V6 (对比测试)
4. ✅ Ultra API (价格对比)
5. ✅ 指令反序列化
6. ✅ Ultra 路由引导

### 方法 2: 集成测试

运行完整的闪电贷机器人：

```bash
# Dry-run 模式（不实际发送交易）
start-flashloan-dryrun.bat

# 或手动启动
pnpm --filter @solana-arb-bot/jupiter-bot start
```

**观察日志**:
```
✅ Jupiter Legacy Swap API client initialized (lite-api.jup.ag/swap/v1 - flash loan support)
```

如果看到这条日志，说明配置正确。

---

## 📊 对比：不同 API 的特点

### Legacy Swap API (lite-api.jup.ag/swap/v1)
- ✅ **闪电贷支持**: `/swap-instructions` 不检查余额
- ✅ **免费**: 无需 API Key
- ✅ **稳定**: 官方推荐用于程序化交易
- ⚠️ **路由引擎**: Metis v1 (不包括 Iris, Shadow Lane)

### Ultra API (lite-api.jup.ag/ultra/v1)
- ✅ **最优价格**: Iris + Shadow Lane + RFQ
- ✅ **简化流程**: `/order` + `/execute`
- ❌ **余额验证**: 需要钱包有足够余额
- ⚠️ **不可修改**: 交易不能添加闪电贷指令

### Quote API V6 (quote-api.jup.ag/v6) ⚠️ 已废弃
- ❌ **已废弃**: 不再维护
- ❌ **稳定性差**: 经常出现 TLS 连接问题

---

## 🎯 当前策略

### 两阶段方案

**阶段 1: 发现机会（Ultra API）**
```
Worker 线程使用 Ultra API 扫描市场
→ 获得最优价格和路由计划
```

**阶段 2: 构建交易（Legacy Swap API）**
```
Main 线程使用 Legacy Swap API 构建指令
→ 尝试复制 Ultra 的路由 (dexes 参数)
→ 失败则自动降级为自动路由
→ 与闪电贷指令组合
```

### 优势

1. **价格发现**: 利用 Ultra 的高级路由引擎
2. **灵活构建**: Legacy API 支持自定义指令组合
3. **高成功率**: 智能降级策略
4. **稳定性**: Legacy API 连接更稳定

---

## 🔍 诊断问题

### 如果仍然遇到 TLS 错误

**检查网络连接**:
```bash
# 测试连接
curl -v https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=100000000&slippageBps=50
```

**可能的原因**:
1. 防火墙/代理阻止连接
2. DNS 解析问题
3. SSL/TLS 证书问题
4. 网络不稳定

**解决方案**:
```toml
# my-bot-config.toml
[network]
proxy_url = "http://127.0.0.1:7890"  # 如果需要代理
```

### 日志关键词

**成功标志**:
```
✅ Successfully built swap instructions on attempt 1
Building swap via Legacy Swap API (attempt 1/3)
```

**需要关注的警告**:
```
⚠️ Retrying without dexes constraint...
⚠️ Legacy Swap API returned no route
```

**错误标志**:
```
❌ Failed to build swap instructions (attempt 3/3)
❌ [TLS/网络错误]
```

---

## 📝 修改的文件

1. **packages/jupiter-bot/src/flashloan-bot.ts**
   - `createJupiterQuoteClient()`: 更正 baseURL
   - `buildSwapInstructionsFromQuoteAPI()`: 添加重试机制

2. **test-jupiter-quote-api.ts** (新增)
   - 完整的测试脚本

3. **test-jupiter-quote-api.bat** (新增)
   - Windows 测试运行脚本

---

## 🚀 下一步

1. **运行独立测试**: `test-jupiter-quote-api.bat`
2. **检查测试结果**: 确认所有 6 项测试通过
3. **运行集成测试**: `start-flashloan-dryrun.bat`
4. **观察实际表现**: 监控机会构建成功率

---

## 📚 参考文档

- [Jupiter Legacy Swap API](https://dev.jup.ag/docs/swap/index)
- [Ultra Swap API](https://dev.jup.ag/docs/ultra/index)
- [Flash Loan Integration](https://dev.jup.ag/docs/lend/liquidation)

---

## ✨ 预期结果

修复完成后，应该看到：

```
{"level":20,"time":1761802824328,"module":"FlashloanBot","msg":"🚀 Building swap instructions via Quote API (flash loan compatible)..."}
{"level":20,"time":1761802824328,"module":"FlashloanBot","msg":"Building swap via Legacy Swap API (attempt 1/3): mSoLzYCx... → EPjFWdd5..., amount=825000000000"}
{"level":20,"time":1761802824650,"module":"FlashloanBot","msg":"✅ Successfully built swap instructions on attempt 1"}
{"level":20,"time":1761802824651,"module":"FlashloanBot","msg":"✅ Transaction build successful, proceeding to execution"}
```

而不是：

```
{"level":50,"time":1761802824412,"module":"FlashloanBot","msg":"Failed to build swap instructions from Quote API: Client network socket disconnected before secure TLS connection was established"}
```

---

**修复完成时间**: 2025-10-30
**修复工程师**: AI Coding Assistant
**测试状态**: ⏳ 待测试





