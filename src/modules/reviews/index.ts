import { Telegraf } from 'telegraf';
import { Context } from '../../bot/context.js';
import { BotModule } from '../../bot/types.js';
import { getActiveReviews } from '../../services/review-service.js';
import { logUserAction } from '../../services/user-history.js';

export const reviewsModule: BotModule = {
  async register(bot: Telegraf<Context>) {
    // Handle reviews command
    bot.command('reviews', async (ctx) => {
      try {
        console.log('⭐ Reviews: /reviews command triggered by', ctx.from?.id);
        await logUserAction(ctx, 'command:reviews');
        await showReviews(ctx);
      } catch (error) {
        console.error('⭐ Reviews: Failed to process /reviews command', error);
        await ctx.reply('❌ Не удалось загрузить отзывы. Попробуйте позже.');
      }
    });

    bot.hears(['Отзывы', '⭐ Отзывы'], async (ctx) => {
      await logUserAction(ctx, 'menu:reviews');
      await showReviews(ctx);
    });
  },
};

export async function showReviews(ctx: Context) {
  try {
    const reviews = await getActiveReviews();

    if (reviews.length === 0) {
      await ctx.reply('Отзывов пока нет. Добавьте их в админке.');
      return;
    }

    for (const review of reviews) {
      const caption = [`⭐ ${review.name}`, review.content];
      if (review.link) {
        caption.push(`Подробнее: ${review.link}`);
      }

      if (review.photoUrl) {
        await ctx.replyWithPhoto(review.photoUrl, { caption: caption.join('\n\n') });
      } else {
        await ctx.reply(caption.join('\n\n'));
      }
    }
  } catch (error) {
    console.error('⭐ Reviews: Failed to show reviews', error);
    await ctx.reply('❌ Не удалось показать отзывы. Попробуйте позже.');
  }
}
