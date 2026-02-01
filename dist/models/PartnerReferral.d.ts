import mongoose, { Document } from 'mongoose';
import { PartnerProgramType } from './PartnerProfile.js';
export interface IPartnerReferral extends Document<mongoose.Types.ObjectId> {
    _id: mongoose.Types.ObjectId;
    profileId: mongoose.Types.ObjectId;
    referredId?: mongoose.Types.ObjectId;
    contact?: string;
    level: number;
    referralType: PartnerProgramType;
    createdAt: Date;
}
export declare const PartnerReferral: mongoose.Model<IPartnerReferral, {}, {}, {}, mongoose.Document<unknown, {}, IPartnerReferral, {}, {}> & IPartnerReferral & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
