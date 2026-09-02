export async function withRetry<T>(operation: () => Promise<T>, limit = 3) {
  let lastError: unknown;
  for (let attempt = 0; attempt < limit; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
