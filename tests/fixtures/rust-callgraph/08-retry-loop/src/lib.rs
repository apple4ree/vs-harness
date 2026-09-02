fn attempt() {}
fn exhausted() {}

fn run() {
    for retry in 0..3 {
        attempt();
    }
    exhausted();
}
