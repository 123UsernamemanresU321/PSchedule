export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function roundToTenth(value: number) {
  return Math.round(value * 10) / 10;
}

export function roundToQuarterHour(minutes: number) {
  return Math.round(minutes / 15) * 15;
}

export function toPercent(value: number, total: number) {
  if (!total) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

export function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

export function groupBy<T, K extends string | number>(
  values: T[],
  keyFn: (value: T) => K,
) {
  return values.reduce<Record<K, T[]>>((accumulator, value) => {
    const key = keyFn(value);
    const current = accumulator[key] ?? [];
    current.push(value);
    accumulator[key] = current;
    return accumulator;
  }, {} as Record<K, T[]>);
}

export function recordFromKeys<T extends string>(
  keys: readonly T[],
  createValue: () => number,
) {
  return keys.reduce<Record<T, number>>((accumulator, key) => {
    accumulator[key] = createValue();
    return accumulator;
  }, {} as Record<T, number>);
}

export function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

export function createId(prefix?: string) {
  const scopedCrypto = globalThis.crypto;

  if (scopedCrypto?.randomUUID) {
    const id = scopedCrypto.randomUUID();
    return prefix ? `${prefix}-${id}` : id;
  }

  const randomChunk = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  const timeChunk = Date.now().toString(16);
  const id = `${timeChunk}-${randomChunk()}-${randomChunk()}`;

  return prefix ? `${prefix}-${id}` : id;
}
