export declare function getActiveReviews(limit?: number): Promise<{
    id: string;
    name: string;
    link: string | null;
    createdAt: Date;
    updatedAt: Date;
    content: string;
    isActive: boolean;
    photoUrl: string | null;
    isPinned: boolean;
}[]>;
