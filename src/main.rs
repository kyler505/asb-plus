mod db;
mod ingest;
mod routes;

use anyhow::{Context, Result};
use std::path::Path;

#[tokio::main]
async fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let command = args.next();
    let pool = db::open(&std::env::var("ASB_DB_PATH").unwrap_or_else(|_| "data/asb.sqlite".into()))
        .await?;
    db::migrate(&pool).await?;
    match command.as_deref() {
        Some("import-sections") => {
            let path = args
                .next()
                .context("usage: asb-plus import-sections <sections.json>")?;
            let result = ingest::import_sections_file(&pool, &path).await?;
            println!("Imported {} sections from {}", result.count, result.source);
            return Ok(());
        }
        Some("refresh-howdy") => {
            let result = ingest::refresh_howdy(&pool).await?;
            println!("Imported {} sections from {}", result.count, result.source);
            return Ok(());
        }
        Some("import-grades") => {
            let path = args
                .next()
                .context("usage: asb-plus import-grades <registrar-report.pdf|csv>")?;
            let count = ingest::import_grade_file(&pool, &path).await?;
            println!("Imported {count} grade rows from Registrar report");
            return Ok(());
        }
        Some(other) => anyhow::bail!(
            "Unknown command: {other}. Use import-sections, refresh-howdy, import-grades, or run without a command."
        ),
        None => {}
    }
    if db::section_count(&pool).await? == 0 && Path::new("data/s27.json").is_file() {
        match ingest::import_sections_file(&pool, "data/s27.json").await {
            Ok(result) => println!("Loaded {} local sections", result.count),
            Err(error) => eprintln!("Local section import failed: {error:#}"),
        }
    }
    let sections = db::section_count(&pool).await?;
    println!("ASB+ indexed {sections} sections; open http://127.0.0.1:8000");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:8000").await?;
    axum::serve(listener, routes::router(routes::AppState { pool })).await?;
    Ok(())
}
