#!/usr/bin/env node
/**
 * 计算交易最多支持几跳（完整版）
 * 确认包含：闪电贷borrow + 去程Swap1 + 返程Swap2 + 闪电贷repay
 */

// 基础开销（固定部分）
const BASE_FIXED_SIZE = 100; // 固定头部
const BASE_SIGNATURE_SIZE = 64 + 4; // 签名 + 数组长度
const BASE_V0_OVERHEAD = 50; // 版本化交易额外开销

// 闪电贷指令（borrow + repay）
const FLASHLOAN_BORROW_SIZE = 15 + 7 + 50; // borrow指令（假设14个账户，7个在ALT中）
const FLASHLOAN_REPAY_SIZE = 15 + 7 + 50; // repay指令
const FLASHLOAN_TOTAL_SIZE = FLASHLOAN_BORROW_SIZE + FLASHLOAN_REPAY_SIZE;

// ComputeBudget指令（全局共享，2个）
const COMPUTE_BUDGET_SIZE = 2 * 15;

// ALT基础开销（假设4-5个ALT）
const BASE_ALT_SIZE = 4 * 35; // 基础4个ALT
const ALT_PER_SWAP = 35; // 每跳可能增加1个ALT

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
 * 计算完整的2跳交易大小（包含闪电贷）
 */
function calculateFullTwoHopsSize(
  swap1Accounts: number[], 
  swap1Data: number[],
  swap2Accounts: number[],
  swap2Data: number[],
  swap1ComputeBudget: number = 0, // Swap1的computeBudget指令数（通常为0，因为全局共享）
  swap2ComputeBudget: number = 0, // Swap2的computeBudget指令数
  altCount: number = 4
): { raw: number; base64: number; breakdown: any } {
  let total = BASE_FIXED_SIZE + BASE_SIGNATURE_SIZE + BASE_V0_OVERHEAD;
  
  // 1. 闪电贷borrow指令
  total += FLASHLOAN_BORROW_SIZE;
  
  // 2. ComputeBudget指令（全局共享）
  total += COMPUTE_BUDGET_SIZE;
  
  // 3. Swap1指令
  let swap1Size = 0;
  if (swap1ComputeBudget > 0) {
    // 如果Swap1有自己的computeBudget（通常没有，因为全局共享）
    swap1Size += swap1ComputeBudget * 15;
  }
  for (let i = 0; i < swap1Accounts.length; i++) {
    swap1Size += calculateInstructionSize(swap1Accounts[i], swap1Data[i] || 50);
  }
  total += swap1Size;
  
  // 4. Swap2指令
  let swap2Size = 0;
  if (swap2ComputeBudget > 0) {
    swap2Size += swap2ComputeBudget * 15;
  }
  for (let i = 0; i < swap2Accounts.length; i++) {
    swap2Size += calculateInstructionSize(swap2Accounts[i], swap2Data[i] || 50);
  }
  total += swap2Size;
  
  // 5. 闪电贷repay指令
  total += FLASHLOAN_REPAY_SIZE;
  
  // 6. ALT开销
  total += altCount * 35;
  
  // 7. 安全边际
  const rawWithMargin = Math.ceil(total * SAFETY_MARGIN);
  
  // 8. Base64编码
  const base64Size = Math.ceil(rawWithMargin * BASE64_FACTOR);
  
  return {
    raw: total,
    base64: base64Size,
    breakdown: {
      base: BASE_FIXED_SIZE + BASE_SIGNATURE_SIZE + BASE_V0_OVERHEAD,
      flashloan: FLASHLOAN_TOTAL_SIZE,
      computeBudget: COMPUTE_BUDGET_SIZE,
      swap1: swap1Size,
      swap2: swap2Size,
      alt: altCount * 35,
      total: total,
      withMargin: rawWithMargin,
      base64: base64Size
    }
  };
}

console.log('═══════════════════════════════════════════');
console.log('📊 完整交易大小计算（包含闪电贷）');
console.log('═══════════════════════════════════════════\n');

console.log('📐 基础开销：');
console.log(`   固定头部: ${BASE_FIXED_SIZE} bytes`);
console.log(`   签名数组: ${BASE_SIGNATURE_SIZE} bytes`);
console.log(`   版本化开销: ${BASE_V0_OVERHEAD} bytes`);
console.log(`   小计: ${BASE_FIXED_SIZE + BASE_SIGNATURE_SIZE + BASE_V0_OVERHEAD} bytes\n`);

console.log('⚡ 闪电贷指令：');
console.log(`   Borrow指令: ${FLASHLOAN_BORROW_SIZE} bytes`);
console.log(`   Repay指令: ${FLASHLOAN_REPAY_SIZE} bytes`);
console.log(`   总计: ${FLASHLOAN_TOTAL_SIZE} bytes\n`);

console.log('💰 ComputeBudget指令（全局共享）：');
console.log(`   setComputeUnitLimit + setComputeUnitPrice: ${COMPUTE_BUDGET_SIZE} bytes\n`);

console.log('═══════════════════════════════════════════');
console.log('📊 2跳场景详细分析（完整交易）');
console.log('═══════════════════════════════════════════\n');

// 场景1：最轻量级（仅Swap主指令）
console.log('场景1：最轻量级（每个Swap只有1个主指令，20个账户）');
const scenario1 = calculateFullTwoHopsSize(
  [20], [50], // Swap1: 1个指令，20账户
  [20], [50], // Swap2: 1个指令，20账户
  0, 0, // 无额外的computeBudget
  4 // 4个ALT
);
console.log(`   分解:`);
console.log(`     基础: ${scenario1.breakdown.base} bytes`);
console.log(`     闪电贷: ${scenario1.breakdown.flashloan} bytes`);
console.log(`     ComputeBudget: ${scenario1.breakdown.computeBudget} bytes`);
console.log(`     Swap1: ${scenario1.breakdown.swap1} bytes`);
console.log(`     Swap2: ${scenario1.breakdown.swap2} bytes`);
console.log(`     ALT: ${scenario1.breakdown.alt} bytes`);
console.log(`   原始大小: ${scenario1.raw} bytes`);
console.log(`   安全边际后: ${scenario1.breakdown.withMargin} bytes`);
console.log(`   Base64后: ${scenario1.base64} bytes`);
console.log(`   限制: ${MAX_BASE64_SIZE} bytes`);
console.log(`   结果: ${scenario1.base64 <= MAX_BASE64_SIZE ? '✅ 通过' : '❌ 超限'}\n`);

// 场景2：轻量级（Swap + Setup）
console.log('场景2：轻量级（每个Swap 2个指令：setup+swap，setup=15账户，swap=25账户）');
const scenario2 = calculateFullTwoHopsSize(
  [15, 25], [20, 50], // Swap1: setup(15账户) + swap(25账户)
  [15, 25], [20, 50], // Swap2: setup(15账户) + swap(25账户)
  0, 0,
  4
);
console.log(`   原始大小: ${scenario2.raw} bytes`);
console.log(`   Base64后: ${scenario2.base64} bytes`);
console.log(`   限制: ${MAX_BASE64_SIZE} bytes`);
console.log(`   结果: ${scenario2.base64 <= MAX_BASE64_SIZE ? '✅ 通过' : '❌ 超限'}\n`);

// 场景3：实际数据（基于日志）
console.log('场景3：实际数据（基于日志：Swap1=43账户，Swap2=26账户）');
const scenario3 = calculateFullTwoHopsSize(
  [30, 43], [20, 48], // Swap1: setup(30账户) + swap(43账户)
  [20, 26], [15, 50], // Swap2: setup(20账户) + swap(26账户)
  0, 0,
  5 // 5个ALT（包含Jupiter Lend ALT）
);
console.log(`   分解:`);
console.log(`     基础: ${scenario3.breakdown.base} bytes`);
console.log(`     闪电贷: ${scenario3.breakdown.flashloan} bytes`);
console.log(`     ComputeBudget: ${scenario3.breakdown.computeBudget} bytes`);
console.log(`     Swap1: ${scenario3.breakdown.swap1} bytes`);
console.log(`     Swap2: ${scenario3.breakdown.swap2} bytes`);
console.log(`     ALT: ${scenario3.breakdown.alt} bytes`);
console.log(`   原始大小: ${scenario3.raw} bytes`);
console.log(`   Base64后: ${scenario3.base64} bytes`);
console.log(`   限制: ${MAX_BASE64_SIZE} bytes`);
console.log(`   结果: ${scenario3.base64 <= MAX_BASE64_SIZE ? '✅ 通过' : '❌ 超限'}\n`);

// 场景4：极简（仅Swap主指令，30账户）
console.log('场景4：极简（每个Swap只有1个主指令，30个账户）');
const scenario4 = calculateFullTwoHopsSize(
  [30], [50], // Swap1: 1个指令，30账户
  [30], [50], // Swap2: 1个指令，30账户
  0, 0,
  4
);
console.log(`   原始大小: ${scenario4.raw} bytes`);
console.log(`   Base64后: ${scenario4.base64} bytes`);
console.log(`   限制: ${MAX_BASE64_SIZE} bytes`);
console.log(`   结果: ${scenario4.base64 <= MAX_BASE64_SIZE ? '✅ 通过' : '❌ 超限'}\n`);

// 总结
console.log('═══════════════════════════════════════════');
console.log('📝 最终结论：');
console.log('═══════════════════════════════════════════');
console.log('✅ 1跳（1个Swap）: 安全，支持30-40个账户/指令');
console.log('⚠️  2跳（去程+返程）:');
console.log('   - 仅主指令: 每个Swap最多30个账户 ✅');
console.log('   - Setup+Swap: Setup≤10，Swap≤20 ✅');
console.log('   - Setup+Swap: Setup≥15，Swap≥25 ❌');
console.log('❌ 3跳及以上: 几乎不可能\n');

























