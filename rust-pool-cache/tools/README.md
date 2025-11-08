# 🛠️ Meteora DLMM 分析工具

## 📁 工具列表

| 工具 | 功能 | 状态 |
|------|------|------|
| `analyze-meteora-account.ts` | 分析链上Meteora池子数据 | ✅ 就绪 |
| `fetch-meteora-idl.ts` | 获取官方IDL | ✅ 就绪 |
| `run-meteora-analysis.ps1` | PowerShell启动脚本（带代理） | ✅ 推荐 |

---

## 🚀 快速开始

### 方法1: 使用PowerShell脚本（推荐）

```powershell
# 在 tools/ 目录下
.\run-meteora-analysis.ps1
```

**优点：**
- ✅ 自动设置代理
- ✅ 自动检查结果
- ✅ 友好的错误提示

---

### 方法2: 使用.env文件

```bash
# 1. 复制环境变量模板
cp .env.example .env

# 2. 编辑 .env 文件，设置你的代理
# HTTPS_PROXY=http://127.0.0.1:7890
# HTTP_PROXY=http://127.0.0.1:7890

# 3. 安装dotenv（如果需要）
npm install dotenv

# 4. 运行工具（需要在代码中加载dotenv）
npx ts-node analyze-meteora-account.ts
```

---

### 方法3: 命令行临时设置

#### PowerShell

```powershell
$env:HTTPS_PROXY="http://127.0.0.1:7890"; $env:HTTP_PROXY="http://127.0.0.1:7890"; npx ts-node analyze-meteora-account.ts
```

#### Bash / Git Bash

```bash
HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890 npx ts-node analyze-meteora-account.ts
```

---

## 📊 analyze-meteora-account.ts

### 功能

- 获取真实Meteora DLMM池子的链上数据
- 解析并分析字段结构
- 生成详细的分析报告
- 保存原始二进制数据供后续分析

### 输出

```
analysis-results/
├── JUP-USDC-account-data.bin     # 原始账户数据（904字节）
└── JUP-USDC-analysis.json        # 字段分析报告
```

### 分析报告示例

```json
{
  "pool": "JUP/USDC",
  "address": "BhQEFZCgCKi96rLaVMeTr5jCVWZpe72nSP6hqTXA8Cem",
  "discriminator": "a1b2c3d4e5f6g7h8",
  "totalSize": 904,
  "dataSize": 896,
  "fields": [
    {
      "offset": 0,
      "name": "discriminator",
      "type": "[u8; 8]",
      "value": [161, 178, 195, 212, 229, 246, 7, 8],
      "bytes": "a1b2c3d4e5f6g7h8"
    },
    {
      "offset": 8,
      "name": "parameters.base_factor",
      "type": "u16",
      "value": 5000,
      "bytes": "8813"
    },
    ...
  ]
}
```

---

## 🔧 配置

### 代理设置

**检查代理是否运行：**

```powershell
# 测试连接
curl http://127.0.0.1:7890
```

**常见代理端口：**
- Clash: 7890
- V2Ray: 10808
- Shadowsocks: 1080

### RPC端点

默认使用Solana官方RPC：`https://api.mainnet-beta.solana.com`

**替代选项：**

```bash
# Alchemy
RPC_URL=https://solana-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# Ankr
RPC_URL=https://rpc.ankr.com/solana

# QuickNode
RPC_URL=https://your-node.solana-mainnet.quiknode.pro/YOUR_KEY/
```

---

## 🐛 故障排查

### 问题1: "直连模式（无代理）"

**原因：** 环境变量未设置

**解决：**

```powershell
# 检查环境变量
echo $env:HTTPS_PROXY
# 应该输出: http://127.0.0.1:7890

# 如果为空，设置它
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:HTTP_PROXY = "http://127.0.0.1:7890"

# 或者使用PowerShell脚本
.\run-meteora-analysis.ps1
```

---

### 问题2: "TypeError: fetch failed"

**可能原因：**

1. **代理未运行**
   ```powershell
   # 检查代理
   curl http://127.0.0.1:7890
   ```

2. **网络不可达**
   ```powershell
   # 测试RPC端点
   curl https://api.mainnet-beta.solana.com
   ```

3. **防火墙阻止**
   - 检查Windows防火墙设置
   - 临时禁用杀毒软件

---

### 问题3: "账户不存在"

**原因：** 池子地址可能已变更

**解决：**

编辑`analyze-meteora-account.ts`，更新池子地址：

```typescript
const METEORA_POOLS = [
  {
    name: 'JUP/USDC',
    address: 'YOUR_POOL_ADDRESS_HERE',
  },
];
```

从这些地方获取最新地址：
- https://meteora.ag/pools
- https://solscan.io/

---

## 📚 使用示例

### 分析单个池子

```typescript
// analyze-meteora-account.ts

const METEORA_POOLS = [
  {
    name: 'SOL/USDC',
    address: 'YourPoolAddressHere',
  },
];
```

### 批量分析多个池子

```typescript
const METEORA_POOLS = [
  { name: 'JUP/USDC', address: 'BhQEFZCgCKi96rLaVMeTr5jCVWZpe72nSP6hqTXA8Cem' },
  { name: 'SOL/USDC', address: 'AnotherPoolAddress' },
  { name: 'BONK/SOL', address: 'YetAnotherPoolAddress' },
];
```

---

## 🎯 验证Rust结构

分析完成后，对比字段偏移量：

```bash
# 1. 查看分析报告
cat analysis-results/JUP-USDC-analysis.json

# 2. 对比Rust结构
cd ../src/deserializers
cat meteora_dlmm_improved.rs

# 3. 运行大小验证测试
cargo test meteora_dlmm_improved::tests::test_structure_size
```

---

## 💡 提示

1. **首次运行前** 确保代理正常工作
2. **数据珍贵** - 保存好`analysis-results/`目录
3. **网络问题** - 考虑使用私有RPC节点（更快更稳定）
4. **离线分析** - 如果已有`.bin`文件，可以离线分析

---

## 📞 支持

遇到问题？检查：

1. ✅ 代理是否运行？ `curl http://127.0.0.1:7890`
2. ✅ 环境变量是否设置？ `echo $env:HTTPS_PROXY`
3. ✅ RPC端点是否可达？ `curl https://api.mainnet-beta.solana.com`
4. ✅ 池子地址是否正确？ 访问 https://solscan.io/

---

## 🔗 相关文档

- [Meteora DLMM完整指南](../METEORA_DLMM_COMPLETE_GUIDE.md)
- [NetworkAdapter使用指南](../../../docs/development/NETWORK_ADAPTER_GUIDE.md)
- [Meteora官方文档](https://docs.meteora.ag/)


























































































