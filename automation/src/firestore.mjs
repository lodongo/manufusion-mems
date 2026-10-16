import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { assertProjectConfigured } from './projectGuard.mjs';

export function database() {
  const projectId = assertProjectConfigured();
  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId });
  return getFirestore();
}

/** Immutable dated rates, atomically published current pointer; safe on retries. */
export async function persistRates(snapshot) {
  const db = database();
  const dated = db.collection('fx_reference_snapshots').doc(snapshot.effectiveDate + '_USD');
  const active = db.collection('fx_control').doc('latest_USD');
  return await db.runTransaction(async tx => {
    const [existing, previous] = await Promise.all([tx.get(dated), tx.get(active)]);
    if (existing.exists) return { status: 'already-imported', effectiveDate: snapshot.effectiveDate };
    const previousDate = previous.exists ? previous.data()?.effectiveDate : '';
    if (previousDate && previousDate > snapshot.effectiveDate)
      return { status: 'older-than-current', effectiveDate: snapshot.effectiveDate };
    tx.create(dated, snapshot);
    tx.set(active, { ...snapshot, lastPublishedAt: new Date().toISOString() });
    return { status: 'published', effectiveDate: snapshot.effectiveDate, count: snapshot.rateCount };
  });
}

export async function latestRates() {
  const db = database();
  const doc = await db.collection('fx_control').doc('latest_USD').get();
  return doc.exists ? doc.data() : null;
}
