// ────────────────────────────────────────────────────────────────────────────
// tests/helpers/localStorage.ts
// Node 环境下的最小 localStorage 桩。
//
// 为什么手写而不用 jsdom：本项目的单元测试只覆盖纯逻辑，为了一个 localStorage
// 引入整个 DOM 环境不划算。这里只实现被测代码真正用到的 4 个方法 + length/key。
// ────────────────────────────────────────────────────────────────────────────

/** 安装 localStorage 桩，返回底层 Map 以便断言真实写入内容。 */
export function installLocalStorageStub(initial?: Record<string, string>): Map<string, string> {
  const backing = new Map<string, string>(Object.entries(initial ?? {}));

  const stub: Storage = {
    get length() {
      return backing.size;
    },
    clear: () => backing.clear(),
    getItem: (key: string) => (backing.has(key) ? backing.get(key)! : null),
    key: (index: number) => Array.from(backing.keys())[index] ?? null,
    removeItem: (key: string) => {
      backing.delete(key);
    },
    setItem: (key: string, value: string) => {
      backing.set(key, String(value));
    },
  };

  (globalThis as unknown as { localStorage: Storage }).localStorage = stub;
  return backing;
}

/** 卸载桩，避免污染其它用例。 */
export function removeLocalStorageStub(): void {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
}
