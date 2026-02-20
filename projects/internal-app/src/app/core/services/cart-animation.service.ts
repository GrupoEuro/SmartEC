import { Injectable } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class CartAnimationService {

    constructor() { }

    /**
     * Animates an element (usually an image) flying from its current position 
     * to the Cart Icon in the navbar.
     * 
     * @param startElement The DOM element to clone and animate (e.g. product image)
     * @param targetId The ID of the target element (default: 'cart-icon-target')
     * @param onComplete Optional callback when animation finishes
     */
    animateToCart(startElement: HTMLElement, targetId: string = 'cart-icon-target', onComplete?: () => void): void {
        const target = document.getElementById(targetId);
        if (!target) {
            console.warn(`Cart target #${targetId} not found.`);
            if (onComplete) onComplete();
            return;
        }

        // Create Clone
        const clone = startElement.cloneNode(true) as HTMLElement;
        const rect = startElement.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();

        // Style Clone explicitly to match start position exactly
        clone.style.position = 'fixed';
        clone.style.left = `${rect.left}px`;
        clone.style.top = `${rect.top}px`;
        clone.style.width = `${rect.width}px`;
        clone.style.height = `${rect.height}px`;
        clone.style.zIndex = '9999';
        clone.style.pointerEvents = 'none';
        clone.style.transition = 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)'; // Ease-out quint-ish
        clone.style.borderRadius = getComputedStyle(startElement).borderRadius;
        clone.style.objectFit = 'contain';

        document.body.appendChild(clone);

        // Force reflow
        void clone.offsetWidth;

        // Calculate Target Position (Center of Target)
        // We want the clone to shrink into the center of the cart icon
        const targetX = targetRect.left + (targetRect.width / 2) - (rect.width / 2);
        const targetY = targetRect.top + (targetRect.height / 2) - (rect.height / 2);

        // Animate
        requestAnimationFrame(() => {
            clone.style.left = `${targetX}px`;
            clone.style.top = `${targetY}px`;
            clone.style.transform = 'scale(0.05)';
            clone.style.opacity = '0.7';
        });

        // Cleanup
        setTimeout(() => {
            clone.remove();
            if (onComplete) onComplete();
        }, 800); // Match transition duration
    }
}
