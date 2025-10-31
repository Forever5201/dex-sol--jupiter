# 📊 LST套利统计功能详解

## ✅ **回答您的问题：会统计吗？**

**答案：会！系统会自动统计每天的LST机会数量** ✅

---

## 🎯 **统计功能概述**

### 系统已有的统计功能

您的套利系统已经内置了**完整的数据库记录和统计功能**：

**1. 自动记录（实时）**
```
每当发现套利机会时：
- ✅ 自动记录到数据库
- ✅ 包括代币类型（mSOL, jitoSOL）
- ✅ 记录时间戳
- ✅ 记录利润、ROI
- ✅ 记录是否执行
```

**2. 数据库表结构**
```sql
-- opportunities 表（所有机会记录）
- id
- discoveredAt (发现时间)
- inputMint (输入代币)
- outputMint (输出代币)
- bridgeToken (桥接代币，如 mSOL, jitoSOL)
- bridgeMint (桥接代币地址)
- expectedProfit (预期利润)
- expectedRoi (预期ROI)
- executed (是否执行)
- filtered (是否过滤)
- metadata (包含路由详情)
```

**3. 已有的统计工具**
```
packages/core/src/database/statistics.ts
- 每日统计
- 代币统计
- 性能指标
- ROI分布
- DEX性能
```

---

## 🆕 **新增的LST专用统计工具**

### 工具1: LST机会分析器

**文件**: `tools/analyze-lst-opportunities.ts`

**功能**：
- 📊 总体LST机会统计
- 📊 按代币统计（mSOL vs jitoSOL）
- 📊 按时间统计（今天、本周、本月）
- 📊 按套利类型统计
- 📊 执行率统计
- 📊 利润分布

**使用方法**：
```bash
# Windows
analyze-lst-opportunities.bat

# 或直接运行
npx tsx tools/analyze-lst-opportunities.ts
```

**输出示例**：
```
════════════════════════════════════════════════════════════════
💎 LST套利机会统计分析
════════════════════════════════════════════════════════════════

1️⃣  总体统计
─────────────────────────────────────────────────────────
   总LST机会数: 245
   已执行数: 12 (4.9%)
   平均利润: 0.015000 SOL
   总利润潜力: 3.6750 SOL
   平均ROI: 1.25%
   最大利润: 0.085000 SOL
   最小利润: 0.001000 SOL

2️⃣  按LST代币统计
─────────────────────────────────────────────────────────

   🔸 mSOL
      机会数: 150
      已执行: 8 (5.3%)
      平均利润: 0.016000 SOL
      总利润: 2.4000 SOL
      平均ROI: 1.35%
      最大利润: 0.085000 SOL

   🔸 jitoSOL
      机会数: 95
      已执行: 4 (4.2%)
      平均利润: 0.013000 SOL
      总利润: 1.2350 SOL
      平均ROI: 1.10%
      最大利润: 0.045000 SOL

3️⃣  按时间统计
─────────────────────────────────────────────────────────
   今天: 18 个LST机会
   本周: 125 个LST机会 (平均 17.9/天)
   本月: 245 个LST机会 (平均 15.6/天)
   全部时间: 245 个LST机会 (15天, 平均 16.3/天)

4️⃣  按套利类型统计
─────────────────────────────────────────────────────────
   折价套利: 0 个
   多DEX价差: 180 个
   三角套利: 65 个
   其他: 0 个

5️⃣  执行率统计
─────────────────────────────────────────────────────────
   总机会: 245
   已执行: 12 (4.9%)
   已过滤: 200 (81.6%)
   未处理: 33

6️⃣  利润分布（SOL）
─────────────────────────────────────────────────────────
   <0.001 SOL: 5 (2.0%)
   0.001-0.01 SOL: 120 (49.0%)
   0.01-0.1 SOL: 115 (46.9%)
   0.1-1 SOL: 5 (2.0%)
   >1 SOL: 0 (0.0%)

✅ 统计完成！
```

---

## 📈 **如何查看LST统计**

### 方法1: 使用专用工具（推荐）

```bash
# 1. 启动bot（如果还没启动）
start-bot.bat

# 2. 运行LST统计（另一个终端）
analyze-lst-opportunities.bat
```

### 方法2: 使用通用数据库分析

```bash
# 分析整个数据库
npx tsx analyze-database.ts
```

### 方法3: 直接查询数据库（SQL）

```sql
-- 查询今天的LST机会
SELECT COUNT(*) as lst_opportunities_today
FROM "Opportunity"
WHERE "discoveredAt" >= CURRENT_DATE
AND (
    "bridgeToken" IN ('mSOL', 'jitoSOL')
    OR "inputMint" IN (
        'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
        'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn'
    )
    OR "outputMint" IN (
        'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
        'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn'
    )
);

-- 查询LST每日统计
SELECT 
    DATE("discoveredAt") as date,
    COUNT(*) as opportunities,
    SUM(CASE WHEN executed THEN 1 ELSE 0 END) as executed,
    AVG(CAST("expectedProfit" AS NUMERIC) / 1e9) as avg_profit_sol,
    AVG("expectedRoi") as avg_roi
FROM "Opportunity"
WHERE "bridgeToken" IN ('mSOL', 'jitoSOL')
GROUP BY DATE("discoveredAt")
ORDER BY date DESC
LIMIT 30;
```

---

## 🔄 **自动统计流程**

### 系统如何自动记录LST机会

```
1. bot启动 → 启用LST代币（mSOL, jitoSOL）

2. 路由查询器 → 查询所有涉及LST的路由
   - USDC → mSOL
   - USDC → jitoSOL
   - mSOL → USDC
   - jitoSOL → USDC
   - SOL → mSOL
   - SOL → jitoSOL
   等...

3. 套利检测器 → 发现价差机会

4. 数据库记录器 → 自动记录到数据库
   ✅ 记录时间
   ✅ 记录代币
   ✅ 记录利润
   ✅ 记录ROI

5. 统计服务 → 后台自动统计
   ✅ 每日统计
   ✅ 累计统计
```

---

## 📊 **关键指标**

### 您应该关注的LST统计数据

**1. 每日机会数量**
```
目标: >5个/天
良好: >10个/天
优秀: >20个/天
```

**2. 平均利润**
```
最低: >0.001 SOL ($0.20)
良好: >0.01 SOL ($2)
优秀: >0.05 SOL ($10)
```

**3. 执行率**
```
初期: 0-5% (观察模式)
优化后: 10-30% (自动执行)
理想: >50% (高效执行)
```

**4. 平均ROI**
```
最低: >0.5%
良好: >1%
优秀: >2%
```

---

## 📅 **建议的统计周期**

### 第一周（观察期）

**每天统计**：
```bash
# 早晚各运行一次
analyze-lst-opportunities.bat
```

**关注指标**：
- 每日机会数量
- 机会出现的时间分布
- 平均利润和ROI

### 第二周（优化期）

**每2-3天统计一次**

**关注指标**：
- 执行率变化
- 利润趋势
- 哪种LST机会更多（mSOL vs jitoSOL）

### 稳定后（运营期）

**每周统计一次**

**关注指标**：
- 周总机会数
- 周总利润
- 执行成功率

---

## 🎯 **成功标准**

### 第一天
- ✅ 发现 >5 个LST机会
- ✅ 统计工具正常运行
- ✅ 数据正确记录到数据库

### 第一周
- ✅ 平均每天 >10 个LST机会
- ✅ 至少执行 1 笔LST套利
- ✅ 累计利润 >0.1 SOL

### 第一月
- ✅ 累计 >300 个LST机会
- ✅ 执行率 >5%
- ✅ 累计利润 >1 SOL ($200)

---

## 🛠️ **故障排除**

### 问题1: 统计工具显示0个机会

**可能原因**：
1. bot还没启动或刚启动
2. LST还没被启用（检查bridge-tokens.json）
3. 还没有发现任何机会（正常，需要等待）

**解决方案**：
```bash
# 1. 确认bot正在运行
# 2. 确认LST已启用
# 3. 等待5-10分钟后再次统计
```

### 问题2: 数据库连接失败

**可能原因**：
PostgreSQL没有运行

**解决方案**：
```bash
# 启动PostgreSQL服务
# Windows: 服务 → PostgreSQL → 启动
```

### 问题3: 机会很少（<5/天）

**可能原因**：
1. 市场价格平衡（正常）
2. 阈值设置过高
3. 路由查询频率太低

**解决方案**：
观察1-2天，如果持续很少，考虑调整参数

---

## 📚 **相关文件**

### 统计工具
- `tools/analyze-lst-opportunities.ts` - LST专用统计
- `analyze-lst-opportunities.bat` - 快速启动脚本
- `analyze-database.ts` - 通用数据库分析
- `packages/core/src/database/statistics.ts` - 统计服务

### 数据库
- `packages/core/prisma/schema.prisma` - 数据库结构定义
- `packages/core/src/database/recorder.ts` - 数据记录器

### 配置
- `bridge-tokens.json` - LST代币配置

---

## ✅ **总结**

**您的问题：系统会不会统计每天的LST机会数量？**

**答案：会！** ✅

系统会：
1. ✅ **自动记录**所有LST套利机会到数据库
2. ✅ **实时存储**时间、代币、利润、ROI等数据
3. ✅ **提供工具**随时查询和统计
4. ✅ **支持多维度**统计（按天、按周、按月、按代币）

**使用方法**：
```bash
# 随时运行此命令查看LST统计
analyze-lst-opportunities.bat
```

**预期数据**（LST启用后）：
- 第1天: 5-20个机会
- 第1周: 50-150个机会
- 第1月: 200-500个机会

---

**现在就启动bot，开始收集LST套利数据吧！** 🚀


























