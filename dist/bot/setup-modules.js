import { navigationModule } from '../modules/navigation/index.js';
import { shopModule } from '../modules/shop/index.js';
import { partnerModule } from '../modules/partner/index.js';
import { reviewsModule } from '../modules/reviews/index.js';
import { aboutModule } from '../modules/about/index.js';
import { adminModule } from '../modules/admin/index.js';
import { cartModule } from '../modules/cart/index.js';
import { audioModule } from '../modules/audio/index.js';
import { balanceModule } from '../modules/balance/index.js';
const modules = [
    shopModule, // Register shop module first to handle shop button
    cartModule, // Register cart module to handle cart button
    balanceModule, // Пополнение баланса
    audioModule, // Register audio module to handle audio uploads
    navigationModule,
    partnerModule,
    reviewsModule,
    aboutModule,
    adminModule,
];
export async function applyBotModules(bot) {
    for (const module of modules) {
        await module.register(bot);
    }
}
