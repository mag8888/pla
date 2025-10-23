import { Router, Application } from 'express';
import AdminJS from 'adminjs';
import AdminJSExpress from '@adminjs/express';
import * as AdminJSPrisma from '@adminjs/prisma';
import type { ActionRequest } from 'adminjs';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';

AdminJS.registerAdapter({
  Resource: AdminJSPrisma.Resource,
  Database: AdminJSPrisma.Database,
});

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function setupAdminPanel(app: Application) {
  const admin = new AdminJS({
    rootPath: '/admin',
    branding: {
      companyName: 'Plazma Water MM',
    },
    resources: [
      {
        resource: { model: prisma.category, client: prisma },
        options: {
          properties: {
            slug: {
              isVisible: {
                list: true,
                edit: false,
                show: true,
                filter: true,
              },
            },
          },
          actions: {
            new: {
              before: async (request: ActionRequest) => {
                const payload = request.payload ?? {};
                if (payload.name && !payload.slug) {
                  return {
                    ...request,
                    payload: {
                      ...payload,
                      slug: slugify(String(payload.name)),
                    },
                  };
                }
                return request;
              },
            },
            edit: {
              before: async (request: ActionRequest) => {
                const payload = request.payload ?? {};
                if (payload.name) {
                  return {
                    ...request,
                    payload: {
                      ...payload,
                      slug: slugify(String(payload.name)),
                    },
                  };
                }
                return request;
              },
            },
          },
        },
      },
      {
        resource: { model: prisma.product, client: prisma },
        options: {
          navigation: {
            name: 'Товары',
            icon: 'Package',
          },
          listProperties: ['title', 'categoryId', 'price', 'isActive'],
          showProperties: ['title', 'summary', 'description', 'imageUrl', 'price', 'stock', 'isActive', 'availableInRussia', 'availableInBali', 'categoryId', 'createdAt', 'updatedAt'],
          editProperties: ['title', 'summary', 'description', 'imageUrl', 'price', 'stock', 'isActive', 'availableInRussia', 'availableInBali', 'categoryId'],
          filterProperties: ['title', 'isActive', 'availableInRussia', 'availableInBali'],
          sort: {
            sortBy: 'title',
            direction: 'asc',
          },
          properties: {
            title: {
              isTitle: true,
            },
            description: {
              type: 'richtext',
            },
            price: {
              type: 'number',
            },
          },
        },
      },
      {
        resource: { model: prisma.review, client: prisma },
        options: {
          navigation: {
            name: 'Отзывы',
            icon: 'Star',
          },
          listProperties: ['name', 'isActive', 'isPinned', 'createdAt'],
          showProperties: ['name', 'photoUrl', 'content', 'link', 'isPinned', 'isActive', 'createdAt', 'updatedAt'],
          editProperties: ['name', 'photoUrl', 'content', 'link', 'isPinned', 'isActive'],
          filterProperties: ['name', 'isActive', 'isPinned'],
          sort: {
            sortBy: 'createdAt',
            direction: 'desc',
          },
          properties: {
            name: {
              isTitle: true,
            },
          },
        },
      },
      {
        resource: { model: prisma.partnerProfile, client: prisma },
        options: {
          listProperties: ['id', 'userId', 'programType', 'balance', 'bonus'],
        },
      },
      {
        resource: { model: prisma.partnerTransaction, client: prisma },
        options: {
          listProperties: ['profileId', 'amount', 'type', 'createdAt'],
        },
      },
      {
        resource: { model: prisma.user, client: prisma },
        options: {
          navigation: {
            name: 'Пользователи',
            icon: 'User',
          },
          listProperties: ['telegramId', 'firstName', 'username', 'phone', 'deliveryAddress', 'createdAt'],
          showProperties: ['telegramId', 'firstName', 'lastName', 'username', 'phone', 'deliveryAddress', 'balance', 'selectedRegion', 'createdAt', 'updatedAt'],
          editProperties: ['firstName', 'lastName', 'username', 'phone', 'deliveryAddress', 'balance', 'selectedRegion'],
          filterProperties: ['telegramId', 'firstName', 'username', 'phone'],
          sort: {
            sortBy: 'createdAt',
            direction: 'desc',
          },
          properties: {
            telegramId: {
              isTitle: true, // Делаем telegramId заголовком
            },
            phone: {
              isVisible: {
                list: true,
                edit: true,
                show: true,
                filter: true,
              },
            },
            deliveryAddress: {
              isVisible: {
                list: true,
                edit: true,
                show: true,
                filter: true,
              },
            },
          },
        },
      },
      {
        resource: { model: prisma.userHistory, client: prisma },
        options: {
          listProperties: ['userId', 'action', 'createdAt'],
        },
      },
      {
        resource: { model: prisma.orderRequest, client: prisma },
        options: {
          navigation: {
            name: 'Заказы',
            icon: 'ShoppingCart',
          },
          listProperties: ['id', 'userId', 'status', 'contact', 'createdAt'],
          showProperties: ['id', 'userId', 'status', 'contact', 'message', 'itemsJson', 'createdAt'],
          editProperties: ['status', 'contact', 'message'],
          filterProperties: ['status', 'contact'],
          sort: {
            sortBy: 'createdAt',
            direction: 'desc',
          },
          properties: {
            id: {
              isTitle: true, // Делаем id заголовком
            },
            itemsJson: {
              type: 'textarea',
              isVisible: {
                list: false,
                edit: true,
                show: true,
                filter: false,
              },
              props: {
                rows: 4,
              },
            },
            message: {
              type: 'textarea',
              isVisible: {
                list: false,
                edit: true,
                show: true,
                filter: false,
              },
              props: {
                rows: 3,
              },
            },
          },
        },
      },
      {
        resource: { model: prisma.botContent, client: prisma },
        options: {
          navigation: {
            name: 'Контент бота',
            icon: 'Text',
          },
          listProperties: ['key', 'title', 'category', 'language', 'isActive', 'updatedAt'],
          showProperties: ['key', 'title', 'content', 'description', 'category', 'language', 'isActive', 'createdAt', 'updatedAt'],
          editProperties: ['key', 'title', 'content', 'description', 'category', 'language', 'isActive'],
          filterProperties: ['key', 'title', 'category', 'language', 'isActive'],
          sort: {
            sortBy: 'updatedAt',
            direction: 'desc',
          },
          properties: {
            key: {
              isVisible: {
                list: true, edit: true, show: true, filter: true,
              },
              isTitle: true, // Делаем key заголовком для лучшей навигации
            },
            title: {
              isVisible: {
                list: true, edit: true, show: true, filter: true,
              },
            },
            content: {
              type: 'textarea',
              isVisible: {
                list: false, edit: true, show: true, filter: false,
              },
              props: {
                rows: 8,
              },
            },
            description: {
              type: 'textarea',
              isVisible: {
                list: false, edit: true, show: true, filter: false,
              },
              props: {
                rows: 3,
              },
            },
            category: {
              isVisible: {
                list: true, edit: true, show: true, filter: true,
              },
              availableValues: [
                { value: 'messages', label: 'Сообщения' },
                { value: 'descriptions', label: 'Описания' },
                { value: 'buttons', label: 'Кнопки' },
              ],
            },
            language: {
              isVisible: {
                list: true, edit: true, show: true, filter: true,
              },
              availableValues: [
                { value: 'ru', label: 'Русский' },
                { value: 'en', label: 'English' },
              ],
            },
            isActive: {
              isVisible: {
                list: true, edit: true, show: true, filter: true,
              },
            },
            createdAt: {
              isVisible: {
                list: false, edit: false, show: true, filter: false,
              },
            },
            updatedAt: {
              isVisible: {
                list: true, edit: false, show: true, filter: false,
              },
            },
          },
        },
      },
    ],
  });

  const router = Router();
  const adminRouter = AdminJSExpress.buildAuthenticatedRouter(
    admin,
    {
      authenticate: async (email, password) => {
        if (email === env.adminEmail && password === env.adminPassword) {
          return { email };
        }
        return null;
      },
      cookiePassword: env.botWebhookSecret ?? env.adminPassword,
    },
    null,
    {
      secret: env.botWebhookSecret ?? env.adminPassword,
      resave: false,
      saveUninitialized: false,
    },
  );

  router.use(admin.options.rootPath, adminRouter);
  app.use(router);
}
