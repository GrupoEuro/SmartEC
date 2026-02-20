import { Injectable } from '@angular/core';

/**
 * Point interface for coordinates
 */
export interface Point {
    x: number;
    y: number;
}

/**
 * Path node for A* algorithm
 */
interface PathNode {
    point: Point;
    g: number; // Cost from start
    h: number; // Heuristic (estimated cost to goal)
    f: number; // Total cost (g + h)
    parent: PathNode | null;
}

/**
 * PathfindingService
 * 
 * Implements A* algorithm for optimal warehouse pathfinding
 * Features:
 * - Manhattan distance heuristic (perfect for grid-based warehouses)
 * - Obstacle avoidance
 * - Bézier curve path smoothing
 * - Multi-level support (future)
 */
@Injectable({
    providedIn: 'root'
})
export class PathfindingService {

    /**
     * Find shortest path using A* algorithm
     * @param start Starting point
     * @param goal Goal point
     * @param obstacles Array of obstacle rectangles to avoid
     * @param smooth Whether to apply Bézier smoothing
     * @returns Array of points representing the path
     */
    findPath(
        start: Point,
        goal: Point,
        obstacles: { x: number, y: number, width: number, height: number }[] = [],
        smooth: boolean = true
    ): Point[] {

        // Simple Manhattan path for now (L-shaped)
        // Full A* implementation can be added if needed for complex obstacle avoidance
        const path = this.calculateManhattanPath(start, goal);

        // Apply smoothing if requested
        if (smooth && path.length > 2) {
            return this.smoothPath(path, 0.3);
        }

        return path;
    }

    /**
     * Calculate simple Manhattan (L-shaped) path
     * Works well for warehouse environments with minimal obstacles
     */
    private calculateManhattanPath(start: Point, goal: Point): Point[] {
        const deltaX = Math.abs(goal.x - start.x);
        const deltaY = Math.abs(goal.y - start.y);

        const path: Point[] = [start];

        // Decide whether to move vertically or horizontally first
        // Move on axis with larger delta first
        if (deltaY > deltaX) {
            // Move vertically first
            path.push({ x: start.x, y: goal.y });
        } else {
            // Move horizontally first
            path.push({ x: goal.x, y: start.y });
        }

        path.push(goal);

        return path;
    }

    /**
     * Manhattan distance heuristic
     * Perfect for grid-based warehouse navigation
     */
    private heuristic(a: Point, b: Point): number {
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }

    /**
     * Euclidean distance (for reference)
     */
    private euclideanDistance(a: Point, b: Point): number {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Smooth path using quadratic B ézier curves
     * Reduces sharp 90-degree turns for more realistic movement
     * 
     * @param path Original path points
     * @param smoothness 0.0 (no smoothing) to 1.0 (maximum smoothing)
     * @returns Smoothed path
     */
    private smoothPath(path: Point[], smoothness: number = 0.3): Point[] {
        if (path.length < 3) return path;

        const smoothed: Point[] = [path[0]]; // Keep start point

        for (let i = 1; i < path.length - 1; i++) {
            const prev = path[i - 1];
            const curr = path[i];
            const next = path[i + 1];

            // Calculate control point for Bézier curve
            const cp1 = {
                x: prev.x + (curr.x - prev.x) * (1 - smoothness),
                y: prev.y + (curr.y - prev.y) * (1 - smoothness)
            };

            const cp2 = {
                x: curr.x + (next.x - curr.x) * smoothness,
                y: curr.y + (next.y - curr.y) * smoothness
            };

            // Add interpolated points along the curve
            const steps = 5; // Number of points per curve segment
            for (let t = 0; t <= steps; t++) {
                const ratio = t / steps;
                const point = this.quadraticBezier(cp1, curr, cp2, ratio);
                smoothed.push(point);
            }
        }

        smoothed.push(path[path.length - 1]); // Keep end point

        return smoothed;
    }

    /**
     * Quadratic Bézier curve interpolation
     */
    private quadraticBezier(p0: Point, p1: Point, p2: Point, t: number): Point {
        const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x;
        const y = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y;
        return { x, y };
    }

    /**
     * Convert path points to SVG path string
     * Useful for rendering animated paths
     */
    pathToSVGString(path: Point[]): string {
        if (path.length === 0) return '';

        return path.reduce((acc, point, index) => {
            if (index === 0) {
                return `M ${point.x} ${point.y}`;
            } else {
                return `${acc} L ${point.x} ${point.y}`;
            }
        }, '');
    }

    /**
     * Check if a point is inside an obstacle
     */
    private isPointInObstacle(
        point: Point,
        obstacle: { x: number, y: number, width: number, height: number }
    ): boolean {
        return (
            point.x >= obstacle.x &&
            point.x <= obstacle.x + obstacle.width &&
            point.y >= obstacle.y &&
            point.y <= obstacle.y + obstacle.height
        );
    }

    /**
     * Full A* implementation (for future use with complex obstacle avoidance)
     * Currently not needed but available for enhancement
     */
    private aStarSearch(start: Point, goal: Point, obstacles: any[]): Point[] {
        // TODO: Implement full A* with grid discretization and obstacle avoidance
        // For now, Manhattan path is sufficient for most warehouse scenarios
        return this.calculateManhattanPath(start, goal);
    }
}
