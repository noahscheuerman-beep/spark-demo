export class SparkOperationTimeoutError extends Error {
  readonly operation: string;
  readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = "SparkOperationTimeoutError";
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

class SparkOperationCancelledError extends Error {
  constructor(operation: string) {
    super(`${operation} completed before its deadline`);
    this.name = "SparkOperationCancelledError";
  }
}

type TimeoutOptions = {
  operation: string;
  timeoutMs: number;
  parentSignal?: AbortSignal;
};

export async function withAbortTimeout<T>(
  options: TimeoutOptions,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutError = new SparkOperationTimeoutError(options.operation, options.timeoutMs);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let settleDeadline: ((reason: Error) => void) | undefined;
  let deadlineSettled = false;

  const settle = (reason: Error) => {
    if (deadlineSettled) return;
    deadlineSettled = true;
    controller.abort(reason);
    settleDeadline?.(reason);
  };

  const onParentAbort = () => {
    const reason = options.parentSignal?.reason;
    settle(reason instanceof Error ? reason : new Error(`${options.operation} was aborted`));
  };

  const deadline = new Promise<never>((_resolve, reject) => {
    settleDeadline = reject;
    if (options.parentSignal?.aborted) {
      onParentAbort();
      return;
    }
    options.parentSignal?.addEventListener("abort", onParentAbort, { once: true });
    timeoutId = setTimeout(() => settle(timeoutError), options.timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    options.parentSignal?.removeEventListener("abort", onParentAbort);
    settle(new SparkOperationCancelledError(options.operation));
  }
}

export function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      error_name: error.name,
      error_message: error.message,
      timed_out: error instanceof SparkOperationTimeoutError,
    };
  }
  return { error_name: "UnknownError", error_message: String(error), timed_out: false };
}

export function logSparkEvent(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {},
) {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    component: "spark.chat",
    event,
    ...fields,
  });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.info(payload);
}
