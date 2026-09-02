fn job() {}

fn select() -> fn() {
    job
}

fn run() {
    select()();
}
