import { PartnerProgramType } from '../models/PartnerProfile.js';
import { TransactionType } from '../models/PartnerTransaction.js';
import mongoose from 'mongoose';
export declare function getOrCreatePartnerProfile(userId: string, programType?: PartnerProgramType): Promise<mongoose.Document<unknown, {}, import("../models/PartnerProfile.js").IPartnerProfile, {}, {}> & import("../models/PartnerProfile.js").IPartnerProfile & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}>;
export declare function activatePartnerProfile(userId: string, activationType: 'PURCHASE' | 'ADMIN', months?: number, reason?: string, adminId?: string): Promise<mongoose.Document<unknown, {}, import("../models/PartnerProfile.js").IPartnerProfile, {}, {}> & import("../models/PartnerProfile.js").IPartnerProfile & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}>;
export declare function deactivatePartnerProfile(userId: string, reason?: string, adminId?: string): Promise<mongoose.Document<unknown, {}, import("../models/PartnerProfile.js").IPartnerProfile, {}, {}> & import("../models/PartnerProfile.js").IPartnerProfile & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}>;
export declare function getPartnerActivationHistory(profileId: string): Promise<never[]>;
export declare function checkPartnerActivation(userId: string): Promise<boolean>;
/**
 * Проверяет и автоматически деактивирует истекшие профили
 * Используется только в местах, где это уместно (например, при открытии дашборда партнера)
 */
export declare function checkAndDeactivateExpiredProfiles(userId: string): Promise<boolean>;
export declare function buildReferralLink(code: string, programType: 'DIRECT' | 'MULTI_LEVEL'): string;
export declare function getPartnerDashboard(userId: string): Promise<{
    profile: mongoose.FlattenMaps<import("../models/PartnerProfile.js").IPartnerProfile> & Required<{
        _id: mongoose.Types.ObjectId;
    }> & {
        __v: number;
    };
    stats: {
        partners: number;
        directPartners: number;
        multiPartners: number;
    };
    transactions: (mongoose.FlattenMaps<import("../models/PartnerTransaction.js").IPartnerTransaction> & Required<{
        _id: mongoose.Types.ObjectId;
    }> & {
        __v: number;
    })[];
} | null>;
export declare function getPartnerList(userId: string): Promise<{
    directPartners: any[];
    multiPartners: any[];
} | null>;
export declare function recordPartnerTransaction(profileId: string, amount: number, description: string, type?: TransactionType): Promise<mongoose.Document<unknown, {}, import("../models/PartnerTransaction.js").IPartnerTransaction, {}, {}> & import("../models/PartnerTransaction.js").IPartnerTransaction & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}>;
export declare function recalculatePartnerBonuses(profileId: string): Promise<number>;
export declare function calculateDualSystemBonuses(orderUserId: string, orderAmount: number, orderId?: string): Promise<any[]>;
export declare function createPartnerReferral(profileId: string, level: number, referredId?: string, contact?: string, referralType?: PartnerProgramType): Promise<mongoose.Document<unknown, {}, import("../models/PartnerReferral.js").IPartnerReferral, {}, {}> & import("../models/PartnerReferral.js").IPartnerReferral & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}>;
export declare function upsertPartnerReferral(profileId: string, level: number, referredId?: string, contact?: string, referralType?: PartnerProgramType): Promise<mongoose.Document<unknown, {}, import("../models/PartnerReferral.js").IPartnerReferral, {}, {}> & import("../models/PartnerReferral.js").IPartnerReferral & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}>;
