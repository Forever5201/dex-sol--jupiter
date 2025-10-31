# LST池子地址研究报告

## 🎯 目标
找到主要LST池子的准确地址用于直接订阅

## 📊 研究方法

### 方法1: Solscan查询（最可靠）
通过Solscan浏览器手动查找每个LST代币的Markets

### 方法2: 已知Phoenix CLOB市场
从config.toml中我们已经知道：
```toml
[[pools]]
address = "FZRgpfpvicJ3p23DfmZuvUgcQZBHJsWScTf2N2jK8dy6"
name = "mSOL/SOL (Phoenix)"
pool_type = "phoenix"
```
✅ 这个已经在订阅中

### 方法3: Raydium流动性池查找

## 📍 已知LST代币地址

```
mSOL:    mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So
jitoSOL: J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn
bSOL:    bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1
```

## 🔍 池子地址调查结果

### mSOL池子

#### mSOL/SOL (Phoenix CLOB)
- **地址**: `FZRgpfpvicJ3p23DfmZuvUgcQZBHJsWScTf2N2jK8dy6`
- **类型**: Phoenix CLOB
- **状态**: ✅ 已在config.toml中
- **流动性**: 高
- **备注**: 已订阅，工作正常

#### mSOL/USDC (Raydium V4) - 需要查找
-  **候选地址1**: `5ijRoAHVgd5T5CNtK5KDRUBZ7Bffb69nktMj5n6ks6m4` 
- **验证结果**: ❌ 82字节，是Token Account而非Pool
- **状态**: 需要继续查找

#### mSOL/SOL (Raydium V4) - 需要验证
- **候选地址**: `ZfvDXXUhZDzDVsapffUyXHj9ByCoPjP4thL6YXcZ9ixY`
- **历史**: 之前因904字节被注释掉
- **验证结果**: ❌ Invalid public key (地址可能有误)
- **状态**: 地址错误或不存在

### jitoSOL池子

#### jitoSOL/SOL (Raydium V4) - 需要查找
- **状态**: 未找到
- **流动性**: 预期高（jitoSOL是第二大LST）

#### jitoSOL/USDC (Raydium V4) - 需要查找  
- **候选地址**: `3XHKyq4A6ufxJpkqfnwVs5zUX2KXDvJSJQJDWCvv8PkF`
- **验证结果**: ❌ 账户不存在
- **状态**: 需要继续查找

### bSOL池子
- **状态**: 尚未调查

## 🎯 推荐策略

由于网络限制无法直接查询Jupiter API和Raydium API，推荐以下策略：

### 策略A: 使用Sanctum LST聚合器（最推荐）

Sanctum是所有LST的中心枢纽，提供：
- 所有主流LST之间的即时兑换
- mSOL ↔ SOL, jitoSOL ↔ SOL等
- 流动性深厚且稳定

**Program ID**: `SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy`

**优势**：
- ✅ 一个协议覆盖所有LST
- ✅ 流动性最深
- ✅ 价格发现最准确
- ✅ 不需要找多个独立池子

**实施方法**：
1. 实现Sanctum池子反序列化器
2. 查找Sanctum主要池子地址
3. 添加到config.toml订阅

### 策略B: 扩展Phoenix CLOB订阅（当前可用）

已有Phoenix mSOL/SOL市场，Phoenix还有其他LST市场：
- ✅ mSOL/SOL (已有)
- 🔍 jitoSOL/SOL (需查找地址)  
- 🔍 bSOL/SOL (需查找地址)

### 策略C: 手动查找Raydium V4池子

需要通过以下方式手动查找：
1. 访问 https://raydium.io/liquidity-pools/
2. 搜索mSOL和jitoSOL
3. 从URL或页面信息中提取池子地址
4. 通过Solscan验证地址和类型

## 📝 下一步行动

### 优先级1: 手动查找主要池子地址（30分钟）
使用浏览器访问Raydium和Solscan手动查找

### 优先级2: 验证找到的地址（15分钟）
使用Solscan验证：
- 账户存在
- 账户大小匹配（Raydium V4 = 752字节）
- Owner是Raydium程序
- 有近期交易活动

### 优先级3: 添加到配置并测试（30分钟）
- 更新config.toml
- 重启Rust Pool Cache
- 验证订阅成功
- 监控价格更新

### 优先级4: 考虑集成Sanctum（长期）
- 研究Sanctum协议
- 实现反序列化器
- 添加Sanctum池子

## 🌐 有用的链接

- Raydium流动性池: https://raydium.io/liquidity-pools/
- Solscan浏览器: https://solscan.io/
- mSOL Solscan: https://solscan.io/token/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So
- jitoSOL Solscan: https://solscan.io/token/J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn
- Phoenix市场: https://phoenix.trade/

## 💡 临时解决方案

如果无法快速找到所有池子地址，可以先添加已知的高质量池子：

```toml
# Phoenix CLOB - 已有，延迟极低
[[pools]]
address = "FZRgpfpvicJ3p23DfmZuvUgcQZBHJsWScTf2N2jK8dy6"
name = "mSOL/SOL (Phoenix)"
pool_type = "phoenix"

# 其他待添加...
```

即使只有1-2个LST池子，也能显著提升捕获率。



