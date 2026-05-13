import type { GemStoneArgument, MarshalledValue, Session } from "./client.ts";
import type { Oop } from "./oop.ts";

export class GsDict implements AsyncDisposable {
  readonly session: Session;
  readonly oop: Oop;

  constructor(session: Session, oop: Oop) {
    this.session = session;
    this.oop = oop;
  }

  static async create(
    session: Session,
    initial: Record<string, GemStoneArgument> = {},
  ): Promise<GsDict> {
    return new GsDict(session, await session.dictionaryToOop(initial));
  }

  async get(key: string): Promise<MarshalledValue> {
    return this.session.strDictGet(this.oop, key);
  }

  async getOop(key: string): Promise<Oop | null> {
    return this.session.strDictGetOop(this.oop, key);
  }

  async set(key: string, value: GemStoneArgument): Promise<this> {
    await this.session.strDictSet(this.oop, key, value);
    return this;
  }

  async setOop(key: string, value: Oop): Promise<this> {
    await this.session.runtime.strKeyValueDictAtPut(this.oop, key, value);
    return this;
  }

  async has(key: string): Promise<boolean> {
    return await this.getOop(key) !== null;
  }

  async pick(keys: readonly string[]): Promise<Record<string, MarshalledValue>> {
    const result: Record<string, MarshalledValue> = {};
    for (const key of keys) {
      result[key] = await this.get(key);
    }
    return result;
  }

  async send<R = MarshalledValue>(selector: string, ...args: GemStoneArgument[]): Promise<R> {
    return await this.session.performValueWith(this.oop, selector, ...args) as R;
  }

  async sendOop(selector: string, ...args: GemStoneArgument[]): Promise<Oop> {
    return this.session.performWith(this.oop, selector, ...args);
  }

  async [Symbol.asyncDispose](): Promise<void> {}
}
