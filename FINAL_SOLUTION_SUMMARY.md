# 🎯 Jupiter Quote API 修复 - 最终解决方案

## 📝 执行总结

**日期**: 2025-10-30  
**任务**: 修复 Jupiter Quote API 构建失败问题  
**状态**: ✅ **代码修复完成**，⏸️ 等待用户配置代理后测试

---

## 🔍 问题诊断

### 原始错误（来自用户日志）
```json
{
  "level": 50,
  "time": 1761802824412,
  "module": "FlashloanBot",
  "msg": "Failed to build swap instructions from Quote API: Client network socket disconnected before secure TLS connection was established"
}
```

### 根本原因（多重问题）

1. ❌ **错误的 API Endpoint**
   - 使用了: `https://quote-api.jup.ag/v6` (已废弃)
   - 应该用: `https://lite-api.jup.ag/swap/v1` (Legacy Swap API)

2. ❌ **网络连接问题**
   - 测试结果: 所有 Jupiter API 端点均 ETIMEDOUT
   - 原因: 中国大陆访问海外 API 需要代理
   - 解决方案: 配置 HTTP_PROXY 环境变量

3. ⚠️ **配置不够健壮**
   - 超时时间偏短 (20秒)
   - 缺少重试机制
   - 路由参数过于严格

---

## ✅ 已完成的修复

### 1. 更正 API Endpoint

**文件**: `packages/jupiter-bot/src/flashloan-bot.ts`

```typescript
// ❌ 修改前
baseURL: 'https://quote-api.jup.ag/v6'  // Quote API V6 (已废弃)

// ✅ 修改后
baseURL: 'https://lite-api.jup.ag/swap/v1'  // Legacy Swap API (官方推荐)
```

**原因**: 
- Quote API V6 已被 Jupiter 官方废弃
- Legacy Swap API 是官方推荐用于程序化交易和闪电贷的 API
- Legacy Swap API 的 `/swap-instructions` 端点**不检查余额**，完美支持闪电贷

---

### 2. 优化配置参数

| 参数 | 修改前 | 修改后 | 原因 |
|------|--------|--------|------|
| `timeout` | 20000ms | 30000ms | 提高连接稳定性 |
| `onlyDirectRoutes` | true | false | 允许多跳，提高成功率 |
| `maxAccounts` | 20 | 32 | 平衡交易大小和路由质量 |
| `User-Agent` | 无 | FlashloanBot/1.0 | 标识客户端 |

---

### 3. 实现智能重试机制

```typescript
const maxRetries = 3;
const retryDelay = 100; // ms

for (let attempt = 1; attempt <= maxRetries; attempt++) {
  try {
    // API 调用
  } catch (error) {
    // TLS/网络错误：递增延迟后重试
    if (isTlsError && attempt < maxRetries) {
      const delay = retryDelay * attempt * 2;
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }
    
    // DEX 约束失败：移除约束后重试
    if (attempt < maxRetries && dexes && dexes.length > 0) {
      params.ultraRoutePlan = undefined;
      continue;
    }
  }
}
```

**重试策略**:
- **第1次失败**: 等待 200ms 后重试
- **第2次失败**: 等待 400ms 后重试
- **第3次失败**: 返回 null

**特殊处理**:
- TLS/网络错误 → 自动重试（识别 `socket`, `TLS`, `ECONNRESET` 等）
- DEX 路由失败 → 移除 `dexes` 约束后重试

---

### 4. 创建测试工具

#### 4.1 独立测试脚本
**文件**: `test-jupiter-quote-api.ts`

测试内容：
1. ✅ Legacy Quote API (`/quote`)
2. ✅ Legacy Swap Instructions (`/swap-instructions`)
3. ✅ Quote API V6 (对比测试)
4. ✅ Ultra API (价格对比)
5. ✅ 指令反序列化
6. ✅ Ultra 路由引导

#### 4.2 Windows 测试脚本（带代理）
**文件**: `启动测试 - 使用代理.bat`

自动化测试流程：
1. 设置代理环境变量
2. 测试代理连接
3. 编译测试脚本
4. 运行完整测试

---

## 🚀 使用指南

### 方法 1: 使用测试脚本（推荐）

#### 步骤 1: 编辑代理配置

编辑 `启动测试 - 使用代理.bat` 文件：

```batch
REM 如果使用 Clash（端口 7890）
set HTTP_PROXY=http://127.0.0.1:7890
set HTTPS_PROXY=http://127.0.0.1:7890

REM 如果使用 V2Ray（端口 10808）
REM set HTTP_PROXY=http://127.0.0.1:10808
REM set HTTPS_PROXY=http://127.0.0.1:10808

REM 如果使用 Shadowsocks（端口 1080）
REM set HTTP_PROXY=http://127.0.0.1:1080
REM set HTTPS_PROXY=http://127.0.0.1:1080
```

#### 步骤 2: 运行测试

双击运行：
```
启动测试 - 使用代理.bat
```

#### 步骤 3: 查看结果

成功标志：
```
[INFO] ✅ 成功! 耗时: 650ms
[INFO] 出金: 236130000
[INFO] 路由: 2 跳
[INFO] 1️⃣  Legacy Quote: ✅
[INFO] 2️⃣  Legacy Swap Instructions: ✅
```

---

### 方法 2: 启动闪电贷机器人（完整测试）

#### 步骤 1: 编辑配置文件

**文件**: `my-bot-config.toml`

```toml
[network]
# 添加这一段（如果没有的话）
# 替换为你的实际代理地址
proxy_url = "http://127.0.0.1:7890"
```

#### 步骤 2: 设置环境变量（或者修改 bat 文件）

**方式 A**: 临时设置（命令行）
```batch
set HTTP_PROXY=http://127.0.0.1:7890
set HTTPS_PROXY=http://127.0.0.1:7890
start-flashloan-dryrun.bat
```

**方式 B**: 修改 bat 文件
编辑 `start-flashloan-dryrun.bat`，在文件开头添加：
```batch
set HTTP_PROXY=http://127.0.0.1:7890
set HTTPS_PROXY=http://127.0.0.1:7890
```

#### 步骤 3: 启动机器人

```batch
start-flashloan-dryrun.bat
```

#### 步骤 4: 观察日志

**成功标志**:
```json
{"level":20,"module":"FlashloanBot","msg":"✅ Jupiter Legacy Swap API client initialized (lite-api.jup.ag/swap/v1 - flash loan support)"}
{"level":20,"module":"FlashloanBot","msg":"Building swap via Legacy Swap API (attempt 1/3): mSoLzYCx... → EPjFWdd5..."}
{"level":20,"module":"FlashloanBot","msg":"✅ Successfully built swap instructions on attempt 1"}
{"level":20,"module":"FlashloanBot","msg":"✅ Transaction build successful, proceeding to execution"}
```

**失败标志**:
```json
{"level":50,"module":"FlashloanBot","msg":"Failed to build swap instructions (attempt 3/3): connect ETIMEDOUT"}
{"level":50,"module":"FlashloanBot","msg":"❌ [TLS/网络错误]"}
```

---

## 📊 技术细节

### Jupiter API 对比

| 特性 | Legacy Swap API | Ultra API | Quote API V6 |
|------|-----------------|-----------|--------------|
| Endpoint | lite-api.jup.ag/swap/v1 | lite-api.jup.ag/ultra/v1 | quote-api.jup.ag/v6 |
| 闪电贷支持 | ✅ 完全支持 | ❌ 需要余额 | ⚠️ 已废弃 |
| API Key | ❌ 免费 | ✅ 需要 | ❌ 免费 |
| 路由引擎 | Metis v1 | Juno (Iris+Shadow) | 旧版 |
| 稳定性 | ✅ 高 | ✅ 高 | ❌ 低 |
| 官方推荐 | ✅ 是 | ✅ 是 | ❌ 否 |
| 适用场景 | 程序化交易、闪电贷 | 终端用户、UI | 已废弃 |

### 当前实现策略

```
┌─────────────────────────────────────────────────────────┐
│                   套利流程                                │
└─────────────────────────────────────────────────────────┘
        │
        │ 1. 发现机会
        ▼
┌──────────────────┐
│  Worker 线程      │  使用 Ultra API
│  扫描市场         │  → 获取最优价格和路由
└──────────────────┘
        │
        │ 2. 验证机会
        ▼
┌──────────────────┐
│  Main 线程        │  使用 Legacy Swap API
│  构建交易         │  → 尝试复制 Ultra 路由 (dexes 参数)
│                  │  → 失败则自动降级为自动路由
│                  │  → 与闪电贷指令组合
└──────────────────┘
        │
        │ 3. 执行交易
        ▼
┌──────────────────┐
│  Jito Executor   │  发送 Bundle 到 Jito
└──────────────────┘
```

**优势**:
1. **价格优势**: 利用 Ultra API 的高级路由引擎（Iris + Shadow Lane）发现最优价格
2. **灵活性**: Legacy API 支持自定义指令组合（闪电贷 + swap）
3. **高成功率**: 智能降级策略确保即使 DEX 约束失败也能找到路由
4. **稳定性**: Legacy API 连接更稳定，支持重试

---

## 🔧 故障排查

### 问题 1: 代理连接失败

**症状**:
```
connect ETIMEDOUT
或
Client network socket disconnected before secure TLS connection was established
```

**解决方案**:
1. 确认代理软件正在运行
2. 检查代理地址和端口是否正确
3. 测试代理连接:
   ```batch
   curl -x http://127.0.0.1:7890 https://www.google.com
   ```

---

### 问题 2: 路由构建失败

**症状**:
```
Legacy Swap API returned no route
```

**原因**: 
- 指定的 DEX 组合无法找到路由
- 流动性不足
- 代币对不支持

**解决方案**:
- ✅ 已实现：自动移除 `dexes` 约束后重试
- 检查代币对是否有足够流动性

---

### 问题 3: 所有重试均失败

**症状**:
```
Failed to build swap instructions (attempt 3/3)
```

**原因**:
- 网络持续不稳定
- 代理失效
- Jupiter API 服务异常

**解决方案**:
1. 检查网络连接
2. 更换代理节点
3. 增加重试次数（修改代码中的 `maxRetries`）

---

## 📁 修改的文件清单

### 核心修复
1. **packages/jupiter-bot/src/flashloan-bot.ts**
   - `createJupiterQuoteClient()`: 更正 baseURL 和配置
   - `buildSwapInstructionsFromQuoteAPI()`: 完全重写，添加重试机制

### 测试工具
2. **test-jupiter-quote-api.ts** (新增)
   - 完整的 API 测试套件

3. **test-jupiter-quote-api.bat** (新增)
   - Windows 测试脚本（不含代理）

4. **启动测试 - 使用代理.bat** (新增)
   - Windows 测试脚本（含代理配置和连接测试）

### 文档
5. **JUPITER_QUOTE_API_FIX_GUIDE.md** (新增)
   - 详细的修复指南

6. **JUPITER_QUOTE_API_测试总结.md** (新增)
   - 测试结果分析

7. **FINAL_SOLUTION_SUMMARY.md** (本文件)
   - 最终解决方案总结

---

## ✅ 验收标准

修复成功的标志：

### 1. 测试脚本通过
```
✅ 1️⃣  Legacy Quote: ✅
✅ 2️⃣  Legacy Swap Instructions: ✅
✅ 5️⃣  Instruction Deserialization: ✅
```

### 2. 机器人日志正常
```
✅ Jupiter Legacy Swap API client initialized
✅ Successfully built swap instructions on attempt 1
✅ Transaction build successful
```

### 3. 实际执行套利
```
✅ 可执行机会 - 净利润: 4.167374 SOL
✅ Building swap instructions via Legacy Swap API
✅ Transaction sent
```

---

## 🎉 预期效果

配置代理后，之前失败的日志：

```json
❌ {"level":50,"msg":"Failed to build swap instructions from Quote API: Client network socket disconnected before secure TLS connection was established"}
❌ {"level":50,"msg":"❌ Failed to build swap instructions from Quote API"}
❌ {"level":50,"msg":"❌ Transaction build failed, skipping execution"}
```

将变为：

```json
✅ {"level":20,"msg":"Building swap via Legacy Swap API (attempt 1/3): mSoLzYCx... → EPjFWdd5..., amount=825000000000, dexes=Raydium CLMM,HumidiFi"}
✅ {"level":20,"msg":"✅ Successfully built swap instructions on attempt 1"}
✅ {"level":20,"msg":"✅ Transaction build successful, proceeding to execution"}
```

---

## 📞 后续支持

### 需要用户提供的信息

1. **代理配置**
   - 代理类型: [ ] Clash / [ ] V2Ray / [ ] Shadowsocks / [ ] 其他
   - 代理地址: _______
   - 代理端口: _______

2. **测试结果**
   - [ ] 运行了 `启动测试 - 使用代理.bat`
   - [ ] 测试结果: [ ] 通过 / [ ] 失败
   - [ ] 错误信息（如有）: _______

3. **机器人运行状态**
   - [ ] 能够发现机会
   - [ ] 能够构建交易
   - [ ] 能够执行交易

---

## 📚 参考资料

- [Jupiter Legacy Swap API 官方文档](https://dev.jup.ag/docs/swap/index)
- [Jupiter Ultra Swap API 官方文档](https://dev.jup.ag/docs/ultra/index)
- [Flash Loan 集成文档](https://dev.jup.ag/docs/lend/liquidation)
- [llms.txt - Jupiter API 参考](./llms.txt)

---

**修复完成日期**: 2025-10-30  
**状态**: ✅ 代码修复完成，⏸️ 等待用户配置代理后测试验证  
**预计测试时间**: 5-10 分钟





