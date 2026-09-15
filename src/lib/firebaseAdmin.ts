import { initializeApp, getApps, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';

const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || 'primeopportunity-18381';

// One shared admin app for the whole process. Initialized without a service
// account: ID-token verification only needs Google's public signing keys (fetched
// over HTTPS), never a private credential, so this works on any host.
let app: App | null = null;

export const initFirebaseAdmin = (): App => {
  if (!app) {
    app = getApps()[0] || initializeApp({ projectId: FIREBASE_PROJECT_ID });
  }
  return app;
};

export const getAdminAuth = (): Auth => {
  initFirebaseAdmin();
  return getAuth();
};