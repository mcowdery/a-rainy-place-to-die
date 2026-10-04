/**
 * The tape deck: the player's own music, from a folder on their machine (nothing is uploaded or shipped; the
 * files are read where they are). Where the browser can pick a folder and remember it (Chromium's
 * showDirectoryPicker, the handle kept in IndexedDB) the cassette is still there next time, after the browser has
 * been asked again for leave to read it (which needs a key press or click); elsewhere a folder is picked through a
 * file input and lasts until the page is closed. Tracks play in a shuffled order, from where the tape was stopped.
 */

const AUDIO = /\.(mp3|ogg|opus|oga|m4a|aac|flac|wav)$/i;
const MAX_TRACKS = 2000;
const MAX_DEPTH = 4;
const DB = 'citypop.tape';

interface DirHandle {
  readonly name: string;
  readonly kind: 'directory';
  values(): AsyncIterable<DirHandle | FileHandle>;
  queryPermission?(o: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'read' }): Promise<PermissionState>;
}
interface FileHandle {
  readonly name: string;
  readonly kind: 'file';
  getFile(): Promise<File>;
}

export interface TapeTrack {
  readonly title: string;
  file(): Promise<File>;
}

function idb<T>(run: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        const req = run(open.result.transaction('kv', mode).objectStore('kv'));
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

export class Tape {
  /** The folder's name (the cassette's label), and its tracks in the order they play. */
  label = '';
  tracks: TapeTrack[] = [];
  index = 0;
  /** Seconds into the current track when the tape was last stopped. */
  position = 0;
  /** A folder remembered from before, not yet read (the browser wants to be asked again). */
  private kept: DirHandle | null = null;

  constructor() {
    void idb<DirHandle>((s) => s.get('folder'), 'readonly').then((h) => {
      if (h && !this.tracks.length) {
        this.kept = h;
        this.label = h.name;
      }
    });
  }

  get loaded(): boolean {
    return this.tracks.length > 0;
  }

  /** A folder was chosen before and can be read again for the asking. */
  get remembered(): boolean {
    return this.kept !== null;
  }

  get current(): TapeTrack | null {
    return this.tracks[this.index] ?? null;
  }

  /** On to the next track (or back), from its start. */
  skip(dir: 1 | -1): void {
    if (!this.tracks.length) return;
    this.index = (this.index + dir + this.tracks.length) % this.tracks.length;
    this.position = 0;
  }

  /** Reads the folder remembered from last time. Call from a key press or click. False if there's none or the
   * browser says no. */
  async reopen(): Promise<boolean> {
    const h = this.kept;
    if (!h) return false;
    let ok = false;
    try {
      ok = ((await h.queryPermission?.({ mode: 'read' })) === 'granted' || (await h.requestPermission?.({ mode: 'read' })) === 'granted') && (await this.read(h));
    } catch {
      /* moved, deleted or refused */
    }
    if (!ok) {
      this.kept = null;
      this.label = '';
    }
    return ok;
  }

  /** Asks for a folder of music. Call from a key press or click. False if none was chosen or it holds no music. */
  async choose(): Promise<boolean> {
    const pick = (window as unknown as { showDirectoryPicker?: (o: object) => Promise<DirHandle> }).showDirectoryPicker;
    if (pick) {
      let h: DirHandle;
      try {
        h = await pick.call(window, { id: 'citypop-tape', mode: 'read', startIn: 'music' });
      } catch {
        return false;
      }
      if (!(await this.read(h))) return false;
      this.kept = h;
      void idb((s) => s.put(h, 'folder'), 'readwrite');
      return true;
    }
    const files = await new Promise<File[]>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.setAttribute('webkitdirectory', '');
      input.onchange = () => resolve([...(input.files ?? [])]);
      input.oncancel = () => resolve([]);
      input.click();
    });
    const music = files.filter((f) => AUDIO.test(f.name)).slice(0, MAX_TRACKS);
    if (!music.length) return false;
    this.load(files[0].webkitRelativePath.split('/')[0] || 'TAPE', music.map((f) => ({ title: f.name.replace(AUDIO, ''), file: () => Promise.resolve(f) })));
    return true;
  }

  private async read(dir: DirHandle): Promise<boolean> {
    const found: TapeTrack[] = [];
    const walk = async (d: DirHandle, depth: number): Promise<void> => {
      for await (const e of d.values()) {
        if (found.length >= MAX_TRACKS) return;
        if (e.kind === 'file') {
          if (AUDIO.test(e.name)) found.push({ title: e.name.replace(AUDIO, ''), file: () => e.getFile() });
        } else if (depth < MAX_DEPTH) await walk(e, depth + 1);
      }
    };
    await walk(dir, 0);
    if (!found.length) return false;
    this.load(dir.name, found);
    return true;
  }

  private load(label: string, tracks: TapeTrack[]): void {
    for (let i = tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    }
    this.label = label;
    this.tracks = tracks;
    this.index = 0;
    this.position = 0;
  }
}
