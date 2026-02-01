import mongoose, { Document, Types } from 'mongoose';
export interface IAudioFile extends Document<mongoose.Types.ObjectId> {
    _id: mongoose.Types.ObjectId;
    title: string;
    description?: string;
    fileId: string;
    duration?: number;
    fileSize?: number;
    mimeType?: string;
    isActive: boolean;
    category?: string;
    createdAt: Date;
    updatedAt: Date;
}
export declare const AudioFile: mongoose.Model<IAudioFile, {}, {}, {}, mongoose.Document<unknown, {}, IAudioFile, {}, {}> & IAudioFile & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
