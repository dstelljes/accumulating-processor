type Awaitable<T> = T | Promise<T>;

type Batch<TItem, TResult, TError extends Error> = {
  entries: Entry<TItem, TResult, TError>[];
  promise: Promise<void>;
  resolve: () => void;
  size: number;
  timeout?: ReturnType<typeof setTimeout>;
};

type Entry<TItem, TResult, TError extends Error> = {
  item: TItem;
  resolve: (result: TResult) => void;
  reject: (result: TError) => void;
};

type Processor<TItem, TResult, TError extends Error> = (
  /**
   * An array of items sorted by least to most recently enqueued.
   */
  batch: TItem[],
) => Awaitable<Result<TResult, TError>>;

type Result<TResult, TError extends Error> = TResult extends void
  ? Array<TResult | TError> | TResult
  : Array<TResult | TError>;

type ThresholdOptions<TItem> = {
  /**
   * Batch by item count.
   */
  count?: {
    /**
     * The maximum number of items in a batch. Must be greater than or equal to
     * 1.
     */
    max: number;
  };

  /**
   * Batch by time.
   */
  delay?: {
    /**
     * The maximum amount of time (in milliseconds) an item may be enqueued
     * before it is processed.
     */
    max: number;
  };

  /**
   * Batch by item size.
   */
  size?: {
    /**
     * The maximum total size of a batch.
     */
    max: number;

    /**
     * A function that will be invoked to calculate the size of an item.
     */
    calculate: (item: TItem) => number;

    /**
     * Whether a single item should be rejected if its size exceeds the maximum
     * size. (In other words, whether maximum size should be treated as a hard
     * limit.) If `false`, any item that exceeds the maximum size will be
     * immediately processed alone in a single-item batch. Defaults to `true`.
     */
    strict?: boolean;
  };
};

/**
 * A batch processor that accumulates items by count, delay, or size.
 */
export class AccumulatingProcessor<
  TItem,
  TResult = void,
  TError extends Error = Error,
> {
  /**
   * All pending batches. Includes the currently accumulating batch and any in
   * flight.
   */
  readonly #all: Set<Batch<TItem, TResult, TError>>;

  /**
   * The function to be invoked to process a batch.
   */
  readonly #fn: (batch: TItem[]) => Promise<Result<TResult, TError>>;

  /**
   * Validated threshold options.
   */
  readonly #options: ThresholdOptions<TItem>;

  /**
   * The currently accumulating batch, if any.
   */
  #current: Batch<TItem, TResult, TError> | undefined;

  constructor(
    /**
     * A function that will be invoked whenever {@link release} is called or a
     * batch of at least one item reaches any of the configured thresholds.
     *
     * *   If the function throws or rejects to an error, {@link Promise}s for
     *     all items in the batch will be rejected with the error.
     * *   If the function returns or fulfills with `undefined`, all items in
     *     the batch will be fulfilled with `undefined`.
     * *   If the function returns or fulfills with an array, the
     *     {@link Promise} for each item in the batch will be completed with
     *     the value in the corresponding position. If the value is assignable
     *     to {@link Error}, the {@link Promise} will be rejected, otherwise it
     *     will be fulfilled.
     */
    fn: Processor<TItem, TResult, TError>,
    /**
     * Accumulation thresholds. If no thresholds are configured, items will
     * accumulate until {@link release} is called.
     */
    options?: ThresholdOptions<TItem>,
  ) {
    if (typeof fn !== "function") {
      throw new Error("processing function must be provided");
    }

    this.#all = new Set();
    this.#fn = async (batch) => await fn(batch);
    this.#options = validateOptions(options);
  }

  /**
   * Processes an item.
   *
   * @returns
   * A {@link Promise} that resolves when processing succeeds or rejects when
   * processing fails. If the batch fails, the {@link Promise} will be rejected
   * with that error. If the batch succeeds but the processing function returns
   * an {@link Error} for the item, the {@link Promise} will be rejected with
   * that error.
   *
   * @throws {Error} The item's size exceeds the maximum batch size.
   */
  process(item: TItem): Promise<TResult> {
    let size = 0;

    if (this.#options.size) {
      const max = this.#options.size.max;
      size = this.#options.size.calculate(item);

      if (size > max && this.#options.size.strict) {
        throw new Error(`item has size ${size}, greater than ${max} allowed`);
      }

      // release here to ensure that a new batch is created if the item would
      // push the current batch size over the limit
      if (this.#current && (this.#current.size + size) > max) {
        this.release();
      }
    }

    if (!this.#current) {
      const next: Batch<TItem, TResult, TError> = this.#current = {
        entries: [],
        promise: undefined!,
        resolve: undefined!,
        size: 0,
      };

      next.promise = new Promise<void>((resolve) => {
        next.resolve = resolve;
      }).then(() => {
        this.#all.delete(next);
      });

      if (this.#options.delay) {
        next.timeout = setTimeout(() => {
          if (this.#current === next) {
            this.release();
          }
        }, this.#options.delay.max);
      }

      this.#all.add(next);
    }

    const entry: Entry<TItem, TResult, TError> = {
      item,
      resolve: undefined!,
      reject: undefined!,
    };

    this.#current.entries.push(entry);
    this.#current.size += size;

    if (
      (
        this.#options.count &&
        this.#options.count.max <= this.#current.entries.length
      ) ||
      (
        this.#options.size &&
        this.#options.size.max <= this.#current.size
      )
    ) {
      this.release();
    }

    return new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });
  }

  /**
   * Immediately processes all accumulated items.
   */
  release() {
    const batch = this.#current;
    this.#current = undefined;

    if (batch) {
      clearTimeout(batch.timeout);

      this.#fn(batch.entries.map((entry) => entry.item)).then((results) => {
        // be lenient here; only exclude values that cannot be indexed (ideally
        // Result would be based on ArrayLike instead of Array, but that makes
        // for worse type inference)
        const indexable = typeof results !== "undefined" && results !== null;

        batch.entries.forEach((entry, index) => {
          let result: TResult | TError;
          try {
            result = indexable ? results[index] : undefined as TResult;
          } catch (error) {
            result = error;
          }

          if (result instanceof Error) {
            entry.reject(result);
          } else {
            entry.resolve(result);
          }
        });
      }).catch((error) => {
        batch.entries.forEach((entry) => {
          entry.reject(error);
        });
      }).finally(() => {
        batch.resolve();
      });
    }
  }

  /**
   * Immediately releases the current batch if one is accumulating and waits
   * for all in-flight batches to complete.
   *
   * {@link flush} only waits for items pending at the time of the call. Any
   * items enqueued by subsequent calls to {@link process} will not be awaited.
   *
   * @returns
   * A {@link Promise} that resolves when all pending items have been
   * processed, regardless of whether processing was successful.
   */
  async flush(): Promise<void> {
    const all = Promise.all([...this.#all].map((batch) => batch.promise));
    this.release();

    await all;
  }
}

function validateOptions<TItem>(options: ThresholdOptions<TItem> | undefined) {
  // build a copy of the options so that changes to the original don't alter
  // the behavior of already constructed instances
  const validated: ThresholdOptions<TItem> = {};

  if (typeof options !== "undefined") {
    if (typeof options !== "object" || options === null) {
      throw new Error("options must be an object");
    }

    if (typeof options.count !== "undefined") {
      if (typeof options.count !== "object" || options.count === null) {
        throw new Error("count must be an object");
      }

      if (typeof options.count.max !== "number" || options.count.max < 1) {
        throw new Error(
          "count.max must be a number greater than or equal to 1",
        );
      }

      validated.count = { max: options.count.max };
    }

    if (typeof options.delay !== "undefined") {
      if (typeof options.delay !== "object" || options.delay === null) {
        throw new Error("delay must be an object");
      }

      if (typeof options.delay.max !== "number" || options.delay.max < 0) {
        throw new Error(
          "delay.max must be a number greater than or equal to 0",
        );
      }

      validated.delay = { max: options.delay.max };
    }

    if (typeof options.size !== "undefined") {
      if (typeof options.size !== "object" || options.size === null) {
        throw new Error("size must be an object");
      }

      if (typeof options.size.max !== "number") {
        throw new Error("size.max must be a number");
      }

      if (typeof options.size.calculate !== "function") {
        throw new Error(
          "if size.max is provided, size.calculate must also be provided",
        );
      }

      validated.size = {
        max: options.size.max,
        calculate: options.size.calculate,
        strict: true,
      };

      if (typeof options.size.strict !== "undefined") {
        if (typeof options.size.strict !== "boolean") {
          throw new Error("size.strict must be a boolean");
        }

        validated.size.strict = options.size.strict;
      }
    }
  }

  return validated;
}
