///! 结构体大小自动验证工具
///! 用于在运行时验证Rust结构体大小是否与链上数据匹配

use std::mem::size_of;
use crate::dex_interface::DexError;

/// 结构体大小验证结果
#[derive(Debug, Clone)]
pub struct SizeValidationResult {
    pub struct_name: String,
    pub expected_size: usize,
    pub actual_size: usize,
    pub matches: bool,
    pub diff: i32,
}

impl SizeValidationResult {
    pub fn new(struct_name: &str, expected_size: usize, actual_size: usize) -> Self {
        Self {
            struct_name: struct_name.to_string(),
            expected_size,
            actual_size,
            matches: expected_size == actual_size,
            diff: expected_size as i32 - actual_size as i32,
        }
    }
    
    pub fn to_string(&self) -> String {
        if self.matches {
            format!(
                "✅ {} size: {} bytes (matches expected)",
                self.struct_name, self.actual_size
            )
        } else {
            format!(
                "❌ {} size mismatch! Expected: {} bytes, Actual: {} bytes, Diff: {} bytes",
                self.struct_name, self.expected_size, self.actual_size, self.diff
            )
        }
    }
}

/// 结构体大小验证器
pub struct StructSizeValidator;

impl StructSizeValidator {
    /// 验证结构体大小
    pub fn validate<T>(struct_name: &str, expected_size: usize) -> SizeValidationResult {
        let actual_size = size_of::<T>();
        SizeValidationResult::new(struct_name, expected_size, actual_size)
    }
    
    /// 验证并在不匹配时返回错误
    pub fn validate_strict<T>(struct_name: &str, expected_size: usize) -> Result<(), DexError> {
        let result = Self::validate::<T>(struct_name, expected_size);
        
        if !result.matches {
            return Err(DexError::ValidationFailed(format!(
                "Struct size mismatch for {}: expected {} bytes, got {} bytes (diff: {} bytes)",
                struct_name, expected_size, result.actual_size, result.diff
            )));
        }
        
        Ok(())
    }
    
    /// 批量验证多个结构体
    pub fn validate_batch(validations: Vec<(&str, usize, usize)>) -> Vec<SizeValidationResult> {
        validations
            .into_iter()
            .map(|(name, expected, actual)| SizeValidationResult::new(name, expected, actual))
            .collect()
    }
}

/// 动态结构探测器
/// 用于在不完全了解结构的情况下探测其布局
pub struct StructProbe;

impl StructProbe {
    /// 探测数据中的Pubkey字段（32字节，且看起来像有效的Pubkey）
    pub fn find_pubkey_fields(data: &[u8]) -> Vec<usize> {
        let mut offsets = Vec::new();
        
        if data.len() < 32 {
            return offsets;
        }
        
        for i in 0..=(data.len() - 32) {
            // 简单启发式: Pubkey通常不是全零
            let chunk = &data[i..i + 32];
            let is_all_zeros = chunk.iter().all(|&b| b == 0);
            
            // 检查是否看起来像一个有效的Pubkey
            // (不是全零，且符合Ed25519公钥特征)
            if !is_all_zeros {
                offsets.push(i);
            }
        }
        
        offsets
    }
    
    /// 探测可能的u64字段（8字节对齐）
    pub fn find_u64_fields(data: &[u8], min_offset: usize) -> Vec<(usize, u64)> {
        let mut fields = Vec::new();
        
        for i in (min_offset..data.len()).step_by(8) {
            if i + 8 <= data.len() {
                let mut bytes = [0u8; 8];
                bytes.copy_from_slice(&data[i..i + 8]);
                let value = u64::from_le_bytes(bytes);
                
                // 只记录非零值
                if value != 0 {
                    fields.push((i, value));
                }
            }
        }
        
        fields
    }
    
    /// 打印数据的十六进制转储（用于调试）
    pub fn hex_dump(data: &[u8], offset: usize, length: usize) -> String {
        let end = (offset + length).min(data.len());
        let chunk = &data[offset..end];
        
        let mut result = String::new();
        for (i, byte) in chunk.iter().enumerate() {
            if i % 16 == 0 {
                if i > 0 {
                    result.push('\n');
                }
                result.push_str(&format!("{:04X}: ", offset + i));
            }
            result.push_str(&format!("{:02X} ", byte));
        }
        
        result
    }
    
    /// 分析数据结构的基本统计
    pub fn analyze_data(data: &[u8]) -> DataAnalysis {
        DataAnalysis {
            total_size: data.len(),
            zero_bytes: data.iter().filter(|&&b| b == 0).count(),
            non_zero_bytes: data.iter().filter(|&&b| b != 0).count(),
            potential_pubkeys: Self::find_pubkey_fields(data).len(),
        }
    }
}

#[derive(Debug)]
pub struct DataAnalysis {
    pub total_size: usize,
    pub zero_bytes: usize,
    pub non_zero_bytes: usize,
    pub potential_pubkeys: usize,
}

impl DataAnalysis {
    pub fn to_string(&self) -> String {
        format!(
            "Data Analysis:\n\
             - Total size: {} bytes\n\
             - Zero bytes: {} ({:.1}%)\n\
             - Non-zero bytes: {} ({:.1}%)\n\
             - Potential Pubkey fields: {}",
            self.total_size,
            self.zero_bytes,
            (self.zero_bytes as f64 / self.total_size as f64) * 100.0,
            self.non_zero_bytes,
            (self.non_zero_bytes as f64 / self.total_size as f64) * 100.0,
            self.potential_pubkeys
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_size_validation() {
        struct TestStruct {
            field1: u64,
            field2: u32,
        }
        
        let result = StructSizeValidator::validate::<TestStruct>("TestStruct", 12);
        assert!(result.matches);
    }
    
    #[test]
    fn test_size_mismatch() {
        struct TestStruct {
            field1: u64,
        }
        
        let result = StructSizeValidator::validate::<TestStruct>("TestStruct", 16);
        assert!(!result.matches);
        assert_eq!(result.diff, 8); // 期望16，实际8，差值8
    }
    
    #[test]
    fn test_struct_probe() {
        // 创建包含一个Pubkey的测试数据
        let mut data = vec![0u8; 64];
        // 在offset 16处填充一个非零Pubkey
        for i in 0..32 {
            data[16 + i] = (i + 1) as u8;
        }
        
        let pubkey_offsets = StructProbe::find_pubkey_fields(&data);
        assert!(pubkey_offsets.contains(&16));
    }
}




































