import { Markup, Telegraf } from 'telegraf';
import { Context } from '../../bot/context.js';
import { BotModule } from '../../bot/types.js';
import { ensureUser, logUserAction } from '../../services/user-history.js';
import { createAudioFile, findAudioByFileId, getActiveAudioFiles, getAllAudioFiles, formatDuration, getAudioFileById } from '../../services/audio-service.js';
import { getAdminChatIds } from '../../config/env.js';
import { env } from '../../config/env.js';
import { isCloudinaryConfigured, listCloudinaryResources } from '../../services/cloudinary-service.js';

export async function showAudioFiles(ctx: Context, category?: string) {
  await logUserAction(ctx, 'audio:show_files', { category });

  try {
    const audioFiles = await getActiveAudioFiles(category);

    console.log('🎵 Loading audio files:', {
      category,
      count: audioFiles.length,
      files: audioFiles.map(f => ({ title: f.title, category: f.category, isActive: f.isActive }))
    });

    if (audioFiles.length === 0) {
      if (category === 'gift' && isCloudinaryConfigured()) {
        const folder = env.cloudinaryAudioFolder || 'plazma';
        console.log(`🎵 Searching Cloudinary for audio in folder: '${folder}'...`);

        try {
          const raw = await listCloudinaryResources(folder, 'raw', 50);
          const video = await listCloudinaryResources(folder, 'video', 50);

          console.log(`🎵 Cloudinary results - Raw: ${raw.length}, Video/Audio: ${video.length}`);

          const fromCloudinary = [...raw, ...video].filter(
            (r) => r.secure_url && /\.(mp3|m4a|ogg|wav|aac|webm|mp4)$/i.test(r.secure_url)
          );

          if (fromCloudinary.length > 0) {
            console.log(`✅ Found ${fromCloudinary.length} audio files in Cloudinary folder '${folder}'`);

            await ctx.reply(`🎵 Найдено ${fromCloudinary.length} файлов в облачном хранилище (папка ${folder}):`);

            for (let i = 0; i < fromCloudinary.length; i++) {
              const r = fromCloudinary[i];
              // Try to extract a clean title from public_id
              const fileName = r.public_id.split('/').pop() || `Аудио ${i + 1}`;
              // Remove extension and underscores
              const cleanTitle = fileName.replace(/\.[^/.]+$/, "").replace(/_/g, " ");

              await ctx.reply(`🎵 ${cleanTitle}`, {
                reply_markup: {
                  inline_keyboard: [[{ text: '🎶 Слушать сейчас', url: r.secure_url }]],
                },
              });
            }
            await ctx.reply('💡 Нажмите "Слушать сейчас" для воспроизведения.');
            return;
          } else {
            console.log(`❌ No audio files found in Cloudinary folder '${folder}'`);
          }
        } catch (e) {
          console.error('❌ Cloudinary audio fallback failed:', (e as Error)?.message);
        }
      }

      console.log('❌ No audio files found for category:', category);
      await ctx.reply(
        '🎵 Звуковые матрицы\n\n' +
        'Пока нет доступных аудиофайлов.\n\n' +
        'Система проверила базу данных и облачное хранилище (Cloudinary).\n' +
        'Администратор может загрузить файлы через бота или добавить их в папку "plazma" в Cloudinary.'
      );
      return;
    }

    // Send audio files
    for (const audioFile of audioFiles) {
      console.log('🎵 Sending audio file:', audioFile.title, 'File ID:', audioFile.fileId);

      try {
        // Проверяем, является ли file_id заглушкой
        if (audioFile.fileId.startsWith('BAADBAAD') || audioFile.fileId === 'PLACEHOLDER_FILE_ID') {
          // Отправляем как информационную карточку
          await ctx.reply(
            `🎵 ${audioFile.title}\n` +
            `📝 ${audioFile.description}\n` +
            `⏱️ Длительность: ${audioFile.duration ? formatDuration(audioFile.duration) : 'Неизвестно'}\n\n` +
            `💡 Для прослушивания нажмите кнопку ниже.`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: '🎵 Слушать звуковые матрицы',
                      callback_data: `audio:play:${audioFile.id}`
                    }
                  ]
                ]
              }
            }
          );
        } else {
          // Отправляем реальный аудиофайл
          await ctx.replyWithAudio(
            audioFile.fileId,
            {
              title: audioFile.title,
              performer: 'Anton Matrix Laboratory',
              duration: audioFile.duration || undefined,
              caption: audioFile.description || undefined,
            }
          );
        }
      } catch (error) {
        console.error('Error sending audio file:', audioFile.title, error);
        // Отправляем как информационную карточку в случае ошибки
        await ctx.reply(
          `🎵 ${audioFile.title}\n` +
          `📝 ${audioFile.description}\n` +
          `⏱️ Длительность: ${audioFile.duration ? formatDuration(audioFile.duration) : 'Неизвестно'}\n\n` +
          `💡 Для прослушивания нажмите кнопку ниже.`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '🎵 Слушать звуковые матрицы',
                    callback_data: `audio:play:${audioFile.id}`
                  }
                ]
              ]
            }
          }
        );
      }
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
  const adminChatIds = getAdminChatIds();
  const userId = ctx.from?.id?.toString() || '';
  const isAdmin = adminChatIds.includes(userId);

  console.log('🔍 Audio upload admin check:', {
    userId,
    adminChatIds,
    isAdmin
  });

  if (!isAdmin) {
    await ctx.reply(`❌ Только администраторы могут загружать аудиофайлы.\n\nВаш ID: ${userId}\nНастроенные админы: ${adminChatIds.join(', ') || 'не настроены'}`);
    return;
  }

  const audio = ctx.message && 'audio' in ctx.message ? ctx.message.audio : null;
  if (!audio) {
    await ctx.reply('❌ Файл не найден. Пожалуйста, отправьте аудиофайл.');
    return;
  }

  try {
    // Идемпотентность: если такой file_id уже есть в категории gift — не создаём дубликат
    const existing = await findAudioByFileId(audio.file_id, 'gift');
    if (existing) {
      await ctx.reply(
        `✅ Этот аудиофайл уже в каталоге.\n\n` +
        `📝 ${existing.title}\n` +
        `Раздел «Звуковые матрицы Гаряева».`
      );
      return;
    }

    const audioFileData = {
      title: audio.title || 'Безымянный файл',
      description: audio.performer ? `Исполнитель: ${audio.performer}` : undefined,
      fileId: audio.file_id,
      duration: audio.duration,
      fileSize: audio.file_size,
      mimeType: audio.mime_type,
      category: 'gift',
    };

    const createdFile = await createAudioFile(audioFileData);

    await logUserAction(ctx, 'audio:upload', {
      audioFileId: createdFile.id,
      title: createdFile.title,
      duration: createdFile.duration,
    });

    await ctx.reply(
      `✅ Аудиофайл успешно загружен!\n\n` +
      `📝 Название: ${createdFile.title}\n` +
      `⏱️ Длительность: ${createdFile.duration ? formatDuration(createdFile.duration) : 'Неизвестно'}\n` +
      `📁 Размер: ${createdFile.fileSize ? Math.round(createdFile.fileSize / 1024) + ' KB' : 'Неизвестно'}\n` +
      `🏷️ Категория: ${createdFile.category || 'Не указана'}\n\n` +
      `Файл добавлен в раздел "Звуковые матрицы Гаряева".`
    );
  } catch (error: any) {
    console.error('Error uploading audio file:', {
      message: error?.message,
      code: error?.code,
      name: error?.name,
    });
    await ctx.reply(
      '❌ Ошибка при загрузке аудиофайла. Попробуйте позже. Если повторяется — проверьте логи сервера (DATABASE_URL, подключение к БД).'
    );
  }
}

async function showAdminAudioList(ctx: Context) {
  try {
    const audioFiles = await getAllAudioFiles();

    if (audioFiles.length === 0) {
      await ctx.reply('📋 Список аудиофайлов пуст.\n\nДля загрузки отправьте аудиофайл боту.');
      return;
    }

    let message = '📋 Список всех аудиофайлов:\n\n';

    audioFiles.forEach((file, index) => {
      const status = file.isActive ? '✅' : '❌';
      const duration = file.duration ? formatDuration(file.duration) : 'Неизвестно';
      const size = file.fileSize ? Math.round(file.fileSize / 1024) + ' KB' : 'Неизвестно';

      message += `${index + 1}. ${status} **${file.title}**\n`;
      message += `   📁 Категория: ${file.category || 'Не указана'}\n`;
      message += `   ⏱️ Длительность: ${duration}\n`;
      message += `   📊 Размер: ${size}\n`;
      message += `   📅 Загружен: ${file.createdAt.toLocaleDateString('ru-RU')}\n\n`;
    });

    message += `📊 Всего файлов: ${audioFiles.length}`;
    message += `\n✅ Активных: ${audioFiles.filter(f => f.isActive).length}`;
    message += `\n❌ Неактивных: ${audioFiles.filter(f => !f.isActive).length}`;

    await ctx.reply(message, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error showing admin audio list:', error);
    await ctx.reply('❌ Ошибка при загрузке списка аудиофайлов.');
  }
}

async function showAudioStats(ctx: Context) {
  try {
    const audioFiles = await getAllAudioFiles();

    if (audioFiles.length === 0) {
      await ctx.reply('📊 Статистика аудиофайлов:\n\nФайлов не найдено.');
      return;
    }

    const activeFiles = audioFiles.filter(f => f.isActive);
    const totalDuration = audioFiles.reduce((sum, file) => sum + (file.duration || 0), 0);
    const totalSize = audioFiles.reduce((sum, file) => sum + (file.fileSize || 0), 0);

    const categories = audioFiles.reduce((acc, file) => {
      const category = file.category || 'Без категории';
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    let message = '📊 Статистика аудиофайлов:\n\n';
    message += `📁 Всего файлов: ${audioFiles.length}\n`;
    message += `✅ Активных: ${activeFiles.length}\n`;
    message += `❌ Неактивных: ${audioFiles.length - activeFiles.length}\n`;
    message += `⏱️ Общая длительность: ${formatDuration(totalDuration)}\n`;
    message += `📊 Общий размер: ${Math.round(totalSize / 1024 / 1024 * 100) / 100} MB\n\n`;

    message += '📂 По категориям:\n';
    Object.entries(categories).forEach(([category, count]) => {
      message += `• ${category}: ${count} файл(ов)\n`;
    });

    await ctx.reply(message);

  } catch (error) {
    console.error('Error showing audio stats:', error);
    await ctx.reply('❌ Ошибка при загрузке статистики аудиофайлов.');
  }
}

export const audioModule: BotModule = {
  async register(bot: Telegraf<Context>) {
    console.log('🎵 Registering audio module...');

    // Handle admin audio command
    bot.command('admin', async (ctx) => {
      const user = await ensureUser(ctx);
      if (!user) return;

      // Check if user is admin
      const adminChatIds = getAdminChatIds();
      const userId = ctx.from?.id?.toString() || '';
      const isAdmin = adminChatIds.includes(userId);

      console.log('🔍 Admin check:', {
        userId,
        adminChatIds,
        isAdmin
      });

      if (!isAdmin) {
        await ctx.reply(`❌ Доступ запрещен. Только администраторы могут использовать эту команду.\n\nВаш ID: ${userId}\nНастроенные админы: ${adminChatIds.join(', ') || 'не настроены'}`);
        return;
      }

      const command = ctx.message?.text?.split(' ')[1];

      if (command === 'audio') {
        await ctx.reply('🎵 Управление аудиофайлами\n\n' +
          'Доступные команды:\n' +
          '/admin audio list - показать все аудиофайлы\n' +
          '/admin audio stats - статистика аудиофайлов\n\n' +
          'Или просто отправьте аудиофайл боту для загрузки.');
      } else {
        await ctx.reply('🎵 Админ-команды для аудио:\n\n' +
          '/admin audio - управление аудиофайлами\n' +
          '/admin audio list - список файлов\n' +
          '/admin audio stats - статистика\n\n' +
          'Для загрузки просто отправьте аудиофайл боту.');
      }
    });

    // Handle specific admin audio commands
    bot.command('admin_audio', async (ctx) => {
      const user = await ensureUser(ctx);
      if (!user) return;

      // Check if user is admin
      const adminChatIds = getAdminChatIds();
      const userId = ctx.from?.id?.toString() || '';
      const isAdmin = adminChatIds.includes(userId);

      console.log('🔍 Admin check:', {
        userId,
        adminChatIds,
        isAdmin
      });

      if (!isAdmin) {
        await ctx.reply(`❌ Доступ запрещен. Только администраторы могут использовать эту команду.\n\nВаш ID: ${userId}\nНастроенные админы: ${adminChatIds.join(', ') || 'не настроены'}`);
        return;
      }

      const args = ctx.message?.text?.split(' ').slice(1);
      const command = args?.[0];

      if (command === 'list') {
        await showAdminAudioList(ctx);
      } else if (command === 'stats') {
        await showAudioStats(ctx);
      } else {
        await ctx.reply('🎵 Админ-команды для аудио:\n\n' +
          '/admin_audio list - показать все аудиофайлы\n' +
          '/admin_audio stats - статистика аудиофайлов\n\n' +
          'Для загрузки просто отправьте аудиофайл боту.');
      }
    });

    // Simple audio command for quick access
    bot.command('audio', async (ctx) => {
      await logUserAction(ctx, 'audio:command');
      const { showAudioFiles } = await import('../audio/index.js');
      await showAudioFiles(ctx, 'gift');
    });

    // Handle audio file uploads
    bot.on('audio', async (ctx) => {
      await handleAudioUpload(ctx);
    });

    // Handle voice messages (convert to audio)
    bot.on('voice', async (ctx) => {
      const user = await ensureUser(ctx);
      if (!user) return;

      // Check if user is admin
      const adminChatIds = getAdminChatIds();
      const userId = ctx.from?.id?.toString() || '';
      const isAdmin = adminChatIds.includes(userId);

      console.log('🔍 Voice upload admin check:', {
        userId,
        adminChatIds,
        isAdmin
      });

      if (!isAdmin) {
        await ctx.reply(`❌ Только администраторы могут загружать аудиофайлы.\n\nВаш ID: ${userId}\nНастроенные админы: ${adminChatIds.join(', ') || 'не настроены'}`);
        return;
      }

      const voice = ctx.message && 'voice' in ctx.message ? ctx.message.voice : null;
      if (!voice) return;

      try {
        const existing = await findAudioByFileId(voice.file_id, 'voice');
        if (existing) {
          await ctx.reply('✅ Это голосовое сообщение уже сохранено в каталоге.');
          return;
        }

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
          duration: createdFile.duration,
        });

        await ctx.reply(
          `✅ Голосовое сообщение сохранено!\n\n` +
          `📝 ${createdFile.title}\n` +
          `⏱️ ${formatDuration(createdFile.duration || 0)}\n` +
          `🏷️ Категория: ${createdFile.category}`
        );
      } catch (error: any) {
        console.error('Error uploading voice:', { message: error?.message, code: error?.code });
        await ctx.reply('❌ Ошибка при сохранении голосового сообщения. Попробуйте позже.');
      }
    });

    // Handle audio play button clicks
    bot.action(/^audio:play:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      const audioId = ctx.match[1];

      try {
        const audioFile = await getAudioFileById(audioId);
        if (!audioFile) {
          await ctx.reply('❌ Аудиофайл не найден.');
          return;
        }

        // Проверяем, является ли file_id заглушкой
        if (audioFile.fileId.startsWith('BAADBAAD') || audioFile.fileId === 'PLACEHOLDER_FILE_ID') {
          await ctx.reply(
            `🎵 ${audioFile.title}\n\n` +
            `📝 ${audioFile.description}\n\n` +
            `⚠️ Для прослушивания этого файла администратор должен загрузить реальный аудиофайл через бота.\n\n` +
            `💡 Пока файл находится в системе как информация о доступной звуковой матрице.`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: '⬅️ Назад к списку',
                      callback_data: 'nav:audio:gift'
                    }
                  ]
                ]
              }
            }
          );
        } else {
          // Отправляем реальный аудиофайл
          await ctx.replyWithAudio(
            audioFile.fileId,
            {
              title: audioFile.title,
              performer: audioFile.description || 'Vital',
              duration: audioFile.duration || undefined,
              caption: `🎵 ${audioFile.title}\n📝 ${audioFile.description}`,
            }
          );
        }
      } catch (error) {
        console.error('Error playing audio:', error);
        await ctx.reply('❌ Ошибка воспроизведения аудиофайла.');
      }
    });

    // Handle audio retry button clicks
    bot.action(/^audio:retry:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      const audioId = ctx.match[1];

      try {
        const audioFile = await getAudioFileById(audioId);
        if (!audioFile) {
          await ctx.reply('❌ Аудиофайл не найден.');
          return;
        }

        // Пытаемся отправить файл снова
        await ctx.replyWithAudio(
          audioFile.fileId,
          {
            title: audioFile.title,
            performer: audioFile.description || 'Vital',
            duration: audioFile.duration || undefined,
            caption: audioFile.description || undefined,
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '🎵 Слушать',
                    callback_data: `audio:play:${audioFile.id}`
                  }
                ]
              ]
            }
          }
        );
      } catch (error) {
        console.error('Error retrying audio:', error);
        await ctx.reply('❌ Не удалось воспроизвести аудиофайл. Возможно, файл поврежден или недоступен.');
      }
    });

  },
};
