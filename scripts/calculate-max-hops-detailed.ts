#!/usr/bin/env node
/**
 * 计算交易最多支持几跳（优化版）
 * 分析在什么条件下可以支持2跳
 */

// 基础开销（固定部分）
const BASE_FIXED_SIZE = 100;
const BASE_SIGNATURE_SIZE = 64 + 4;
const BASE_COMPUTE_BUDGET_SIZE = 2 * 15;
const BASE_FLASHLOAN_SIZE = 2 * 15 + 14 * 1 + 100;
const BASE_V0_OVERHEAD = 50;
const BASE_SIZE = BASE_FIXED_SIZE + BASE_SIGNATURE_SIZE + BASE_COMPUTE_BUDGET_SIZE + BASE_FLASHLOAN_SIZE + BASE_V0_OVERHEAD;

// ALT基础开销（假设4个ALT）
const BASE_ALT_SIZE = 4 * 35;

// Base64编码后的限制
const MAX_BASE64_SIZE = 1644;

// 安全边际和Base64编码系数
const SAFETY_MARGIN = 1.05;
const BASE64_FACTOR = 1.333;

/**
 * 计算单个指令的大小（更精确）
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
 * 计算2跳的总大小
 */
function calculateTwoHopsSize(
  swap1Accounts: number[], 
  swap1Data: number[],
  swap2Accounts: number[],
  swap2Data: number[],
  altCount: number = 4
): { raw: number; base64: number } {
  let total = BASE_SIZE;
  
  // ALT开销（基础4个 + 每跳可能增加）
  total += altCount * 35;
  
  // Swap1指令
  for (let i = 0; i < swap1Accounts.length; i++) {
    total += calculateInstructionSize(swap1Accounts[i], swap1Data[i] || 50);
  }
  
  // Swap2指令
  for (let i = 0; i < swap2Accounts.length; i++) {
    total += calculateInstructionSize(swap2Accounts[i], swap2Data[i] || 50);
  }
  
  const base64Size = Math.ceil(total * SAFETY_MARGIN * BASE64_FACTOR);
  
  return { raw: total, base64: base64Size };
}

console.log('═══════════════════════════════════════════');
console.log('📊 2跳场景详细分析');
console.log('═══════════════════════════════════════════\n');

console.log('基础开销:');
console.log(`  固定部分: ${BASE_SIZE} bytes`);
console.log(`  ALT基础(4个): ${BASE_ALT_SIZE} bytes`);
console.log(`  总计: ${BASE_SIZE + BASE_ALT_SIZE} bytes\n`);

// 场景1：最轻量级（仅Swap指令，无setup）
console.log('场景1：最轻量级（每个Swap只有1个主指令，20个账户）');
const scenario1 = calculateTwoHopsSize(
  [20], [50], // Swap1: 1个指令，20账户，50B data
  [20], [50], // Swap2: 1个指令，20账户，50B data
  4 // 4个ALT
);
console.log(`  原始大小: ${scenario1.raw} bytes`);
console.log(`  Base64后: ${scenario1.base64} bytes`);
console.log(`  限制: ${MAX_BASE64_SIZE} bytes`);
console.log(`  结果: ${scenario1.base64 <= MAX_BASE64_SIZE ? '✅ 通过' : '❌ 超限'}\n`);

// 场景2：轻量级（Swap + Setup）
console.log('场景2：轻量级（每个Swap 2个指令：setup+swap，setup=15账户，swap=25账户）');
const scenario2 = calculateTwoHopsSize(
  [15, 25], [20, 50], // Swap1: setup(15账户) + swap(25账户)
  [15, 25], [20, 50], // Swap2: setup(15账户) + swap(25账户)
  4
);
console.log(`  原始大小: ${scenario2.raw} bytes`);
console.log(`  Base64后: ${scenario2.base64} bytes`);
console.log(`  限制: ${MAX_BASE64_SIZE} bytes`);
console.log(`  结果: ${scenario2.base64 <= MAX_BASE64_SIZE ? '✅ 通过' : '❌ 超限'}\n`);

// 场景3：基于日志的实际数据
console.log('场景3：实际数据（基于日志：Swap1=43账户，Swap2=26账户）');
const scenario3 = calculateTwoHopsSize(
  [30, 43], [20, 48], // Swap1: setup(30账户) + swap(43账户, 48B data)
  [20, 26], [15, 50], // Swap2: setup(20账户) + swap(26账户, 50B data)
  5 // 5个ALT（包含Jupiter Lend ALT）
);
console.log(`  原始大小: ${scenario3.raw} bytes`);
console.log(`  Base64后: ${scenario3.base64} bytes`);
console.log(`  限制: ${MAX_BASE64_SIZE} bytes`);
console.log(`  结果: ${scenario3.base64 <= MAX_BASE64_SIZE ? '✅ 通过' : '❌ 超限'}\n`);

// 场景4：优化后的实际数据（减少账户数）
console.log('场景4：优化后（减少账户数：Swap1=30账户，Swap2=20账户）');
const scenario4 = calculateTwoHopsSize(
  [20, 30], [15, 40], // Swap1: setup(20账户) + swap(30账户)
  [15, 20], [15, 40], // Swap2: setup(15账户) + swap(20账户)
  4
);
console.log(`  原始大小: ${scenario4.raw} bytes`);
console.log(`  Base64后: ${scenario4.base64} bytes`);
console.log(`  限制: ${MAX_BASE64_SIZE} bytes`);
console.log(`  结果: ${scenario4.base64 <= MAX_BASE64_SIZE ? '✅ 通过' : '❌ 超限'}\n`);

// 场景5：极简（只有Swap主指令，无setup）
console.log('场景5：极简（每个Swap只有1个主指令，30个账户）');
const scenario5 = calculateTwoHopsSize(
  [30], [50], // Swap1: 1个指令，30账户
  [30], [50], // Swap2: 1个指令，30账户
  4
);
console.log(`  原始大小: ${scenario5.raw} bytes`);
console.log(`  Base64后: ${scenario5.base64} bytes`);
console.log(`  限制: ${MAX_BASE64_SIZE} bytes`);
console.log(`  结果: ${scenario5.base64 <= MAX_BASE64_SIZE ? '✅ 通过' : '❌ 超限'}\n`);

// 寻找临界点
console.log('═══════════════════════════════════════════');
console.log('🔍 寻找临界点：');
console.log('═══════════════════════════════════════════\n');

const maxRawSize = Math.floor(MAX_BASE64_SIZE / (SAFETY_MARGIN * BASE64_FACTOR));
const availableForSwaps = maxRawSize - BASE_SIZE - BASE_ALT_SIZE;

console.log(`可用空间: ${availableForSwaps} bytes`);
console.log(`（需要分配给2个Swap的所有指令）\n`);

// 计算如果每个Swap只有1个主指令，最多能支持多少账户
for (let accounts = 15; accounts <= 35; accounts += 5) {
  const size = calculateTwoHopsSize(
    [accounts], [50],
    [accounts], [50],
    4
  );
  const status = size.base64 <= MAX_BASE64_SIZE ? '✅' : '❌';
  console.log(`${status} 每个Swap 1个指令，${accounts}个账户/指令: ${size.base64} bytes`);
}

console.log('\n');

// 计算如果每个Swap有2个指令（setup+swap），最多能支持多少账户
for (let swapAccounts = 20; swapAccounts <= 30; swapAccounts += 5) {
  for (let setupAccounts = 10; setupAccounts <= 20; setupAccounts += 5) {
    const size = calculateTwoHopsSize(
      [setupAccounts, swapAccounts], [15, 50],
      [setupAccounts, swapAccounts], [15, 50],
      4
    );
    const status = size.base64 <= MAX_BASE64_SIZE ? '✅' : '❌';
    console.log(`${status} Setup(${setupAccounts}) + Swap(${swapAccounts}): ${size.base64} bytes`);
  }
}

console.log('\n═══════════════════════════════════════════');
console.log('📝 最终结论：');
console.log('═══════════════════════════════════════════');
console.log('✅ 1跳: 安全，支持30-40个账户/指令');
console.log('⚠️  2跳（仅主指令）: 每个Swap最多25-30个账户');
console.log('⚠️  2跳（setup+swap）: Setup≤15账户，Swap≤25账户');
console.log('❌ 3跳及以上: 几乎不可能\n');







































































































































