import type { LoggerPort } from '../../../src/core/types';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogLine {
  readonly level: LogLevel;
  readonly message: string;
}

export class FakeLogger implements LoggerPort {
  readonly lines: LogLine[] = [];

  info(message: string): void {
    this.lines.push({ level: 'info', message });
  }

  warn(message: string): void {
    this.lines.push({ level: 'warn', message });
  }

  error(message: string): void {
    this.lines.push({ level: 'error', message });
  }

  at(level: LogLevel): string[] {
    return this.lines.filter((l) => l.level === level).map((l) => l.message);
  }

  get problems(): string[] {
    return this.lines.filter((l) => l.level !== 'info').map((l) => l.message);
  }

  get text(): string {
    return this.lines.map((l) => `${l.level}: ${l.message}`).join('\n');
  }

  clear(): void {
    this.lines.length = 0;
  }

  /**
   * Returns every logged line that contains one of `secrets` (e.g. tool names or string values from a setting).
   * The extension must log only mode/count/origin/outcome and error messages, never setting values.
   */
  leaks(secrets: readonly string[]): string[] {
    const needles = secrets.filter((s) => s.length > 0);
    return this.lines.map((l) => l.message).filter((message) => needles.some((needle) => message.includes(needle)));
  }
}
