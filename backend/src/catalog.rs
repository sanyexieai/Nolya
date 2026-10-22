use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

pub const VERSION: &str = "1.0";
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Question {
    pub id: String,
    pub version: String,
    pub dimension: Option<String>,
    pub prompt: String,
    pub choice_a: String,
    pub choice_b: String,
    pub form: String,
    pub locale: String,
    pub region: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topic: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dimension_hint: Option<String>,
    #[serde(default)]
    pub direction_a: i32,
}

pub fn questions() -> &'static Vec<Question> {
    static CATALOG: OnceLock<Vec<Question>> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("questions.json"))
            .expect("embedded question catalog is valid")
    })
}
pub fn self_questions() -> Vec<Question> {
    questions()
        .iter()
        .filter(|q| q.form == "self")
        .cloned()
        .collect()
}
pub fn find(id: &str) -> Option<Question> {
    questions().iter().find(|q| q.id == id).cloned()
}
pub fn pulse_for_date(day: NaiveDate) -> Question {
    let index = day.num_days_from_ce().rem_euclid(30) + 1;
    find(&format!("PULSE-{index:02}")).expect("30 pulse questions")
}
pub fn friend_questions(dimensions: &[String], variant: usize) -> Vec<Question> {
    // Variant A of D1 is intentionally excluded: the source has ambiguous polarity.
    let suffix = ["B", "C", "D"][variant % 3];
    dimensions
        .iter()
        .map(|d| find(&format!("FRIEND-{d}-{suffix}")).expect("friend dimension exists"))
        .collect()
}
pub fn dimension_labels(d: &str) -> (&'static str, &'static str) {
    match d {
        "D1" => ("有计划", "随性"),
        "D2" => ("直接表达", "委婉处理"),
        "D3" => ("尝鲜探索", "熟悉稳定"),
        _ => ("情绪外显", "自己消化"),
    }
}
