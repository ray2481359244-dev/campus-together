import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {signInReader} from './ui-support';

test('real post workspaces preserve drafts, reflect URL state and fit every screen',async({page})=>{
  await signInReader(page);await page.goto('/discover?panel=discussion');
  await page.locator('.post-card').first().click();await expect(page.locator('.wb-source h1')).toBeVisible();
  const nav=page.getByRole('navigation',{name:'帖子内容导航'});
  await nav.getByRole('link',{name:'02 评论互动',exact:true}).click();
  await page.getByLabel('写一条评论',{exact:true}).fill('切换工作区后，这份未提交的输入仍应保留。');
  await nav.getByRole('link',{name:'03 相关招募',exact:true}).click();
  await expect(page.locator('.post-workbench')).toHaveAttribute('data-view','act');
  await expect(page.locator('.wb-talk')).toBeHidden();
  await nav.getByRole('link',{name:'01 帖子正文',exact:true}).click();
  await expect(page.locator('.wb-source-body')).toBeVisible();
  await nav.getByRole('link',{name:'02 评论互动',exact:true}).click();
  await expect(page.getByLabel('写一条评论',{exact:true})).toHaveValue('切换工作区后，这份未提交的输入仍应保留。');
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    for(const label of ['01 帖子正文','02 评论互动','03 相关招募']){
      await nav.getByRole('link',{name:label,exact:true}).click();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
      await expect(page.locator('.wb-source h1')).toBeVisible();
      await page.locator('.post-workbench').evaluate(async node=>{await Promise.all(node.getAnimations({subtree:true}).filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
      if(width<=768){
        await expect(nav).toBeInViewport();
        const target=label.startsWith('01')?'.wb-source h1':label.startsWith('02')?'.wb-talk .surface-heading':'.wb-act .surface-heading';
        await expect(page.locator(target)).toBeInViewport();
        await expect.poll(()=>page.locator(target).evaluate(node=>node.getBoundingClientRect().top-(document.querySelector('.wb-nav')?.getBoundingClientRect().bottom||0))).toBeGreaterThanOrEqual(0);
      }
      if([390,1440].includes(width)){
        await page.screenshot({path:`.local/screenshots/workbench-${width}-${label.slice(0,2)}.png`});
      }
    }
  }
});

test('global feedback remains immediate, stops at rest and respects disabled and reduced motion',async({page})=>{
  await signInReader(page);await page.goto('/discover');
  await expect(page.locator('#main-content h1')).toBeVisible();
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.mouse.move(350,260);await expect(page.locator('.pointer-companion')).toHaveAttribute('data-visible','true');
  await page.mouse.move(450,310);await expect(page.locator('.pointer-companion')).toHaveAttribute('data-running','false',{timeout:3000});
  const toggle=page.getByRole('button',{name:'动效开启',exact:true});
  await toggle.focus();await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveClass(/motion-off/);
  await expect(page.locator('.pointer-companion')).toHaveAttribute('data-visible','false');
  await page.getByRole('button',{name:'动效关闭',exact:true}).click();
  await page.goto('/publish');const disabled=page.getByRole('button',{name:'发布讨论',exact:true});
  // A blank form must not be submitted by visual feedback or intercepted clicks.
  if(await disabled.isEnabled())await disabled.click();else await expect(disabled).toBeDisabled();await expect(page).toHaveURL(/\/publish$/);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(page.locator('html')).toHaveClass(/motion-off/);
  await page.mouse.move(500,350);await expect(page.locator('.pointer-companion')).toHaveAttribute('data-visible','false');
  expect(errors).toEqual([]);
});

test('warm navigation records animation frame pacing without delaying route changes',async({page})=>{
  await signInReader(page);await page.goto('/discover');
  const timings:{route:string;milliseconds:number}[]=[];
  // Read-only frame samples during the actual navigation sequence; no mocked timers.
  await page.evaluate(()=>{const samples:number[]=[];(window as unknown as Record<string,unknown>).uiFrameSamples=samples;let last=performance.now(),remaining=360;function sample(now:number){samples.push(now-last);last=now;if(--remaining)requestAnimationFrame(sample);}requestAnimationFrame(sample);});
  await page.evaluate(()=>{
    const results:{route:string;milliseconds:number}[]=[];(window as unknown as Record<string,unknown>).uiRouteSamples=results;
    const longTasks:{start:number;duration:number}[]=[];(window as unknown as Record<string,unknown>).uiLongTasks=longTasks;
    if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>{for(const entry of list.getEntries())longTasks.push({start:Math.round(entry.startTime),duration:Math.round(entry.duration)});}).observe({type:'longtask'});
    document.addEventListener('click',event=>{
      const anchor=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('nav[aria-label="桌面主导航"] a'):null;if(!anchor)return;
      const path=anchor.pathname,started=performance.now(),oldTitle=document.querySelector('#main-content h1')?.textContent;
      function sample(){const title=document.querySelector('#main-content h1');if(location.pathname===path&&title&&title.textContent!==oldTitle&&title.getBoundingClientRect().height){results.push({route:path,milliseconds:Math.round(performance.now()-started)});}else if(performance.now()-started<5000)requestAnimationFrame(sample);}
      requestAnimationFrame(sample);
    },true);
  });
  const routes=[['发布','/publish'],['消息','/messages'],['我的','/me'],['招募','/recruitments'],['发现','/discover']];
  for(const [label,route] of routes){const link=page.getByRole('navigation',{name:'桌面主导航'}).getByRole('link',{name:label,exact:true});await link.hover();const started=Date.now();await link.click();await expect(page).toHaveURL(new RegExp(route+'$'));await expect(page.locator('#main-content h1').first()).toBeVisible();timings.push({route,milliseconds:Date.now()-started});}
  const frames=await page.evaluate(()=>(window as unknown as {uiFrameSamples:number[]}).uiFrameSamples);
  const sorted=frames.filter(n=>n>0).sort((a,b)=>a-b);
  const clickToContent=await page.evaluate(()=>(window as unknown as {uiRouteSamples:{route:string;milliseconds:number}[]}).uiRouteSamples);
  const longTasks=await page.evaluate(()=>(window as unknown as {uiLongTasks:{start:number;duration:number}[]}).uiLongTasks);
  writeFileSync('.local/interaction-performance.json',JSON.stringify({clickToContent,automationWallTimings:timings,frameCount:frames.length,p95FrameMs:sorted[Math.floor(sorted.length*.95)]??null,maxFrameMs:sorted.at(-1)??null,longTasks,note:'Local automated browser sample. clickToContent starts at the browser click event; wall timings include Playwright actionability and assertions. Headless frame pacing is not a device-wide FPS guarantee.'},null,2));
  expect(timings).toHaveLength(5);expect(sorted.length).toBeGreaterThan(0);
});
