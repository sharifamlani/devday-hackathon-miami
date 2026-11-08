/**
 * The slice of eventemitter3 that audio-recorder.ts uses (on / off / emit), so the lifted file
 * runs without adding a dependency. Not part of the Google lift.
 */
type Listener = (...args: any[]) => void;

export default class EventEmitter {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, fn: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return this;
  }

  off(event: string, fn?: Listener): this {
    if (fn) this.listeners.get(event)?.delete(fn);
    else this.listeners.delete(event);
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const set = this.listeners.get(event);
    set?.forEach((fn) => fn(...args));
    return !!set?.size;
  }
}
