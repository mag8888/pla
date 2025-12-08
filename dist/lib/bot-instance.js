import { Telegraf } from 'telegraf';
import { env } from '../config/env.js';
import { session as telegrafSession } from 'telegraf';
import { applyBotModules } from '../bot/setup-modules.js';
let botInstance = null;
export async function getBotInstance() {
    if (!botInstance) {
        botInstance = new Telegraf(env.botToken, {
            handlerTimeout: 30_000,
        });
        // Add session middleware
        botInstance.use(telegrafSession({
            defaultSession: () => ({ uiMode: 'classic' }),
        }));
        // Apply bot modules
        await applyBotModules(botInstance);
        // Register cart actions
        const { registerCartActions } = await import('../modules/cart/index.js');
        registerCartActions(botInstance);
    }
    return botInstance;
}
export function setBotInstance(bot) {
    botInstance = bot;
}
export { botInstance };
