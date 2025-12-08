export declare function getActiveReviews(limit?: number): Promise<{
    id: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    content: string;
    isActive: boolean;
    link: string | null;
    photoUrl: string | null;
    isPinned: boolean;
}[]>;
