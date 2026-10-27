import { test, expect } from '@playwright/test';
import { flows } from './flow-support';
test('图片讨论、手机评论点赞收藏和删除评论持久化',async({browser})=>{
  test.setTimeout(120000);const f=await flows(browser);let failed=false;let releaseUpload=()=>{};
  try {
    await f.create('社区互动验收准备窗口');const owner=f.pages[0], reader=f.pages[1];
    await owner.goto('/publish');await owner.getByLabel('标题',{exact:true}).fill('图片讨论与社区互动浏览器验收');await owner.getByLabel('正文',{exact:true}).fill('这是一条真实持久化的图片讨论，用于验证评论、点赞和收藏的完整操作流程。');
    const bytes=await owner.evaluate(()=>{const c=document.createElement('canvas');c.width=120;c.height=80;const ctx=c.getContext('2d')!;ctx.fillStyle='#e5ff55';ctx.fillRect(0,0,120,80);return c.toDataURL('image/png').split(',')[1];});
    const uploadGate=new Promise<void>(resolve=>{releaseUpload=resolve;});await owner.route('**/api/v1/media',async route=>{await uploadGate;await route.continue();});
    await owner.getByLabel('添加讨论图片',{exact:true}).setInputFiles({name:'discussion.png',mimeType:'image/png',buffer:Buffer.from(bytes,'base64')});await expect(owner.getByRole('button',{name:'发布讨论',exact:true})).toBeDisabled();releaseUpload();await expect(owner.getByAltText('待发布配图')).toBeVisible();await owner.getByRole('button',{name:'发布讨论',exact:true}).click();await expect(owner).toHaveURL(/\/posts\/[0-9a-f-]{36}$/);await expect(owner.getByAltText('讨论配图')).toBeVisible();
    const path=new URL(owner.url()).pathname;await reader.goto(path);await reader.getByRole('button',{name:'点赞 · 0',exact:true}).click();await expect(reader.getByRole('button',{name:'取消点赞 · 1',exact:true})).toBeVisible();await reader.getByRole('button',{name:'收藏讨论',exact:true}).click();await expect(reader.getByRole('button',{name:'取消收藏',exact:true})).toBeVisible();
    await reader.getByLabel('写一条评论',{exact:true}).fill('这条图片讨论我已看到，愿意一起参与。');await reader.getByRole('button',{name:'发布评论',exact:true}).click();await expect(reader.getByText('这条图片讨论我已看到，愿意一起参与。',{exact:true})).toBeVisible();await reader.reload();await expect(reader.getByText('这条图片讨论我已看到，愿意一起参与。',{exact:true})).toBeVisible();await reader.getByRole('button',{name:'删除我的评论',exact:true}).click();await expect(reader.getByText('还没有评论，来聊聊你的想法。',{exact:true})).toBeVisible();
    await reader.getByRole('link',{name:'我的收藏',exact:true}).click();await expect(reader.getByRole('link',{name:'图片讨论与社区互动浏览器验收',exact:true})).toBeVisible();expect(await reader.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await reader.screenshot({path:'.local/community-mobile.png',fullPage:true});await owner.screenshot({path:'.local/community-desktop.png',fullPage:true});
  } catch(e) { failed=true;throw e; } finally {releaseUpload();try{await f.close();}catch(e){if(!failed)throw e;}}
});
