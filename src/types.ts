import type { Client } from '@notionhq/client';

export type PageId = string;

export interface FetcherOptions {
  notion: Client;
  shouldFetchPageComment?: (pageItem: any) => boolean;
  shouldFetchBlockComment?: (pageItem: any, blockItem: any) => boolean;
  maxTasksInOneSec?: number;
  handleError?: 'throw' | 'log';
}
