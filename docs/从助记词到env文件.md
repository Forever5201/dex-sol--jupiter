# 🚀 超简单：从助记词到 .env 文件

## ❌ 错误做法

**不要把助记词直接填入 .env 文件！**

```bash
# ❌ 错误！
SOLANA_MNEMONIC=word1 word2 word3 ... word12
```

---

## ✅ 正确做法：两步完成

### 步骤 1：从助记词生成 Base58 私钥

运行这个命令（把您的12个助记词替换进去）：

```powershell
pnpm tsx scripts/mnemonic-to-env.ts word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12
```

**示例：**
```powershell
pnpm tsx scripts/mnemonic-to-env.ts apple banana cherry dog elephant fish game house ink jump king lion
```

### 步骤 2：复制输出的 Base58 私钥到 .env 文件

脚本会显示类似这样的内容：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SOLANA_PRIVATE_KEY=5Kb8Kk8Lf9io...（很长的Base58字符串）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**直接复制这一整行**，粘贴到项目根目录的 `.env` 文件中：

```bash
# .env 文件内容
SOLANA_PRIVATE_KEY=5Kb8Kk8Lf9io...（您复制的Base58字符串）
```

### 步骤 3：验证配置

```powershell
pnpm tsx scripts/test-keypair.ts
```

---

## 📝 完整示例

假设您的助记词是：`apple banana cherry dog elephant fish game house ink jump king lion`

### 步骤 1：运行命令

```powershell
pnpm tsx scripts/mnemonic-to-env.ts apple banana cherry dog elephant fish game house ink jump king lion
```

### 步骤 2：复制输出

脚本会显示：

```
SOLANA_PRIVATE_KEY=5Kb8Kk8Lf9ioNdXL...（Base58字符串）
```

### 步骤 3：创建 .env 文件

在项目根目录创建 `.env` 文件：

```bash
# .env
SOLANA_PRIVATE_KEY=5Kb8Kk8Lf9ioNdXL...（您的Base58私钥）
```

### 步骤 4：验证

```powershell
pnpm tsx scripts/test-keypair.ts
```

---

## 🔐 为什么不能直接填助记词？

1. **格式不匹配**：系统需要 Base58 格式的私钥，不是助记词
2. **安全风险**：助记词太长，容易泄露
3. **转换过程**：需要先将助记词转换为密钥，再提取私钥

---

## 💡 如果已有密钥文件怎么办？

如果您已经有 `keypairs/flashloan-wallet.json` 文件：

```powershell
# 从密钥文件提取 Base58 私钥
pnpm tsx scripts/extract-base58-key.ts

# 复制输出的 Base58 私钥到 .env 文件
```

---

## ⚠️ 安全提醒

1. ✅ **正确**：把 Base58 私钥填入 .env
2. ❌ **错误**：把助记词填入 .env
3. ✅ **正确**：.env 文件加入 .gitignore
4. ❌ **错误**：把 .env 提交到 Git

---

## 🆘 还有问题？

### Q: 我不知道我的助记词，只有密钥文件？

```powershell
# 从密钥文件提取 Base58 私钥
pnpm tsx scripts/extract-base58-key.ts
```

### Q: 我没有助记词，想创建新钱包？

```powershell
# 方法1：创建新钱包文件
solana-keygen new -o keypairs/flashloan-wallet.json

# 然后提取 Base58 私钥
pnpm tsx scripts/extract-base58-key.ts
```

### Q: 我想同时使用文件和环境变量？

**可以！** 优先级顺序：
1. 环境变量 `SOLANA_PRIVATE_KEY`（最高优先级）
2. 环境变量 `SOLANA_KEYPAIR_PATH`
3. 配置文件路径

---

## ✨ 总结

**一句话：运行脚本，复制 Base58 私钥，粘贴到 .env 文件！**

```powershell
# 1. 运行脚本（替换您的助记词）
pnpm tsx scripts/mnemonic-to-env.ts word1 word2 ... word12

# 2. 复制输出的 Base58 私钥

# 3. 粘贴到 .env 文件
SOLANA_PRIVATE_KEY=您的Base58私钥

# 4. 验证
pnpm tsx scripts/test-keypair.ts
```

**就这么简单！** 🎉

