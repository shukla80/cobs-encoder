# COBS Encoder

Encode and decode Consistent Overhead Byte Stuffing (COBS) for framing arbitrary bytes over a delimiter channel. Zero runtime dependencies, ESM only.

```js
import { encode, decode } from 'cobs-encoder';

const frame = encode(new Uint8Array([0x01, 0x00, 0x02]));
// Uint8Array(5) [ 2, 1, 1, 2, 2 ]

// Append a 0x00 delimiter on the wire; strip it before decoding.
const back = decode(frame);
// Uint8Array(3) [ 1, 0, 2 ]
```

`encode(input: Uint8Array): Uint8Array` returns the stuffed bytes **without** a trailing delimiter. `decode(input: Uint8Array): Uint8Array` takes exactly one such frame (delimiter already removed) and returns the original bytes. Both accept and return `Uint8Array` only — passing a plain `Array` or `number[]` throws `TypeError`, because silent coercion hides caller bugs (e.g. numbers > 255).

## Why

When you stream bytes over a transport that uses a sentinel byte to mark frame boundaries (a serial line, a log channel, a pipe), any occurrence of that sentinel in the payload corrupts framing. COBS replaces every zero in the input so that `0x00` can serve as an unambiguous delimiter. The overhead is at most one byte per 254 bytes of input — predictable and small, unlike byte-escaping schemes whose overhead balloons for adversarial inputs. The trade-off versus a length-prefixed framing is that you must scan every byte to find the delimiter, and you pay the stuffing overhead; in exchange the framing is self-synchronising: a dropped byte only loses one frame, not the stream's alignment.

This is the original Cheshire/Baker COBS variant with the "0x00 last-zero" convention: the final overhead byte may be `0x00`, which decodes as "the previous run ran to the delimiter".

## Edge cases

- Empty input encodes to `[0x01]` and decodes back to empty.
- A single zero byte encodes to `[0x01, 0x01]` (two overhead bytes, zero literals) and decodes back to `[0x00]`.
- `decode` throws on an empty frame, on an internal `0x00` byte (corruption), and on a truncated run (code promises more literals than remain). It does **not** accept a trailing delimiter — strip it first.
- The encoded output never contains `0x00`, which is the whole point and is asserted by the test suite.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

