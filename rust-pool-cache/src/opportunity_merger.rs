/*!
 * Opportunity Merger
 */

use crate::router::ArbitragePath;
use crate::lst_enhanced_detector::LstOpportunity;
use std::collections::HashSet;
use tracing::debug;

#[derive(Debug, Clone)]
pub struct UnifiedOpportunity {
    pub source: OpportunitySource,
    pub roi: f64,
    pub net_profit: f64,
    pub description: String,
    pub token_sequence: Vec<String>,
    pub pool_ids: HashSet<String>,
    pub raw_data: OpportunityData,
}

#[derive(Debug, Clone, PartialEq)]
pub enum OpportunitySource {
    GeneralRouter,
    LstDetector,
}

#[derive(Debug, Clone)]
pub enum OpportunityData {
    General(ArbitragePath),
    Lst(LstOpportunity),
}

impl UnifiedOpportunity {
    pub fn from_arbitrage_path(path: ArbitragePath) -> Self {
        let token_sequence = path.steps.iter().map(|s| s.output_token.clone()).collect();
        let pool_ids = path.steps.iter().map(|s| s.pool_id.clone()).collect();
        let description = format!("{} → {}", path.start_token, path.end_token);
        
        Self {
            source: OpportunitySource::GeneralRouter,
            roi: path.roi_percent,
            net_profit: path.net_profit,
            description,
            token_sequence,
            pool_ids,
            raw_data: OpportunityData::General(path),
        }
    }
    
    pub fn from_lst_opportunity(opp: LstOpportunity) -> Self {
        let token_sequence = Vec::new();
        let pool_ids = HashSet::new();
        
        Self {
            source: OpportunitySource::LstDetector,
            roi: opp.estimated_profit_percent,
            net_profit: opp.output_amount - opp.input_amount,
            description: opp.path_description.clone(),
            token_sequence,
            pool_ids,
            raw_data: OpportunityData::Lst(opp),
        }
    }
    
    pub fn score(&self) -> f64 {
        let base_score = self.net_profit * 0.6 + self.roi * 0.3;
        let source_bonus = match self.source {
            OpportunitySource::LstDetector => 0.15,
            OpportunitySource::GeneralRouter => 0.0,
        };
        base_score + source_bonus
    }
}

#[derive(Clone)]
pub struct OpportunityMerger {
    similarity_threshold: f64,
}

impl OpportunityMerger {
    pub fn new() -> Self {
        Self { similarity_threshold: 5.0 }
    }
    
    pub fn merge(
        &self,
        general_paths: Vec<ArbitragePath>,
        lst_opportunities: Vec<LstOpportunity>,
    ) -> Vec<UnifiedOpportunity> {
        debug!("Merging {} general + {} LST opportunities", general_paths.len(), lst_opportunities.len());
        
        let mut all_opportunities: Vec<UnifiedOpportunity> = Vec::new();
        
        for path in general_paths {
            all_opportunities.push(UnifiedOpportunity::from_arbitrage_path(path));
        }
        
        for opp in lst_opportunities {
            all_opportunities.push(UnifiedOpportunity::from_lst_opportunity(opp));
        }
        
        let deduplicated = self.deduplicate(all_opportunities);
        let mut sorted = deduplicated;
        sorted.sort_by(|a, b| b.score().partial_cmp(&a.score()).unwrap_or(std::cmp::Ordering::Equal));
        
        sorted
    }
    
    fn deduplicate(&self, opportunities: Vec<UnifiedOpportunity>) -> Vec<UnifiedOpportunity> {
        if opportunities.is_empty() { return opportunities; }
        
        let mut result = Vec::new();
        let mut seen = Vec::new();
        
        for opp in opportunities {
            let is_duplicate = seen.iter().any(|existing: &UnifiedOpportunity| {
                self.is_duplicate(&opp, existing)
            });
            
            if !is_duplicate {
                seen.push(opp.clone());
                result.push(opp);
            }
        }
        
        result
    }
    
    fn is_duplicate(&self, opp1: &UnifiedOpportunity, opp2: &UnifiedOpportunity) -> bool {
        let roi_diff = (opp1.roi - opp2.roi).abs();
        roi_diff < self.similarity_threshold
    }
    
    pub fn format_report(&self, opportunities: &[UnifiedOpportunity]) -> String {
        if opportunities.is_empty() {
            return "📊 套利扫描完成：未发现机会\n".to_string();
        }
        
        let mut report = String::new();
        report.push_str("\n╔═══════════════════════════════════════════════════════════╗\n");
        report.push_str("║         套利机会报告 (合并输出)                           ║\n");
        report.push_str("╠═══════════════════════════════════════════════════════════╣\n");
        
        for (idx, opp) in opportunities.iter().take(10).enumerate() {
            let source_label = match opp.source {
                OpportunitySource::GeneralRouter => "[通用]",
                OpportunitySource::LstDetector => "[LST]",
            };
            
            report.push_str(&format!(
                "║ #{:<2} {} {:6.2}% │ 净利: {:>8.4}                       ║\n",
                idx + 1, source_label, opp.roi, opp.net_profit
            ));
            
            let desc = if opp.description.len() > 55 {
                format!("{}...", &opp.description[..52])
            } else {
                format!("{:<55}", opp.description)
            };
            
            report.push_str(&format!("║     {}  ║\n", desc));
            report.push_str("╠═══════════════════════════════════════════════════════════╣\n");
        }
        
        let general_count = opportunities.iter().filter(|o| o.source == OpportunitySource::GeneralRouter).count();
        let lst_count = opportunities.iter().filter(|o| o.source == OpportunitySource::LstDetector).count();
        
        report.push_str(&format!("║ 总计: {}个 (通用: {} | LST: {})                         ║\n", opportunities.len(), general_count, lst_count));
        report.push_str("╚═══════════════════════════════════════════════════════════╝\n");
        
        report
    }
}

impl Default for OpportunityMerger {
    fn default() -> Self {
        Self::new()
    }
}

