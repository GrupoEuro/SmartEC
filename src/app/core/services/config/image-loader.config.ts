import { ImageLoaderConfig, IMAGE_LOADER } from '@angular/common';

export const provideImageLoader = () => {
    return {
        provide: IMAGE_LOADER,
        useValue: (config: ImageLoaderConfig) => {
            // TODO: Replace with your actual ImageKit ID or environment variable
            // Example: https://ik.imagekit.io/your_id/
            // For now we use a placeholder or the raw Firebase URL if not set
            if (config.src.startsWith('http')) {
                // Optional: If you have a CDN, you can rewrite firebase URLs here
                // For now, we just append width for reference if useful
                return config.src;
            }

            // If it's a local path, we might want to throw or handle differently
            return config.src;
        }
    };
};
