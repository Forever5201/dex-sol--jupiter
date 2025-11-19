# Solana DEX 套利机器人 - 项目上下文

## 项目概述

这是一个专业的 Solana DEX 套利经济模型系统，实现了生产级套利机器人所需的所有核心功能。该项目旨在通过精确的成本计算、动态费用优化、利润分析和风险管理来实现 Solana DEX 上的套利机会。

## 核心特性

1. **精确成本计算**: 涵盖基础费、优先费、Jito 小费和闪电贷等所有成本
2. **动态小费优化**: 实时 Jito 市场数据 + 历史学习 + 竞争评估
3. **利润分析引擎**: 毛利/净利/ROI 计算 + 滑点估算 + 批量评估
4. **风险管理系统**: 5层风险检查 + 机会验证 + 风险等级评估
5. **熔断保护机制**: 连续失败检测 + 亏损监控 + 自动恢复
6. **配置驱动策略**: 小/中/大资金预设 + TOML 配置 + 灵活定制
7. **实用工具集**: 成本模拟器 + Jito 监控器 + 完整演示

## 项目架构

项目采用 monorepo 结构，使用 pnpm 工作区管理：

```
solana-arb-bot/
├── packages/
│   ├── core/              # 经济模型核心 (主要逻辑)
│   ├── jupiter-bot/       # Jupiter API 驱动的套利机器人
│   ├── onchain-bot/       # 链上监控和执行机器人
│   ├── jupiter-server/    # 自托管 Jupiter API 服务器
│   └── launcher/          # 机器人启动器和管理工具
├── configs/              # TOML 配置文件
├── tools/                # 成本模拟器、Jito 监控器等工具
├── docs/                 # 完整的中文文档
├── examples/             # 使用示例
├── tests/                # 测试文件
└── scripts/              # 实用脚本
```

### Core 组件结构

Core 包含所有经济模型模块：

- `cost-calculator.ts`: 计算所有交易成本 (基础费、优先费、Jito 小费、闪电贷费用)
- `jito-tip-optimizer.ts`: 动态费用优化基于市场数据和历史成功率
- `profit-analyzer.ts`: 精确利润计算和机会评估
- `risk-manager.ts`: 多级风险检查和保护
- `circuit-breaker.ts`: 防止连续亏损的熔断机制

## 技术栈

- **语言**: TypeScript 5.3+
- **平台**: Node.js 20+
- **区块链**: Solana (通过 @solana/web3.js)
- **包管理**: pnpm
- **配置格式**: TOML
- **日志系统**: pino

## 配置策略

系统支持三种预设策略：

| 资金量级 | 闪电贷 | Jito策略 | 最小利润 | 目标成功率 |
|---------|--------|---------|---------|-----------|
| 小 (<10 SOL) | ✅ 必须 | 50th | 0.0001 SOL | 50% |
| 中 (10-100 SOL) | ⚡ 自动 | 75th | 0.00005 SOL | 70% |
| 大 (>100 SOL) | ❌ 不用 | 95th | 0.00003 SOL | 90% |

## 构建与运行

### 环境要求
- Node.js >= 20.0.0
- pnpm (用于工作区管理)

### 安装与构建
```bash
# 安装依赖
pnpm install

# 构建所有包
pnpm run build

# 设置配置
cp configs/global.example.toml configs/global.toml
# 编辑 configs/global.toml 填入 RPC URLs、密钥路径等
```

### 运行命令
```bash
# 开发模式
pnpm run dev

# 构建并运行
pnpm run build
pnpm run start:onchain-bot

# 运行闪电贷机器人
pnpm run start:flashloan

# 经济模型演示
pnpm run demo

# 成本模拟器
pnpm run cost-sim -- -s 2 -cu 200000 -cup 5000

# Jito 费用监控器
pnpm run jito-monitor
```

## 主要功能模块

### 经济模型
- **成本计算**: 精确计算所有交易成本，包括基础费、优先费、Jito 小费和闪电贷费用
- **利润分析**: 计算毛利、净利、ROI，估算滑点，进行批量评估
- **风险控制**: 5层风险检查，包括利润门槛、成本限制、滑点保护、流动性验证、ROI 要求
- **熔断保护**: 监控连续失败、小时亏损、成功率，自动暂停交易

### 交易执行
- **Jupiter 集成**: 使用 Jupiter API 进行交易路由
- **Jito 优化**: 通过 Jito bundles 提高交易包含率
- **闪电贷支持**: 集成 Jupiter 闪电贷进行无本金套利

### 监控与管理
- **成本模拟器**: 模拟不同配置下的交易成本
- **Jito 监控器**: 实时监控 Jito 市场小费
- **日志系统**: 使用 pino 记录详细的交易和系统日志

## 安全考量

- 使用专用热钱包（绝非主钱包）
- 包含熔断器防止大额亏损
- 实施 5 层风险检查
- 支持干运行模式测试
- 连续失败和亏损监控

## 开发规范

- 所有代码使用 TypeScript 编写
- 使用 pnpm 工作区管理 monorepo
- 经济模型模块位于 `packages/core/src/economics/`
- 配置通过 TOML 文件处理
- 日志使用 pino 记录
- 测试使用 Jest

## 文档资源

项目包含完整的中文文档，覆盖：
- 快速入门指南
- 配置说明
- 性能优化
- 技术分析
- 部署运维
- 测试指南

## 沟通语言

所有项目沟通必须使用中文进行，包括但不限于：
- 代码注释
- 提交信息
- 问题描述
- 文档编写
- 团队交流

## 许可证

MIT 许可证，保留所有权利。

---

**注意**: 套利交易存在风险，可能导致资金损失。使用前请确保理解机制并进行充分测试。