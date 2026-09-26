export interface ThrottledFunction<TArgs extends any[] = any[]> {
  (...args: TArgs): void
  cancel(): void
  flush(): void
}
