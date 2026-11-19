/** A binary min-heap on `f`, in typed arrays. `pop` leaves the entry in `key` and `g`. */
export class Heap {
  // `declare` keeps these out of the emitted class, so the constructor alone shapes the object.
  declare keys: Int32Array;
  declare gs: Float64Array;
  declare fs: Float64Array;
  declare length: number;
  declare key: number;
  declare g: number;
  constructor() {
    this.keys = new Int32Array(256);
    this.gs = new Float64Array(256);
    this.fs = new Float64Array(256);
    this.length = 0;
    this.key = -1;
    this.g = 0;
  }
  push(key: number, g: number, f: number) {
    if (this.length === this.keys.length) {
      const grow = <A extends Int32Array | Float64Array>(a: A, T: new (n: number) => A) => {
        const b = new T(a.length * 2);
        b.set(a);
        return b;
      };
      this.keys = grow(this.keys, Int32Array);
      this.gs = grow(this.gs, Float64Array);
      this.fs = grow(this.fs, Float64Array);
    }
    const { keys, gs, fs } = this;
    let i = this.length++;
    while (i) {
      const p = (i - 1) >> 1;
      if (fs[p] <= f) break;
      keys[i] = keys[p];
      gs[i] = gs[p];
      fs[i] = fs[p];
      i = p;
    }
    keys[i] = key;
    gs[i] = g;
    fs[i] = f;
  }
  pop() {
    const { keys, gs, fs } = this,
      n = --this.length;
    this.key = keys[0];
    this.g = gs[0];
    if (n) {
      const key = keys[n],
        g = gs[n],
        f = fs[n];
      let i = 0;
      while (i * 2 + 1 < n) {
        let j = i * 2 + 1;
        if (j + 1 < n && fs[j + 1] < fs[j]) j++;
        if (fs[j] >= f) break;
        keys[i] = keys[j];
        gs[i] = gs[j];
        fs[i] = fs[j];
        i = j;
      }
      keys[i] = key;
      gs[i] = g;
      fs[i] = f;
    }
  }
}
/** A binary min-heap of objects ordered by `before`. */
export class Queue<T> {
  declare items: T[];
  declare before: (a: T, b: T) => boolean;
  constructor(before: (a: T, b: T) => boolean) {
    this.items = [];
    this.before = before;
  }
  push(v: T) {
    const q = this.items;
    let i = q.push(v) - 1;
    while (i) {
      const p = (i - 1) >> 1;
      if (!this.before(v, q[p])) break;
      q[i] = q[p];
      i = p;
    }
    q[i] = v;
  }
  pop() {
    const q = this.items,
      top = q[0],
      last = q.pop()!;
    if (q.length) {
      let i = 0;
      for (;;) {
        let j = i * 2 + 1;
        if (j >= q.length) break;
        if (j + 1 < q.length && this.before(q[j + 1], q[j])) j++;
        if (!this.before(q[j], last)) break;
        q[i] = q[j];
        i = j;
      }
      q[i] = last;
    }
    return top;
  }
}
