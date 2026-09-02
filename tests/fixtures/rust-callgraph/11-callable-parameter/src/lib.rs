fn job() {}

fn apply(callback: fn()) {
    callback();
}

fn run() {
    apply(job);
}
