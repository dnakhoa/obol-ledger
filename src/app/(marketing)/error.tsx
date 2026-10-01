'use client';

/**
 * The landing page's error boundary: the application's own, so a failure
 * here — a session lookup with the database down — reads the same as one
 * anywhere else, digest and all, instead of Next's bare default.
 */
export { default } from '@/app/(app)/error';
