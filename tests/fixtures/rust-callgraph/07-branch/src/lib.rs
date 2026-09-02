fn fast_path() {}
fn safe_path() {}

fn run(cached: bool) {
    if cached {
        fast_path();
    } else {
        safe_path();
    }
}
