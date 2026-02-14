
import { prisma } from '../lib/prisma.js';
import { getBotInstance } from '../lib/bot-instance.js';
import { Markup } from 'telegraf';

const BATCH_SIZE = 50; // Process 50 users at a time
const PROCESSING_INTERVAL = 2000; // Run every 2 seconds

export class BroadcastService {
    private isProcessing = false;

    constructor() {
        // Start the worker loop
        setInterval(() => this.processQueue(), PROCESSING_INTERVAL);
    }

    async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            // 1. Find active broadcasts (PROCESSING status)
            const activeBroadcasts = await prisma.broadcast.findMany({
                where: { status: 'PROCESSING' },
                select: { id: true, message: true, photoUrl: true, buttonText: true, buttonUrl: true }
            });

            if (activeBroadcasts.length === 0) {
                this.isProcessing = false;
                return;
            }

            const bot = await getBotInstance();

            for (const broadcast of activeBroadcasts) {
                // 2. Fetch pending targets for this broadcast
                const targets = await prisma.broadcastTarget.findMany({
                    where: { broadcastId: broadcast.id, status: 'PENDING' },
                    include: { user: { select: { id: true, telegramId: true, isBlocked: true, firstName: true } } },
                    take: BATCH_SIZE
                });

                if (targets.length === 0) {
                    // No more pending targets, mark broadcast as COMPLETED
                    await prisma.broadcast.update({
                        where: { id: broadcast.id },
                        data: { status: 'COMPLETED', completedAt: new Date() }
                    });
                    continue;
                }

                // 3. Process batch in parallel
                await Promise.all(targets.map(async (target: any) => {
                    // Skip if user is known to be blocked
                    if (target.user.isBlocked) {
                        await prisma.broadcastTarget.update({
                            where: { id: target.id },
                            data: { status: 'FAILED', error: 'User blocked bot previously' }
                        });
                        await prisma.broadcast.update({
                            where: { id: broadcast.id },
                            data: { failedCount: { increment: 1 } }
                        });
                        return;
                    }

                    try {

                        const extra: any = { parse_mode: 'Markdown' };
                        if (broadcast.buttonText && broadcast.buttonUrl) {
                            extra.reply_markup = {
                                inline_keyboard: [[{ text: broadcast.buttonText, url: broadcast.buttonUrl }]]
                            };
                        }

                        // Send message
                        if (broadcast.photoUrl) {
                            let photoInput: any = broadcast.photoUrl;
                            if (!broadcast.photoUrl.startsWith('http')) {
                                photoInput = { source: broadcast.photoUrl };
                            }

                            await bot.telegram.sendPhoto(target.user.telegramId, photoInput, {
                                caption: broadcast.message,
                                ...extra
                            });
                        } else {
                            await bot.telegram.sendMessage(target.user.telegramId, broadcast.message, extra);
                        }

                        // Success
                        await prisma.broadcastTarget.update({
                            where: { id: target.id },
                            data: { status: 'SENT', sentAt: new Date() }
                        });

                        await prisma.broadcast.update({
                            where: { id: broadcast.id },
                            data: { sentCount: { increment: 1 } }
                        });

                    } catch (error: any) {
                        const errorMsg = error.message || String(error);
                        const isBlocked = errorMsg.includes('blocked') || errorMsg.includes('Forbidden: bot was blocked');

                        // Mark user as blocked if detected
                        if (isBlocked) {
                            await prisma.user.update({
                                where: { id: target.user.id },
                                data: { isBlocked: true }
                            });
                        }

                        await prisma.broadcastTarget.update({
                            where: { id: target.id },
                            data: { status: 'FAILED', error: errorMsg }
                        });

                        await prisma.broadcast.update({
                            where: { id: broadcast.id },
                            data: { failedCount: { increment: 1 } }
                        });
                    }
                }));
            }

        } catch (error) {
            console.error('❌ Broadcast Worker Error:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    async sendTestBroadcast(adminTelegramId: string | number, opts: { message: string, photo?: Express.Multer.File, buttonText?: string, buttonUrl?: string }) {
        const bot = await getBotInstance();
        const extra: any = { parse_mode: 'Markdown' };

        if (opts.buttonText && opts.buttonUrl) {
            extra.reply_markup = {
                inline_keyboard: [[{ text: opts.buttonText, url: opts.buttonUrl }]]
            };
        }

        try {
            if (opts.photo) {
                await bot.telegram.sendPhoto(adminTelegramId, { source: opts.photo.path }, {
                    caption: opts.message,
                    ...extra
                });
            } else {
                await bot.telegram.sendMessage(adminTelegramId, opts.message, extra);
            }
        } catch (e) {
            console.error('Test broadcast failed:', e);
            throw e;
        }
    }
}

// Singleton instance
export const broadcastService = new BroadcastService();
