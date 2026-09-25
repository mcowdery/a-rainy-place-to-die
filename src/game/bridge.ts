import type { WorldNode } from '../content/nodes';

/** What the VN side sees of a node. 2D WorldNodes and 3D district nodes both satisfy it. */
export type HandoffNode = Pick<WorldNode, 'id' | 'kind' | 'name' | 'placementId' | 'returnSpawn' | 'handoff'>;

/**
 * The seam where VN mode plugs in. The world calls enter() with the triggered node and waits.
 * It never interprets node.handoff and holds no VN logic; the real VN integration (exit/entry keys,
 * shared flags) replaces PlaceholderVnBridge without touching the world.
 */
export interface VnBridge {
  enter(node: HandoffNode): Promise<VnReturn>;
}

export interface VnReturn {
  /** Full spawn node id to put the player at. Falls back to the node's own returnSpawn, then to staying put. */
  readonly returnSpawn?: string | null;
}

/** Stand-in that shows what would be handed off, and returns on Esc/Enter. */
export class PlaceholderVnBridge implements VnBridge {
  constructor(private readonly panel: HTMLElement) {}

  enter(node: HandoffNode): Promise<VnReturn> {
    this.panel.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = `VN mode — ${node.name ?? node.id}`;
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(
      { node: node.id, kind: node.kind, placement: node.placementId, returnSpawn: node.returnSpawn, handoff: node.handoff },
      null,
      2,
    );
    const hint = document.createElement('p');
    hint.textContent = 'Placeholder: the VN scene would run here. [Esc] / [Enter] to return to the city.';
    this.panel.append(h, pre, hint);
    this.panel.hidden = false;
    return new Promise((resolve) => {
      const onKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape' && e.key !== 'Enter') return;
        e.preventDefault();
        window.removeEventListener('keydown', onKey, true);
        this.panel.hidden = true;
        resolve({});
      };
      window.addEventListener('keydown', onKey, true);
    });
  }
}
