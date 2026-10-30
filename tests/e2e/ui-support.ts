import {expect, type Page} from '@playwright/test';
import {existsSync,readFileSync} from 'node:fs';

// Reading now happens inside the authenticated platform. Reuse a real session,
// with a standalone fallback when this test file is run by itself.
export async function signInReader(page:Page){
  if((await (await page.request.get('/api/v1/auth/me')).json()).data.user)return;
  for(const file of ['.local/e2e-application-observer.json','.local/e2e-ui-reader.json']){
    if(!existsSync(file))continue;
    await page.context().addCookies(JSON.parse(readFileSync(file,'utf8')).cookies);
    if((await (await page.request.get('/api/v1/auth/me')).json()).data.user)return;
  }
  await page.goto('/register');
  await page.getByLabel('邮箱',{exact:true}).fill('ui-reader-'+Date.now()+'@campus.invalid');
  await page.getByLabel('密码',{exact:true}).fill('ReaderBrowser2026!');
  await page.getByLabel('昵称',{exact:true}).fill('界面阅读体验');
  await page.getByRole('combobox',{name:'学校（自述）',exact:true}).selectOption({label:'星原大学（虚构演示）'});
  await page.getByRole('button',{name:'创建账号，开始碰个头'}).click();
  await expect(page).toHaveURL(/\/discover/);
  await page.context().storageState({path:'.local/e2e-ui-reader.json'});
}
