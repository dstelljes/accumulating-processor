# accumulating-processor

A JavaScript batch processor that supports accumulating items by count, delay,
or size.

## Installation

In Node:

```
npm install accumulating-processor
```

```js
import { AccumulatingProcessor } from "accumulating-processor";
```

In Deno:

```js
import { AccumulatingProcessor } from "https://raw.githubusercontent.com/dstelljes/accumulating-processor/1.0.0/mod.ts";
```

or

```js
import { AccumulatingProcessor } from "npm:accumulating-processor";
```

## Usage

`AccumulatingProcessor` is instantiated with a function that will be invoked
whenever there is a batch ready to be processed:

```js
const processor = new AccumulatingProcessor((entities) =>
  repo.process(entities)
);
```

The `process` method returns a Promise that will resolve when the item's batch
is processed or reject when the batch fails:

```js
// adds the item to a batch and blocks until the batch is processed:
await processor.process({ id: "jpqlbd" });
```

If no threshold options are specified, the processor will accumulate items until
`release` is called:

```js
const promises = [
  processor.process({ id: "apbker" }),
  processor.process({ id: "mzlexi" }),
];

processor.release();

// blocks until the batch is processed:
const [first, second] = await Promise.all(promises);
```

The `flush` method can be used to ensure that all pending items are processed:

```js
processor.process({ id: "hhqpro" });
processor.process({ id: "pnojwe" });
processor.release();
processor.process({ id: "mbypsd" });

// releases a batch containing the third item and blocks until all three items
// are processed:
await processor.flush();
```

### Count thresholds

Use the `count.max` option to specify the maximum number of items that may be
included in a batch:

```js
const processor = new AccumulatingProcessor(
  (entities) => repo.process(entities),
  {
    count: { max: 3 },
  },
);

const promises = [
  processor.process({ id: "bliauf" }),
  processor.process({ id: "etbkte" }),
  processor.process({ id: "hpgnou" }),
];

// blocks until the batch is processed:
const [first, second, third] = await Promise.all(promises);
```

### Delay thresholds

Use the `delay.max` option to specify the maximum amount of time that a batch
may accumulate:

```js
const processor = new AccumulatingProcessor(
  (entities) => repo.process(entities),
  {
    delay: { max: 1000 },
  },
);

const start = Date.now();
await processor.process({ id: "spjlwr" });
const end = Date.now();

// end - start === 1000 + processing time
```

### Size thresholds

Use the `size.max` and `size.calculate` options to specify the maximum total
size of a batch:

```ts
const processor = new AccumulatingProcessor(
  (messages) => bus.produce(messages),
  {
    size: {
      max: 1024,
      calculate: ({ key, value }) => key.byteLength + value.byteLength,
    },
  },
);

processor.process({
  key: Buffer.from("albpre"),
  value: Buffer.alloc(512),
});

processor.process({
  key: Buffer.from("albpre"),
  value: Buffer.alloc(256),
});

processor.process({
  key: Buffer.from("mspvjj"),
  value: Buffer.alloc(768),
});

// releases two batches, one with the first and second items and one with the
// third item:
await processor.flush();
```

By default, the processor will reject any item whose size exceeds `size.max`:

```js
processor.process({
  key: Buffer.from("ghiphr"),
  value: Buffer.alloc(1024),
});

// Error: item has size 1030, greater than 1024 allowed
```

To allow individual items to exceeed `size.max`, `size.strict` may be set to
`false`:

```js
const processor = new AccumulatingProcessor(
  (messages) => bus.produce(messages),
  {
    size: {
      max: 1024,
      calculate: ({ key, value }) => key.byteLength + value.byteLength,
      strict: false,
    },
  },
);

processor.process({
  key: Buffer.from("bnaser"),
  value: Buffer.alloc(512),
});

processor.process({
  key: Buffer.from("nksdfd"),
  value: Buffer.alloc(1024),
});

// releases two batches, one with the first item (total calculated size 518)
// and one with the second item (total calculated size 1030):
await processor.flush();
```

### Per-item results

A processing function may return a
[Dataloader-style](https://github.com/graphql/dataloader#batch-function) array
of values or Error instances that will be mapped back to individual items by
index:

```js
function reciprocate(n) {
  if (n === 0) {
    return Error("divide by zero");
  }

  return 1 / n;
}

const processor = new AccumulatingProcessor((numbers) =>
  numbers.map(reciprocate)
);

const two = processor.process(2);
const one = processor.process(1);
const zero = processor.process(0);
processor.release();

await two; // 0.5
await one; // 1
await zero; // throws Error: divide by zero
```
