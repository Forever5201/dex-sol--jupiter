# 📋 日志系统快速参考卡

## 🚀 快速启动

```bash
# 标准启动（INFO级别）
cargo run --release

# 调试模式（显示所有细节）
RUST_LOG=debug cargo run --release

# 安静模式（只显示错误）
RUST_LOG=error cargo run --release
```

---

## 📊 监控命令

```bash
# 查看错误统计
curl http://localhost:3001/errors | jq

# 实时监控（每5秒刷新）
watch -n 5 'curl -s http://localhost:3001/errors | jq'

# 查看最新日志
tail -f logs/rust-pool-cache.log.$(date +%Y-%m-%d)
```

---

## 🔍 日志分析

```bash
# 所有错误
cat logs/*.log | jq 'select(.level == "ERROR")'

# 错误统计
cat logs/*.log | jq -r 'select(.level == "ERROR") | .fields.pool_type' | sort | uniq -c

# 延迟分析
cat logs/*.log | jq -r 'select(.fields.latency_us) | .fields.latency_us' | awk '{sum+=$1; n++} END {print sum/n}'

# 价格更新统计
cat logs/*.log | grep "Pool price updated" | wc -l
```

---

## ⚙️ 配置文件

```toml
[logging]
level = "info"                          # trace|debug|info|warn|error
file_enabled = true                      # 启用文件输出
price_change_threshold_percent = 1.0     # 价格变化阈值
```

---

## 📂 日志文件位置

```
logs/
├── rust-pool-cache.log.2025-10-28  # 今天的日志
├── rust-pool-cache.log.2025-10-27  # 昨天的日志
└── ...                              # 历史日志
```

**自动轮转**：每天午夜自动创建新文件

---

## 🎯 常见场景

### 场景1: 生产环境运行

```bash
# 安静启动，只记录重要信息
RUST_LOG=info cargo run --release > /dev/null 2>&1 &

# 后台运行，查看错误
curl http://localhost:3001/errors
```

### 场景2: 调试特定问题

```bash
# 开启详细日志
RUST_LOG=debug cargo run --release

# 只看特定池子
cargo run --release 2>&1 | grep "SOL/USDC"
```

### 场景3: 性能分析

```bash
# 记录所有更新
RUST_LOG=trace cargo run --release

# 分析延迟
cat logs/*.log | jq -r '.fields.latency_us' | sort -n | tail -100
```

---

## 🚨 告警阈值

系统在错误达到以下次数时自动发出WARN日志：
- 10次
- 50次
- 100次
- 500次
- 1000次

---

## 💡 提示

- 日志文件是JSON格式，可以用任何JSON工具分析
- 终端输出是人类可读格式，带颜色
- 价格微小变化（<1%）自动过滤，只在DEBUG级别显示
- 所有错误自动去重和统计

---

**文档版本**: 1.0  
**创建日期**: 2025-10-28






