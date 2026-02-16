use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

const SLOW_DB_QUERY_THRESHOLD_MS: u128 = 200;

#[derive(Debug, Default)]
pub struct Telemetry {
    auth_failures: AtomicU64,
    auth_rate_limit_hits: AtomicU64,
    media_denials: AtomicU64,
    ws_queue_pressure_events: AtomicU64,
    slow_db_queries: AtomicU64,
}

impl Telemetry {
    pub fn inc_auth_failure(&self) {
        self.auth_failures.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_auth_rate_limit_hit(&self) {
        self.auth_rate_limit_hits.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_media_denial(&self) {
        self.media_denials.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_ws_queue_pressure(&self) {
        self.ws_queue_pressure_events
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn observe_db_query(&self, query_name: &str, elapsed: Duration) {
        let elapsed_ms = elapsed.as_millis();
        if elapsed_ms < SLOW_DB_QUERY_THRESHOLD_MS {
            return;
        }

        let total_slow = self.slow_db_queries.fetch_add(1, Ordering::Relaxed) + 1;
        tracing::warn!(
            query = query_name,
            elapsed_ms,
            threshold_ms = SLOW_DB_QUERY_THRESHOLD_MS,
            total_slow,
            "Observed slow DB query"
        );
    }
}
