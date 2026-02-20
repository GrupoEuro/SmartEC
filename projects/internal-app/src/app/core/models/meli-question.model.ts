export interface MeliQuestion {
    id: string;
    item_id: string;
    date_created: string;
    status: 'UNANSWERED' | 'ANSWERED' | 'CLOSED_UNANSWERED' | 'UNDER_REVIEW';
    text: string;
    answer?: {
        text: string;
        date_created: string;
        status: string;
    };
    from: {
        id: number;
    };
    // Internal fields
    itemTitle?: string;
    itemThumbnail?: string;
}
