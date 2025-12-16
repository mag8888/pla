import { PrismaClient } from '@prisma/client';
export declare const prisma: PrismaClient<{
    datasources: {
        db: {
            url: string;
        };
    } | undefined;
    log: ({
        level: "info";
        emit: "event";
    } | {
        level: "warn";
        emit: "event";
    } | {
        level: "error";
        emit: "event";
    })[];
}, "info" | "warn" | "error", import("@prisma/client/runtime/library").DefaultArgs>;
