#!/bin/bash
# LST池子状态验证脚本

echo "========================================"
echo "🔍 LST池子状态验证"
echo "========================================"
echo

# 检查config.toml中的LST相关池子
echo "📋 当前配置的LST相关池子:"
echo "----------------------------------------"
grep -A 2 "mSOL\|jitoSOL\|bSOL\|stSOL" ../config.toml | head -20
echo
echo "========================================"
echo

# 检查最近的日志中是否有LST价格更新
echo "📊 检查最近的LST价格更新:"
echo "----------------------------------------"
if [ -d "../logs" ]; then
  echo "查找mSOL相关日志..."
  find ../logs -name "*.log" -type f -mtime -1 -exec grep -i "msol" {} \; | tail -10 || echo "未找到mSOL相关日志"
  echo
  echo "查找jitoSOL相关日志..."
  find ../logs -name "*.log" -type f -mtime -1 -exec grep -i "jitosol" {} \; | tail -10 || echo "未找到jitoSOL相关日志"
else
  echo "⚠️  logs目录不存在，可能Rust Pool Cache还未运行"
fi
echo
echo "========================================"
echo

# 提供验证建议
echo "💡 验证建议:"
echo "----------------------------------------"
echo "1. 如果看到Phoenix mSOL/SOL的价格更新 → LST监控已在工作✅"
echo "2. 如果没有看到任何LST日志 → 需要启动Rust Pool Cache"
echo "3. 如果想添加更多LST池子 → 参考 LST_POOLS_IMPLEMENTATION_GUIDE.md"
echo
echo "快速启动Rust Pool Cache:"
echo "  cd ../  "
echo "  cargo run --release"
echo
echo "========================================"



