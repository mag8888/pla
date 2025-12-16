import { PartnerProgramType, TransactionType } from '@prisma/client';
export declare function getOrCreatePartnerProfile(userId: string, programType?: PartnerProgramType): Promise<{
    id: string;
    balance: number;
    createdAt: Date;
    updatedAt: Date;
    userId: string;
    isActive: boolean;
    activatedAt: Date | null;
    expiresAt: Date | null;
    activationType: string | null;
    programType: import(".prisma/client").$Enums.PartnerProgramType;
    referralCode: string;
    bonus: number;
    totalPartners: number;
    directPartners: number;
    multiPartners: number;
}>;
export declare function activatePartnerProfile(userId: string, activationType: 'PURCHASE' | 'ADMIN', months?: number, reason?: string, adminId?: string): Promise<{
    id: string;
    balance: number;
    createdAt: Date;
    updatedAt: Date;
    userId: string;
    isActive: boolean;
    activatedAt: Date | null;
    expiresAt: Date | null;
    activationType: string | null;
    programType: import(".prisma/client").$Enums.PartnerProgramType;
    referralCode: string;
    bonus: number;
    totalPartners: number;
    directPartners: number;
    multiPartners: number;
}>;
export declare function deactivatePartnerProfile(userId: string, reason?: string, adminId?: string): Promise<{
    id: string;
    balance: number;
    createdAt: Date;
    updatedAt: Date;
    userId: string;
    isActive: boolean;
    activatedAt: Date | null;
    expiresAt: Date | null;
    activationType: string | null;
    programType: import(".prisma/client").$Enums.PartnerProgramType;
    referralCode: string;
    bonus: number;
    totalPartners: number;
    directPartners: number;
    multiPartners: number;
}>;
export declare function getPartnerActivationHistory(profileId: string): Promise<{
    id: string;
    action: string;
    createdAt: Date;
    expiresAt: Date | null;
    activationType: string | null;
    reason: string | null;
    adminId: string | null;
    profileId: string;
}[]>;
export declare function checkPartnerActivation(userId: string): Promise<boolean>;
/**
 * Проверяет и автоматически деактивирует истекшие профили
 * Используется только в местах, где это уместно (например, при открытии дашборда партнера)
 */
export declare function checkAndDeactivateExpiredProfiles(userId: string): Promise<boolean>;
export declare function buildReferralLink(code: string, programType: 'DIRECT' | 'MULTI_LEVEL'): string;
export declare function getPartnerDashboard(userId: string): Promise<{
    profile: {
        referrals: {
            id: string;
            contact: string | null;
            level: number;
            createdAt: Date;
            profileId: string;
            referredId: string | null;
            referralType: import(".prisma/client").$Enums.PartnerProgramType;
        }[];
        transactions: {
            id: string;
            type: import(".prisma/client").$Enums.TransactionType;
            description: string;
            createdAt: Date;
            amount: number;
            profileId: string;
        }[];
    } & {
        id: string;
        balance: number;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        isActive: boolean;
        activatedAt: Date | null;
        expiresAt: Date | null;
        activationType: string | null;
        programType: import(".prisma/client").$Enums.PartnerProgramType;
        referralCode: string;
        bonus: number;
        totalPartners: number;
        directPartners: number;
        multiPartners: number;
    };
    stats: {
        partners: number;
        directPartners: number;
        multiPartners: number;
    };
} | null>;
export declare function getPartnerList(userId: string): Promise<{
    directPartners: any[];
    multiPartners: any[];
} | null>;
export declare function recordPartnerTransaction(profileId: string, amount: number, description: string, type?: TransactionType): Promise<{
    id: string;
    type: import(".prisma/client").$Enums.TransactionType;
    description: string;
    createdAt: Date;
    amount: number;
    profileId: string;
}>;
export declare function recalculatePartnerBonuses(profileId: string): Promise<number>;
export declare function calculateDualSystemBonuses(orderUserId: string, orderAmount: number, orderId?: string): Promise<{
    partnerId: string;
    partnerName: string;
    level: number;
    amount: number;
    description: string;
}[] | undefined>;
export declare function createPartnerReferral(profileId: string, level: number, referredId?: string, contact?: string, referralType?: 'DIRECT' | 'MULTI_LEVEL'): Promise<{
    id: string;
    contact: string | null;
    level: number;
    createdAt: Date;
    profileId: string;
    referredId: string | null;
    referralType: import(".prisma/client").$Enums.PartnerProgramType;
}>;
export declare function upsertPartnerReferral(profileId: string, level: number, referredId?: string, contact?: string, referralType?: 'DIRECT' | 'MULTI_LEVEL'): Promise<{
    id: string;
    contact: string | null;
    level: number;
    createdAt: Date;
    profileId: string;
    referredId: string | null;
    referralType: import(".prisma/client").$Enums.PartnerProgramType;
}>;
