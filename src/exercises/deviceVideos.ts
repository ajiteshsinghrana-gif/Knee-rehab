/**
 * Videos kept in this browser only (IndexedDB), for when the clinic has no cloud storage or the physio is not signed in.
 * localStorage cannot hold video (about 5 MB), IndexedDB can. These videos never reach a patient's phone: the physio's
 * screen says so, and the sync slice drops them.
 */
const DB = 'rehabpath-videos';
const STORE = 'videos';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('This browser cannot keep videos on this device. Paste a link instead.')); return; }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not open the video store on this device.'));
  });
}
const run = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = f(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(new Error('Could not save the video on this device (storage may be full).'));
      tx.onabort = () => reject(new Error('Could not save the video on this device (storage may be full).'));
    });
  } finally { db.close(); }
};

export const newLocalId = (): string => { const b = new Uint8Array(12); crypto.getRandomValues(b); return `v${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`; };
export const saveLocalVideo = async (id: string, blob: Blob): Promise<void> => { await run('readwrite', (s) => s.put(blob, id)); };
export const loadLocalVideo = async (id: string): Promise<Blob | null> => { try { return ((await run('readonly', (s) => s.get(id))) as Blob | undefined) ?? null; } catch { return null; } };
export const deleteLocalVideo = async (id: string): Promise<void> => { try { await run('readwrite', (s) => s.delete(id)); } catch { /* already gone */ } };
