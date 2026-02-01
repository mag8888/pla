import mongoose, { Document } from 'mongoose';
export interface IAudioFile extends Document {
    _id: string;
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
    _id: string;
}> & {
    __v: number;
}, any>;
