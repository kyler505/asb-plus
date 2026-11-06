use anyhow::Result;
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use std::{path::Path, str::FromStr};

pub async fn open(path: &str) -> Result<SqlitePool> {
    if let Some(parent) = Path::new(path).parent() {
        std::fs::create_dir_all(parent)?;
    }
    let options = SqliteConnectOptions::from_str(&format!("sqlite:{path}"))?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true);
    Ok(SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?)
}

pub async fn migrate(pool: &SqlitePool) -> Result<()> {
    sqlx::query("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (unixepoch()))")
        .execute(pool).await?;
    let version: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(version),0) FROM schema_migrations")
        .fetch_one(pool)
        .await?;
    if version >= 1 {
        return Ok(());
    }
    let statements = [
        "CREATE TABLE terms (term TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT '')",
        "CREATE TABLE courses (term TEXT NOT NULL, subject TEXT NOT NULL, course TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', hours REAL, PRIMARY KEY(term, subject, course))",
        "CREATE TABLE sections (term TEXT NOT NULL, crn TEXT NOT NULL, subject TEXT NOT NULL, course TEXT NOT NULL, section TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', site TEXT NOT NULL DEFAULT '', campus TEXT NOT NULL DEFAULT '', schedule_type TEXT NOT NULL DEFAULT '', instruction_type TEXT NOT NULL DEFAULT '', attributes TEXT NOT NULL DEFAULT '', open_flag TEXT NOT NULL DEFAULT 'Unknown', seats TEXT, capacity TEXT, enrolled TEXT, wait_capacity TEXT, wait_count TEXT, wait_available TEXT, hours REAL, instructors_json TEXT NOT NULL DEFAULT '[]', meetings_json TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(term,crn))",
        "CREATE TABLE meetings (id INTEGER PRIMARY KEY AUTOINCREMENT, term TEXT NOT NULL, crn TEXT NOT NULL, days TEXT NOT NULL DEFAULT '', begin_time TEXT, end_time TEXT, begin_minute INTEGER, end_minute INTEGER, building TEXT, room TEXT, meeting_type TEXT, FOREIGN KEY(term,crn) REFERENCES sections(term,crn) ON DELETE CASCADE)",
        "CREATE TABLE instructors (id INTEGER PRIMARY KEY AUTOINCREMENT, display_name TEXT NOT NULL UNIQUE)",
        "CREATE TABLE section_instructors (term TEXT NOT NULL, crn TEXT NOT NULL, instructor_id INTEGER NOT NULL REFERENCES instructors(id), PRIMARY KEY(term,crn,instructor_id), FOREIGN KEY(term,crn) REFERENCES sections(term,crn) ON DELETE CASCADE)",
        "CREATE TABLE grade_observations (id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL, course TEXT NOT NULL, section TEXT NOT NULL DEFAULT '', instructor TEXT NOT NULL DEFAULT '', year TEXT NOT NULL DEFAULT '', semester TEXT NOT NULL DEFAULT '', gpa REAL, grade_a TEXT, grade_b TEXT, grade_c TEXT, grade_d TEXT, grade_f TEXT, grade_q TEXT, source TEXT NOT NULL, fetched_at INTEGER NOT NULL, data_json TEXT NOT NULL)",
        "CREATE TABLE source_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, term TEXT NOT NULL DEFAULT '', item_count INTEGER NOT NULL, fetched_at INTEGER NOT NULL)",
        "CREATE INDEX idx_sections_term_course ON sections(term, subject, course)",
        "CREATE INDEX idx_sections_term_site ON sections(term, site)",
        "CREATE INDEX idx_meetings_term_crn ON meetings(term,crn)",
        "CREATE INDEX idx_section_instructors_instructor ON section_instructors(instructor_id)",
        "CREATE INDEX idx_grades_course ON grade_observations(subject, course, year, semester)",
    ];
    let mut tx = pool.begin().await?;
    for statement in statements {
        sqlx::query(statement).execute(&mut *tx).await?;
    }
    sqlx::query("INSERT INTO schema_migrations(version) VALUES(1)")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn section_count(pool: &SqlitePool) -> Result<i64> {
    Ok(sqlx::query_scalar("SELECT count(*) FROM sections")
        .fetch_one(pool)
        .await?)
}

pub async fn last_run(pool: &SqlitePool, source: &str, term: &str) -> Result<Option<i64>> {
    Ok(
        sqlx::query_scalar("SELECT max(fetched_at) FROM source_runs WHERE source = ? AND term = ?")
            .bind(source)
            .bind(term)
            .fetch_one(pool)
            .await?,
    )
}

pub async fn record_run(
    pool: &SqlitePool,
    source: &str,
    term: &str,
    item_count: i64,
) -> Result<()> {
    sqlx::query("INSERT INTO source_runs(source, term, item_count, fetched_at) VALUES(?, ?, ?, unixepoch())")
        .bind(source).bind(term).bind(item_count).execute(pool).await?;
    Ok(())
}
