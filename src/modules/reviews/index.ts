import { Telegraf, Markup } from 'telegraf';
import { Context } from '../../bot/context.js';
import { BotModule } from '../../bot/types.js';
import { getActiveReviews } from '../../services/review-service.js';
import { logUserAction } from '../../services/user-history.js';

export const reviewsModule: BotModule = {
  async register(bot: Telegraf<Context>) {
    // Handle reviews command
    bot.command('reviews', async (ctx) => {
      try {
        await logUserAction(ctx, 'command:reviews');
        await showReviews(ctx);
      } catch (error) {
        console.error('⭐ Reviews: Failed to process /reviews command', error);
        await ctx.reply('❌ Не удалось загрузить отзывы. Попробуйте позже.');
      }
    });

    bot.hears(['Отзывы', '⭐ Отзывы'], async (ctx) => {
      try {
        await logUserAction(ctx, 'menu:reviews');
        await showReviews(ctx);
      } catch (error) {
        console.error('⭐ Reviews: Failed to process reviews menu', error);
        await ctx.reply('❌ Не удалось загрузить отзывы. Попробуйте позже.');
      }
    });
  },
};

export async function showReviews(ctx: Context) {
  try {
    // Добавляем таймаут для загрузки отзывов
    let reviews: any[] = [];
    try {
      reviews = await Promise.race([
        getActiveReviews(),
        new Promise<any[]>((_, reject) => 
          setTimeout(() => reject(new Error('Database timeout')), 5000)
        )
      ]) as any[];
    } catch (dbError: any) {
      console.error('⭐ Reviews: Error loading reviews from DB:', dbError.message?.substring(0, 100));
      // Показываем сообщение об ошибке и кнопку для отзыва
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.url('💬 Оставить отзыв', 'https://iplazma.tilda.ws/comment')]
      ]);
      await ctx.reply('❌ Ошибка при загрузке отзывов. Попробуйте позже.', keyboard);
      return;
    }

    if (reviews.length === 0) {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.url('💬 Оставить отзыв', 'https://iplazma.tilda.ws/comment')]
      ]);
      await ctx.reply('Отзывов пока нет. Добавьте их в админке.', keyboard);
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

    // Добавляем кнопку для оставления отзыва после всех отзывов
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url('💬 Оставить отзыв', 'https://iplazma.tilda.ws/comment')]
    ]);
    await ctx.reply('💬 Хотите оставить свой отзыв?', keyboard);
  } catch (error: any) {
    console.error('⭐ Reviews: Failed to show reviews', error);
    
    // Проверяем, не является ли это ошибкой БД
    const errorMessage = error.message || error.meta?.message || '';
    const errorKind = (error as any).kind || '';
    const errorName = error.name || '';
    
    const isDbError = 
      error.code === 'P2010' || error.code === 'P1001' || error.code === 'P1002' || error.code === 'P1013' ||
      errorName === 'ConnectorError' || errorName === 'PrismaClientUnknownRequestError' ||
      errorMessage.includes('ConnectorError') || errorMessage.includes('Authentication failed') ||
      errorMessage.includes('SCRAM failure') || errorMessage.includes('replica set') ||
      errorKind.includes('AuthenticationFailed') || errorKind.includes('ConnectorError');
    
    // Показываем кнопку для отзыва даже при ошибке
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url('💬 Оставить отзыв', 'https://iplazma.tilda.ws/comment')]
    ]);
    
    if (isDbError) {
      await ctx.reply('❌ Ошибка при загрузке отзывов. База данных временно недоступна. Попробуйте позже.', keyboard);
    } else {
      await ctx.reply('❌ Ошибка при загрузке отзывов. Попробуйте позже.', keyboard);
    }
  }
}
