import * as vscode from 'vscode';
import { OUTPUT_CHANNEL_NAME } from '../constants';
import type { LoggerPort } from '../core/types';

export class VsCodeLoggerAdapter implements LoggerPort, vscode.Disposable {
  private readonly channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME, { log: true });

  info(message: string): void {
    this.channel.info(message);
  }

  warn(message: string): void {
    this.channel.warn(message);
  }

  error(message: string): void {
    this.channel.error(message);
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
