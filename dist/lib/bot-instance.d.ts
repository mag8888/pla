import { Telegraf } from 'telegraf';
import { Context } from '../bot/context.js';
declare let botInstance: Telegraf<Context> | null;
export declare function getBotInstance(): Promise<Telegraf<Context>>;
export declare function setBotInstance(bot: Telegraf<Context>): void;
export { botInstance };
