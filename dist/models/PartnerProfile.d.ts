import mongoose, { Document } from 'mongoose';
export declare enum PartnerProgramType {
    DIRECT = "DIRECT",
    MULTI_LEVEL = "MULTI_LEVEL"
}
export interface IPartnerProfile extends Document<mongoose.Types.ObjectId> {
    _id: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    isActive: boolean;
    activatedAt?: Date;
    expiresAt?: Date;
    activationType?: string;
    programType: PartnerProgramType;
    referralCode: string;
    balance: number;
    bonus: number;
    totalPartners: number;
    directPartners: number;
    multiPartners: number;
    createdAt: Date;
    updatedAt: Date;
}
export declare const PartnerProfile: mongoose.Model<IPartnerProfile, {}, {}, {}, mongoose.Document<unknown, {}, IPartnerProfile, {}, {}> & IPartnerProfile & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
