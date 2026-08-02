/**
 * In-process collab bus — default single-node fan-out (v0.7 M1).
 * Useful for tests and as the local half of multi-node setups.
 */

import { randomBytes } from 'node:crypto';
import type { CollabEvent } from './collab-types.js';
import type { CollabBus, CollabBusEnvelope, CollabBusHandler, CollabBusStatus } from './collab-bus.js';

export function createMemoryCollabBus(): CollabBus {
  const nodeId = randomBytes(8).toString('hex');
  const handlers = new Set<CollabBusHandler>();

  return {
    kind: 'memory',
    nodeId,
    publish(projectId: string, event: CollabEvent) {
      const envelope: CollabBusEnvelope = {
        projectId,
        event,
        originNodeId: nodeId,
        ts: new Date().toISOString(),
      };
      for (const h of [...handlers]) {
        try {
          h(envelope);
        } catch {
          // ignore
        }
      }
    },
    subscribe(handler: CollabBusHandler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    status(): CollabBusStatus {
      return {
        kind: 'memory',
        nodeId,
        ready: true,
        detail: `in-process handlers=${handlers.size}`,
      };
    },
    close() {
      handlers.clear();
    },
  };
}
