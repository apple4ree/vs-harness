struct Worker;

impl Worker {
    fn helper(&self) {}

    fn run(&self) {
        self.helper();
    }
}
