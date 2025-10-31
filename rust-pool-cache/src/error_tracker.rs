use chrono::{DateTime, Utc};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::warn;

/// Statistics for a specific error type
#[derive(Clone, Debug, Serialize)]
pub struct ErrorStats {
    /// Total number of occurrences
    pub count: usize,
    /// First time this error was seen
    pub first_seen: DateTime<Utc>,
    /// Last time this error was seen
    pub last_seen: DateTime<Utc>,
    /// Sample error messages (up to 5)
    pub samples: Vec<String>,
}

/// Error tracker for aggregating and deduplicating errors
#[derive(Clone)]
pub struct ErrorTracker {
    errors: Arc<RwLock<HashMap<String, ErrorStats>>>,
    alert_thresholds: Vec<usize>, // Alert at these counts (e.g., 10, 50, 100)
}

impl ErrorTracker {
    /// Create a new error tracker
    pub fn new() -> Self {
        Self {
            errors: Arc::new(RwLock::new(HashMap::new())),
            alert_thresholds: vec![10, 50, 100, 500, 1000],
        }
    }

    /// Record an error occurrence
    pub async fn record_error(&self, error_type: &str, message: String) {
        let mut errors = self.errors.write().await;
        
        let stats = errors.entry(error_type.to_string()).or_insert_with(|| {
            ErrorStats {
                count: 0,
                first_seen: Utc::now(),
                last_seen: Utc::now(),
                samples: Vec::new(),
            }
        });

        stats.count += 1;
        stats.last_seen = Utc::now();

        // Keep only the first 5 sample messages
        if stats.samples.len() < 5 && !stats.samples.contains(&message) {
            stats.samples.push(message);
        }

        // Alert at specific thresholds
        if self.alert_thresholds.contains(&stats.count) {
            warn!(
                error_type = %error_type,
                count = stats.count,
                "Error threshold reached"
            );
        }
    }

    /// Get all error statistics
    pub async fn get_error_report(&self) -> HashMap<String, ErrorStats> {
        self.errors.read().await.clone()
    }

    /// Get total error count
    pub async fn get_total_errors(&self) -> usize {
        self.errors.read().await.values().map(|s| s.count).sum()
    }

    /// Get unique error types count
    pub async fn get_unique_errors(&self) -> usize {
        self.errors.read().await.len()
    }

    /// Clear all error statistics
    #[allow(dead_code)]
    pub async fn clear(&self) {
        self.errors.write().await.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_error_tracker() {
        let tracker = ErrorTracker::new();

        // Record same error multiple times
        tracker.record_error("test_error", "Sample message 1".to_string()).await;
        tracker.record_error("test_error", "Sample message 2".to_string()).await;
        tracker.record_error("test_error", "Sample message 3".to_string()).await;

        let report = tracker.get_error_report().await;
        let stats = report.get("test_error").unwrap();

        assert_eq!(stats.count, 3);
        assert_eq!(stats.samples.len(), 3);
    }
}






