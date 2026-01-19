import { Thing } from './thing.component';

export function thing(...args: ConstructorParameters<typeof Thing>): Thing {
  return new Thing(...args);
}

export type { Thing };
