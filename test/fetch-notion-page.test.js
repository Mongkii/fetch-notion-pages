import fs from 'fs';
import path from 'path';
import url from 'url';
import { Client } from '@notionhq/client';

import { fetchNotionPages } from '../dist/index.js';
import { NOTION_TOKEN } from './config.js'; // A config.js file which stores tokens is needed

const notion = new Client({
  auth: NOTION_TOKEN,
});

(async () => {
  const allPageIds = [];

  const filename = url.fileURLToPath(import.meta.url);
  const dirname = path.dirname(filename);

  console.log('Start fetching');

  const startTime = Date.now();
  const result = await fetchNotionPages(allPageIds, {
    notion,
    handleError: 'throw',
  });

  console.log('Time used', (Date.now() - startTime) / 1000);

  fs.writeFileSync(
    path.resolve(path.resolve(dirname, './result.json')),
    JSON.stringify(result),
    'utf-8'
  );
})();
