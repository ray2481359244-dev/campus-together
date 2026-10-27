import { test, expect } from '@playwright/test';
import { flows } from './flow-support';
import { beijingInput } from '../../apps/web/src/lib/recruitments';
test('四区表单发布、手机核对条件并直接入队', async ({ browser }) => {
  test.setTimeout(120000); const f = await flows(browser);
  try {
    await f.create('场景验收前置条件核对');
    const owner=f.pages[0], participant=f.pages[1];
    await owner.goto('/recruitments/new'); await owner.getByLabel('招募区域',{exact:true}).selectOption('STUDY');
    await owner.getByLabel('招募主题',{exact:true}).selectOption({index:1});
    await owner.getByLabel('招募标题',{exact:true}).fill('本周一起复习高等数学'); await owner.getByLabel('招募说明',{exact:true}).fill('一起复习高等数学的积分与导数内容，先安静自习，再集中讨论疑问，尊重彼此时间。');
    await owner.getByLabel('本次目标',{exact:true}).fill('完成复习'); await owner.getByLabel('协作时段说明',{exact:true}).fill('周六下午共同复习');
    await owner.getByLabel('协作开始时间',{exact:true}).fill(beijingInput(new Date(Date.now()+86400000).toISOString())); await owner.getByLabel('协作结束时间',{exact:true}).fill(beijingInput(new Date(Date.now()+90000000).toISOString()));
    await owner.getByLabel('科目与学习目标',{exact:true}).fill('高等数学积分'); await owner.getByLabel('频次与具体时段',{exact:true}).fill('单次，所列时间'); await owner.getByLabel('加入方式',{exact:true}).selectOption('AUTO'); await owner.getByText('接受跨校意向（按身份资料校验）',{exact:true}).check();
    await owner.getByRole('button',{name:'预览并发布',exact:true}).click(); await expect(owner.getByLabel('招募发布预览')).toBeVisible(); await owner.getByRole('button',{name:'确认发布招募',exact:true}).click(); await expect(owner).toHaveURL(/\/recruitments\/[0-9a-f-]{36}$/);
    const path=new URL(owner.url()).pathname; await participant.goto(path); await participant.getByLabel('申请岗位',{exact:true}).selectOption({index:1}); await participant.getByLabel('本次时间确认',{exact:true}).selectOption('yes'); await participant.getByRole('button',{name:'核对申请条件',exact:true}).click(); await expect(participant.getByRole('heading',{name:'核对结果：通过',exact:true})).toBeVisible(); await participant.getByRole('button',{name:'确认直接加入',exact:true}).click(); await expect(participant.getByText(/已入队 · 当前有效成员/)).toBeVisible(); await participant.getByRole('link',{name:'进入我的队伍 →',exact:true}).click(); await expect(participant.getByRole('link',{name:/群聊/})).toBeVisible();
    expect(await participant.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  } finally { await f.close(); }
});
