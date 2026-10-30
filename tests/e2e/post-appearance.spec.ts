import {signInReader} from './ui-support';
import {test,expect} from '@playwright/test';
import {flows} from './flow-support';

test('从讨论板打开帖子时遮住主页，加载和锚点跳转保持背景一致且一次返回原卡片',async({page})=>{
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:1000});await signInReader(page); await page.goto('/discover?panel=discussion');
    const card=page.locator('.post-card').first();await expect(card).toBeVisible();
    const href=(await card.getAttribute('href'))!,id=href.split('/').at(-1)!;
    await card.evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}));
    await card.focus();const originalTop=await page.evaluate(()=>scrollY);
    let release=()=>{};
    const gate=new Promise<void>(resolve=>{release=resolve;});
    await page.route('**/api/v1/posts/'+id,async route=>{await gate;await route.continue();});
    try{
      await card.click();await expect(page.getByText('正在展开讨论……',{exact:true})).toBeVisible();
      await expect(page.locator('.route-base')).toBeHidden();
      await expect(page.locator('.route-overlay')).toHaveCSS('background-color','rgb(245, 239, 249)');
      release();await expect(page.locator('.post-detail h1')).toBeVisible();
      await expect(page.getByTestId('swipe-panel')).toHaveCSS('opacity','1');
      await expect(page.getByTestId('swipe-panel')).toHaveCSS('background-color','rgb(245, 239, 249)');
      for(const label of ['01 帖子正文','02 评论互动','03 相关招募']){
        await page.getByRole('navigation',{name:'帖子内容导航'}).getByRole('link',{name:label,exact:true}).click();
        await expect(page.locator('.route-overlay')).toBeVisible();await expect(page.locator('.route-base')).toBeHidden();
      }
      await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo({top:0,behavior:'instant'});});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:'.local/screenshots/post-overlay-fixed-'+width+'.png',fullPage:true});
      await page.getByRole('button',{name:'返回讨论板',exact:true}).click();
      await expect(page).toHaveURL(/\/discover\?panel=discussion$/);await expect(page.locator('.post-card[href="'+href+'"]').first()).toBeFocused();
      await expect.poll(async()=>Math.abs((await page.evaluate(()=>scrollY))-originalTop)).toBeLessThan(3);
    }finally{release();await page.unrouteAll({behavior:'wait'});}
  }
});

test('收藏成功才显示黄色和动画，刷新保留，取消与减少动画正常；锚点保留评论输入',async({browser})=>{
  test.setTimeout(120000);const f=await flows(browser);let failed=false;
  try{
    await f.create('收藏反馈验收准备窗口');const [owner,reader]=f.pages;
    const topic=(await (await owner.request.get('/api/v1/topics?category=COMPETITION')).json()).data[0];
    const created=await f.post(0,'/posts',{requestKey:crypto.randomUUID(),topicId:topic.id,title:'收藏反馈与帖子背景回归验证',body:'收藏状态需要醒目的黄色反馈，从讨论板打开帖子与跳转正文应有一致的阅读背景。'});expect(created.status()).toBe(201);
    const post=(await created.json()).data;
    await reader.goto('/discover?panel=discussion');await reader.locator('.post-card[data-post-id="'+post.id+'"]').click();
    await expect(reader.getByRole('button',{name:'收藏讨论',exact:true})).toHaveAttribute('aria-pressed','false');
    await reader.route('**/api/v1/favorites',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEST_SAVE_FAILED',message:'收藏未保存，请重试。'}})}),{times:1});
    await reader.getByRole('button',{name:'收藏讨论',exact:true}).click();await expect(reader.getByRole('alert')).toContainText('收藏未保存');
    await expect(reader.getByRole('button',{name:'收藏讨论',exact:true})).not.toHaveClass(/is-saved/);await expect(reader.locator('.save-burst')).toHaveCount(0);
    await reader.getByRole('button',{name:'收藏讨论',exact:true}).click();
    const saved=reader.getByRole('button',{name:'取消收藏',exact:true});await expect(saved).toHaveAttribute('aria-pressed','true');await expect(saved).toHaveClass(/is-saved/);
    await expect(saved).toHaveCSS('background-color','rgb(245, 255, 98)');await expect(reader.locator('.save-burst')).toHaveCSS('animation-name','save-pop');
    await expect(saved).toBeEnabled();
    await reader.getByLabel('写一条评论',{exact:true}).fill('这段未提交评论在页内跳转后仍要保留。');
    for(const label of ['01 帖子正文','02 评论互动','03 相关招募']){
      await reader.getByRole('navigation',{name:'帖子内容导航'}).getByRole('link',{name:label,exact:true}).click();
      await expect(reader.locator('.route-overlay')).toBeVisible();await expect(reader.getByLabel('写一条评论',{exact:true})).toHaveValue('这段未提交评论在页内跳转后仍要保留。');
    }
    await reader.getByRole('link',{name:'写评论 ↓',exact:true}).click();await expect(reader.locator('.route-overlay')).toBeVisible();
    await expect(reader.getByLabel('写一条评论',{exact:true})).toHaveValue('这段未提交评论在页内跳转后仍要保留。');
    await reader.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo({top:0,behavior:'instant'});});
    await reader.screenshot({path:'.local/screenshots/post-saved-yellow-390.png',fullPage:true});
    await reader.reload();await expect(reader.getByRole('button',{name:'取消收藏',exact:true})).toHaveCSS('background-color','rgb(245, 255, 98)');await expect(reader.locator('.save-burst')).toHaveCount(0);
    await reader.getByRole('button',{name:'取消收藏',exact:true}).click();await expect(reader.getByRole('button',{name:'收藏讨论',exact:true})).toHaveAttribute('aria-pressed','false');
    await expect(reader.getByRole('button',{name:'收藏讨论',exact:true})).not.toHaveClass(/is-saved/);
    await reader.emulateMedia({reducedMotion:'reduce'});await reader.getByRole('button',{name:'收藏讨论',exact:true}).click();
    await expect(reader.getByRole('button',{name:'取消收藏',exact:true})).toHaveCSS('background-color','rgb(245, 255, 98)');await expect(reader.locator('.save-burst')).toBeHidden();
  }catch(e){failed=true;throw e;}finally{try{await f.close();}catch(e){if(!failed)throw e;}}
});
