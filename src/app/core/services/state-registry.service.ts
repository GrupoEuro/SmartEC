import { Injectable, signal, WritableSignal } from '@angular/core';

export interface StateNode {
    name: string;
    get: () => any;
    set?: (value: any) => void;
}

@Injectable({
    providedIn: 'root'
})
export class StateRegistryService {
    private registry = new Map<string, StateNode>();

    // Public signal for UI to react to changes in registry
    readonly registeredServices = signal<string[]>([]);

    register(node: StateNode) {
        this.registry.set(node.name, node);
        this.updateList();
        console.log(`[StateRegistry] Registered: ${node.name}`);
    }

    get(name: string): any {
        const node = this.registry.get(name);
        return node ? node.get() : null;
    }

    set(name: string, value: any) {
        const node = this.registry.get(name);
        if (node && node.set) {
            node.set(value);
            console.log(`[StateRegistry] Restored state for: ${name}`);
        } else {
            console.warn(`[StateRegistry] No setter for: ${name}`);
        }
    }

    getAllState(): Record<string, any> {
        const state: Record<string, any> = {};
        this.registry.forEach((node, name) => {
            state[name] = node.get();
        });
        return state;
    }

    restoreAllState(fullState: Record<string, any>) {
        Object.keys(fullState).forEach(name => {
            this.set(name, fullState[name]);
        });
    }

    private updateList() {
        this.registeredServices.set(Array.from(this.registry.keys()));
    }
}
