# 配置文件说明

## 📝 快速开始

### 1. 复制示例配置文件

```bash
# 复制主配置文件
cp flashloan-serverchan.toml.example flashloan-serverchan.toml

# 或使用Windows PowerShell
Copy-Item flashloan-serverchan.toml.example flashloan-serverchan.toml
```

### 2. 配置必需的API密钥

打开 `flashloan-serverchan.toml`，替换以下占位符：

#### 🔑 Helius RPC API Key
```toml
helius_api_key = "YOUR_HELIUS_API_KEY_HERE"
```
- 注册地址：https://helius.dev
- 免费额度：25 RPS

#### 🔑 Jupiter Ultra API Key
```toml
[jupiter_api]
api_key = "YOUR_JUPITER_API_KEY_HERE"
```
- 从Jupiter官方获取
- 用于闪电贷套利查询

#### 🔑 Server酱通知 SendKey（可选）
```toml
[monitoring.serverchan]
send_key = "YOUR_SERVERCHAN_SENDKEY_HERE"
```
- 注册地址：https://sct.ftqq.com/
- 用于微信通知

### 3. 配置钱包

```bash
# 在 keypairs/ 目录放置你的钱包文件
# 示例：flashloan-wallet.json
```

⚠️ **重要提示**：
- 不要提交包含真实密钥的配置文件到Git
- `flashloan-serverchan.toml` 已在 `.gitignore` 中排除
- 只有 `.example` 文件会被提交

## 📂 配置文件说明

| 文件 | 用途 | 是否提交Git |
|------|------|-------------|
| `flashloan-serverchan.toml.example` | 示例配置（无真实密钥） | ✅ 是 |
| `flashloan-serverchan.toml` | 真实配置（包含密钥） | ❌ 否 |
| `flashloan-dryrun.toml` | 测试配置 | ❌ 否 |

## 🔒 安全最佳实践

1. ✅ **永远不要**提交包含真实API密钥的文件
2. ✅ **永远不要**提交钱包私钥文件
3. ✅ 使用环境变量或配置文件管理密钥
4. ✅ 定期更换API密钥

## 📖 详细配置说明

完整的配置参数说明，请参考：
- [主README](../README.md)
- [闪电贷配置文档](../docs/)
