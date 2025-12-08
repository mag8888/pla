import { Telegraf } from 'telegraf';
import { BotModule } from '../../bot/types.js';
import { Context } from '../../bot/context.js';
export declare const cartModule: BotModule;
export declare function showCart(ctx: Context): Promise<void>;
export declare function registerCartActions(bot: Telegraf<Context>): void;
