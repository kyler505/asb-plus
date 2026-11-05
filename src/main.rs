use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs::File,
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    sync::Arc,
    thread,
    time::Instant,
};

const PLAN: [(&str, &str, &[&str]); 6] = [
    ("CSCE", "412", &["58352"]),
    ("CSCE", "435", &["38149"]),
    ("CSCE", "482", &["37075", "37076"]),
    ("MGMT", "309", &["21667", "21668"]),
    ("MKTG", "409", &["35580", "35581"]),
    ("CSCE", "399", &["39488"]),
];
const DAYS: [(&str, &str); 7] = [
    ("MON", "M"),
    ("TUE", "T"),
    ("WED", "W"),
    ("THU", "R"),
    ("FRI", "F"),
    ("SAT", "S"),
    ("SUN", "U"),
];

fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}
fn nonempty(v: &str, fallback: &str) -> String {
    if v.is_empty() {
        fallback.into()
    } else {
        v.into()
    }
}
fn load_data() -> Result<Value, Box<dyn std::error::Error>> {
    let start = Instant::now();
    let file = File::open("data/s27.json")?;
    let rows: Value = serde_json::from_reader(BufReader::new(file))?;
    let mut indexed: HashMap<String, Vec<Value>> = HashMap::new();
    for row in rows.as_array().into_iter().flatten() {
        let key = format!(
            "{} {}",
            text(&row, "SWV_CLASS_SEARCH_SUBJECT"),
            text(&row, "SWV_CLASS_SEARCH_COURSE")
        );
        if PLAN
            .iter()
            .any(|(subject, course, _)| key == format!("{subject} {course}"))
        {
            indexed.entry(key).or_default().push(row.clone());
        }
    }
    let watch: Value = serde_json::from_reader(File::open("data/s27_watch_state.json")?)?;
    let mut groups = Vec::new();
    for (subject, course, preferred) in PLAN {
        let name = format!("{subject} {course}");
        let mut sections = Vec::new();
        for row in indexed.get(&name).into_iter().flatten() {
            let crn = text(row, "SWV_CLASS_SEARCH_CRN");
            let raw_times: Value =
                serde_json::from_str(text(row, "SWV_CLASS_SEARCH_JSON_CLOB")).unwrap_or(json!([]));
            let times: Vec<Value> = raw_times.as_array().into_iter().flatten().map(|m| {
                let day_names = DAYS.iter().filter_map(|(field, code)| if !m.get(format!("SSRMEET_{field}_DAY")).unwrap_or(&Value::Null).is_null() { Some(*code) } else { None }).collect::<String>();
                let room = [text(m, "SSRMEET_BLDG_CODE"), text(m, "SSRMEET_ROOM_CODE")].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" ");
                json!({"days":day_names,"begin":m.get("SSRMEET_BEGIN_TIME").unwrap_or(&Value::Null),"end":m.get("SSRMEET_END_TIME").unwrap_or(&Value::Null),"room":room,"type":m.get("SSRMEET_MTYP_CODE").unwrap_or(&Value::Null)})
            }).collect();
            let instructors =
                serde_json::from_str::<Value>(text(row, "SWV_CLASS_SEARCH_INSTRCTR_JSON"))
                    .unwrap_or(json!([]));
            let instructors: Vec<String> = instructors
                .as_array()
                .into_iter()
                .flatten()
                .map(|i| text(i, "NAME").to_owned())
                .filter(|s| !s.is_empty())
                .collect();
            let hours = row
                .get("SWV_CLASS_SEARCH_SSBSECT_HOURS")
                .filter(|v| !v.is_null())
                .unwrap_or_else(|| row.get("HRS_COLUMN_FIELD").unwrap_or(&Value::Null));
            sections.push(json!({"crn":crn,"course":name,"section":text(row,"SWV_CLASS_SEARCH_SECTION"),"title":text(row,"SWV_CLASS_SEARCH_TITLE"),"site":nonempty(text(row,"SWV_CLASS_SEARCH_SITE"),"Not listed"),"open":nonempty(text(row,"STUSEAT_OPEN"),"Unknown"),"seats":nonempty(text(row,"SWV_CLASS_SEARCH_SEATS_AVAIL"),"NA"),"instructors":if instructors.is_empty(){vec!["Not listed".to_string()]}else{instructors},"times":times,"hours":hours,"attrs":nonempty(text(row,"SWV_CLASS_SEARCH_ATTRIBUTES"),"None listed"),"preferred":preferred.contains(&crn),"tracked":watch.get("picks").and_then(|p|p.get(crn)).is_some()}));
        }
        groups.push(json!({"course":name,"sections":sections}));
    }
    eprintln!(
        "Indexed {} planned sections in {:.2}s",
        groups
            .iter()
            .map(|g| g["sections"].as_array().map_or(0, Vec::len))
            .sum::<usize>(),
        start.elapsed().as_secs_f64()
    );
    Ok(
        json!({"term":"Spring 2027","updated":watch.get("updated_at").unwrap_or(&Value::Null),"groups":groups,"checklist":["Lab Safety Acknowledgment (CSCE 482)","Terms of Use","Location Update","Tuition Rate Plan","Degree plan"]}),
    )
}
fn respond(mut stream: TcpStream, data: &str) {
    let mut reader = BufReader::new(&stream);
    let mut request = String::new();
    if reader.read_line(&mut request).is_err() {
        return;
    }
    let path = request
        .split_whitespace()
        .nth(1)
        .unwrap_or("/")
        .split('?')
        .next()
        .unwrap_or("/");
    let (content_type, body) = match path {
        "/api/data" => ("application/json; charset=utf-8", data.as_bytes().to_vec()),
        "/" | "/static/index.html" => match std::fs::read("static/index.html") {
            Ok(b) => ("text/html; charset=utf-8", b),
            Err(_) => ("text/plain", b"Interface not found".to_vec()),
        },
        _ => ("text/plain; charset=utf-8", b"Not found".to_vec()),
    };
    let status = if path == "/" || path == "/static/index.html" || path == "/api/data" {
        "200 OK"
    } else {
        "404 Not Found"
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(&body);
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let data = Arc::<str>::from(load_data()?.to_string());
    let listener = TcpListener::bind("127.0.0.1:8000")?;
    println!("ASB+ running at http://127.0.0.1:8000");
    for stream in listener.incoming().flatten() {
        let data = Arc::clone(&data);
        thread::spawn(move || respond(stream, &data));
    }
    Ok(())
}
