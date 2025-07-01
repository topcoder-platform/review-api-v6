import {
  Injectable,
  LoggerService as NestLoggerService,
  LogLevel,
} from '@nestjs/common';

@Injectable()
export class LoggerService implements NestLoggerService {
  private context?: string;

  constructor(context?: string) {
    this.context = context;
  }

  // Static method to create a new instance with a context
  static forRoot(context: string): LoggerService {
    return new LoggerService(context);
  }

  setContext(context: string) {
    this.context = context;
  }

  log(message: any, context?: string) {
    this.printMessage('log', message, context || this.context);
  }

  error(message: any, trace?: string, context?: string) {
    this.printMessage('error', message, context || this.context);
    if (trace) {
      console.error(trace);
    }
  }

  warn(message: any, context?: string) {
    this.printMessage('warn', message, context || this.context);
  }

  debug(message: any, context?: string) {
    this.printMessage('debug', message, context || this.context);
  }

  verbose(message: any, context?: string) {
    this.printMessage('verbose', message, context || this.context);
  }

  private printMessage(level: LogLevel, message: any, context?: string) {
    const timestamp = new Date().toISOString();
    let logMessage: string;

    if (typeof message === 'object') {
      try {
        logMessage = JSON.stringify(message);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        logMessage = String(message);
      }
    } else {
      logMessage = message;
    }

    const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${context ? `[${context}] ` : ''}${logMessage}`;

    switch (level) {
      case 'error':
        console.error(formattedMessage);
        break;
      case 'warn':
        console.warn(formattedMessage);
        break;
      case 'debug':
        console.debug(formattedMessage);
        break;
      case 'verbose':
        console.log(formattedMessage);
        break;
      default:
        console.log(formattedMessage);
    }
  }
}
