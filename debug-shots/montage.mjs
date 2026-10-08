// Several shots side by side in one picture (rows of `cols`), each labelled with its file's name.
//   node debug-shots/montage.mjs <out.png> <cols> <width of each> <files...>
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
const [out, cols, width, ...files] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 100, height: 100 } });
const cells = files.map((f) => `<td><div>${basename(f, '.png')}</div><img width="${width}" src="data:image/png;base64,${readFileSync(f).toString('base64')}"></td>`);
let html = '<body style="margin:0;background:#111;color:#ddd;font:12px Consolas,monospace"><table cellspacing="2" cellpadding="0">';
for (let i = 0; i < cells.length; i += Number(cols)) html += `<tr>${cells.slice(i, i + Number(cols)).join('')}</tr>`;
await page.setContent(`${html}</table></body>`);
await page.waitForTimeout(200);
await (await page.$('table')).screenshot({ path: out });
await browser.close();
