/**
 * Typed access to shared/pages.json - the single registry of pages used by the
 * router, the sidebar and (from Phase 9) the voice assistant's navigation tool.
 */
import rawPages from '@shared/pages.json';
import type { Role } from './types';

export interface PageDef {
  key: string;
  path: string;
  title: string;
  roles: Role[];
  description: string;
  aliases?: string[];
  nav?: boolean;
  icon?: string;
  requires_params?: string[];
}

export const PAGES: PageDef[] = rawPages as PageDef[];

export function pagesForRole(role: Role): PageDef[] {
  return PAGES.filter((p) => p.roles.includes(role));
}

export function navPagesForRole(role: Role): PageDef[] {
  return pagesForRole(role).filter((p) => p.nav);
}

export function pageByKey(key: string): PageDef {
  const page = PAGES.find((p) => p.key === key);
  if (!page) throw new Error(`Unknown page key: ${key}`);
  return page;
}

/** Where each role lands after logging in. */
export function homePathFor(role: Role): string {
  return `/${role}`;
}

export function profilePathFor(role: Role): string {
  return `/${role}/profile`;
}
