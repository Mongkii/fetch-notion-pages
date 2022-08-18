import { PropertyItemPropertyItemListResponse } from '@notionhq/client/build/src/api-endpoints.js';

import { TaskManager } from './task-manager.js';
import { FetcherOptions, PageId } from './types';

const isObjEmpty = (obj: Record<any, any>) => {
  let isEmpty = true;
  for (const key in obj) {
    isEmpty = false;
    break;
  }
  return isEmpty;
};

export const flattenPageBlocks = (pageItem: any) => {
  let blocks: any[] = [...pageItem.children] || [];

  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    const children = block[block.type]?.children;
    if (children && children.length > 0) {
      blocks.push(...children);
    }
    i += 1;
  }

  return blocks;
};

interface FetchResult {
  pages: any[];
  failedPages: {
    [pageId: string]: any;
  };
}

export const fetchNotionPages = async (
  pageIds: PageId[],
  options: FetcherOptions
): Promise<FetchResult> => {
  const taskManager = new TaskManager(options.maxTasksInOneSec ?? 3);
  const { notion } = options;

  const pages: FetchResult['pages'] = [];
  const failedPages: FetchResult['failedPages'] = {};

  const handleError = (pageId: string, e: any) => {
    if (options.handleError === 'throw') {
      throw e;
    }
    failedPages[pageId] = e;
  };

  async function fetchPage(pageId: PageId) {
    try {
      const pageItem = await notion.pages.retrieve({ page_id: pageId });
      pages.push(pageItem);

      Object.values((pageItem as any).properties || {}).forEach((propItem) => {
        taskManager.addTask(async () => await fetchPageProp(pageItem, propItem));
      });
      taskManager.addTask(async () => await fetchBlockChildren(pageId, pageItem));
    } catch (e) {
      handleError(pageId, e);
    }
  }

  async function fetchPageProp(pageItem: any, propItem: any) {
    try {
      const fullProp = await notion.pages.properties.retrieve({
        page_id: pageItem.id,
        property_id: propItem.id,
      });

      if (!('next_cursor' in fullProp)) {
        Object.assign(propItem, fullProp);
        return;
      }

      const { has_more, next_cursor, ...restProp } = fullProp;
      Object.assign(propItem, restProp);

      if (next_cursor) {
        taskManager.addTask(
          async () => await fetchPagePropAtCursor(pageItem, propItem, next_cursor)
        );
      }
    } catch (e) {
      handleError(pageItem.id, e);
    }
  }

  async function fetchPagePropAtCursor(pageItem: any, propItem: any, startCursor: string) {
    try {
      const { results, next_cursor } = (await notion.pages.properties.retrieve({
        page_id: pageItem.id,
        property_id: propItem.id,
        start_cursor: startCursor,
      })) as PropertyItemPropertyItemListResponse;

      propItem.results.push(...results);

      if (next_cursor) {
        taskManager.addTask(
          async () => await fetchPagePropAtCursor(pageItem, propItem, next_cursor)
        );
      }
    } catch (e) {
      handleError(pageItem.id, e);
    }
  }

  async function fetchBlockChildren(pageId: string, pageOrBlockItem: any, startCursor?: string) {
    try {
      const { results, next_cursor } = await notion.blocks.children.list({
        block_id: pageOrBlockItem.id,
        start_cursor: startCursor,
      });

      const childrenContainer =
        pageOrBlockItem.object === 'page' ? pageOrBlockItem : pageOrBlockItem[pageOrBlockItem.type];
      if (!childrenContainer.children) {
        childrenContainer.children = [];
      }
      childrenContainer.children.push(...results);

      const nestedChildren = results.filter((child) => (child as any).has_children);
      nestedChildren.forEach((child) => {
        taskManager.addTask(async () => await fetchBlockChildren(pageId, child));
      });

      if (next_cursor) {
        taskManager.addTask(
          async () => await fetchBlockChildren(pageId, pageOrBlockItem, next_cursor)
        );
      }
    } catch (e) {
      handleError(pageId, e);
    }
  }

  async function fetchPageComment(pageItem: any, startCursor?: string) {
    try {
      const { results, next_cursor } = await notion.comments.list({
        block_id: pageItem.id,
        start_cursor: startCursor,
      });

      if (!pageItem.page_comments) {
        pageItem.page_comments = [];
      }
      pageItem.page_comments.push(...results);

      if (next_cursor) {
        taskManager.addTask(async () => await fetchPageComment(pageItem, next_cursor));
      }
    } catch (e) {
      handleError(pageItem.id, e);
    }
  }

  async function fetchBlockComment(pageItem: any, blockItem: any, startCursor?: string) {
    try {
      const blockId = blockItem.id;

      const { results, next_cursor } = await notion.comments.list({
        block_id: blockItem.id,
        start_cursor: startCursor,
      });

      if (!pageItem.block_comments) {
        pageItem.block_comments = {};
      }
      if (!pageItem.block_comments[blockId]) {
        pageItem.block_comments[blockId] = [];
      }
      pageItem.block_comments[blockId].push(...results);

      if (next_cursor) {
        taskManager.addTask(async () => await fetchBlockComment(pageItem, blockItem, next_cursor));
      }
    } catch (e) {
      handleError(pageItem.id, e);
    }
  }

  pageIds.forEach((pageId) => {
    taskManager.addTask(async () => await fetchPage(pageId));
  });
  taskManager.start();
  await taskManager.isDone();

  const successPages = isObjEmpty(failedPages)
    ? pages
    : pages.filter((page) => !(page.id in failedPages));

  const { shouldFetchPageComment, shouldFetchBlockComment } = options;
  if (!(shouldFetchPageComment || shouldFetchBlockComment)) {
    return { pages: successPages, failedPages };
  }

  const failedPagesBeforeComment = { ...failedPages };

  if (shouldFetchPageComment) {
    successPages.filter(shouldFetchPageComment).forEach((pageItem) => {
      taskManager.addTask(async () => await fetchPageComment(pageItem));
    });
  }
  if (shouldFetchBlockComment) {
    successPages.forEach((pageItem) => {
      const flattenBlocks = flattenPageBlocks(pageItem);
      flattenBlocks
        .filter((blockItem) => shouldFetchBlockComment(pageItem, blockItem))
        .forEach((blockItem) => {
          taskManager.addTask(async () => await fetchBlockComment(pageItem, blockItem));
        });
    });
  }
  taskManager.start();
  await taskManager.isDone();

  const failedPageIdsAfterComment = new Set<PageId>();
  for (const pageId in failedPages) {
    if (!(pageId in failedPagesBeforeComment)) {
      failedPageIdsAfterComment.add(pageId);
    }
  }

  const successPagesAfterComment =
    failedPageIdsAfterComment.size < 1
      ? successPages
      : successPages.filter((pageItem) => !failedPageIdsAfterComment.has(pageItem.id));

  return { pages: successPagesAfterComment, failedPages };
};
