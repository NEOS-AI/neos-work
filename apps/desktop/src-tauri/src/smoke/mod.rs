//! Headless real-file smoke. Runs only when `VIDEO_RS_SMOKE=1`.

mod core;
mod fixtures;
mod probe;
mod regressions;
mod runner;
mod timeline;
mod tools;

fn smoke_enabled() -> bool {
    matches!(std::env::var("VIDEO_RS_SMOKE"), Ok(ref v) if v == "1")
}

/// Returns true when the test should return immediately (gate off).
fn skip_unless_smoke() -> bool {
    if smoke_enabled() {
        return false;
    }
    eprintln!("skipping smoke (set VIDEO_RS_SMOKE=1)");
    true
}
