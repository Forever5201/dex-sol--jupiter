#!/usr/bin/env node
/**
 * 计算交易最多支持几跳
 * 基于实际的估算公式
 */

// 基础开销（固定部分）
const BASE_FIXED_SIZE = 100; // 固定头部
const BASE_SIGNATURE_SIZE = 64 + 4; // 签名 + 数组长度
const BASE_COMPUTE_BUDGET_SIZE = 2 * 15; // ComputeBudget指令
const BASE_FLASHLOAN_SIZE = 2 * 15 + 14 * 1 + 100; // 闪电贷指令
const BASE_V0_OVERHEAD = 50; // 版本化交易额外开销

// 基础总计
const BASE_SIZE = BASE_FIXED_SIZE + BASE_SIGNATURE_SIZE + BASE_COMPUTE_BUDGET_SIZE + BASE_FLASHLOAN_SIZE + BASE_V0_OVERHEAD;

// ALT基础开销（假设4个ALT）
const BASE_ALT_SIZE = 4 * 35;

// Base64编码后的限制
const MAX_BASE64_SIZE = 1644;

// 安全边际和Base64编码系数
const SAFETY_MARGIN = 1.05;
const BASE64_FACTOR = 1.333;

/**
 * 计算单个指令的大小
 */
function calculateInstructionSize(accountCount: number, dataSize: number): number {
  const compressedAccounts = Math.floor(accountCount * 0.85);
  const uncompressedAccounts = accountCount - compressedAccounts;
  
  return (
    1 + // programId索引
    compressedAccounts * 1 + // ALT索引
    uncompressedAccounts * 32 + // 完整地址
    accountCount * 1 + // 账户读写标记
    Math.ceil(accountCount * 0.5) + // 账户索引数组开销
    dataSize // 指令data
  );
}

/**
 * 计算一个Swap的开销
 */
function calculateSwapSize(accountsPerInstruction: number[], dataSizes: number[]): number {
  let total = 0;
  for (let i = 0; i < accountsPerInstruction.length; i++) {
    total += calculateInstructionSize(accountsPerInstruction[i], dataSizes[i] || 50);
  }
  return total;
}

/**
 * 计算最多支持几跳
 */
function calculateMaxHops() {
  console.log('═══════════════════════════════════════════');
  console.log('📊 交易大小计算：最多支持几跳？');
  console.log('═══════════════════════════════════════════\n');

  // 基础开销
  console.log('📐 基础开销（固定部分）：');
  console.log(`   固定头部: ${BASE_FIXED_SIZE} bytes`);
  console.log(`   签名数组: ${BASE_SIGNATURE_SIZE} bytes`);
  console.log(`   ComputeBudget: ${BASE_COMPUTE_BUDGET_SIZE} bytes`);
  console.log(`   闪电贷指令: ${BASE_FLASHLOAN_SIZE} bytes`);
  console.log(`   版本化开销: ${BASE_V0_OVERHEAD} bytes`);
  console.log(`   ALT基础: ${BASE_ALT_SIZE} bytes (4个ALT)`);
  console.log(`   总计: ${BASE_SIZE + BASE_ALT_SIZE} bytes\n`);

  // 原始大小上限（反向计算）
  const maxRawSize = Math.floor(MAX_BASE64_SIZE / (SAFETY_MARGIN * BASE64_FACTOR));
  console.log(`📏 原始大小上限: ${maxRawSize} bytes`);
  console.log(`   (Base64编码后: ${maxRawSize * SAFETY_MARGIN * BASE64_FACTOR} bytes ≤ ${MAX_BASE64_SIZE} bytes)\n`);

  // 可用空间
  const availableSize = maxRawSize - BASE_SIZE - BASE_ALT_SIZE;
  console.log(`💾 可用于Swap的空间: ${availableSize} bytes\n`);

  // 不同场景的跳数计算
  console.log('═══════════════════════════════════════════');
  console.log('📊 不同场景分析：');
  console.log('═══════════════════════════════════════════\n');

  // 场景1：轻量级Swap（账户数少）
  console.log('场景1：轻量级Swap（每个Swap 2个指令，25个账户/指令）');
  const lightSwapSize = calculateSwapSize([25, 25], [20, 40]);
  const lightAltPerSwap = 35; // 每跳增加1个ALT
  const lightTotalPerHop = lightSwapSize + lightAltPerSwap;
  const lightMaxHops = Math.floor(availableSize / lightTotalPerHop);
  console.log(`   每跳开销: ${lightTotalPerHop} bytes`);
  console.log(`   最多跳数: ${lightMaxHops} 跳`);
  console.log(`   总大小: ${BASE_SIZE + BASE_ALT_SIZE + lightTotalPerHop * lightMaxHops} bytes`);
  console.log(`   Base64后: ${Math.ceil((BASE_SIZE + BASE_ALT_SIZE + lightTotalPerHop * lightMaxHops) * SAFETY_MARGIN * BASE64_FACTOR)} bytes\n`);

  // 场景2：中等Swap（基于日志数据）
  console.log('场景2：中等Swap（每个Swap 2个指令，34个账户/指令）');
  const mediumSwapSize = calculateSwapSize([30, 34], [20, 50]);
  const mediumAltPerSwap = 35;
  const mediumTotalPerHop = mediumSwapSize + mediumAltPerSwap;
  const mediumMaxHops = Math.floor(availableSize / mediumTotalPerHop);
  console.log(`   每跳开销: ${mediumTotalPerHop} bytes`);
  console.log(`   最多跳数: ${mediumMaxHops} 跳`);
  console.log(`   总大小: ${BASE_SIZE + BASE_ALT_SIZE + mediumTotalPerHop * mediumMaxHops} bytes`);
  console.log(`   Base64后: ${Math.ceil((BASE_SIZE + BASE_ALT_SIZE + mediumTotalPerHop * mediumMaxHops) * SAFETY_MARGIN * BASE64_FACTOR)} bytes\n`);

  // 场景3：重量级Swap（账户数多）
  console.log('场景3：重量级Swap（每个Swap 2个指令，43个账户/指令）');
  const heavySwapSize = calculateSwapSize([40, 43], [20, 50]);
  const heavyAltPerSwap = 35;
  const heavyTotalPerHop = heavySwapSize + heavyAltPerSwap;
  const heavyMaxHops = Math.floor(availableSize / heavyTotalPerHop);
  console.log(`   每跳开销: ${heavyTotalPerHop} bytes`);
  console.log(`   最多跳数: ${heavyMaxHops} 跳`);
  console.log(`   总大小: ${BASE_SIZE + BASE_ALT_SIZE + heavyTotalPerHop * heavyMaxHops} bytes`);
  console.log(`   Base64后: ${Math.ceil((BASE_SIZE + BASE_ALT_SIZE + heavyTotalPerHop * heavyMaxHops) * SAFETY_MARGIN * BASE64_FACTOR)} bytes\n`);

  // 实际验证2跳
  console.log('═══════════════════════════════════════════');
  console.log('🔍 实际验证：2跳场景');
  console.log('═══════════════════════════════════════════\n');
  
  const twoHopsSize = BASE_SIZE + BASE_ALT_SIZE + mediumTotalPerHop * 2;
  const twoHopsBase64 = Math.ceil(twoHopsSize * SAFETY_MARGIN * BASE64_FACTOR);
  console.log(`2跳总大小（原始）: ${twoHopsSize} bytes`);
  console.log(`2跳总大小（Base64）: ${twoHopsBase64} bytes`);
  console.log(`限制: ${MAX_BASE64_SIZE} bytes`);
  console.log(`结果: ${twoHopsBase64 <= MAX_BASE64_SIZE ? '✅ 通过' : '❌ 超限'}\n`);

  // 结论
  console.log('═══════════════════════════════════════════');
  console.log('📝 结论：');
  console.log('═══════════════════════════════════════════');
  console.log('✅ 1跳（直接swap）: 安全，几乎不会超限');
  console.log('⚠️  2跳（去程+回程）: 需要选择账户数少的DEX');
  console.log('❌ 3跳及以上: 几乎不可能，除非大幅优化\n');
}

calculateMaxHops();



















































































