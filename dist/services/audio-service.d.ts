export interface AudioFileData {
    title: string;
    description?: string;
    fileId: string;
    duration?: number;
    fileSize?: number;
    mimeType?: string;
    category?: string;
}
export declare function createAudioFile(data: AudioFileData): Promise<{
    id: string;
    duration: number | null;
    title: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    category: string | null;
    isActive: boolean;
    fileId: string;
    fileSize: number | null;
    mimeType: string | null;
}>;
export declare function getActiveAudioFiles(category?: string): Promise<{
    id: string;
    duration: number | null;
    title: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    category: string | null;
    isActive: boolean;
    fileId: string;
    fileSize: number | null;
    mimeType: string | null;
}[]>;
export declare function getAllAudioFiles(): Promise<{
    id: string;
    duration: number | null;
    title: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    category: string | null;
    isActive: boolean;
    fileId: string;
    fileSize: number | null;
    mimeType: string | null;
}[]>;
export declare function getAudioFileById(id: string): Promise<{
    id: string;
    duration: number | null;
    title: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    category: string | null;
    isActive: boolean;
    fileId: string;
    fileSize: number | null;
    mimeType: string | null;
} | null>;
export declare function updateAudioFile(id: string, data: Partial<AudioFileData & {
    isActive?: boolean;
}>): Promise<{
    id: string;
    duration: number | null;
    title: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    category: string | null;
    isActive: boolean;
    fileId: string;
    fileSize: number | null;
    mimeType: string | null;
}>;
export declare function deleteAudioFile(id: string): Promise<{
    id: string;
    duration: number | null;
    title: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    category: string | null;
    isActive: boolean;
    fileId: string;
    fileSize: number | null;
    mimeType: string | null;
}>;
export declare function toggleAudioFileStatus(id: string): Promise<{
    id: string;
    duration: number | null;
    title: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    category: string | null;
    isActive: boolean;
    fileId: string;
    fileSize: number | null;
    mimeType: string | null;
}>;
export declare function formatDuration(seconds: number): string;
