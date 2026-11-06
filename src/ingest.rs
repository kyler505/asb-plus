use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use std::{
    fs::File,
    io::BufReader,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

const HOWDY_URL: &str = "https://howdyportal.tamu.edu/api/course-sections";
const HOWDY_MIN_INTERVAL: i64 = 6 * 60 * 60;

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
fn field<'a>(row: &'a Value, key: &str) -> Option<&'a str> {
    row.get(key).and_then(Value::as_str)
}
fn val(row: &Value, key: &str) -> Option<String> {
    row.get(key).and_then(|v| match v {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    })
}
fn number(row: &Value, key: &str) -> Option<f64> {
    row.get(key)
        .and_then(|v| v.as_f64().or_else(|| v.as_str()?.parse().ok()))
}
fn valid_seat(s: Option<String>) -> Option<String> {
    s.filter(|x| !x.eq_ignore_ascii_case("NA") && !x.trim().is_empty())
}
fn time_minutes(value: Option<&str>) -> Option<i64> {
    let value = value?.trim();
    let mut parts = value.split_ascii_whitespace();
    let clock = parts.next()?;
    let suffix = parts.next();
    if parts.next().is_some() {
        return None;
    }
    let (hour, minute) = clock.split_once(':')?;
    let hour: i64 = hour.parse().ok()?;
    let minute: i64 = minute.parse().ok()?;
    if minute > 59 {
        return None;
    }
    let hour = match suffix {
        Some(suffix) if suffix.eq_ignore_ascii_case("AM") && (1..=12).contains(&hour) => hour % 12,
        Some(suffix) if suffix.eq_ignore_ascii_case("PM") && (1..=12).contains(&hour) => {
            hour % 12 + 12
        }
        None if hour <= 23 => hour,
        _ => return None,
    };
    Some(hour * 60 + minute)
}

#[derive(Debug, serde::Serialize)]
pub struct ImportResult {
    pub source: String,
    pub count: usize,
    pub skipped: bool,
}

pub async fn import_sections_file(pool: &SqlitePool, path: &str) -> Result<ImportResult> {
    let file = File::open(path).with_context(|| format!("open section file {path}"))?;
    let value: Value = serde_json::from_reader(BufReader::new(file))?;
    import_sections_value(pool, value, "local-json").await
}

pub async fn refresh_howdy(pool: &SqlitePool) -> Result<ImportResult> {
    let last = crate::db::last_run(pool, "howdy-public", "202711")
        .await?
        .unwrap_or(0);
    let elapsed = now() - last;
    if last > 0 && elapsed < HOWDY_MIN_INTERVAL {
        bail!(
            "Public Howdy data was refreshed {} minutes ago. Try again after the six-hour refresh window.",
            elapsed / 60
        );
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()?;
    let value: Value = client
        .post(HOWDY_URL)
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&json!({"startRow":0,"endRow":0,"termCode":"202711","publicSearch":"Y"}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    import_sections_value(pool, value, "howdy-public").await
}

async fn import_sections_value(
    pool: &SqlitePool,
    value: Value,
    source: &str,
) -> Result<ImportResult> {
    let rows = value
        .as_array()
        .context("section source must be a JSON array")?;
    let mut tx = pool.begin().await?;
    let mut count = 0usize;
    let mut known_terms = std::collections::HashSet::new();
    let mut known_courses = std::collections::HashSet::new();
    let mut instructor_ids = std::collections::HashMap::new();
    for row in rows {
        let crn = match field(row, "SWV_CLASS_SEARCH_CRN") {
            Some(v) if !v.is_empty() => v,
            _ => continue,
        };
        let term = val(row, "SWV_CLASS_SEARCH_TERM").unwrap_or_else(|| "202711".into());
        let subject = val(row, "SWV_CLASS_SEARCH_SUBJECT").unwrap_or_default();
        let course = val(row, "SWV_CLASS_SEARCH_COURSE").unwrap_or_default();
        let title = val(row, "SWV_CLASS_SEARCH_TITLE").unwrap_or_default();
        let hours = number(row, "SWV_CLASS_SEARCH_SSBSECT_HOURS")
            .or_else(|| number(row, "HRS_COLUMN_FIELD"));
        let raw_meetings: Value = field(row, "SWV_CLASS_SEARCH_JSON_CLOB")
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(json!([]));
        let mut meetings_json = Vec::new();
        if let Some(items) = raw_meetings.as_array() {
            for meeting in items {
                let days = [
                    ("MON", "M"),
                    ("TUE", "T"),
                    ("WED", "W"),
                    ("THU", "R"),
                    ("FRI", "F"),
                    ("SAT", "S"),
                    ("SUN", "U"),
                ]
                .iter()
                .filter_map(|(day, code)| {
                    meeting
                        .get(format!("SSRMEET_{day}_DAY"))
                        .is_some_and(|v| !v.is_null())
                        .then_some(*code)
                })
                .collect::<String>();
                meetings_json.push(json!({
                    "days": days, "begin": val(meeting,"SSRMEET_BEGIN_TIME"),
                    "end": val(meeting,"SSRMEET_END_TIME"), "building": val(meeting,"SSRMEET_BLDG_CODE"),
                    "room": val(meeting,"SSRMEET_ROOM_CODE"), "type": val(meeting,"SSRMEET_MTYP_CODE")
                }));
            }
        }
        let raw_instructors: Value = field(row, "SWV_CLASS_SEARCH_INSTRCTR_JSON")
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(json!([]));
        let instructor_names: Vec<String> = raw_instructors
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|item| {
                field(item, "NAME")
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned)
            })
            .collect();
        let meetings_text = serde_json::to_string(&meetings_json)?;
        let instructors_text = serde_json::to_string(&instructor_names)?;
        if known_terms.insert(term.clone()) {
            sqlx::query("INSERT INTO terms(term,label) VALUES(?,?) ON CONFLICT(term) DO UPDATE SET label=excluded.label")
                .bind(&term).bind(if term == "202711" { "Spring 2027" } else { "" }).execute(&mut *tx).await?;
        }
        if known_courses.insert((term.clone(), subject.clone(), course.clone())) {
            sqlx::query("INSERT INTO courses(term,subject,course,title,hours) VALUES(?,?,?,?,?) ON CONFLICT(term,subject,course) DO UPDATE SET title=excluded.title,hours=excluded.hours")
                .bind(&term).bind(&subject).bind(&course).bind(&title).bind(hours).execute(&mut *tx).await?;
        }
        sqlx::query("INSERT INTO sections(crn,term,subject,course,section,title,site,campus,schedule_type,instruction_type,attributes,open_flag,seats,capacity,enrolled,wait_capacity,wait_count,wait_available,hours,instructors_json,meetings_json,source,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch()) ON CONFLICT(term,crn) DO UPDATE SET subject=excluded.subject,course=excluded.course,section=excluded.section,title=excluded.title,site=excluded.site,campus=excluded.campus,schedule_type=excluded.schedule_type,instruction_type=excluded.instruction_type,attributes=excluded.attributes,open_flag=excluded.open_flag,seats=excluded.seats,capacity=excluded.capacity,enrolled=excluded.enrolled,wait_capacity=excluded.wait_capacity,wait_count=excluded.wait_count,wait_available=excluded.wait_available,hours=excluded.hours,instructors_json=excluded.instructors_json,meetings_json=excluded.meetings_json,source=excluded.source,updated_at=unixepoch()")
            .bind(crn).bind(&term).bind(&subject).bind(&course).bind(val(row,"SWV_CLASS_SEARCH_SECTION").unwrap_or_default()).bind(&title)
            .bind(val(row,"SWV_CLASS_SEARCH_SITE").unwrap_or_default()).bind(val(row,"SWV_CLASS_SEARCH_SITE").unwrap_or_default())
            .bind(val(row,"SWV_CLASS_SEARCH_SCHD").unwrap_or_default()).bind(val(row,"SWV_CLASS_SEARCH_INST_TYPE").unwrap_or_default())
            .bind(val(row,"SWV_CLASS_SEARCH_ATTRIBUTES").unwrap_or_default()).bind(val(row,"STUSEAT_OPEN").unwrap_or_else(|| "Unknown".into()))
            .bind(valid_seat(val(row,"SWV_CLASS_SEARCH_SEATS_AVAIL"))).bind(valid_seat(val(row,"SWV_CLASS_SEARCH_MAX_ENRL")))
            .bind(valid_seat(val(row,"SWV_CLASS_SEARCH_ENRL"))).bind(valid_seat(val(row,"SWV_WAIT_CAPACITY")))
            .bind(valid_seat(val(row,"SWV_WAIT_COUNT"))).bind(valid_seat(val(row,"SWV_WAIT_AVAIL"))).bind(hours)
            .bind(instructors_text).bind(meetings_text).bind(source).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM meetings WHERE term=? AND crn=?")
            .bind(&term)
            .bind(crn)
            .execute(&mut *tx)
            .await?;
        for meeting in &meetings_json {
            let begin = meeting["begin"].as_str();
            let end = meeting["end"].as_str();
            sqlx::query("INSERT INTO meetings(term,crn,days,begin_time,end_time,begin_minute,end_minute,building,room,meeting_type) VALUES(?,?,?,?,?,?,?,?,?,?)")
                .bind(&term).bind(crn).bind(meeting["days"].as_str().unwrap_or(""))
                .bind(begin).bind(end).bind(time_minutes(begin)).bind(time_minutes(end))
                .bind(meeting["building"].as_str()).bind(meeting["room"].as_str()).bind(meeting["type"].as_str())
                .execute(&mut *tx).await?;
        }
        sqlx::query("DELETE FROM section_instructors WHERE term=? AND crn=?")
            .bind(&term)
            .bind(crn)
            .execute(&mut *tx)
            .await?;
        for name in &instructor_names {
            let id = if let Some(id) = instructor_ids.get(name) {
                *id
            } else {
                sqlx::query("INSERT INTO instructors(display_name) VALUES(?) ON CONFLICT(display_name) DO NOTHING")
                    .bind(name).execute(&mut *tx).await?;
                let id: i64 = sqlx::query_scalar("SELECT id FROM instructors WHERE display_name=?")
                    .bind(name)
                    .fetch_one(&mut *tx)
                    .await?;
                instructor_ids.insert(name.clone(), id);
                id
            };
            sqlx::query("INSERT INTO section_instructors(term,crn,instructor_id) VALUES(?,?,?) ON CONFLICT DO NOTHING").bind(&term).bind(crn).bind(id).execute(&mut *tx).await?;
        }
        count += 1;
    }
    tx.commit().await?;
    crate::db::record_run(pool, source, "202711", count as i64).await?;
    Ok(ImportResult {
        source: source.into(),
        count,
        skipped: false,
    })
}

fn normalized_key(key: &str) -> String {
    key.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}
fn find_value<'a>(row: &'a Value, names: &[&str]) -> Option<&'a Value> {
    let object = row.as_object()?;
    object
        .iter()
        .find(|(key, _)| {
            names
                .iter()
                .any(|name| normalized_key(key) == normalized_key(name))
        })
        .map(|(_, value)| value)
}
fn string_value(row: &Value, names: &[&str]) -> String {
    find_value(row, names)
        .and_then(|v| match v {
            Value::String(s) => Some(s.clone()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        })
        .unwrap_or_default()
}
fn numeric_value(row: &Value, names: &[&str]) -> Option<f64> {
    find_value(row, names).and_then(|v| v.as_f64().or_else(|| v.as_str()?.parse().ok()))
}
fn grade_rows(value: &Value) -> Option<Vec<Value>> {
    if let Some(rows) = value.as_array() {
        return Some(rows.clone());
    }
    let object = value.as_object()?;
    for key in ["data", "grades", "results", "rows", "sections", "classes"] {
        if let Some(value) = object
            .iter()
            .find(|(k, _)| normalized_key(k) == key)
            .map(|(_, v)| v)
        {
            if let Some(rows) = grade_rows(value) {
                return Some(rows);
            }
        }
    }
    None
}

async fn replace_grade_rows(
    pool: &SqlitePool,
    subject: &str,
    course: &str,
    source: &str,
    rows: &[Value],
) -> Result<usize> {
    if rows.is_empty() {
        bail!("Grade source returned no rows; existing data was kept");
    }
    let first_period = rows.first().map(|row| {
        (
            string_value(row, &["year", "academicYear"]),
            string_value(row, &["semester", "term", "season"]),
        )
    });
    let period = first_period.and_then(|(year, semester)| {
        (!year.is_empty()
            && !semester.is_empty()
            && rows.iter().all(|row| {
                string_value(row, &["year", "academicYear"]) == year
                    && string_value(row, &["semester", "term", "season"]) == semester
            }))
        .then_some((year, semester))
    });
    let mut tx = pool.begin().await?;
    if let Some((year, semester)) = period {
        sqlx::query("DELETE FROM grade_observations WHERE subject=? AND course=? AND source=? AND year=? AND semester=?")
            .bind(subject).bind(course).bind(source).bind(year).bind(semester)
            .execute(&mut *tx).await?;
    } else {
        sqlx::query("DELETE FROM grade_observations WHERE subject=? AND course=? AND source=?")
            .bind(subject)
            .bind(course)
            .bind(source)
            .execute(&mut *tx)
            .await?;
    }
    for row in rows {
        let raw = row.to_string();
        let gpa = numeric_value(row, &["gpa", "avgGpa", "averageGpa", "gpaAverage"]);
        let values = [
            string_value(row, &["a", "gradeA", "aCount", "countA", "aGrades"]),
            string_value(row, &["b", "gradeB", "bCount", "countB", "bGrades"]),
            string_value(row, &["c", "gradeC", "cCount", "countC", "cGrades"]),
            string_value(row, &["d", "gradeD", "dCount", "countD", "dGrades"]),
            string_value(row, &["f", "gradeF", "fCount", "countF", "fGrades"]),
            string_value(row, &["q", "gradeQ", "qCount", "countQ", "qGrades"]),
        ]
        .map(|value| (!value.is_empty()).then_some(value));
        sqlx::query("INSERT INTO grade_observations(subject,course,section,instructor,year,semester,gpa,grade_a,grade_b,grade_c,grade_d,grade_f,grade_q,source,fetched_at,data_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch(),?)")
            .bind(subject).bind(course).bind(string_value(row,&["section","sec","crn"]))
            .bind(string_value(row,&["professor","professorName","instructor","instructorName","prof","name"]))
            .bind(string_value(row,&["year","academicYear"])).bind(string_value(row,&["semester","term","season"]))
            .bind(gpa).bind(values[0].as_deref()).bind(values[1].as_deref()).bind(values[2].as_deref()).bind(values[3].as_deref()).bind(values[4].as_deref()).bind(values[5].as_deref()).bind(source).bind(raw)
            .execute(&mut *tx).await?;
    }
    tx.commit().await?;
    crate::db::record_run(
        pool,
        source,
        &format!("{subject}{course}"),
        rows.len() as i64,
    )
    .await?;
    Ok(rows.len())
}

pub async fn fetch_anex(pool: &SqlitePool, subject: &str, course: &str) -> Result<usize> {
    let cache_key = format!("{subject}{course}");
    if crate::db::last_run(pool, "anex", &cache_key)
        .await?
        .is_some_and(|last| now() - last < 24 * 60 * 60)
    {
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM grade_observations WHERE subject=? AND course=? AND source='anex'")
            .bind(subject).bind(course).fetch_one(pool).await?;
        if count > 0 {
            return Ok(count as usize);
        }
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()?;
    let response: Value = client
        .post("https://anex.us/grades/getData/")
        .form(&[("dept", subject), ("number", course)])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let rows =
        grade_rows(&response).context("anex returned an unsupported grade response format")?;
    replace_grade_rows(pool, subject, course, "anex", &rows).await
}

pub async fn import_grade_csv(pool: &SqlitePool, path: &str) -> Result<usize> {
    let mut reader = csv::Reader::from_path(path)?;
    let headers = reader.headers()?.clone();
    let mut groups: std::collections::HashMap<(String, String), Vec<Value>> =
        std::collections::HashMap::new();
    for record in reader.records() {
        let record = record?;
        let object: serde_json::Map<String, Value> = headers
            .iter()
            .zip(record.iter())
            .map(|(k, v)| (k.to_owned(), Value::String(v.to_owned())))
            .collect();
        let row = Value::Object(object);
        let subject = string_value(
            &row,
            &[
                "subject",
                "subjectCode",
                "subjectArea",
                "dept",
                "department",
                "departmentCode",
            ],
        )
        .trim()
        .to_ascii_uppercase();
        let course = string_value(
            &row,
            &[
                "course",
                "number",
                "courseNumber",
                "courseCode",
                "catalogNumber",
            ],
        )
        .trim()
        .to_owned();
        if !subject.is_empty() && !course.is_empty() {
            groups.entry((subject, course)).or_default().push(row);
        }
    }
    if groups.is_empty() {
        bail!("No grade rows with subject and course columns were found");
    }
    let mut total = 0;
    for ((subject, course), rows) in groups {
        total += replace_grade_rows(pool, &subject, &course, "registrar-csv", &rows).await?;
    }
    Ok(total)
}

pub async fn import_grade_file(pool: &SqlitePool, path: &str) -> Result<usize> {
    match std::path::Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("csv") => import_grade_csv(pool, path).await,
        Some("pdf") => import_grade_pdf(pool, path).await,
        _ => bail!("Use a Registrar .pdf or .csv grade report"),
    }
}

async fn import_grade_pdf(pool: &SqlitePool, path: &str) -> Result<usize> {
    let output = Command::new("pdftotext")
        .arg("-layout")
        .arg("-nopgbrk")
        .arg(path)
        .arg("-")
        .output()
        .with_context(|| "run pdftotext to import this PDF; install Poppler or use a CSV")?;
    if !output.status.success() {
        bail!(
            "pdftotext could not read the report: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let text = String::from_utf8(output.stdout).context("pdftotext returned non-UTF-8 text")?;
    let (semester, year) = grade_report_period(&text)?;
    let mut groups: std::collections::HashMap<(String, String), Vec<Value>> =
        std::collections::HashMap::new();
    for line in text.lines() {
        if let Some((subject, course, row)) = grade_report_row(line, &semester, &year) {
            groups.entry((subject, course)).or_default().push(row);
        }
    }
    if groups.is_empty() {
        bail!("No section grade rows were found in this Registrar PDF");
    }
    let mut total = 0;
    for ((subject, course), rows) in groups {
        total += replace_grade_rows(pool, &subject, &course, "registrar-pdf", &rows).await?;
    }
    Ok(total)
}

fn grade_report_period(text: &str) -> Result<(String, String)> {
    text.lines()
        .find_map(|line| {
            let line = line.to_ascii_uppercase();
            let period = line.split_once("GRADE DISTRIBUTION REPORT FOR ")?.1;
            let mut parts = period.split_whitespace();
            let semester = parts.next()?;
            let year = parts.next()?;
            (matches!(semester, "SPRING" | "SUMMER" | "FALL")
                && year.len() == 4
                && year.parse::<u16>().is_ok())
            .then(|| (semester.to_owned(), year.to_owned()))
        })
        .context("PDF does not contain a TAMU grade distribution report title")
}

fn grade_report_row(line: &str, semester: &str, year: &str) -> Option<(String, String, Value)> {
    let mut fields = line.split_whitespace();
    let section_code = fields.next()?;
    let mut parts = section_code.split('-');
    let subject = parts.next()?;
    let course = parts.next()?;
    let section = parts.next()?;
    if parts.next().is_some()
        || !(2..=8).contains(&subject.len())
        || !subject
            .chars()
            .all(|character| character.is_ascii_alphabetic())
        || course.is_empty()
        || !course
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
        || section.is_empty()
        || !section
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
    {
        return None;
    }
    let values: Vec<&str> = fields.collect();
    if values.len() < 13 {
        return None;
    }
    let count = |index: usize| {
        values[index]
            .parse::<u64>()
            .ok()
            .map(|value| value.to_string())
    };
    let grade_a = count(0)?;
    let grade_b = count(1)?;
    let grade_c = count(2)?;
    let grade_d = count(3)?;
    let grade_f = count(4)?;
    let gpa = values[6].parse::<f64>().ok()?;
    let grade_q = count(10)?;
    if !gpa.is_finite() || !(0.0..=4.0).contains(&gpa) {
        return None;
    }
    let instructor = values[13..].join(" ");
    Some((
        subject.to_ascii_uppercase(),
        course.to_owned(),
        json!({
            "section": section,
            "instructor": instructor,
            "year": year,
            "semester": semester,
            "gpa": gpa,
            "a": grade_a,
            "b": grade_b,
            "c": grade_c,
            "d": grade_d,
            "f": grade_f,
            "q": grade_q
        }),
    ))
}
