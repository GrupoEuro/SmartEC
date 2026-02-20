export interface Address {
    id?: string;
    label?: string; // e.g., "Home", "Office"
    street: string;
    extNum: string;
    intNum?: string;
    colonia: string; // Neighborhood
    city: string;
    state: string;
    zip: string;
    country: string;
    isDefault?: boolean;
    reference?: string;
}
