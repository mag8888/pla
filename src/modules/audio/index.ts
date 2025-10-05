import { Markup, Telegraf } from 'telegraf';
import { Context } from '../../bot/context.js';
import { BotModule } from '../../bot/types.js';
import { ensureUser, logUserAction } from '../../services/user-history.js';
import { createAudioFile, getActiveAudioFiles, formatDuration } from '../../services/audio-service.js';
import { env } from '../../config/env.js';

const ADMIN_USER_IDS = env.adminChatId ? [env.adminChatId] : [];

export async function showAudioFiles(ctx: Context, category?: string) {
  await logUserAction(ctx, 'audio:show_files', { category });
  
  try {
    const audioFiles = await getActiveAudioFiles(category);
    
    if (audioFiles.length === 0) {
      await ctx.reply('🎵 Звуковые матрицы\n\nПока нет доступных аудиофайлов.');
      return;
    }

    // Send each audio file
    for (const audioFile of audioFiles) {
      await ctx.replyWithAudio(
        audioFile.fileId,
        {
          title: audioFile.title,
          performer: audioFile.description || 'Plazma Water',
          duration: audioFile.duration || undefined,
          caption: audioFile.description || undefined,
        }
      );
    }

    // Send summary message
    const totalDuration = audioFiles.reduce((sum, file) => sum + (file.duration || 0), 0);
    const formattedDuration = formatDuration(totalDuration);
    
    await ctx.reply(
      `🎵 Всего файлов: ${audioFiles.length}\n⏱️ Общая длительность: ${formattedDuration}\n\n` +
      '💡 Слушайте эти звуковые матрицы для оздоровления и восстановления энергии.',
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🔙 Назад в меню',
                callback_data: 'nav:menu:shop',
              },
            ],
          ],
        },
      }
    );

  } catch (error) {
    console.error('Error showing audio files:', error);
    await ctx.reply('❌ Ошибка загрузки аудиофайлов. Попробуйте позже.');
  }
}

async function handleAudioUpload(ctx: Context) {
  const user = await ensureUser(ctx);
  if (!user) return;

  // Check if user is admin
  const isAdmin = ADMIN_USER_IDS.includes(ctx.from?.id?.toString() || '');
  if (!isAdmin) {
    await ctx.reply('❌ Только администраторы могут загружать аудиофайлы.');
    return;
  }

  const audio = ctx.message && 'audio' in ctx.message ? ctx.message.audio : null;
  if (!audio) {
    await ctx.reply('❌ Файл не найден. Пожалуйста, отправьте аудиофайл.');
    return;
  }

  try {
    // Create audio file record
    const audioFileData = {
      title: audio.title || 'Безымянный файл',
      description: audio.performer ? `Исполнитель: ${audio.performer}` : undefined,
      fileId: audio.file_id,
      duration: audio.duration,
      fileSize: audio.file_size,
      mimeType: audio.mime_type,
      category: 'gift', // Default category for gift audio files
    };

    const createdFile = await createAudioFile(audioFileData);
    
    await logUserAction(ctx, 'audio:upload', { 
      audioFileId: createdFile.id,
      title: createdFile.title,
      duration: createdFile.duration 
    });

    await ctx.reply(
      `✅ Аудиофайл успешно загружен!\n\n` +
      `📝 Название: ${createdFile.title}\n` +
      `⏱️ Длительность: ${createdFile.duration ? formatDuration(createdFile.duration) : 'Неизвестно'}\n` +
      `📁 Размер: ${createdFile.fileSize ? Math.round(createdFile.fileSize / 1024) + ' KB' : 'Неизвестно'}\n` +
      `🏷️ Категория: ${createdFile.category || 'Не указана'}\n\n` +
      `Файл добавлен в раздел "Звуковые матрицы Гаряева".`
    );

  } catch (error) {
    console.error('Error uploading audio file:', error);
    await ctx.reply('❌ Ошибка при загрузке аудиофайла. Попробуйте позже.');
  }
}

export const audioModule: BotModule = {
  async register(bot: Telegraf<Context>) {
    console.log('🎵 Registering audio module...');

    // Handle audio file uploads
    bot.on('audio', async (ctx) => {
      await handleAudioUpload(ctx);
    });

    // Handle voice messages (convert to audio)
    bot.on('voice', async (ctx) => {
      const user = await ensureUser(ctx);
      if (!user) return;

      // Check if user is admin
      const isAdmin = ADMIN_USER_IDS.includes(ctx.from?.id?.toString() || '');
      if (!isAdmin) {
        await ctx.reply('❌ Только администраторы могут загружать аудиофайлы.');
        return;
      }

      const voice = ctx.message && 'voice' in ctx.message ? ctx.message.voice : null;
      if (!voice) return;

      try {
        // Create audio file record for voice message
        const audioFileData = {
          title: `Голосовое сообщение от ${ctx.from?.first_name || 'Администратор'}`,
          description: 'Голосовое сообщение',
          fileId: voice.file_id,
          duration: voice.duration,
          fileSize: voice.file_size,
          mimeType: 'audio/ogg',
          category: 'voice',
        };

        const createdFile = await createAudioFile(audioFileData);
        
        await logUserAction(ctx, 'audio:upload_voice', { 
          audioFileId: createdFile.id,
          duration: createdFile.duration 
        });

        await ctx.reply(
          `✅ Голосовое сообщение сохранено как аудиофайл!\n\n` +
          `📝 Название: ${createdFile.title}\n` +
          `⏱️ Длительность: ${formatDuration(createdFile.duration || 0)}\n` +
          `🏷️ Категория: ${createdFile.category}`
        );

      } catch (error) {
        console.error('Error uploading voice message:', error);
        await ctx.reply('❌ Ошибка при сохранении голосового сообщения. Попробуйте позже.');
      }
    });

  },
};
