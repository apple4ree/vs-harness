trait Job {
    fn execute(&self);
}

struct Worker;

impl Job for Worker {
    fn execute(&self) {}

    fn run(&self) {
        self.execute();
    }
}
