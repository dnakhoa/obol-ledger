'use client';

import { createAuthClient } from 'better-auth/react';
import { anonymousClient } from 'better-auth/client/plugins';

/**
 * The browser half of authentication.
 *
 * Only the sign-in and sign-out calls happen here; everything that decides
 * what a person may *do* runs on the server, where a membership row and a
 * row-level security policy can be consulted. A client that could decide its
 * own permissions would be a client that could lie about them.
 */
export const authClient = createAuthClient({ plugins: [anonymousClient()] });
