import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.214.0/assert/mod.ts";
import { delay } from "https://deno.land/std@0.214.0/async/mod.ts";
import { spy } from "https://deno.land/std@0.214.0/testing/mock.ts";
import { FakeTime } from "https://deno.land/std@0.214.0/testing/time.ts";

import { AccumulatingProcessor } from "./mod.ts";

Deno.test("releases manually", () => {
  const fn = spy((_: number[]) => {});
  const processor = new AccumulatingProcessor(fn);

  processor.process(1);
  processor.process(2);
  processor.release();
  processor.process(3);
  processor.release();
  processor.process(4);

  assertEquals(fn.calls.length, 2);
  assertEquals(fn.calls[0].args, [[1, 2]]);
  assertEquals(fn.calls[1].args, [[3]]);
});

Deno.test("releases at count threshold", () => {
  const fn = spy((_: number[]) => {});
  const processor = new AccumulatingProcessor(fn, { count: { max: 2 } });

  processor.process(1);
  processor.process(2);
  processor.process(3);
  processor.process(4);
  processor.process(5);

  assertEquals(fn.calls.length, 2);
  assertEquals(fn.calls[0].args, [[1, 2]]);
  assertEquals(fn.calls[1].args, [[3, 4]]);
});

Deno.test("releases at delay threshold", () => {
  const fn = spy((_: number[]) => {});
  const processor = new AccumulatingProcessor(fn, { delay: { max: 50 } });

  const time = new FakeTime();

  try {
    processor.process(1);
    processor.process(2);
    time.tick(50);
    processor.process(3);
    processor.process(4);
    time.tick(100);
    processor.process(5);

    assertEquals(fn.calls.length, 2);
    assertEquals(fn.calls[0].args, [[1, 2]]);
    assertEquals(fn.calls[1].args, [[3, 4]]);
  } finally {
    time.restore();
  }
});

Deno.test("releases at size threshold", () => {
  const fn = spy((_: number[]) => {});
  const processor = new AccumulatingProcessor(fn, {
    size: { max: 5, calculate: (n) => n },
  });

  processor.process(1);
  processor.process(2);
  processor.process(3);
  processor.process(4);
  processor.process(5);

  assertEquals(fn.calls.length, 4);
  assertEquals(fn.calls[0].args, [[1, 2]]);
  assertEquals(fn.calls[1].args, [[3]]);
  assertEquals(fn.calls[2].args, [[4]]);
  assertEquals(fn.calls[3].args, [[5]]);
});

Deno.test("rejects items larger than size threshold when size.strict", () => {
  const fn = spy((_: number[]) => {});
  const processor = new AccumulatingProcessor(fn, {
    size: { max: 0, calculate: (n) => n },
  });

  assertThrows(
    () => processor.process(1),
    "item has size 1, greater than 0 allowed",
  );
});

Deno.test("releases items larger than size threshold when !size.strict", () => {
  const fn = spy((_: number[]) => {});
  const processor = new AccumulatingProcessor(fn, {
    size: { max: 2, calculate: (n) => n, strict: false },
  });

  processor.process(1);
  processor.process(2);
  processor.process(3);

  assertEquals(fn.calls.length, 3);
  assertEquals(fn.calls[0].args, [[1]]);
  assertEquals(fn.calls[1].args, [[2]]);
  assertEquals(fn.calls[2].args, [[3]]);
});

Deno.test("fails all items when fn rejects", async () => {
  const processor = new AccumulatingProcessor(
    (_: number[]) => Promise.reject("nope"),
  );

  const one = processor.process(1);
  const two = processor.process(2);
  processor.release();

  await assertRejects(() => one, "nope");
  await assertRejects(() => two, "nope");
});

Deno.test("fails all items when fn throws", async () => {
  const processor = new AccumulatingProcessor(
    (_: number[]) => {
      throw "nope";
    },
  );

  const one = processor.process(1);
  const two = processor.process(2);
  processor.release();

  await assertRejects(() => one, "nope");
  await assertRejects(() => two, "nope");
});

Deno.test("maps fn results when fn resolves", async () => {
  const processor = new AccumulatingProcessor(
    (_: number[]) => Promise.resolve([0, new Error("nope")]),
  );

  const one = processor.process(1);
  const two = processor.process(2);
  const three = processor.process(3);
  processor.release();

  assertEquals(await one, 0);
  await assertRejects(() => two, "nope");
  assertEquals(await three, undefined);
});

Deno.test("maps fn results when fn returns", async () => {
  const processor = new AccumulatingProcessor(
    (_: number[]) => [0, new Error("nope")],
  );

  const one = processor.process(1);
  const two = processor.process(2);
  const three = processor.process(3);
  processor.release();

  assertEquals(await one, 0);
  await assertRejects(() => two, "nope");
  assertEquals(await three, undefined);
});

Deno.test("drains all batches on flush", async () => {
  const processor = new AccumulatingProcessor(
    (_: number[]) => delay(10),
  );

  const time = new FakeTime();

  try {
    const one = processor.process(1);
    processor.release();

    const two = processor.process(2);
    const flush = processor.flush();
    time.tick(10);

    await one;
    await two;
    await flush;
  } finally {
    time.restore();
  }
});

Deno.test("validates parameters", async (t) => {
  const fn = () => {};

  for (const invalid of [undefined, 1] as unknown[]) {
    await t.step(`rejects fn = ${JSON.stringify(invalid)}`, () => {
      assertThrows(
        () => new AccumulatingProcessor(invalid as () => void),
        "processing function must be provided",
      );
    });
  }

  await t.step("accepts fn = function", () => {
    new AccumulatingProcessor(fn);
  });

  for (const invalid of [null, 1] as unknown[]) {
    await t.step(`rejects count = ${JSON.stringify(invalid)}`, () => {
      const options = {
        count: invalid as { max: number },
      };

      assertThrows(
        () => new AccumulatingProcessor(fn, options),
        "count must be an object",
      );
    });
  }

  for (const invalid of ["1", 0] as unknown[]) {
    await t.step(`rejects count.max = ${JSON.stringify(invalid)}`, () => {
      const options = {
        count: { max: invalid as number },
      };

      assertThrows(
        () => new AccumulatingProcessor(fn, options),
        "count.max must be a number greater than or equal to 1",
      );
    });
  }

  await t.step("accepts count.max = 1", () => {
    new AccumulatingProcessor(() => {}, { count: { max: 1 } });
  });

  for (const invalid of [null, 0] as unknown[]) {
    await t.step(`rejects delay = ${JSON.stringify(invalid)}`, () => {
      const options = {
        delay: invalid as { max: number },
      };

      assertThrows(
        () => new AccumulatingProcessor(fn, options),
        "delay must be an object",
      );
    });
  }

  for (const invalid of ["0", -1] as unknown[]) {
    await t.step(`rejects delay.max = ${JSON.stringify(invalid)}`, () => {
      const options = {
        delay: { max: invalid as number },
      };

      assertThrows(
        () => new AccumulatingProcessor(fn, options),
        "delay.max must be a number greater than or equal to 0",
      );
    });
  }

  await t.step("accepts delay.max = 0", () => {
    new AccumulatingProcessor(() => {}, { delay: { max: 0 } });
  });

  for (const invalid of [null, 0] as unknown[]) {
    await t.step(`rejects size = ${JSON.stringify(invalid)}`, () => {
      const options = {
        size: invalid as { max: number; calculate: (item: unknown) => number },
      };

      assertThrows(
        () => new AccumulatingProcessor(fn, options),
        "size must be an object",
      );
    });
  }

  for (const invalid of ["0"] as unknown[]) {
    await t.step(`rejects size.max = ${JSON.stringify(invalid)}`, () => {
      const options = {
        size: { max: invalid as number, calculate: () => 0 },
      };

      assertThrows(
        () => new AccumulatingProcessor(fn, options),
        "size.max must be a number",
      );
    });
  }

  for (const invalid of [undefined, true] as unknown[]) {
    await t.step(`rejects size.calculate = ${JSON.stringify(invalid)}`, () => {
      const options = {
        size: { max: 0, calculate: invalid as (item: unknown) => number },
      };

      assertThrows(
        () => new AccumulatingProcessor(fn, options),
        "if size.max is provided, size.calculate must also be provided",
      );
    });
  }

  await t.step("accepts size.max = 0, size.calculate = function", () => {
    new AccumulatingProcessor(() => {}, {
      size: { max: 0, calculate: () => 0 },
    });
  });

  for (const invalid of ["true"] as unknown[]) {
    await t.step(`rejects size.strict = ${JSON.stringify(invalid)}`, () => {
      const options = {
        size: { max: 0, calculate: () => 0, strict: invalid as boolean },
      };

      assertThrows(
        () => new AccumulatingProcessor(fn, options),
        "size.strict must be a boolean",
      );
    });
  }

  await t.step("accepts size.strict = false", () => {
    new AccumulatingProcessor(() => {}, {
      size: { max: 0, calculate: () => 0, strict: false },
    });
  });
});
