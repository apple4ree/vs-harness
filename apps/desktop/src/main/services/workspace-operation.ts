/** A project switch and a disk mutation must never overlap in one application. */
export class WorkspaceOperation {
  private active: string | null = null;
  private idleWaiters: (() => void)[] = [];

  get busy() {
    return this.active;
  }
  whenIdle(): Promise<void> {
    return this.active
      ? new Promise((resolve) => this.idleWaiters.push(resolve))
      : Promise.resolve();
  }

  async run<T>(label: string, operation: () => T | Promise<T>): Promise<T> {
    if (this.active)
      throw new Error(`Wait for ${this.active} to finish before ${label}.`);
    this.active = label;
    try {
      return await operation();
    } finally {
      this.active = null;
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }
}
