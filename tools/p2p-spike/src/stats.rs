//! Kennzahlen für die G1-Tabelle (SPEC 1.3): Perzentile nach dem Nearest-Rank-Verfahren.

use std::time::Duration;

/// Verteilung der Echo-Umlaufzeiten.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LatencySummary {
    pub min: Duration,
    pub p50: Duration,
    pub p99: Duration,
    pub max: Duration,
}

impl LatencySummary {
    /// `None` bei leerer Messreihe.
    pub fn from_samples(samples: &[Duration]) -> Option<Self> {
        let mut sorted = samples.to_vec();
        sorted.sort_unstable();
        Some(Self {
            min: *sorted.first()?,
            p50: nearest_rank(&sorted, 50),
            p99: nearest_rank(&sorted, 99),
            max: *sorted.last()?,
        })
    }
}

fn nearest_rank(sorted: &[Duration], percent: usize) -> Duration {
    let rank = (percent * sorted.len()).div_ceil(100).max(1);
    sorted[rank - 1]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn millis(values: impl IntoIterator<Item = u64>) -> Vec<Duration> {
        values.into_iter().map(Duration::from_millis).collect()
    }

    #[test]
    fn empty_series_has_no_summary() {
        assert_eq!(LatencySummary::from_samples(&[]), None);
    }

    #[test]
    fn single_sample_is_every_percentile() {
        let summary = LatencySummary::from_samples(&millis([7])).unwrap();
        assert_eq!(summary.p50, Duration::from_millis(7));
        assert_eq!(summary.p99, Duration::from_millis(7));
    }

    #[test]
    fn hundred_samples_use_nearest_rank() {
        let summary = LatencySummary::from_samples(&millis((1..=100).rev())).unwrap();
        assert_eq!(summary.min, Duration::from_millis(1));
        assert_eq!(summary.p50, Duration::from_millis(50));
        assert_eq!(summary.p99, Duration::from_millis(99));
        assert_eq!(summary.max, Duration::from_millis(100));
    }

    #[test]
    fn p99_of_a_thousand_samples_ignores_the_ten_worst() {
        let mut samples = millis(std::iter::repeat_n(5, 990));
        samples.extend(millis(std::iter::repeat_n(500, 10)));
        let summary = LatencySummary::from_samples(&samples).unwrap();
        assert_eq!(summary.p99, Duration::from_millis(5));
        assert_eq!(summary.max, Duration::from_millis(500));
    }
}
