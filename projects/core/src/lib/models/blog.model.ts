export interface BlogAuthor {
    name: string;
    avatar: string;
    role: string;
}

export interface BlogPost {
    id: string;
    slug: string;
    title: string;
    excerpt: string;
    content: string; // HTML content
    coverImage: string;
    date: Date;
    author: BlogAuthor;
    category: 'Mantenimiento' | 'Novedades' | 'Consejos' | 'Tecnología';
    readTime: number; // in minutes
    tags: string[];
}
