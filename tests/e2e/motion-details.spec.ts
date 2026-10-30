import {test,expect} from '@playwright/test';
import {signInReader} from './ui-support';

test('held and interrupted disclosure presses return to native font size without filled scale animations',async({page})=>{
  await signInReader(page);await page.goto('/recruitments');
  const summaries=page.locator('.my-drafts summary');await expect(summaries).toHaveCount(3);
  for(const summary of await summaries.all()){
    const before=await summary.evaluate(node=>({height:(node as HTMLElement).offsetHeight,font:getComputedStyle(node).fontSize}));
    const box=(await summary.boundingBox())!;await page.mouse.move(box.x+80,box.y+box.height/2);await page.mouse.down();
    // Longer than the press animation, reproducing the previously leaked forwards fill.
    await page.waitForTimeout(170);await page.mouse.up();
    await expect(summary.locator('..')).toHaveAttribute('open','');
    await expect.poll(()=>summary.evaluate(node=>node.getAnimations().length)).toBe(0);
    expect(await summary.evaluate(node=>getComputedStyle(node).scale)).toMatch(/^(none|1)$/);
    expect(await summary.evaluate(node=>({height:(node as HTMLElement).offsetHeight,font:getComputedStyle(node).fontSize}))).toEqual(before);
    await summary.click();await summary.click();await summary.click();
    await expect(summary.locator('..')).not.toHaveAttribute('open','');
    await expect.poll(()=>summary.evaluate(node=>node.getAnimations().length)).toBe(0);
    expect(await summary.evaluate(node=>getComputedStyle(node).scale)).toMatch(/^(none|1)$/);
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await summaries.first().press('Enter');await expect(summaries.first().locator('..')).toHaveAttribute('open','');
  expect(await page.locator('.soft-disclosure').first().evaluate(node=>node.getAnimations({subtree:true}).length)).toBe(0);
});

test('roundtable decorative strokes stay behind all four faces including hover reactions',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  await signInReader(page);await page.goto('/discover?panel=interests');
  await expect(page.locator('.ct-meeting-illustration')).toBeVisible();
  expect(await page.locator('.ct-meeting-illustration').evaluate(svg=>{
    const marks=svg.querySelector('.ct-conversation-marks')!;
    return [...svg.querySelectorAll('.ct-meeting-person:not(.ct-meeting-foreground-arms)')].every(person=>!!(marks.compareDocumentPosition(person)&Node.DOCUMENT_POSITION_FOLLOWING));
  })).toBe(true);
  await page.getByRole('link',{name:/学习搭子/}).hover();
  await page.screenshot({path:'.local/screenshots/roundtable-face-layers.png'});
});
