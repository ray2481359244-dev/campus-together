import { test, expect } from '@playwright/test';
import { flows } from './flow-support';
import { beijingInput } from '../../apps/web/src/lib/recruitments';
test('轻量表单发布、手机直接入队并打开群聊', async ({ browser }) => {
  test.setTimeout(120000); const f = await flows(browser);
  try {
    await f.create('场景验收前置条件核对');
    const owner=f.pages[0], participant=f.pages[1];
    await owner.goto('/recruitments/new');
    await owner.getByRole('combobox',{name:'招募区域',exact:true}).selectOption('STUDY', { timeout: 8000 });
    await owner.getByRole('combobox',{name:'招募主题',exact:true}).selectOption({index:1}, { timeout: 8000 });
    await owner.getByLabel('再找几位',{exact:true}).fill('1'); await expect(owner.getByText('你 + 1 位伙伴，共 2 人',{exact:true})).toBeVisible();
    await owner.getByLabel('招募标题',{exact:true}).fill('本周一起复习高等数学');
    await owner.getByRole('combobox',{name:'时间安排',exact:true}).selectOption('FIXED');
    await owner.getByLabel('协作开始时间',{exact:true}).fill(beijingInput(new Date(Date.now()+86400000).toISOString()));
    await owner.getByRole('button',{name:'发布招募',exact:true}).click();
    await expect(owner).toHaveURL(/\/recruitments\/[0-9a-f-]{36}$/);
    await expect(owner.getByRole('link',{name:'进入队伍群',exact:true})).toBeVisible();
    const path=new URL(owner.url()).pathname; await participant.goto(path);
    await participant.getByRole('button',{name:'加入队伍',exact:true}).click();
    await participant.getByRole('button',{name:'确认加入',exact:true}).click();
    await expect(participant.getByText(/已入队 · 当前有效成员/)).toBeVisible();
    await participant.getByRole('link',{name:'打开队伍群',exact:true}).click();
    await expect(participant.getByRole('region',{name:'队伍群聊',exact:true})).toBeVisible();
    expect(await participant.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  } finally { await f.close(); }
});
