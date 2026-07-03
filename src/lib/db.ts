// Local patient/study database (IndexedDB). Studies stay on the user's device —
// no PET pixel data or PHI is uploaded to any server. Vercel just serves the app.

import type { PetStudy } from "./types";

const DB_NAME = "pet-suv-simulator";
const STORE = "studies";
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveStudy(study: PetStudy): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(study);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getStudy(id: string): Promise<PetStudy | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as PetStudy) ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Lightweight study metadata for listing (without pixel arrays). */
export interface StudySummary {
  id: string;
  patientName: string;
  patientId: string;
  uptakeMinutes: number;
  suvValid: boolean;
  sliceCount: number;
  suvMax: number;
  createdAt: number;
  isDemo?: boolean;
  seriesDescription?: string;
}

export async function listStudies(): Promise<StudySummary[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      db.close();
      const studies = (req.result as PetStudy[]) ?? [];
      resolve(
        studies
          .map((s) => ({
            id: s.id,
            patientName: s.patientName,
            patientId: s.patientId,
            uptakeMinutes: s.uptakeMinutes,
            suvValid: s.suvValid,
            sliceCount: s.slices.length,
            suvMax: s.suvMax,
            createdAt: s.createdAt,
            isDemo: s.isDemo,
            seriesDescription: s.seriesDescription,
          }))
          .sort((a, b) => b.createdAt - a.createdAt)
      );
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteStudy(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}
