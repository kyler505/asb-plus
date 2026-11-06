use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{FromRow, QueryBuilder, Sqlite};

use crate::ingest;

#[derive(Clone)]
pub struct AppState {
    pub pool: sqlx::SqlitePool,
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: String,
    code: Option<&'static str>,
}
impl ApiError {
    fn new(status: StatusCode, error: impl std::fmt::Display) -> Self {
        Self {
            status,
            message: error.to_string(),
            code: None,
        }
    }

    fn typed(status: StatusCode, code: &'static str, error: impl std::fmt::Display) -> Self {
        Self {
            status,
            message: error.to_string(),
            code: Some(code),
        }
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = self.status;
        let message = self.message;
        let code = self.code;
        let body = match code {
            Some(code) => json!({"error":message,"code":code}),
            None => json!({"error":message}),
        };
        (status, Json(body)).into_response()
    }
}
impl From<anyhow::Error> for ApiError {
    fn from(error: anyhow::Error) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, error)
    }
}
impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, error)
    }
}

#[derive(Deserialize, Default)]
pub struct Search {
    q: Option<String>,
    course: Option<String>,
    term: Option<String>,
    crns: Option<String>,
    campus: Option<String>,
    subject: Option<String>,
    instructor: Option<String>,
    attribute: Option<String>,
    day: Option<String>,
    starts_after: Option<String>,
    ends_before: Option<String>,
    min_gpa: Option<f64>,
    max_gpa: Option<f64>,
    min_ab_rate: Option<f64>,
    open: Option<String>,
    grades: Option<bool>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(FromRow)]
struct SectionRow {
    crn: String,
    term: String,
    subject: String,
    course: String,
    section: String,
    title: String,
    site: String,
    campus: String,
    schedule_type: String,
    instruction_type: String,
    attributes: String,
    open_flag: String,
    seats: Option<String>,
    capacity: Option<String>,
    enrolled: Option<String>,
    hours: Option<f64>,
    instructors_json: String,
    meetings_json: String,
    source: String,
    updated_at: i64,
    average_gpa: Option<f64>,
    ab_rate: Option<f64>,
    grade_sections: i64,
}
#[derive(Serialize)]
struct Section {
    crn: String,
    term: String,
    subject: String,
    course: String,
    section: String,
    title: String,
    site: String,
    campus: String,
    schedule_type: String,
    instruction_type: String,
    attributes: String,
    open_flag: String,
    seats: Option<String>,
    capacity: Option<String>,
    enrolled: Option<String>,
    hours: Option<f64>,
    instructors: Value,
    meetings: Value,
    source: String,
    updated_at: i64,
    average_gpa: Option<f64>,
    ab_rate: Option<f64>,
    grade_sections: i64,
}
impl From<SectionRow> for Section {
    fn from(s: SectionRow) -> Self {
        Self {
            crn: s.crn,
            term: s.term,
            subject: s.subject,
            course: s.course,
            section: s.section,
            title: s.title,
            site: s.site,
            campus: s.campus,
            schedule_type: s.schedule_type,
            instruction_type: s.instruction_type,
            attributes: s.attributes,
            open_flag: s.open_flag,
            seats: s.seats,
            capacity: s.capacity,
            enrolled: s.enrolled,
            hours: s.hours,
            instructors: serde_json::from_str(&s.instructors_json).unwrap_or(json!([])),
            meetings: serde_json::from_str(&s.meetings_json).unwrap_or(json!([])),
            source: s.source,
            updated_at: s.updated_at,
            average_gpa: s.average_gpa,
            ab_rate: s.ab_rate,
            grade_sections: s.grade_sections,
        }
    }
}

#[derive(FromRow, Serialize)]
struct CourseRow {
    term: String,
    subject: String,
    course: String,
    title: String,
    hours: Option<f64>,
    sections: i64,
    grades: i64,
}
#[derive(FromRow, Serialize)]
struct TermRow {
    term: String,
    label: String,
}
#[derive(Deserialize, Default)]
struct ProfessorSearch {
    term: Option<String>,
    q: Option<String>,
    grade_name: Option<String>,
}

#[derive(Deserialize, Default)]
struct GradeInstructorSearch {
    q: Option<String>,
}

#[derive(FromRow)]
struct ProfessorBase {
    name: String,
    sections: i64,
    courses: String,
}

#[derive(Serialize)]
struct ProfessorInfo {
    name: String,
    sections: i64,
    courses: String,
    candidate_names: Vec<String>,
    match_confidence: String,
}

#[derive(FromRow, Serialize)]
struct GradeInstructor {
    instructor: String,
    records: i64,
}

#[derive(FromRow, Serialize)]
struct GradeRow {
    subject: String,
    course: String,
    section: String,
    instructor: String,
    year: String,
    semester: String,
    gpa: Option<f64>,
    grade_a: Option<String>,
    grade_b: Option<String>,
    grade_c: Option<String>,
    grade_d: Option<String>,
    grade_f: Option<String>,
    grade_q: Option<String>,
    source: String,
    fetched_at: i64,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/", get(index))
        .route("/schedule.js", get(schedule_js))
        .route("/degree.js", get(degree_js))
        .route("/preflight.js", get(preflight_js))
        .route("/preflight.css", get(preflight_css))
        .route("/vendor/pdfjs/pdf.mjs", get(pdfjs_main))
        .route("/vendor/pdfjs/pdf.worker.mjs", get(pdfjs_worker))
        .route("/api/health", get(health))
        .route("/api/summary", get(summary))
        .route("/api/terms", get(terms))
        .route("/api/subjects", get(subjects))
        .route("/api/courses", get(courses))
        .route("/api/sections", get(sections))
        .route("/api/sections/refresh", post(refresh_sections))
        .route("/api/grades", get(grades))
        .route("/api/professors", get(professors))
        .route("/api/professors/{name}", get(professor))
        .route("/api/grade-instructors", get(grade_instructors))
        .route(
            "/api/grades/{subject}/{course}/refresh",
            post(refresh_grades),
        )
        .with_state(state)
}

async fn index() -> Result<impl IntoResponse, ApiError> {
    let html = tokio::fs::read("static/index.html")
        .await
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok((
        [(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8")],
        html,
    ))
}
async fn schedule_js() -> Result<impl IntoResponse, ApiError> {
    let script = tokio::fs::read("static/schedule.js")
        .await
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error))?;
    Ok((
        [(
            axum::http::header::CONTENT_TYPE,
            "application/javascript; charset=utf-8",
        )],
        script,
    ))
}
async fn degree_js() -> Result<impl IntoResponse, ApiError> {
    let script = tokio::fs::read("static/degree.js")
        .await
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error))?;
    Ok((
        [(
            axum::http::header::CONTENT_TYPE,
            "application/javascript; charset=utf-8",
        )],
        script,
    ))
}
async fn preflight_js() -> Result<impl IntoResponse, ApiError> {
    let script = tokio::fs::read("static/preflight.js")
        .await
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error))?;
    Ok((
        [(
            axum::http::header::CONTENT_TYPE,
            "application/javascript; charset=utf-8",
        )],
        script,
    ))
}
async fn preflight_css() -> Result<impl IntoResponse, ApiError> {
    let stylesheet = tokio::fs::read("static/preflight.css")
        .await
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error))?;
    Ok((
        [(axum::http::header::CONTENT_TYPE, "text/css; charset=utf-8")],
        stylesheet,
    ))
}
async fn pdfjs_main() -> Result<impl IntoResponse, ApiError> {
    let script = tokio::fs::read("static/vendor/pdfjs/pdf.mjs")
        .await
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error))?;
    Ok((
        [(
            axum::http::header::CONTENT_TYPE,
            "application/javascript; charset=utf-8",
        )],
        script,
    ))
}
async fn pdfjs_worker() -> Result<impl IntoResponse, ApiError> {
    let script = tokio::fs::read("static/vendor/pdfjs/pdf.worker.mjs")
        .await
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error))?;
    Ok((
        [(
            axum::http::header::CONTENT_TYPE,
            "application/javascript; charset=utf-8",
        )],
        script,
    ))
}
async fn health() -> Json<Value> {
    Json(json!({"status":"ok"}))
}

async fn summary(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let sections: i64 = sqlx::query_scalar("SELECT count(*) FROM sections")
        .fetch_one(&state.pool)
        .await?;
    let courses: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM (SELECT DISTINCT subject,course,term FROM sections)",
    )
    .fetch_one(&state.pool)
    .await?;
    let last: Option<i64> = sqlx::query_scalar("SELECT max(updated_at) FROM sections")
        .fetch_one(&state.pool)
        .await?;
    let latest_term: Option<String> = sqlx::query_scalar("SELECT max(term) FROM terms")
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(
        json!({"sections":sections,"courses":courses,"last_updated":last,"latest_term":latest_term}),
    ))
}

async fn courses(
    State(state): State<AppState>,
    Query(search): Query<Search>,
) -> Result<Json<Value>, ApiError> {
    let mut query = QueryBuilder::<Sqlite>::new(
        "SELECT c.term,c.subject,c.course,c.title,c.hours,count(DISTINCT s.crn) AS sections,count(DISTINCT g.id) AS grades FROM courses c LEFT JOIN sections s ON s.term=c.term AND s.subject=c.subject AND s.course=c.course LEFT JOIN grade_observations g ON g.subject=c.subject AND g.course=c.course WHERE 1=1",
    );
    if let Some(term) = search.term.filter(|s| !s.is_empty()) {
        query.push(" AND c.term=").push_bind(term);
    }
    if let Some(q) = search.q.filter(|s| !s.trim().is_empty()) {
        let pattern = format!("%{}%", q.trim());
        query
            .push(" AND (c.subject || ' ' || c.course LIKE ")
            .push_bind(pattern.clone())
            .push(" OR c.title LIKE ")
            .push_bind(pattern)
            .push(")");
    }
    query
        .push(" GROUP BY c.term,c.subject,c.course ORDER BY c.subject,c.course LIMIT ")
        .push_bind(search.limit.unwrap_or(100).clamp(1, 250));
    let rows: Vec<CourseRow> = query.build_query_as().fetch_all(&state.pool).await?;
    Ok(Json(json!({"courses":rows})))
}
async fn terms(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let rows: Vec<TermRow> = sqlx::query_as("SELECT term,label FROM terms ORDER BY term DESC")
        .fetch_all(&state.pool)
        .await?;
    Ok(Json(json!({"terms":rows})))
}

async fn subjects(
    State(state): State<AppState>,
    Query(search): Query<Search>,
) -> Result<Json<Value>, ApiError> {
    let mut query = QueryBuilder::<Sqlite>::new("SELECT DISTINCT subject FROM courses WHERE 1=1");
    if let Some(term) = search.term.filter(|term| !term.is_empty()) {
        query.push(" AND term=").push_bind(term);
    }
    query.push(" ORDER BY subject");
    let rows: Vec<String> = query.build_query_scalar().fetch_all(&state.pool).await?;
    Ok(Json(json!({"subjects":rows})))
}

fn parse_time_filter(value: Option<&str>) -> Result<Option<i64>, ApiError> {
    let Some(value) = value.filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let parsed = value
        .split_once(':')
        .and_then(|(hour, minute)| Some((hour.parse::<i64>().ok()?, minute.parse::<i64>().ok()?)));
    match parsed {
        Some((hour, minute)) if hour <= 23 && minute <= 59 => Ok(Some(hour * 60 + minute)),
        _ => Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Use a valid 24-hour time such as 09:30.",
        )),
    }
}

const SECTION_QUERY: &str = r#"
SELECT s.crn,s.term,s.subject,s.course,s.section,s.title,s.site,s.campus,
       s.schedule_type,s.instruction_type,s.attributes,s.open_flag,s.seats,
       s.capacity,s.enrolled,s.hours,s.instructors_json,s.meetings_json,
       s.source,s.updated_at,g.average_gpa,
       CASE WHEN g.total_count>0 THEN 100.0*g.ab_count/g.total_count ELSE NULL END AS ab_rate,
       COALESCE(g.grade_sections,0) AS grade_sections
FROM sections s
LEFT JOIN (
    SELECT subject,course,AVG(gpa) AS average_gpa,COUNT(*) AS grade_sections,
           SUM(COALESCE(CAST(grade_a AS REAL),0)+COALESCE(CAST(grade_b AS REAL),0)) AS ab_count,
           SUM(COALESCE(CAST(grade_a AS REAL),0)+COALESCE(CAST(grade_b AS REAL),0)+
               COALESCE(CAST(grade_c AS REAL),0)+COALESCE(CAST(grade_d AS REAL),0)+
               COALESCE(CAST(grade_f AS REAL),0)) AS total_count
    FROM (
        SELECT g.*,
               ROW_NUMBER() OVER (
                   PARTITION BY g.subject,g.course,
                       CASE WHEN trim(g.section)='' OR trim(g.instructor)=''
                            THEN 'id:'||g.id
                            ELSE upper(trim(g.section))||'|'||upper(trim(g.instructor)) END,
                       g.year,g.semester
                   ORDER BY CASE WHEN g.source IN ('registrar-pdf','registrar-csv') THEN 0 ELSE 1 END,
                            g.fetched_at DESC,g.id DESC
               ) AS source_rank
        FROM grade_observations g
    ) ranked_grades
    WHERE source_rank=1
    GROUP BY subject,course
) g ON g.subject=s.subject AND g.course=s.course
WHERE 1=1
"#;
const SCHEDULE_BUILDER_TERM: &str = "202711";
const MAX_SECTION_CRNS: usize = 50;

fn section_lookup_term(term: Option<&str>) -> Result<String, ApiError> {
    let Some(term) = term.map(str::trim).filter(|term| !term.is_empty()) else {
        return Err(ApiError::typed(
            StatusCode::BAD_REQUEST,
            "missing_term",
            "A term is required for section CRN lookup.",
        ));
    };
    if term != SCHEDULE_BUILDER_TERM {
        return Err(ApiError::typed(
            StatusCode::BAD_REQUEST,
            "unsupported_term",
            format!("Only term {SCHEDULE_BUILDER_TERM} is available."),
        ));
    }
    Ok(term.to_owned())
}

fn section_lookup_crns(value: &str) -> Result<Vec<String>, ApiError> {
    if value.trim().is_empty() {
        return Err(ApiError::typed(
            StatusCode::BAD_REQUEST,
            "missing_crns",
            "At least one CRN is required.",
        ));
    }
    let values: Vec<_> = value.split(',').map(str::trim).collect();
    if values.len() > MAX_SECTION_CRNS {
        return Err(ApiError::typed(
            StatusCode::BAD_REQUEST,
            "too_many_crns",
            format!("At most {MAX_SECTION_CRNS} CRNs may be requested."),
        ));
    }
    if values
        .iter()
        .any(|crn| crn.len() != 5 || !crn.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err(ApiError::typed(
            StatusCode::BAD_REQUEST,
            "invalid_crn",
            "Each CRN must contain exactly five digits.",
        ));
    }
    Ok(values.into_iter().map(str::to_owned).collect())
}

async fn sections_by_crn(
    pool: &sqlx::SqlitePool,
    term: &str,
    crns: &[String],
) -> Result<Json<Value>, ApiError> {
    let mut query = QueryBuilder::<Sqlite>::new(SECTION_QUERY);
    query.push(" AND s.term=").push_bind(term);
    query.push(" AND s.crn IN (");
    for (index, crn) in crns.iter().enumerate() {
        if index > 0 {
            query.push(",");
        }
        query.push_bind(crn);
    }
    query.push(") ORDER BY s.subject,s.course,s.section,s.crn");
    let rows: Vec<SectionRow> = query.build_query_as().fetch_all(pool).await?;
    let sections: Vec<Section> = rows.into_iter().map(Section::from).collect();
    Ok(Json(json!({"term":term,"sections":sections})))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn state_with_section() -> AppState {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::db::migrate(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO sections(term,crn,subject,course,section,title,source,updated_at) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(SCHEDULE_BUILDER_TERM)
        .bind("37075")
        .bind("CSCE")
        .bind("482")
        .bind("500")
        .bind("Software Engineering")
        .bind("howdy-public")
        .bind(1_i64)
        .execute(&pool)
        .await
        .unwrap();
        AppState { pool }
    }

    async fn assert_typed_400(result: Result<Json<Value>, ApiError>, expected_code: &str) {
        let error = result.expect_err("expected a typed bad request");
        assert_eq!(error.status, StatusCode::BAD_REQUEST);
        assert_eq!(error.code, Some(expected_code));
        let response = error.into_response();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let value: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["code"], expected_code);
        assert!(value["error"].as_str().is_some());
    }

    #[tokio::test]
    async fn crn_lookup_is_exact_and_returns_empty_for_unknown_crns() {
        let state = state_with_section().await;
        let result = sections(
            State(state.clone()),
            Query(Search {
                term: Some(SCHEDULE_BUILDER_TERM.into()),
                crns: Some("37075,99999".into()),
                ..Search::default()
            }),
        )
        .await
        .unwrap();
        let Json(value) = result;
        assert_eq!(value["term"], SCHEDULE_BUILDER_TERM);
        assert_eq!(value["sections"].as_array().unwrap().len(), 1);
        assert_eq!(value["sections"][0]["crn"], "37075");
        assert_eq!(value["sections"][0]["term"], SCHEDULE_BUILDER_TERM);

        let result = sections(
            State(state),
            Query(Search {
                term: Some(SCHEDULE_BUILDER_TERM.into()),
                crns: Some("99999".into()),
                ..Search::default()
            }),
        )
        .await
        .unwrap();
        let Json(value) = result;
        assert_eq!(value["sections"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn crn_lookup_validates_term_and_batch_size() {
        let state = state_with_section().await;
        assert_typed_400(
            sections(
                State(state.clone()),
                Query(Search {
                    crns: Some("37075".into()),
                    ..Search::default()
                }),
            )
            .await,
            "missing_term",
        )
        .await;
        assert_typed_400(
            sections(
                State(state.clone()),
                Query(Search {
                    term: Some("202611".into()),
                    crns: Some("37075".into()),
                    ..Search::default()
                }),
            )
            .await,
            "unsupported_term",
        )
        .await;
        let crns = (0..=MAX_SECTION_CRNS)
            .map(|number| format!("{number:05}"))
            .collect::<Vec<_>>()
            .join(",");
        assert_typed_400(
            sections(
                State(state),
                Query(Search {
                    term: Some(SCHEDULE_BUILDER_TERM.into()),
                    crns: Some(crns),
                    ..Search::default()
                }),
            )
            .await,
            "too_many_crns",
        )
        .await;
    }

    #[tokio::test]
    async fn q_search_keeps_its_existing_response_contract() {
        let state = state_with_section().await;
        let result = sections(
            State(state),
            Query(Search {
                term: Some(SCHEDULE_BUILDER_TERM.into()),
                q: Some("CSCE 482".into()),
                ..Search::default()
            }),
        )
        .await
        .unwrap();
        let Json(value) = result;
        assert_eq!(value["limit"], 100);
        assert_eq!(value["offset"], 0);
        assert_eq!(value["sections"].as_array().unwrap().len(), 1);
        assert_eq!(value["sections"][0]["crn"], "37075");
    }
}
async fn sections(
    State(state): State<AppState>,
    Query(search): Query<Search>,
) -> Result<Json<Value>, ApiError> {
    if let Some(crns) = search.crns.as_deref() {
        let term = section_lookup_term(search.term.as_deref())?;
        let crns = section_lookup_crns(crns)?;
        return sections_by_crn(&state.pool, &term, &crns).await;
    }
    for (value, max, name) in [
        (search.min_gpa, 4.0, "Minimum GPA"),
        (search.max_gpa, 4.0, "Maximum GPA"),
        (search.min_ab_rate, 100.0, "Minimum A/B rate"),
    ] {
        if value.is_some_and(|value| !value.is_finite() || !(0.0..=max).contains(&value)) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("{name} is outside the valid range."),
            ));
        }
    }
    if search
        .min_gpa
        .zip(search.max_gpa)
        .is_some_and(|(min, max)| min > max)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Minimum GPA cannot exceed maximum GPA.",
        ));
    }
    let starts_after = parse_time_filter(search.starts_after.as_deref())?;
    let ends_before = parse_time_filter(search.ends_before.as_deref())?;
    let day = search
        .day
        .filter(|day| !day.is_empty())
        .map(|day| day.to_ascii_uppercase());
    if day
        .as_ref()
        .is_some_and(|day| !matches!(day.as_str(), "M" | "T" | "W" | "R" | "F" | "S" | "U"))
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Use a valid weekday filter.",
        ));
    }
    let mut query = QueryBuilder::<Sqlite>::new(SECTION_QUERY);
    if let Some(term) = search.term.filter(|term| !term.is_empty()) {
        query.push(" AND s.term=").push_bind(term);
    }
    if let Some(subject) = search.subject.filter(|subject| !subject.is_empty()) {
        query
            .push(" AND s.subject=")
            .push_bind(subject.to_uppercase());
    }
    if let Some(course) = search.course.filter(|course| !course.is_empty()) {
        query.push(" AND s.course=").push_bind(course);
    }
    if let Some(campus) = search.campus.filter(|campus| !campus.is_empty()) {
        query
            .push(" AND s.site LIKE ")
            .push_bind(format!("%{campus}%"));
    }
    if let Some(attribute) = search
        .attribute
        .filter(|attribute| !attribute.trim().is_empty())
    {
        query
            .push(" AND s.attributes LIKE ")
            .push_bind(format!("%{}%", attribute.trim()));
    }
    if let Some(open) = search.open.filter(|open| !open.is_empty()) {
        query
            .push(" AND s.open_flag=")
            .push_bind(open.to_uppercase());
    }
    if day.is_some() || starts_after.is_some() || ends_before.is_some() {
        query.push(" AND EXISTS (SELECT 1 FROM meetings m WHERE m.term=s.term AND m.crn=s.crn");
        if let Some(day) = day {
            query
                .push(" AND m.days LIKE ")
                .push_bind(format!("%{day}%"));
        }
        if let Some(starts_after) = starts_after {
            query
                .push(" AND m.begin_minute IS NOT NULL AND m.begin_minute>=")
                .push_bind(starts_after);
        }
        if let Some(ends_before) = ends_before {
            query
                .push(" AND m.end_minute IS NOT NULL AND m.end_minute<=")
                .push_bind(ends_before);
        }
        query.push(")");
    }
    if let Some(instructor) = search
        .instructor
        .filter(|instructor| !instructor.trim().is_empty())
    {
        query.push(" AND EXISTS (SELECT 1 FROM section_instructors si JOIN instructors i ON i.id=si.instructor_id WHERE si.term=s.term AND si.crn=s.crn AND i.display_name LIKE ")
            .push_bind(format!("%{}%", instructor.trim())).push(")");
    }
    if let Some(q) = search.q.filter(|q| !q.trim().is_empty()) {
        let pattern = format!("%{}%", q.trim());
        query.push(" AND (s.subject || ' ' || s.course LIKE ").push_bind(pattern.clone())
            .push(" OR s.title LIKE ").push_bind(pattern.clone()).push(" OR s.crn LIKE ").push_bind(pattern.clone())
            .push(" OR EXISTS (SELECT 1 FROM section_instructors si JOIN instructors i ON i.id=si.instructor_id WHERE si.term=s.term AND si.crn=s.crn AND i.display_name LIKE ").push_bind(pattern).push("))");
    }
    if let Some(min_gpa) = search.min_gpa {
        query.push(" AND g.average_gpa>=").push_bind(min_gpa);
    }
    if let Some(max_gpa) = search.max_gpa {
        query.push(" AND g.average_gpa<=").push_bind(max_gpa);
    }
    if let Some(min_ab_rate) = search.min_ab_rate {
        query
            .push(" AND g.total_count>0 AND 100.0*g.ab_count/g.total_count>=")
            .push_bind(min_ab_rate);
    }
    if search.grades == Some(true) {
        query.push(" AND EXISTS(SELECT 1 FROM grade_observations g WHERE g.subject=s.subject AND g.course=s.course)");
    }
    let limit = search.limit.unwrap_or(100).clamp(1, 250);
    let offset = search.offset.unwrap_or(0).max(0);
    query
        .push(" ORDER BY s.subject,s.course,s.section,s.crn LIMIT ")
        .push_bind(limit)
        .push(" OFFSET ")
        .push_bind(offset);
    let rows: Vec<SectionRow> = query.build_query_as().fetch_all(&state.pool).await?;
    let sections: Vec<Section> = rows.into_iter().map(Section::from).collect();
    Ok(Json(
        json!({"sections":sections,"limit":limit,"offset":offset}),
    ))
}

async fn grades(
    State(state): State<AppState>,
    Query(search): Query<Search>,
) -> Result<Json<Value>, ApiError> {
    let subject = search.subject.unwrap_or_default().to_uppercase();
    let course = search.course.unwrap_or_default();
    let instructor = search.instructor.unwrap_or_default();
    let rows = fetch_grade_rows(&state.pool, &subject, &course, &instructor).await?;
    Ok(Json(json!({"grades":rows})))
}

async fn fetch_grade_rows(
    pool: &sqlx::SqlitePool,
    subject: &str,
    course: &str,
    instructor: &str,
) -> Result<Vec<GradeRow>, sqlx::Error> {
    sqlx::query_as(
        "SELECT subject,course,section,instructor,year,semester,gpa,grade_a,grade_b,grade_c,grade_d,grade_f,grade_q,source,fetched_at FROM (SELECT g.*,ROW_NUMBER() OVER (PARTITION BY g.subject,g.course,CASE WHEN trim(g.section)='' OR trim(g.instructor)='' THEN 'id:'||g.id ELSE upper(trim(g.section))||'|'||upper(trim(g.instructor)) END,g.year,g.semester ORDER BY CASE WHEN g.source IN ('registrar-pdf','registrar-csv') THEN 0 ELSE 1 END,g.fetched_at DESC,g.id DESC) AS source_rank FROM grade_observations g WHERE (?='' OR g.subject=?) AND (?='' OR g.course=?) AND (?='' OR g.instructor=? COLLATE NOCASE)) ranked_grades WHERE source_rank=1 ORDER BY CAST(year AS INTEGER) DESC,CASE upper(semester) WHEN 'FALL' THEN 3 WHEN 'SUMMER' THEN 2 WHEN 'SPRING' THEN 1 ELSE 0 END DESC,instructor,section LIMIT 1000",
    )
    .bind(subject)
    .bind(subject)
    .bind(course)
    .bind(course)
    .bind(instructor)
    .bind(instructor)
    .fetch_all(pool)
    .await
}

fn professor_match_key(name: &str, grade_name: bool) -> Option<String> {
    let name = name.split('(').next().unwrap_or(name);
    let parts: Vec<String> = name
        .split(|character: char| !character.is_alphanumeric())
        .filter(|part| !part.is_empty())
        .map(str::to_ascii_uppercase)
        .collect();
    if grade_name {
        let [surname, first, ..] = parts.as_slice() else {
            return None;
        };
        Some(format!("{surname} {}", first.chars().next()?))
    } else {
        let first = parts.first()?;
        let surname = parts.last()?;
        Some(format!("{surname} {}", first.chars().next()?))
    }
}

async fn professor_directory(
    pool: &sqlx::SqlitePool,
    term: &str,
) -> Result<Vec<ProfessorInfo>, sqlx::Error> {
    let bases: Vec<ProfessorBase> = sqlx::query_as(
        "SELECT i.display_name AS name,COUNT(DISTINCT si.crn) AS sections,COALESCE(GROUP_CONCAT(DISTINCT s.subject||' '||s.course),'') AS courses FROM instructors i JOIN section_instructors si ON si.instructor_id=i.id JOIN sections s ON s.term=si.term AND s.crn=si.crn WHERE s.term=? GROUP BY i.id ORDER BY i.display_name",
    )
    .bind(term)
    .fetch_all(pool)
    .await?;
    let grade_names: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT instructor FROM grade_observations WHERE trim(instructor)<>'' ORDER BY instructor",
    )
    .fetch_all(pool)
    .await?;

    let mut active_by_key = std::collections::HashMap::<String, usize>::new();
    for base in &bases {
        if let Some(key) = professor_match_key(&base.name, false) {
            *active_by_key.entry(key).or_default() += 1;
        }
    }
    let mut history_by_key = std::collections::HashMap::<String, Vec<String>>::new();
    for grade_name in grade_names {
        if let Some(key) = professor_match_key(&grade_name, true) {
            history_by_key.entry(key).or_default().push(grade_name);
        }
    }
    Ok(bases
        .into_iter()
        .map(|base| {
            let candidate_names = professor_match_key(&base.name, false)
                .and_then(|key| history_by_key.get(&key).cloned())
                .unwrap_or_default();
            let active_matches = professor_match_key(&base.name, false)
                .and_then(|key| active_by_key.get(&key).copied())
                .unwrap_or_default();
            let match_confidence = if candidate_names.len() == 1 && active_matches == 1 {
                "high"
            } else if candidate_names.is_empty() {
                "unmatched"
            } else {
                "ambiguous"
            };
            ProfessorInfo {
                name: base.name,
                sections: base.sections,
                courses: base.courses,
                candidate_names,
                match_confidence: match_confidence.into(),
            }
        })
        .collect())
}

async fn professors(
    State(state): State<AppState>,
    Query(search): Query<ProfessorSearch>,
) -> Result<Json<Value>, ApiError> {
    let term = match search.term.filter(|term| !term.is_empty()) {
        Some(term) => term,
        None => {
            sqlx::query_scalar("SELECT COALESCE(MAX(term),'') FROM terms")
                .fetch_one(&state.pool)
                .await?
        }
    };
    let query = search.q.unwrap_or_default().trim().to_lowercase();
    let directory = professor_directory(&state.pool, &term).await?;
    let total = directory
        .iter()
        .filter(|professor| professor.name.to_lowercase().contains(&query))
        .count();
    let professors: Vec<_> = directory
        .into_iter()
        .filter(|professor| professor.name.to_lowercase().contains(&query))
        .take(100)
        .collect();
    Ok(Json(
        json!({"term":term,"total":total,"professors":professors}),
    ))
}

async fn professor(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Query(search): Query<ProfessorSearch>,
) -> Result<Json<Value>, ApiError> {
    let term = match search.term.filter(|term| !term.is_empty()) {
        Some(term) => term,
        None => {
            sqlx::query_scalar("SELECT COALESCE(MAX(term),'') FROM terms")
                .fetch_one(&state.pool)
                .await?
        }
    };
    let professor = professor_directory(&state.pool, &term)
        .await?
        .into_iter()
        .find(|professor| professor.name == name)
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Professor is not in this term."))?;
    let manual_name = search
        .grade_name
        .filter(|grade_name| !grade_name.trim().is_empty());
    let grade_name = manual_name.clone().or_else(|| {
        (professor.match_confidence == "high")
            .then(|| professor.candidate_names.first().cloned())
            .flatten()
    });
    let grades = match grade_name.as_deref() {
        Some(grade_name) => fetch_grade_rows(&state.pool, "", "", grade_name).await?,
        None => Vec::new(),
    };
    let match_confidence = if manual_name.is_some() {
        "manual"
    } else {
        professor.match_confidence.as_str()
    };
    Ok(Json(json!({
        "term":term,
        "name":professor.name,
        "sections":professor.sections,
        "courses":professor.courses,
        "candidate_names":professor.candidate_names,
        "match_confidence":match_confidence,
        "grade_name":grade_name,
        "grades":grades
    })))
}

async fn grade_instructors(
    State(state): State<AppState>,
    Query(search): Query<GradeInstructorSearch>,
) -> Result<Json<Value>, ApiError> {
    let query = search.q.unwrap_or_default().trim().to_owned();
    let pattern = format!("%{query}%");
    let rows: Vec<GradeInstructor> = sqlx::query_as(
        "SELECT instructor,COUNT(*) AS records FROM grade_observations WHERE trim(instructor)<>'' AND (?='' OR instructor LIKE ? COLLATE NOCASE) GROUP BY instructor ORDER BY records DESC,instructor LIMIT 50",
    )
    .bind(&query)
    .bind(pattern)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(json!({"instructors":rows})))
}

async fn refresh_sections(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let result = ingest::refresh_howdy(&state.pool).await.map_err(|error| {
        let message = error.to_string();
        let status = if message.contains("six-hour refresh window") {
            StatusCode::TOO_MANY_REQUESTS
        } else {
            StatusCode::BAD_GATEWAY
        };
        ApiError::new(status, message)
    })?;
    Ok(Json(json!(result)))
}
async fn refresh_grades(
    State(state): State<AppState>,
    Path((subject, course)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    if subject.len() > 8
        || !subject.chars().all(|c| c.is_ascii_alphabetic())
        || course.len() > 6
        || !course.chars().all(|c| c.is_ascii_alphanumeric())
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Use a valid subject and course number.",
        ));
    }
    let count = ingest::fetch_anex(&state.pool, &subject.to_uppercase(), &course)
        .await
        .map_err(|e| ApiError::new(StatusCode::BAD_GATEWAY, e))?;
    Ok(Json(
        json!({"subject":subject.to_uppercase(),"course":course,"rows":count,"source":"anex"}),
    ))
}
