import { Context } from '../../bot/context.js';
import { BotModule } from '../../bot/types.js';
export declare function showRegionSelection(ctx: Context): Promise<void>;
export declare function showCategories(ctx: Context, region?: string): Promise<void>;
export declare const shopModule: BotModule;
