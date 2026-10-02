import { SkyModel } from './skyModel';

/** Computes the physical sky's table (real/skyModel.ts, about a second) off the main thread and sends it back once. */
const m = new SkyModel();
(self as unknown as Worker).postMessage({ data: m.data, sun: m.sun }, [m.data.buffer, m.sun.buffer]);
